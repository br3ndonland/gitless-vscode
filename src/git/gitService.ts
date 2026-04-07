import * as vscode from "vscode"
import { gitExec } from "./shell"
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

export class GitService implements vscode.Disposable {
  private _disposables: vscode.Disposable[] = []
  private _onDidChange = new vscode.EventEmitter<void>()
  readonly onDidChange = this._onDidChange.event

  constructor() {
    // Watch for filesystem changes in .git
    const watcher = vscode.workspace.createFileSystemWatcher("**/.git/**")
    watcher.onDidChange(() => this._onDidChange.fire())
    watcher.onDidCreate(() => this._onDidChange.fire())
    watcher.onDidDelete(() => this._onDidChange.fire())
    this._disposables.push(watcher)
  }

  dispose(): void {
    this._disposables.forEach((d) => d.dispose())
    this._onDidChange.dispose()
  }

  async getRepository(): Promise<GitRepository | undefined> {
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (!workspaceFolders?.length) return undefined

    const cwd = workspaceFolders[0].uri.fsPath
    try {
      const rootPath = (
        await gitExec(["rev-parse", "--show-toplevel"], { cwd })
      ).trim()
      const headSha = (
        await gitExec(["rev-parse", "HEAD"], { cwd: rootPath })
      ).trim()
      let headBranch: string | undefined
      try {
        headBranch = (
          await gitExec(["symbolic-ref", "--short", "HEAD"], { cwd: rootPath })
        ).trim()
      } catch {
        // Detached HEAD
      }

      return {
        path: rootPath,
        rootUri: vscode.Uri.file(rootPath).toString(),
        headSha,
        headBranch,
      }
    } catch {
      return undefined
    }
  }

  async getRepoPath(): Promise<string | undefined> {
    const repo = await this.getRepository()
    return repo?.path
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
    const output = await gitExec(args, { cwd: repoPath })
    return parseCommits(output)
  }

  async getBranches(repoPath: string): Promise<GitBranch[]> {
    const localOutput = await gitExec(
      [
        "branch",
        "--format=%(HEAD)<|>%(refname:short)<|>%(objectname:short)<|>%(upstream:short)<|>%(upstream:track)<|>%(creatordate:iso8601)",
      ],
      { cwd: repoPath },
    )
    const localBranches = parseBranches(localOutput)

    try {
      const remoteOutput = await gitExec(
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
    const output = await gitExec(["remote", "-v"], { cwd: repoPath })
    return parseRemotes(output)
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

    const output = await gitExec(
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
    const output = await gitExec(
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
    const output = await gitExec(
      ["stash", "list", "--format=%gd%x00%H%x00%aI%x00%an%x00%ae%x00%s"],
      { cwd: repoPath },
    )
    return parseStashes(output)
  }

  async getWorktrees(repoPath: string): Promise<GitWorktree[]> {
    const output = await gitExec(["worktree", "list", "--porcelain"], {
      cwd: repoPath,
    })
    return parseWorktrees(output)
  }

  async getCommitFiles(repoPath: string, sha: string): Promise<GitFile[]> {
    const output = await gitExec(
      ["diff-tree", "--no-commit-id", "-r", "--name-status", sha],
      { cwd: repoPath },
    )
    return parseFiles(output)
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
    const output = await gitExec(args, { cwd: repoPath })
    return parseCommits(output)
  }

  async getFileContent(
    repoPath: string,
    sha: string,
    filePath: string,
  ): Promise<string> {
    return gitExec(["show", `${sha}:${filePath}`], { cwd: repoPath })
  }

  async getHeadSha(repoPath: string): Promise<string> {
    return (await gitExec(["rev-parse", "HEAD"], { cwd: repoPath })).trim()
  }

  async getHeadBranch(repoPath: string): Promise<string | undefined> {
    try {
      return (
        await gitExec(["symbolic-ref", "--short", "HEAD"], { cwd: repoPath })
      ).trim()
    } catch {
      return undefined
    }
  }

  async getShaForRef(repoPath: string, ref: string): Promise<string> {
    return (await gitExec(["rev-parse", ref], { cwd: repoPath })).trim()
  }

  async checkout(repoPath: string, ref: string): Promise<void> {
    await gitExec(["checkout", ref], { cwd: repoPath })
  }

  async applyStash(repoPath: string, index: number): Promise<void> {
    await gitExec(["stash", "apply", `stash@{${index}}`], {
      cwd: repoPath,
    })
  }

  async dropStash(repoPath: string, index: number): Promise<void> {
    await gitExec(["stash", "drop", `stash@{${index}}`], {
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
    const output = await gitExec(args, { cwd: repoPath })
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
    const output = await gitExec(args, { cwd: repoPath })
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
    const output = await gitExec(args, { cwd: repoPath })
    return parseCommits(output)
  }

  async searchCommits(
    repoPath: string,
    query: string,
    options?: {
      maxCount?: number
      mode?: "message" | "author" | "file" | "changes"
    },
  ): Promise<GitCommit[]> {
    const mode = options?.mode ?? "message"
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
    const output = await gitExec(args, { cwd: repoPath })
    return parseCommits(output)
  }
}
