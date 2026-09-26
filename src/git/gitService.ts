import * as path from "node:path"
import * as vscode from "vscode"
import type { API, GitExtension, Repository } from "../types/vscode.git"
import { gitExec as defaultGitExec } from "./shell"
import {
  getHeadBranch as apiHeadBranch,
  mapCommit,
  mapRemote,
  mapRepository,
} from "./gitApiMappers"
import {
  parseCommits,
  parseBranches,
  parseRemoteBranches,
  parseRemotes,
  parseTags,
  parseStashes,
  parseWorktrees,
  parseFiles,
  getLogFormat,
} from "./parsers"
import type {
  GitCommit,
  GitBranch,
  GitRemote,
  GitTag,
  GitStash,
  GitWorktree,
  GitFile,
  GitRepository,
} from "./models"

type GitExecFn = typeof defaultGitExec

type GitServiceWorkspaceLike = Pick<
  typeof vscode.workspace,
  | "createFileSystemWatcher"
  | "getWorkspaceFolder"
  | "onDidChangeWorkspaceFolders"
>
type GitServiceWindowLike = Pick<
  typeof vscode.window,
  "activeTextEditor" | "onDidChangeActiveTextEditor"
>
type GitServiceCommandsLike = Pick<typeof vscode.commands, "executeCommand">

interface GitServiceDependencies {
  gitExec?: GitExecFn
  workspace?: GitServiceWorkspaceLike
  window?: GitServiceWindowLike
  commands?: GitServiceCommandsLike
}

interface RepositoryEntry {
  repository: Repository
  subscription: vscode.Disposable
}

export class GitService implements vscode.Disposable {
  private readonly executeGit: GitExecFn
  private readonly workspace: GitServiceWorkspaceLike
  private readonly window: GitServiceWindowLike
  private readonly commands: GitServiceCommandsLike
  private readonly disposables: vscode.Disposable[] = []
  private readonly apiDisposables: vscode.Disposable[] = []
  private readonly repositoryEntries = new Map<string, RepositoryEntry>()
  private readonly linkedWorktrees = new Map<string, Set<string>>()
  private readonly changeEmitter = new vscode.EventEmitter<void>()
  readonly onDidChange = this.changeEmitter.event

  private api: API | undefined
  private repositories: GitRepository[] = []
  private activeRepoPath: string | undefined
  private editorUri: vscode.Uri | undefined
  private manualSelection = false
  private initialDiscovery = true
  private pendingEditorSelection = true
  private disposed = false
  private notificationPending = false
  private refreshPromise: Promise<void> | undefined

