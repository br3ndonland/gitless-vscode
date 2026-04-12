import * as path from "node:path"
import * as vscode from "vscode"
import { gitExec as defaultGitExec } from "./shell"
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
import { getConfig as defaultGetConfig } from "../config"

type GitExecFn = typeof defaultGitExec
type GetConfigFn = typeof defaultGetConfig
const MAX_REPOSITORY_MARKER_RESULTS = 1000

interface GitServiceWorkspaceLike {
  workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined
  createFileSystemWatcher(
    globPattern: vscode.GlobPattern,
  ): vscode.FileSystemWatcher
  findFiles(
    include: vscode.GlobPattern,
    exclude?: vscode.GlobPattern | null,
    maxResults?: number,
  ): Thenable<vscode.Uri[]>
  onDidChangeWorkspaceFolders(
    listener: (e: vscode.WorkspaceFoldersChangeEvent) => unknown,
  ): vscode.Disposable
}

interface GitServiceWindowLike {
  activeTextEditor: vscode.TextEditor | undefined
  onDidChangeActiveTextEditor(
    listener: (editor: vscode.TextEditor | undefined) => unknown,
  ): vscode.Disposable
}

interface GitServiceCommandsLike {
  executeCommand(command: string, ...rest: unknown[]): Thenable<unknown>
}

interface GitServiceDependencies {
  gitExec?: GitExecFn
  getConfig?: GetConfigFn
  workspace?: GitServiceWorkspaceLike
  window?: GitServiceWindowLike
  commands?: GitServiceCommandsLike
}

export class GitService implements vscode.Disposable {
  private readonly gitExec: GitExecFn
  private readonly getConfig: GetConfigFn
  private readonly workspace: GitServiceWorkspaceLike
  private readonly window: GitServiceWindowLike
  private readonly commands: GitServiceCommandsLike

  private _disposables: vscode.Disposable[] = []
  private _onDidChange = new vscode.EventEmitter<void>()
  readonly onDidChange = this._onDidChange.event

  private repositories: GitRepository[] = []
  private activeRepoPath: string | undefined
  private initialized = false
  private refreshPromise: Promise<void> | undefined
  private pendingRefreshNotification = false

  constructor(dependencies: GitServiceDependencies = {}) {
    this.gitExec = dependencies.gitExec ?? defaultGitExec
    this.getConfig = dependencies.getConfig ?? defaultGetConfig
    this.workspace = dependencies.workspace ?? vscode.workspace
    this.window = dependencies.window ?? vscode.window
    this.commands = dependencies.commands ?? vscode.commands

    for (const pattern of ["**/.git/**", "**/.git"]) {
      const watcher = this.workspace.createFileSystemWatcher(pattern)
      watcher.onDidChange(() => void this.refreshRepositories(true))
      watcher.onDidCreate(() => void this.refreshRepositories(true))
      watcher.onDidDelete(() => void this.refreshRepositories(true))
      this._disposables.push(watcher)
    }

    this._disposables.push(
      this.workspace.onDidChangeWorkspaceFolders(
        () => void this.refreshRepositories(true),
      ),
      this.window.onDidChangeActiveTextEditor(
        (editor) => void this.handleActiveTextEditorChange(editor),
      ),
    )

    void this.refreshRepositories()
  }

  dispose(): void {
    this._disposables.forEach((d) => d.dispose())
    this._onDidChange.dispose()
  }

  async refreshRepositories(forceNotify = false): Promise<void> {
    this.pendingRefreshNotification =
      this.pendingRefreshNotification || forceNotify

    if (this.refreshPromise) {
      await this.refreshPromise
      return
    }

    this.refreshPromise = this.doRefreshRepositories().finally(() => {
      this.refreshPromise = undefined
    })
    await this.refreshPromise
  }

  async getRepositories(): Promise<GitRepository[]> {
    await this.ensureRepositories()
    return [...this.repositories]
  }

  async getActiveRepository(): Promise<GitRepository | undefined> {
    await this.ensureRepositories()
    return this.findRepositoryByPath(this.activeRepoPath)
  }

  async getActiveRepoPath(): Promise<string | undefined> {
    return (await this.getActiveRepository())?.path
  }

  async setActiveRepository(repoPath: string): Promise<void> {
    await this.ensureRepositories()
    if (!this.findRepositoryByPath(repoPath)) return
    if (repoPath === this.activeRepoPath) return

    this.activeRepoPath = repoPath
    await this.updateContexts()
    this._onDidChange.fire()
  }

  async getRepositoryForUri(
    uri: vscode.Uri,
  ): Promise<GitRepository | undefined> {
    await this.ensureRepositories()
    if (uri.scheme !== "file") return undefined
    return this.findRepositoryForFsPath(uri.fsPath)
  }

