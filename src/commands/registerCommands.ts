import * as vscode from "vscode"
import type { GitService } from "../git/gitService"
import { Commands } from "../constants"
import { shortenSha } from "../config"
import { getRemoteUrl } from "../git/remoteUrls"
import type { GitRemote } from "../git/models"
import { makeRevisionUri } from "./revisionContentProvider"

interface CommandContext {
  gitService: GitService
  outputChannel: vscode.OutputChannel
}

export function registerCommands(ctx: CommandContext): vscode.Disposable[] {
  const { gitService } = ctx
  const disposables: vscode.Disposable[] = []

  function register(
    commandId: string,
    handler: (...args: unknown[]) => Promise<void> | void,
  ): void {
    disposables.push(vscode.commands.registerCommand(commandId, handler))
  }

  // Helper: get the preferred remote provider
  async function getPreferredRemote(
    repoPath: string,
  ): Promise<GitRemote | undefined> {
    const remotes = await gitService.getRemotes(repoPath)
    // Prefer 'origin', then first remote with a provider
    return (
      remotes.find((r) => r.name === "origin" && r.provider) ??
      remotes.find((r) => r.provider)
    )
  }

  // Helper: get current file info from active editor
  async function getActiveFileInfo(): Promise<
    | {
        uri: vscode.Uri
        repoPath: string
        relativePath: string | undefined
      }
    | undefined
  > {
    const editor = vscode.window.activeTextEditor
    if (!editor) return undefined
    const uri = editor.document.uri
    const fileContext = await gitService.getRepoFileContext(uri)
    if (!fileContext) return undefined
    return { uri, ...fileContext }
  }

  async function getRepoPath(
    node?: { repoPath?: string } | undefined,
  ): Promise<string | undefined> {
    return node?.repoPath ?? (await gitService.getActiveRepoPath())
  }

  // Helper: copy to clipboard and show message (status bar, auto-dismisses)
  async function copyToClipboard(value: string, label: string): Promise<void> {
    await vscode.env.clipboard.writeText(value)
    vscode.window.setStatusBarMessage(`$(check) Copied ${label}`, 3000)
  }

  // Helper: show quick pick for choosing a remote
  async function pickRemote(repoPath: string): Promise<GitRemote | undefined> {
    const remotes = await gitService.getRemotes(repoPath)
    const remotesWithProvider = remotes.filter((r) => r.provider)
    if (remotesWithProvider.length === 0) {
      vscode.window.showWarningMessage("No supported remote providers found")
      return undefined
    }
    if (remotesWithProvider.length === 1) return remotesWithProvider[0]

    const items = remotesWithProvider.map((r) => ({
      label: r.name,
      description: r.url,
      remote: r,
    }))
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "Choose a remote",
    })
    return picked?.remote
  }

  // Helper: show quick pick for ref (branch/tag/sha)
  async function pickRef(repoPath: string): Promise<string | undefined> {
    const [branches, tags] = await Promise.all([
      gitService.getBranches(repoPath),
      gitService.getTags(repoPath),
    ])

    const items: vscode.QuickPickItem[] = [
      ...branches
        .filter((b) => !b.remote)
        .map((b) => ({
          label: b.name,
          description: b.current ? "$(check) current" : "",
          detail: "Branch",
        })),
      ...tags.map((t) => ({
        label: t.name,
        detail: "Tag",
      })),
    ]

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "Choose a branch, tag, or enter a SHA",
    })
    return picked?.label
  }

  // ── Command Palette Commands ──

  register(Commands.SelectRepository, async () => {
    const repositories = await gitService.getRepositories()
    if (repositories.length === 0) return

    const activeRepository = await gitService.getActiveRepository()
    const picked = await vscode.window.showQuickPick(
      repositories.map((repo) => ({
        label: repo.label,
        description:
          repo.workspaceFolderName && repo.workspaceFolderName !== repo.label
            ? repo.workspaceFolderName
            : undefined,
        detail: repo.path,
        repoPath: repo.path,
      })),
      {
        placeHolder: "Select a repository",
      },
    )
    if (!picked || picked.repoPath === activeRepository?.path) return

    await gitService.setActiveRepository(picked.repoPath)
  })

  register(Commands.CopyRemoteRepoUrl, async (...args: unknown[]) => {
    const node = args[0] as { repoPath?: string } | undefined
    const repoPath = await getRepoPath(node)
    if (!repoPath) return

    const remote = await getPreferredRemote(repoPath)
    if (!remote?.provider) {
      vscode.window.showWarningMessage("No supported remote provider found")
      return
    }

    const url = getRemoteUrl(remote.provider, { type: "repo" })
    if (url) await copyToClipboard(url, "repository URL")
  })

  register(Commands.CopyRemoteFileUrl, async (...args: unknown[]) => {
    // Check if called from tree view context
    const node = args[0] as
      | { sha?: string; filePath?: string; repoPath?: string }
      | undefined
    let filePath: string | undefined
    let repoPath: string | undefined
    let ref: string | undefined

    if (node?.filePath) {
      filePath = node.filePath
      repoPath = await getRepoPath(node)
      ref = undefined // use HEAD branch
    } else {
      const fileInfo = await getActiveFileInfo()
      if (!fileInfo?.relativePath) {
        vscode.window.showWarningMessage("No file is currently open")
        return
      }
      repoPath = fileInfo.repoPath
      filePath = fileInfo.relativePath
    }
    if (!repoPath) return

    const remote = await getPreferredRemote(repoPath)
    if (!remote?.provider) {
      vscode.window.showWarningMessage("No supported remote provider found")
      return
    }

    const branch = ref ?? (await gitService.getHeadBranch(repoPath))
    const url = getRemoteUrl(remote.provider, {
      type: "file",
      fileName: filePath,
      branch,
    })
    if (url) await copyToClipboard(url, "file URL")
  })

  register(Commands.CopyRemoteFileUrlFrom, async () => {
    const fileInfo = await getActiveFileInfo()
    const repoPath = fileInfo?.repoPath
    if (!repoPath) return

    if (!fileInfo?.relativePath) {
      vscode.window.showWarningMessage("No file is currently open")
      return
    }

    const ref = await pickRef(repoPath)
    if (!ref) return

    const remote = await getPreferredRemote(repoPath)
    if (!remote?.provider) {
      vscode.window.showWarningMessage("No supported remote provider found")
      return
    }

    // Check if ref is a tag
    const tags = await gitService.getTags(repoPath)
    const isTag = tags.some((t) => t.name === ref)

    let sha: string | undefined
    if (!isTag) {
      try {
        sha = await gitService.getShaForRef(repoPath, ref)
      } catch {
        // use ref as branch name
      }
    }

    const url = getRemoteUrl(remote.provider, {
      type: "file",
      fileName: fileInfo.relativePath,
      sha,
      branch: sha ? undefined : isTag ? undefined : ref,
      tag: isTag ? ref : undefined,
    })
    if (url) await copyToClipboard(url, "file URL")
  })

  register(Commands.CopyRemoteCommitUrl, async (...args: unknown[]) => {
    const node = args[0] as { sha?: string; repoPath?: string } | undefined
    const repoPath = await getRepoPath(node)
    if (!repoPath) return

    const sha = node?.sha ?? (await gitService.getHeadSha(repoPath))

    const remote = await getPreferredRemote(repoPath)
    if (!remote?.provider) {
      vscode.window.showWarningMessage("No supported remote provider found")
      return
    }

    const url = getRemoteUrl(remote.provider, { type: "commit", sha })
    if (url) await copyToClipboard(url, "commit URL")
  })

  register(Commands.CopyRemoteCommitUrlFrom, async () => {
    const repoPath = await gitService.getActiveRepoPath()
    if (!repoPath) return

    const remote = await pickRemote(repoPath)
    if (!remote?.provider) return

    const sha = await gitService.getHeadSha(repoPath)
    const url = getRemoteUrl(remote.provider, { type: "commit", sha })
    if (url) await copyToClipboard(url, "commit URL")
  })

  register(Commands.CopySha, async (...args: unknown[]) => {
    const node = args[0] as { sha?: string; repoPath?: string } | undefined
    const repoPath = await getRepoPath(node)
    if (!repoPath) return

    const sha = node?.sha ?? (await gitService.getHeadSha(repoPath))
    await copyToClipboard(sha, "SHA")
  })

  register(Commands.CopyShortSha, async (...args: unknown[]) => {
    const node = args[0] as { sha?: string; repoPath?: string } | undefined
    const repoPath = await getRepoPath(node)
    if (!repoPath) return

    const sha = node?.sha ?? (await gitService.getHeadSha(repoPath))
    await copyToClipboard(shortenSha(sha), "short SHA")
  })

  register(Commands.CopyMessage, async (...args: unknown[]) => {
    const node = args[0] as { message?: string } | undefined
    if (node?.message) {
      await copyToClipboard(node.message, "message")
    }
  })

  // ── View Action Commands ──

  register(Commands.OpenFileAtRevision, async (...args: unknown[]) => {
    const node = args[0] as
      | { sha?: string; filePath?: string; repoPath?: string }
      | undefined
    if (!node?.sha || !node?.filePath || !node?.repoPath) return

    const uri = makeRevisionUri(node.repoPath, node.filePath, node.sha)
    await vscode.window.showTextDocument(uri, { preview: true })
  })

  register(Commands.OpenFile, async (...args: unknown[]) => {
    const node = args[0] as { filePath?: string; repoPath?: string } | undefined
    if (!node?.filePath || !node?.repoPath) return

    const uri = vscode.Uri.file(`${node.repoPath}/${node.filePath}`)
    await vscode.window.showTextDocument(uri, { preview: true })
  })

  register(Commands.OpenChanges, async (...args: unknown[]) => {
    const node = args[0] as
      | {
          sha?: string
          previousSha?: string
          filePath?: string
          repoPath?: string
        }
      | undefined
    if (!node?.sha || !node?.filePath || !node?.repoPath) return

    const leftSha = node.previousSha ?? `${node.sha}~1`
    const leftUri = makeRevisionUri(node.repoPath, node.filePath, leftSha)
    const rightUri = makeRevisionUri(node.repoPath, node.filePath, node.sha)
    const title = node.previousSha
      ? `${node.filePath} (${shortenSha(node.previousSha)} <-> ${shortenSha(node.sha)})`
      : `${node.filePath} (${shortenSha(node.sha)})`
    await vscode.commands.executeCommand(
      "vscode.diff",
      leftUri,
      rightUri,
      title,
    )
  })

  register(Commands.OpenChangesWithWorking, async (...args: unknown[]) => {
    const node = args[0] as
      | { sha?: string; filePath?: string; repoPath?: string }
      | undefined
    if (!node?.sha || !node?.filePath || !node?.repoPath) return

    const revisionUri = makeRevisionUri(node.repoPath, node.filePath, node.sha)
    const workingUri = vscode.Uri.file(`${node.repoPath}/${node.filePath}`)
    const title = `${node.filePath} (${shortenSha(node.sha)} ↔ Working)`
    await vscode.commands.executeCommand(
      "vscode.diff",
      revisionUri,
      workingUri,
      title,
    )
  })

  register(Commands.OpenFileOnRemote, async (...args: unknown[]) => {
    const node = args[0] as
      | { sha?: string; filePath?: string; repoPath?: string }
      | undefined

    let filePath: string | undefined
    let repoPath: string | undefined
    let sha: string | undefined

    if (node?.filePath && node?.repoPath) {
      filePath = node.filePath
      repoPath = node.repoPath
      sha = node.sha
    } else {
      const fileInfo = await getActiveFileInfo()
      if (!fileInfo?.relativePath) {
        vscode.window.showWarningMessage("No file is currently open")
        return
      }
      repoPath = fileInfo.repoPath
      filePath = fileInfo.relativePath
    }

    if (!repoPath) return

    const remote = await getPreferredRemote(repoPath)
    if (!remote?.provider) {
      vscode.window.showWarningMessage("No supported remote provider found")
      return
    }

    const branch = sha ? undefined : await gitService.getHeadBranch(repoPath)
    const url = getRemoteUrl(remote.provider, {
      type: "file",
      fileName: filePath,
      sha,
      branch,
    })
    if (url) await vscode.env.openExternal(vscode.Uri.parse(url))
  })

  register(Commands.OpenCommitOnRemote, async (...args: unknown[]) => {
    const node = args[0] as { sha?: string; repoPath?: string } | undefined
    const repoPath = await getRepoPath(node)
    if (!repoPath) return

    const sha = node?.sha ?? (await gitService.getHeadSha(repoPath))

    const remote = await getPreferredRemote(repoPath)
    if (!remote?.provider) {
      vscode.window.showWarningMessage("No supported remote provider found")
      return
    }

    const url = getRemoteUrl(remote.provider, { type: "commit", sha })
    if (url) await vscode.env.openExternal(vscode.Uri.parse(url))
  })

  register(Commands.CompareWithHead, async (...args: unknown[]) => {
    const node = args[0] as { sha?: string; repoPath?: string } | undefined
    if (!node?.sha || !node?.repoPath) return

    const files = await gitService.diff(node.repoPath, node.sha, "HEAD")
    if (files.length === 0) {
      vscode.window.setStatusBarMessage("$(check) No differences found", 3000)
      return
    }

    // Open first file diff as preview
    const file = files[0]
    const leftUri = makeRevisionUri(node.repoPath, file.path, node.sha)
    const rightUri = makeRevisionUri(node.repoPath, file.path, "HEAD")
    const title = `${file.path} (${shortenSha(node.sha)} ↔ HEAD)`
    await vscode.commands.executeCommand(
      "vscode.diff",
      leftUri,
      rightUri,
      title,
    )
  })

  register(Commands.CompareFromHead, async (...args: unknown[]) => {
    const node = args[0] as { sha?: string; repoPath?: string } | undefined
    if (!node?.sha || !node?.repoPath) return

    const files = await gitService.diff(node.repoPath, "HEAD", node.sha)
    if (files.length === 0) {
      vscode.window.setStatusBarMessage("$(check) No differences found", 3000)
      return
    }

    const file = files[0]
    const leftUri = makeRevisionUri(node.repoPath, file.path, "HEAD")
    const rightUri = makeRevisionUri(node.repoPath, file.path, node.sha)
    const title = `${file.path} (HEAD ↔ ${shortenSha(node.sha)})`
    await vscode.commands.executeCommand(
      "vscode.diff",
      leftUri,
      rightUri,
      title,
    )
  })

  register(Commands.CompareWorkingWith, async (...args: unknown[]) => {
    const node = args[0] as { sha?: string; repoPath?: string } | undefined
    if (!node?.sha || !node?.repoPath) return

    const files = await gitService.diff(node.repoPath, node.sha)
    if (files.length === 0) {
      vscode.window.setStatusBarMessage("$(check) No differences found", 3000)
      return
    }

    const file = files[0]
    const leftUri = makeRevisionUri(node.repoPath, file.path, node.sha)
    const rightUri = vscode.Uri.file(`${node.repoPath}/${file.path}`)
    const title = `${file.path} (${shortenSha(node.sha)} ↔ Working Tree)`
    await vscode.commands.executeCommand(
      "vscode.diff",
      leftUri,
      rightUri,
      title,
    )
  })

  register(Commands.CheckoutTag, async (...args: unknown[]) => {
    const node = args[0] as { name?: string; repoPath?: string } | undefined
    if (!node?.name || !node?.repoPath) return

    try {
      await gitService.checkout(node.repoPath, `tags/${node.name}`)
      vscode.window.setStatusBarMessage(
        `$(check) Checked out tag '${node.name}'`,
        3000,
      )
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to checkout tag: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  })

  register(Commands.CopyTag, async (...args: unknown[]) => {
    const node = args[0] as { name?: string } | undefined
    if (node?.name) {
      await copyToClipboard(node.name, "tag name")
    }
  })

  register(Commands.CopyTagMessage, async (...args: unknown[]) => {
    const node = args[0] as
      | { message?: string; annotation?: string }
      | undefined
    const message = node?.annotation ?? node?.message
    if (message) {
      await copyToClipboard(message, "tag message")
    } else {
      vscode.window.showWarningMessage("This tag has no message")
    }
  })

  register(Commands.OpenAllChanges, async (...args: unknown[]) => {
    const node = args[0] as { sha?: string; repoPath?: string } | undefined
    if (!node?.sha || !node?.repoPath) return

    const files = await gitService.getCommitFiles(node.repoPath, node.sha)
    for (const file of files) {
      const parentSha = `${node.sha}~1`
      const leftUri = makeRevisionUri(node.repoPath, file.path, parentSha)
      const rightUri = makeRevisionUri(node.repoPath, file.path, node.sha)
      const title = `${file.path} (${shortenSha(node.sha)})`
      await vscode.commands.executeCommand(
        "vscode.diff",
        leftUri,
        rightUri,
        title,
        { preview: false },
      )
    }
  })

  register(Commands.OpenAllChangesWithWorking, async (...args: unknown[]) => {
    const node = args[0] as { sha?: string; repoPath?: string } | undefined
    if (!node?.sha || !node?.repoPath) return

    const files = await gitService.getCommitFiles(node.repoPath, node.sha)
    for (const file of files) {
      const leftUri = makeRevisionUri(node.repoPath, file.path, node.sha)
      const rightUri = vscode.Uri.file(`${node.repoPath}/${file.path}`)
      const title = `${file.path} (${shortenSha(node.sha)} ↔ Working)`
      await vscode.commands.executeCommand(
        "vscode.diff",
        leftUri,
        rightUri,
        title,
        { preview: false },
      )
    }
  })

  register(Commands.RefreshView, () => {
    vscode.commands.executeCommand(
      "workbench.actions.treeView.gitless.views.commits.refresh",
    )
  })

  // ── Share/Link Commands ──

  register(Commands.CopyRemoteFileUrlAtRevision, async (...args: unknown[]) => {
    const node = args[0] as
      | { sha?: string; filePath?: string; repoPath?: string }
      | undefined
    if (!node?.sha || !node?.filePath) return

    const repoPath = await getRepoPath(node)
    if (!repoPath) return

    const remote = await getPreferredRemote(repoPath)
    if (!remote?.provider) {
      vscode.window.showWarningMessage("No supported remote provider found")
      return
    }

    const url = getRemoteUrl(remote.provider, {
      type: "file",
      fileName: node.filePath,
      sha: node.sha,
    })
    if (url) await copyToClipboard(url, "file URL at revision")
  })

  register(Commands.CopyRemoteCommitFileUrl, async (...args: unknown[]) => {
    const node = args[0] as
      | { sha?: string; filePath?: string; repoPath?: string }
      | undefined

    const repoPath = await getRepoPath(node)
    if (!repoPath) return

    const sha = node?.sha ?? (await gitService.getHeadSha(repoPath))

    const remote = await getPreferredRemote(repoPath)
    if (!remote?.provider) {
      vscode.window.showWarningMessage("No supported remote provider found")
      return
    }

    const url = getRemoteUrl(remote.provider, { type: "commit", sha })
    if (url) await copyToClipboard(url, "link to commit")
  })

  register(
    Commands.CopyRemoteCommitFileUrlAtRevision,
    async (...args: unknown[]) => {
      const node = args[0] as
        | { sha?: string; filePath?: string; repoPath?: string }
        | undefined
      if (!node?.sha || !node?.filePath) return

      const repoPath = await getRepoPath(node)
      if (!repoPath) return

      const remote = await getPreferredRemote(repoPath)
      if (!remote?.provider) {
        vscode.window.showWarningMessage("No supported remote provider found")
        return
      }

      const url = getRemoteUrl(remote.provider, {
        type: "file",
        fileName: node.filePath,
        sha: node.sha,
      })
      if (url) await copyToClipboard(url, "link to commit at revision")
    },
  )

  return disposables
}