  constructor(
    private readonly gitExtension: GitExtension,
    dependencies: GitServiceDependencies = {},
  ) {
    this.executeGit = dependencies.gitExec ?? defaultGitExec
    this.workspace = dependencies.workspace ?? vscode.workspace
    this.window = dependencies.window ?? vscode.window
    this.commands = dependencies.commands ?? vscode.commands
    this.editorUri = this.window.activeTextEditor?.document.uri

    // These watchers only invalidate supplemental CLI results. Git owns discovery.
    for (const pattern of ["**/.git/**", "**/.git"]) {
      const watcher = this.workspace.createFileSystemWatcher(pattern)
      this.disposables.push(
        watcher,
        watcher.onDidChange(() => this.notifyChange()),
        watcher.onDidCreate(() => this.notifyChange()),
        watcher.onDidDelete(() => this.notifyChange()),
      )
    }
    this.disposables.push(
      this.gitExtension.onDidChangeEnablement((enabled) => {
        if (!enabled) {
          this.connect()
          return
        }
        // Git fires enablement before it finishes constructing the public API.
        queueMicrotask(() => {
          if (this.disposed || !this.gitExtension.enabled) return
          try {
            this.connect()
          } catch (error) {
            void vscode.window.showErrorMessage(
              `GitLess could not connect to Git: ${error instanceof Error ? error.message : String(error)}`,
            )
          }
        })
      }),
      this.workspace.onDidChangeWorkspaceFolders(() => this.reconcile()),
      this.window.onDidChangeActiveTextEditor((editor) => {
        if (editor?.document.uri.scheme !== "file") return
        this.editorUri = editor.document.uri
        this.manualSelection = false
        this.pendingEditorSelection = true
        this.reconcile()
      }),
    )
    try {
      this.connect()
    } catch (error) {
      this.dispose()
      throw error
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.disconnect()
    this.disposables.forEach((disposable) => disposable.dispose())
    this.changeEmitter.dispose()
  }

  async refreshRepositories(_forceNotify = false): Promise<void> {
    const api = this.requireApi()
    if (this.refreshPromise) return this.refreshPromise
    const refresh = (async () => {
      const results = await Promise.allSettled(
        [...this.repositoryEntries.values()].map(({ repository }) =>
          repository.status(),
        ),
      )
      if (this.api === api && !this.disposed) this.reconcile()
      const failure = results.find((result) => result.status === "rejected")
      if (failure?.status === "rejected") throw failure.reason
    })()
    this.refreshPromise = refresh
    try {
      await refresh
    } finally {
      if (this.refreshPromise === refresh) this.refreshPromise = undefined
    }
  }

  async getRepositories(): Promise<GitRepository[]> {
    return [...this.repositories]
  }

  async getActiveRepository(): Promise<GitRepository | undefined> {
    return this.repositories.find((repo) => repo.path === this.activeRepoPath)
  }

  async getActiveRepoPath(): Promise<string | undefined> {
    return (await this.getActiveRepository())?.path
  }

  async setActiveRepository(repoPath: string): Promise<void> {
    if (!this.repositories.some((repo) => repo.path === repoPath)) return
    // Even selecting the automatic fallback explicitly must survive late discovery.
    this.manualSelection = true
    this.pendingEditorSelection = false
    this.activeRepoPath = repoPath
    this.notifyChange()
  }

  async getRepositoryForUri(
    uri: vscode.Uri,
  ): Promise<GitRepository | undefined> {
    if (uri.scheme !== "file" || !this.api) return undefined
    const repository = this.api.getRepository(uri)
    if (
      !repository ||
      !this.repositoryEntries.has(repository.rootUri.toString())
    )
      return undefined
    return this.toRepository(repository)
  }

  async getRepoFileContext(
    uri: vscode.Uri,
  ): Promise<{ repoPath: string; relativePath: string } | undefined> {
    const repo = await this.getRepositoryForUri(uri)
    if (!repo) return undefined
    const relativePath = path.relative(repo.path, uri.fsPath)
    if (!isPathInside(repo.path, uri.fsPath) || !relativePath) return undefined
    return {
      repoPath: repo.path,
      relativePath: relativePath.replace(/\\/g, "/"),
    }
  }

  async getRepository(): Promise<GitRepository | undefined> {
    return this.getActiveRepository()
  }

  async getRepoPath(): Promise<string | undefined> {
    return this.getActiveRepoPath()
  }

  async getCommits(
    repoPath: string,
    options?: {
      maxCount?: number
      ref?: string
      path?: string
    },
  ): Promise<GitCommit[]> {
    const repository = this.getApiRepository(repoPath)
    if (repository && !options?.ref) {
      const commits = await repository.log({
        maxEntries: options?.maxCount ?? 50,
        ...(options?.path ? { path: options.path } : {}),
      })
      return commits.map(mapCommit)
    }
    const args = [
      "log",
      `--format=${getLogFormat()}`,
      `--max-count=${options?.maxCount ?? 50}`,
    ]
    if (options?.ref) args.push(options.ref)
    if (options?.path) {
      args.push("--")
      args.push(options.path)
    }
    const output = await this.gitExec(args, { cwd: repoPath })
    return parseCommits(output)
  }

  async getBranches(repoPath: string): Promise<GitBranch[]> {
    const localOutput = await this.gitExec(
      [
        "branch",
        "--format=%(HEAD)<|>%(refname:short)<|>%(objectname:short)<|>%(upstream:short)<|>%(upstream:track)<|>%(creatordate:iso8601)",
      ],
      { cwd: repoPath },
    )
    const localBranches = parseBranches(localOutput)

    try {
      const remoteOutput = await this.gitExec(
        [
          "branch",
          "-r",
          "--format=%(refname:short)<|>%(objectname:short)<|>%(creatordate:iso8601)",
        ],
        { cwd: repoPath },
      )
      const remoteBranches = parseRemoteBranches(remoteOutput)
      return [...localBranches, ...remoteBranches]
    } catch {
      return localBranches
    }
  }

  async getRemotes(repoPath: string): Promise<GitRemote[]> {
    const repository = this.getApiRepository(repoPath)
    if (repository) {
      return repository.state.remotes
        .map(mapRemote)
        .filter((remote): remote is GitRemote => remote !== undefined)
    }
    const output = await this.gitExec(["remote", "-v"], { cwd: repoPath })
    return parseRemotes(output)
  }

  async getPreferredRemote(repoPath: string): Promise<GitRemote | undefined> {
    return pickPreferredRemote(await this.getRemotes(repoPath))
  }

  async getPreferredAutolinkRemote(
    repoPath: string,
  ): Promise<GitRemote | undefined> {
    return pickPreferredAutolinkRemote(await this.getRemotes(repoPath))
  }

  async getOutgoingCommitShasForBranch(
    repoPath: string,
    branch: GitBranch,
  ): Promise<string[]> {
    this.getApiRepository(repoPath)
    if (
      !branch.upstream ||
      branch.upstream.missing ||
      branch.upstream.ahead === 0
    )
      return []

    const output = await this.gitExec(
      [
        "rev-list",
        `--max-count=${branch.upstream.ahead}`,
        branch.name,
        `^${branch.upstream.name}`,
      ],
      { cwd: repoPath },
    )

    return output.trim().split("\n").filter(Boolean)
  }

  async getTags(repoPath: string): Promise<GitTag[]> {
    const output = await this.gitExec(
      [
        "tag",
        "-l",
        "--sort=-creatordate",
        "--format=%(refname:short)<|>%(objectname)<|>%(*objectname)<|>%(creatordate:iso8601)<|>%(contents)<<END_TAG>>",
      ],
      { cwd: repoPath },
    )
    return parseTags(output)
  }

  async getStashes(repoPath: string): Promise<GitStash[]> {
    const output = await this.gitExec(
      ["stash", "list", "--format=%gd%x00%H%x00%aI%x00%an%x00%ae%x00%s"],
      { cwd: repoPath },
    )
    return parseStashes(output)
  }

  async getWorktrees(repoPath: string): Promise<GitWorktree[]> {
    const api = this.requireApi()
    const repository = this.getApiRepository(repoPath)
    const output = await this.gitExec(["worktree", "list", "--porcelain"], {
      cwd: repoPath,
    })
    const worktrees = parseWorktrees(output)
    if (
      repository &&
      this.api === api &&
      this.repositoryEntries.has(repository.rootUri.toString())
    ) {
      this.linkedWorktrees.set(
        repository.rootUri.toString(),
        new Set(
          worktrees.map((worktree) =>
            vscode.Uri.file(worktree.path).toString(),
          ),
        ),
      )
    }
    return worktrees
  }

  async getCommitFiles(repoPath: string, sha: string): Promise<GitFile[]> {
    const output = await this.gitExec(
      ["diff-tree", "--no-commit-id", "-r", "--name-status", sha],
      { cwd: repoPath },
    )
    return parseFiles(output)
  }

  async getStashFiles(repoPath: string, stashSha: string): Promise<GitFile[]> {
    const trackedOutput = await this.gitExec(
      ["stash", "show", "--name-status", stashSha],
      { cwd: repoPath },
    )
    const trackedFiles = parseFiles(trackedOutput)

    try {
      const untrackedOutput = await this.gitExec(
        ["stash", "show", "--only-untracked", "--name-status", stashSha],
        { cwd: repoPath },
      )
      const untrackedFiles = parseFiles(untrackedOutput).map((file) => ({
        ...file,
        status: "untracked" as const,
      }))

      return [...trackedFiles, ...untrackedFiles]
    } catch {
      return trackedFiles
    }
  }

  async getTagCommits(
    repoPath: string,
    tagName: string,
    options?: { maxCount?: number },
  ): Promise<GitCommit[]> {
    const args = [
      "log",
      `--format=${getLogFormat()}`,
      `--max-count=${options?.maxCount ?? 50}`,
      tagName,
    ]
    const output = await this.gitExec(args, { cwd: repoPath })
    return parseCommits(output)
  }

  async getFileContent(
    repoPath: string,
    sha: string,
    filePath: string,
  ): Promise<string> {
    return this.gitExec(["show", `${sha}:${filePath}`], { cwd: repoPath })
  }

  async getHeadSha(repoPath: string): Promise<string> {
    const repository = this.getApiRepository(repoPath)
    if (repository) {
      const sha = repository.state.HEAD?.commit
      if (!sha) throw new Error("HEAD does not point to a commit")
      return sha
    }
    return (await this.gitExec(["rev-parse", "HEAD"], { cwd: repoPath })).trim()
  }

  async getHeadBranch(repoPath: string): Promise<string | undefined> {
    const repository = this.getApiRepository(repoPath)
    if (repository) return apiHeadBranch(repository)
    try {
      return (
        await this.gitExec(["symbolic-ref", "--short", "HEAD"], {
          cwd: repoPath,
        })
      ).trim()
    } catch {
      return undefined
    }
  }

  async getShaForRef(repoPath: string, ref: string): Promise<string> {
    return (await this.gitExec(["rev-parse", ref], { cwd: repoPath })).trim()
  }

  async checkout(repoPath: string, ref: string): Promise<void> {
    await this.requireRepository(repoPath).checkout(ref)
  }

  async applyStash(repoPath: string, index: number): Promise<void> {
    await this.requireRepository(repoPath).applyStash(index)
  }

  async popStash(repoPath: string, index: number): Promise<void> {
    await this.requireRepository(repoPath).popStash(index)
  }

  async createBranchFromStash(
    repoPath: string,
    index: number,
    branchName: string,
  ): Promise<void> {
    const repository = this.requireRepository(repoPath)
    const api = this.requireApi()
    try {
      await this.gitExec(["stash", "branch", branchName, `stash@{${index}}`], {
        cwd: repoPath,
      })
    } finally {
      // A failed stash operation may still have changed the branch or index.
      // Status errors must not replace the operation's original error.
      if (
        this.api === api &&
        this.repositoryEntries.has(repository.rootUri.toString())
      ) {
        await repository.status().catch(() => {})
        if (this.api === api) this.reconcile()
      }
    }
  }

  async dropStash(repoPath: string, index: number): Promise<void> {
    await this.requireRepository(repoPath).dropStash(index)
  }

  async diff(
    repoPath: string,
    ref1: string,
    ref2?: string,
  ): Promise<GitFile[]> {
    const args = ["diff", "--name-status", ref1]
    if (ref2) args.push(ref2)
    const output = await this.gitExec(args, { cwd: repoPath })
    return parseFiles(output)
  }

  async getFileHistory(
    repoPath: string,
    filePath: string,
    options?: { maxCount?: number },
  ): Promise<GitCommit[]> {
    const args = [
      "log",
      `--format=${getLogFormat()}`,
      `--max-count=${options?.maxCount ?? 50}`,
      "--follow",
      "--",
      filePath,
    ]
    const output = await this.gitExec(args, { cwd: repoPath })
    return parseCommits(output)
  }

  async getLineHistory(
    repoPath: string,
    filePath: string,
    startLine: number,
    endLine: number,
    options?: { maxCount?: number },
  ): Promise<GitCommit[]> {
    const args = [
      "log",
      `--format=${getLogFormat()}`,
      `--max-count=${options?.maxCount ?? 50}`,
      `-L${startLine},${endLine}:${filePath}`,
    ]
    const output = await this.gitExec(args, { cwd: repoPath })
    return parseCommits(output)
  }

  async searchCommits(
    repoPath: string,
    query: string,
    options?: {
      maxCount?: number
      mode?: "message" | "author" | "file" | "changes" | "sha"
    },
  ): Promise<GitCommit[]> {
    const mode = options?.mode ?? "message"
    if (mode === "sha") {
      return this.searchCommitBySha(repoPath, query)
    }

    const args = [
      "log",
      `--format=${getLogFormat()}`,
      `--max-count=${options?.maxCount ?? 50}`,
      "--all",
    ]
    switch (mode) {
      case "message":
        args.push(`--grep=${query}`, "-i")
        break
      case "author":
        args.push(`--author=${query}`, "-i")
        break
      case "file":
        args.push("--", query)
        break
      case "changes":
        args.push(`-S${query}`)
        break
    }
    const output = await this.gitExec(args, { cwd: repoPath })
    return parseCommits(output)
  }

  private async searchCommitBySha(
    repoPath: string,
    query: string,
  ): Promise<GitCommit[]> {
    const repository = this.getApiRepository(repoPath)
    const normalizedQuery = query.trim().toLowerCase()
    if (!/^[0-9a-f]{4,40}$/.test(normalizedQuery)) return []

    if (repository) {
      let commit
      try {
        commit = await repository.getCommit(`${normalizedQuery}^{commit}`)
      } catch {
        return []
      }
      return /^[0-9a-f]{40}$/.test(commit.hash) ? [mapCommit(commit)] : []
    }

    // Explicitly listed but unopened worktrees have no API repository handle.
    let resolvedSha: string
    try {
      resolvedSha = (
        await this.gitExec(
          ["rev-parse", "--verify", "--quiet", `${normalizedQuery}^{commit}`],
          { cwd: repoPath },
        )
      ).trim()
    } catch {
      return []
    }
    if (!/^[0-9a-f]{40}$/.test(resolvedSha)) return []
    return parseCommits(
      await this.gitExec(
        ["show", "--no-patch", `--format=${getLogFormat()}`, resolvedSha],
        { cwd: repoPath },
      ),
    )
  }

  private connect(): void {
    this.disconnect()
    if (this.disposed) return
    this.reconcile()
    if (this.gitExtension.enabled) {
      const api = this.gitExtension.getAPI(1)
      this.api = api
      this.initialDiscovery = true
      this.apiDisposables.push(
        api.onDidOpenRepository((repository) => {
          this.addRepository(repository)
          this.reconcile()
        }),
        api.onDidCloseRepository((repository) => {
          const key = repository.rootUri.toString()
          this.repositoryEntries.get(key)?.subscription.dispose()
          this.repositoryEntries.delete(key)
          this.linkedWorktrees.delete(key)
          this.reconcile()
        }),
        api.onDidChangeState(() => this.reconcile()),
      )
      for (const repository of api.repositories) this.addRepository(repository)
    }
    this.reconcile()
  }

  private disconnect(): void {
    this.apiDisposables.splice(0).forEach((disposable) => disposable.dispose())
    for (const { subscription } of this.repositoryEntries.values())
      subscription.dispose()
    this.repositoryEntries.clear()
    this.linkedWorktrees.clear()
    this.api = undefined
    this.refreshPromise = undefined
  }

  private addRepository(repository: Repository): void {
    const key = repository.rootUri.toString()
    if (
      repository.rootUri.scheme !== "file" ||
      repository.isUsingVirtualFileSystem ||
      this.repositoryEntries.has(key)
    )
      return
    this.repositoryEntries.set(key, {
      repository,
      subscription: repository.state.onDidChange(() => this.reconcile()),
    })
  }

  private toRepository(repository: Repository): GitRepository {
    return mapRepository(
      repository,
      this.workspace.getWorkspaceFolder(repository.rootUri)?.name,
    )
  }

  private reconcile(): void {
    if (this.disposed) return
    this.repositories = [...this.repositoryEntries.values()].map(
      ({ repository }) => this.toRepository(repository),
    )
    const currentExists = this.repositories.some(
      (repo) => repo.path === this.activeRepoPath,
    )
    if (!currentExists) this.manualSelection = false
    const editorRepository =
      this.editorUri?.scheme === "file"
        ? this.api?.getRepository(this.editorUri)
        : undefined
    const editorPath =
      editorRepository &&
      this.repositoryEntries.has(editorRepository.rootUri.toString())
        ? editorRepository.rootUri.fsPath
        : undefined
    if (
      (this.initialDiscovery || this.pendingEditorSelection) &&
      !this.manualSelection &&
      editorPath
    ) {
      this.activeRepoPath = editorPath
      this.pendingEditorSelection = false
    } else if (!currentExists) {
      this.activeRepoPath = editorPath ?? this.repositories[0]?.path
    }
    if (this.api?.state === "initialized") this.initialDiscovery = false
    void this.commands.executeCommand(
      "setContext",
      "gitless:repositories:multiple",
      this.repositories.length > 1,
    )
    this.notifyChange()
  }

  private notifyChange(): void {
    if (this.disposed || this.notificationPending) return
    this.notificationPending = true
    queueMicrotask(() => {
      this.notificationPending = false
      if (!this.disposed) this.changeEmitter.fire()
    })
  }

  private requireApi(): API {
    if (this.disposed || !this.gitExtension.enabled || !this.api) {
      throw new Error("The built-in Git extension is not available")
    }
    return this.api
  }

  private getApiRepository(repoPath: string): Repository | undefined {
    this.requireApi()
    const key = vscode.Uri.file(repoPath).toString()
    const repository = this.repositoryEntries.get(key)?.repository
    if (repository) return repository
    const knownWorktree =
      [...this.repositoryEntries.values()].some(({ repository }) =>
        repository.state.worktrees.some(
          (worktree) => vscode.Uri.file(worktree.path).toString() === key,
        ),
      ) || [...this.linkedWorktrees.values()].some((paths) => paths.has(key))
    if (!knownWorktree)
      throw new Error(`Repository is not open in VS Code Git: ${repoPath}`)
    return undefined
  }

  private requireRepository(repoPath: string): Repository {
    const repository = this.getApiRepository(repoPath)
    if (!repository)
      throw new Error(
        `Open the worktree in VS Code Git to change it: ${repoPath}`,
      )
    return repository
  }

  private gitExec(args: string[], options: { cwd: string }): Promise<string> {
    this.getApiRepository(options.cwd)
    return this.executeGit(args, {
      ...options,
      gitPath: this.requireApi().git.path,
    })
  }
}

function pickPreferredRemote(remotes: GitRemote[]): GitRemote | undefined {
  return (
    remotes.find((remote) => remote.name === "origin" && remote.provider) ??
    remotes.find((remote) => remote.provider)
  )
}

function pickPreferredAutolinkRemote(
  remotes: GitRemote[],
): GitRemote | undefined {
  return (
    remotes.find((remote) => remote.name === "upstream" && remote.provider) ??
    remotes.find((remote) => remote.name === "origin" && remote.provider) ??
    remotes.find((remote) => remote.provider)
  )
}

function isPathInside(basePath: string, candidatePath: string): boolean {
  const relativePath = path.relative(basePath, candidatePath)
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  )
}