  async getRepoFileContext(
    uri: vscode.Uri,
  ): Promise<{ repoPath: string; relativePath: string } | undefined> {
    const repo = await this.getRepositoryForUri(uri)
    if (!repo) return undefined

    const relativePath = path.relative(repo.path, uri.fsPath)
    if (!isPathInside(repo.path, uri.fsPath) || !relativePath) {
      return undefined
    }

    return {
      repoPath: repo.path,
      relativePath: normalizeGitPath(relativePath),
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
    const output = await this.gitExec(["worktree", "list", "--porcelain"], {
      cwd: repoPath,
    })
    return parseWorktrees(output)
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
    return (await this.gitExec(["rev-parse", "HEAD"], { cwd: repoPath })).trim()
  }

  async getHeadBranch(repoPath: string): Promise<string | undefined> {
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
    await this.gitExec(["checkout", ref], { cwd: repoPath })
  }

  async applyStash(repoPath: string, index: number): Promise<void> {
    await this.gitExec(["stash", "apply", `stash@{${index}}`], {
      cwd: repoPath,
    })
  }

  async dropStash(repoPath: string, index: number): Promise<void> {
    await this.gitExec(["stash", "drop", `stash@{${index}}`], {
      cwd: repoPath,
    })
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
    const normalizedQuery = query.trim().toLowerCase()
    if (!/^[0-9a-f]{4,40}$/.test(normalizedQuery)) return []

    let resolvedSha: string
    try {
      const output = await this.gitExec(
        ["rev-parse", "--verify", "--quiet", `${normalizedQuery}^{commit}`],
        { cwd: repoPath },
      )
      resolvedSha = output.trim()
    } catch {
      return []
    }

    if (!/^[0-9a-f]{40}$/.test(resolvedSha)) return []

    const output = await this.gitExec(
      ["show", "--no-patch", `--format=${getLogFormat()}`, resolvedSha],
      { cwd: repoPath },
    )
    return parseCommits(output)
  }

  private async ensureRepositories(): Promise<void> {
    if (this.initialized) return
    await this.refreshRepositories()
  }

  private async doRefreshRepositories(): Promise<void> {
    const forceNotify = this.pendingRefreshNotification
    this.pendingRefreshNotification = false

    const previousRepoPaths = this.repositories.map((repo) => repo.path)
    const previousActiveRepoPath = this.activeRepoPath
    const repositories = await this.discoverRepositories()

    this.repositories = repositories
    this.initialized = true

    this.activeRepoPath = this.pickActiveRepositoryPath(
      repositories,
      previousActiveRepoPath,
      await this.getActiveEditorRepoPath(repositories),
    )

    await this.updateContexts()

    if (
      forceNotify ||
      previousActiveRepoPath !== this.activeRepoPath ||
      !sameRepositoryPaths(previousRepoPaths, repositories)
    ) {
      this._onDidChange.fire()
    }
  }

  private async discoverRepositories(): Promise<GitRepository[]> {
    const workspaceFolders = this.workspace.workspaceFolders
    if (!workspaceFolders?.length) return []

    const candidates = (
      await Promise.all(
        workspaceFolders.map((folder) =>
          this.discoverRepositoryCandidates(folder),
        ),
      )
    ).flat()

    const repositories = await Promise.all(
      candidates.map((candidate) =>
        this.resolveRepositoryFromFsPath(
          candidate.fsPath,
          candidate.workspaceFolderName,
        ),
      ),
    )

    const repositoriesByPath = new Map<string, GitRepository>()
    for (const repository of repositories) {
      if (!repository) continue
      if (!repositoriesByPath.has(repository.path)) {
        repositoriesByPath.set(repository.path, repository)
      }
    }

    return [...repositoriesByPath.values()]
  }

  private async discoverRepositoryCandidates(
    folder: vscode.WorkspaceFolder,
  ): Promise<Array<{ fsPath: string; workspaceFolderName?: string }>> {
    const candidatePaths = new Set<string>([folder.uri.fsPath])

    const markerUris = await this.findChildGitMarkers(folder)
    for (const markerUri of markerUris) {
      const repoPath = getRepositoryPathFromGitMarker(markerUri.fsPath)
      if (repoPath) candidatePaths.add(repoPath)
    }

    return [...candidatePaths]
      .sort(compareRepositoryCandidatePaths)
      .map((fsPath) => ({ fsPath, workspaceFolderName: folder.name }))
  }

  private async findChildGitMarkers(
    folder: vscode.WorkspaceFolder,
  ): Promise<vscode.Uri[]> {
    const repositoryScanMaxDepth = this.getRepositoryScanMaxDepth()
    const markerPatterns = getGitMarkerPatterns(repositoryScanMaxDepth)
    if (markerPatterns.length === 0) return []

    try {
      const markerUris = await Promise.all(
        markerPatterns.map((markerPattern) =>
          this.workspace.findFiles(
            new vscode.RelativePattern(folder, markerPattern),
            null,
            MAX_REPOSITORY_MARKER_RESULTS,
          ),
        ),
      )

      return markerUris.flat()
    } catch {
      return []
    }
  }

  private getRepositoryScanMaxDepth(): number {
    const configured = this.getConfig<number>("repositoryScanMaxDepth")
    if (configured === undefined || !Number.isFinite(configured)) return 1
    return Math.trunc(configured)
  }

  private async resolveRepositoryFromFsPath(
    fsPath: string,
    workspaceFolderName?: string,
  ): Promise<GitRepository | undefined> {
    const cwd = normalizeCwd(fsPath)

    try {
      const rootPath = (
        await this.gitExec(["rev-parse", "--show-toplevel"], { cwd })
      ).trim()
      const { headSha, headBranch } = await this.getHeadInfo(rootPath)

      return {
        path: rootPath,
        rootUri: vscode.Uri.file(rootPath).toString(),
        label: path.basename(rootPath) || rootPath,
        workspaceFolderName,
        headSha,
        headBranch,
      }
    } catch {
      return undefined
    }
  }

  private async getHeadInfo(
    repoPath: string,
  ): Promise<Pick<GitRepository, "headSha" | "headBranch">> {
    let headSha: string | undefined
    let headBranch: string | undefined

    try {
      headSha = (
        await this.gitExec(["rev-parse", "HEAD"], { cwd: repoPath })
      ).trim()
    } catch {
      headSha = undefined
    }

    try {
      headBranch = (
        await this.gitExec(["symbolic-ref", "--short", "HEAD"], {
          cwd: repoPath,
        })
      ).trim()
    } catch {
      headBranch = undefined
    }

    return { headSha, headBranch }
  }

  private async getActiveEditorRepoPath(
    repositories: GitRepository[],
  ): Promise<string | undefined> {
    const editor = this.window.activeTextEditor
    if (!editor || editor.document.uri.scheme !== "file") return undefined
    return this.findRepositoryForFsPath(
      editor.document.uri.fsPath,
      repositories,
    )?.path
  }

  private pickActiveRepositoryPath(
    repositories: GitRepository[],
    currentActiveRepoPath: string | undefined,
    activeEditorRepoPath: string | undefined,
  ): string | undefined {
    const repositoryPaths = new Set(repositories.map((repo) => repo.path))

    if (currentActiveRepoPath && repositoryPaths.has(currentActiveRepoPath)) {
      return currentActiveRepoPath
    }

    if (activeEditorRepoPath && repositoryPaths.has(activeEditorRepoPath)) {
      return activeEditorRepoPath
    }

    return repositories[0]?.path
  }

  private async handleActiveTextEditorChange(
    editor: vscode.TextEditor | undefined,
  ): Promise<void> {
    if (!editor || editor.document.uri.scheme !== "file") return

    const repository = await this.getRepositoryForUri(editor.document.uri)
    if (!repository) return
    if (repository.path === this.activeRepoPath) return

    this.activeRepoPath = repository.path
    await this.updateContexts()
    this._onDidChange.fire()
  }

  private findRepositoryByPath(
    repoPath: string | undefined,
  ): GitRepository | undefined {
    if (!repoPath) return undefined
    return this.repositories.find((repo) => repo.path === repoPath)
  }

  private findRepositoryForFsPath(
    fsPath: string,
    repositories = this.repositories,
  ): GitRepository | undefined {
    return [...repositories]
      .sort((a, b) => b.path.length - a.path.length)
      .find((repo) => isPathInside(repo.path, fsPath))
  }

  private async updateContexts(): Promise<void> {
    await this.commands.executeCommand(
      "setContext",
      "gitless:repositories:multiple",
      this.repositories.length > 1,
    )
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

function normalizeCwd(fsPath: string): string {
  return fsPath
}

function isPathInside(basePath: string, candidatePath: string): boolean {
  const relativePath = path.relative(basePath, candidatePath)
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  )
}

function normalizeGitPath(filePath: string): string {
  return filePath.replace(/\\/g, "/")
}

function getRepositoryPathFromGitMarker(
  markerPath: string,
): string | undefined {
  const markerName = path.basename(markerPath)
  if (markerName === ".git") return path.dirname(markerPath)

  const markerParent = path.dirname(markerPath)
  if (markerName === "HEAD" && path.basename(markerParent) === ".git") {
    return path.dirname(markerParent)
  }

  return undefined
}

function getGitMarkerPatterns(repositoryScanMaxDepth: number): string[] {
  if (repositoryScanMaxDepth === -1) return ["**/.git", "**/.git/HEAD"]
  if (repositoryScanMaxDepth <= 0) return []

  return Array.from({ length: repositoryScanMaxDepth }, (_, index) => {
    return Array.from({ length: index + 1 }, () => "*").join("/")
  }).flatMap((prefix) => [`${prefix}/.git`, `${prefix}/.git/HEAD`])
}

function compareRepositoryCandidatePaths(a: string, b: string): number {
  const depthDifference = getPathDepth(a) - getPathDepth(b)
  if (depthDifference !== 0) return depthDifference

  if (a < b) return -1
  if (a > b) return 1
  return 0
}

function getPathDepth(fsPath: string): number {
  return normalizeGitPath(fsPath).split("/").filter(Boolean).length
}

function sameRepositoryPaths(
  previousRepoPaths: string[],
  repositories: GitRepository[],
): boolean {
  if (previousRepoPaths.length !== repositories.length) return false
  return previousRepoPaths.every((repoPath, index) => {
    return repoPath === repositories[index]?.path
  })
}
