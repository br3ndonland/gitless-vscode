import * as vscode from "vscode"
import type {
  GitCommit,
  GitBranch,
  GitRemote,
  GitTag,
  GitStash,
  GitWorktree,
  GitFile,
  GitFileStatus,
} from "../git/models"
import { Commands, ContextValues } from "../constants"
import { shortenSha } from "../config"

/** Custom URI scheme used for file nodes to trigger file-icon-theme resolution
 * without conflicting with real workspace file decorations. */
export const FILE_NODE_URI_SCHEME = "gitless-file"

// Base class for all tree view nodes
export abstract class ViewNode extends vscode.TreeItem {
  abstract readonly contextValue: string
  readonly repoPath: string

  constructor(
    label: string | vscode.TreeItemLabel,
    repoPath: string,
    collapsibleState?: vscode.TreeItemCollapsibleState,
  ) {
    super(label, collapsibleState)
    this.repoPath = repoPath
  }
}

// ── Commit Node ──

export class CommitNode extends ViewNode {
  readonly contextValue = ContextValues.Commit
  readonly sha: string
  readonly message: string

  constructor(
    public readonly commit: GitCommit,
    repoPath: string,
  ) {
    super(commit.summary, repoPath, vscode.TreeItemCollapsibleState.Collapsed)
    this.sha = commit.sha
    this.message = commit.message
    this.description = `${shortenSha(commit.sha)} • ${formatRelativeDate(commit.date)}`
    const copyShaArgs = commandArgs({ sha: commit.sha })
    const openRemoteArgs = commandArgs({ sha: commit.sha })
    this.tooltip = new vscode.MarkdownString(
      `$(git-commit) **${commit.summary}**\n\n` +
        `SHA: \`${commit.sha}\`\n\n` +
        `Author: ${commit.author.name} <${commit.author.email}>\n\n` +
        `Date: ${commit.date.toLocaleString()}\n\n` +
        (commit.message !== commit.summary ? `---\n\n${commit.message}` : ""),
    )
    this.tooltip.appendMarkdown(
      `\n\n---\n\n` +
        `[$(copy) Copy SHA](command:${Commands.CopySha}?${copyShaArgs} "Copy full commit SHA")` +
        ` | ` +
        `[$(link-external) Open on remote](command:${Commands.OpenCommitOnRemote}?${openRemoteArgs} "Open commit on remote")`,
    )
    this.tooltip.isTrusted = true
    this.tooltip.supportThemeIcons = true
    this.iconPath = new vscode.ThemeIcon("git-commit")
    this.id = `commit:${commit.sha}`
  }
}

// ── File Node ──

export class FileNode extends ViewNode {
  readonly contextValue = ContextValues.File
  readonly sha: string
  readonly filePath: string
  readonly fileStatus: GitFileStatus

  constructor(
    public readonly file: GitFile,
    sha: string,
    repoPath: string,
  ) {
    super(
      file.path.split("/").pop() ?? file.path,
      repoPath,
      vscode.TreeItemCollapsibleState.None,
    )
    this.sha = sha
    this.filePath = file.path
    this.fileStatus = file.status
    this.description = file.path.includes("/")
      ? file.path.slice(0, file.path.lastIndexOf("/"))
      : ""
    const openChangesArgs = commandArgs({ sha, filePath: file.path, repoPath })
    const openRemoteArgs = commandArgs({
      sha,
      filePath: file.path,
      repoPath,
    })
    this.tooltip = new vscode.MarkdownString(
      `**${file.path}**\n\nStatus: ${file.status}\n\nCommit: \`${sha}\``,
    )
    this.tooltip.appendMarkdown(
      `\n\n---\n\n` +
        `[$(diff) Open changes](command:${Commands.OpenChanges}?${openChangesArgs} "Open file changes")` +
        ` | ` +
        `[$(link-external) Open on remote](command:${Commands.OpenFileOnRemote}?${openRemoteArgs} "Open file on remote")`,
    )
    this.tooltip.isTrusted = true
    this.tooltip.supportThemeIcons = true
    this.id = `file:${sha}:${file.path}`

    // Use a custom-scheme URI so the active file icon theme resolves the
    // icon by filename/extension, without conflicting with real workspace
    // file decorations.  The GitFileDecorationProvider uses this same
    // scheme to apply git-status colors and badges.
    this.resourceUri = vscode.Uri.from({
      scheme: FILE_NODE_URI_SCHEME,
      path: `/${file.path}`,
      query: `status=${file.status}`,
    })

    // Click opens the diff (parent commit vs this commit)
    this.command = {
      title: "Open Changes",
      command: Commands.OpenChanges,
      arguments: [{ sha, filePath: file.path, repoPath }],
    }
  }
}

// ── Branch Node ──

export class BranchNode extends ViewNode {
  readonly contextValue: string
  readonly name: string

  constructor(
    public readonly branch: GitBranch,
    repoPath: string,
  ) {
    super(branch.name, repoPath, vscode.TreeItemCollapsibleState.Collapsed)
    this.name = branch.name

    if (branch.current) {
      this.contextValue = ContextValues.BranchCurrent
    } else if (branch.remote) {
      this.contextValue = ContextValues.BranchRemote
    } else {
      this.contextValue = ContextValues.Branch
    }

    const parts: string[] = []
    if (branch.current) parts.push("\u2713")
    if (branch.upstream) {
      parts.push(`→ ${branch.upstream.name}`)
      if (branch.upstream.missing) parts.push("(gone)")
    }
    this.description = parts.join(" ")

    this.tooltip = new vscode.MarkdownString(
      `$(git-branch) **${branch.name}**\n\n` +
        (branch.current ? "Current branch\n\n" : "") +
        (branch.upstream
          ? `Upstream: ${branch.upstream.name}${branch.upstream.missing ? " (gone)" : ""}\n\n`
          : "") +
        (branch.sha ? `SHA: \`${branch.sha}\`\n\n` : "") +
        (branch.date ? `Date: ${branch.date.toLocaleString()}` : ""),
    )
    if (branch.sha) {
      const compareArgs = commandArgs({ sha: branch.sha, repoPath })
      this.tooltip.appendMarkdown(
        `\n\n---\n\n[$(git-compare) Compare with HEAD](command:${Commands.CompareWithHead}?${compareArgs} "Compare branch with HEAD")`,
      )
    }
    this.tooltip.isTrusted = true
    this.tooltip.supportThemeIcons = true
    this.iconPath = new vscode.ThemeIcon(
      branch.current ? "git-branch" : branch.remote ? "cloud" : "git-branch",
    )
    this.id = `branch:${branch.remote ? "remote:" : ""}${branch.name}`
  }
}

// ── Remote Node ──

export class RemoteNode extends ViewNode {
  readonly contextValue = ContextValues.Remote
  readonly name: string
  readonly url: string

  constructor(
    public readonly remote: GitRemote,
    repoPath: string,
  ) {
    super(remote.name, repoPath, vscode.TreeItemCollapsibleState.Collapsed)
    this.name = remote.name
    this.url = remote.url
    this.description = remote.provider?.name ?? remote.url
    this.tooltip = new vscode.MarkdownString(
      `$(cloud) **${remote.name}**\n\n` +
        `URL: ${remote.url}\n\n` +
        (remote.fetchUrl ? `Fetch: ${remote.fetchUrl}\n\n` : "") +
        (remote.pushUrl ? `Push: ${remote.pushUrl}\n\n` : "") +
        (remote.provider
          ? `Provider: ${remote.provider.name}\n\nOwner: ${remote.provider.owner}\n\nRepo: ${remote.provider.repo}`
          : ""),
    )
    this.tooltip.isTrusted = true
    this.tooltip.supportThemeIcons = true
    this.iconPath = new vscode.ThemeIcon("cloud")
    this.id = `remote:${remote.name}`
  }
}

// ── Tag Node ──

export class TagNode extends ViewNode {
  readonly contextValue = ContextValues.Tag
  readonly name: string
  readonly sha: string
  readonly message?: string
  readonly annotation?: string

  constructor(
    public readonly tag: GitTag,
    repoPath: string,
  ) {
    super(tag.name, repoPath, vscode.TreeItemCollapsibleState.Collapsed)
    this.name = tag.name
    this.sha = tag.sha
    this.message = tag.message
    this.annotation = tag.annotation
    this.description = tag.date
      ? formatRelativeDate(tag.date)
      : shortenSha(tag.sha)
    this.tooltip = new vscode.MarkdownString(
      `$(tag) **${tag.name}**\n\n` +
        `SHA: \`${tag.sha}\`\n\n` +
        (tag.date ? `Date: ${tag.date.toLocaleString()}\n\n` : "") +
        (tag.message ? `Message: ${tag.message}` : ""),
    )
    const copyTagArgs = commandArgs({ name: tag.name })
    const checkoutArgs = commandArgs({ name: tag.name, repoPath })
    this.tooltip.appendMarkdown(
      `\n\n---\n\n` +
        `[$(copy) Copy tag name](command:${Commands.CopyTag}?${copyTagArgs} "Copy tag name to clipboard")` +
        ` | ` +
        `[$(check) Checkout](command:${Commands.CheckoutTag}?${checkoutArgs} "Checkout this tag")`,
    )
    this.tooltip.isTrusted = true
    this.tooltip.supportThemeIcons = true
    this.iconPath = new vscode.ThemeIcon("tag")
    this.id = `tag:${tag.name}`
  }
}

// ── Stash Node ──

export class StashNode extends ViewNode {
  readonly contextValue = ContextValues.Stash
  readonly sha: string
  readonly message: string
  readonly stashIndex: number

  constructor(
    public readonly stash: GitStash,
    repoPath: string,
  ) {
    super(
      stash.message || `stash@{${stash.index}}`,
      repoPath,
      vscode.TreeItemCollapsibleState.Collapsed,
    )
    this.sha = stash.sha
    this.message = stash.message
    this.stashIndex = stash.index
    this.description = `stash@{${stash.index}} • ${formatRelativeDate(stash.date)}`
    this.tooltip = new vscode.MarkdownString(
      `$(archive) **stash@{${stash.index}}**\n\n` +
        `Message: ${stash.message}\n\n` +
        `Author: ${stash.author.name}\n\n` +
        `Date: ${stash.date.toLocaleString()}\n\n` +
        `SHA: \`${stash.sha}\``,
    )
    const copyShaArgs = commandArgs({ sha: stash.sha })
    this.tooltip.appendMarkdown(
      `\n\n---\n\n[$(copy) Copy SHA](command:${Commands.CopySha}?${copyShaArgs} "Copy full stash SHA")`,
    )
    this.tooltip.isTrusted = true
    this.tooltip.supportThemeIcons = true
    this.iconPath = new vscode.ThemeIcon("archive")
    this.id = `stash:${stash.index}`
  }
}

// ── Worktree Node ──

export class WorktreeNode extends ViewNode {
  readonly contextValue: string
  readonly worktreePath: string

  constructor(
    public readonly worktree: GitWorktree,
    repoPath: string,
  ) {
    const name =
      worktree.branch ?? worktree.path.split("/").pop() ?? worktree.path
    super(name, repoPath, vscode.TreeItemCollapsibleState.Collapsed)
    this.worktreePath = worktree.path
    this.contextValue = worktree.main
      ? ContextValues.WorktreeMain
      : ContextValues.Worktree

    const parts: string[] = []
    if (worktree.main) parts.push("main")
    if (worktree.locked) parts.push("$(lock)")
    if (worktree.bare) parts.push("bare")
    this.description = parts.join(" ") || worktree.path

    this.tooltip = new vscode.MarkdownString(
      `$(folder) **${name}**\n\n` +
        `Path: ${worktree.path}\n\n` +
        (worktree.branch ? `Branch: ${worktree.branch}\n\n` : "") +
        (worktree.sha ? `SHA: \`${worktree.sha}\`\n\n` : "") +
        (worktree.locked ? "Locked\n\n" : "") +
        (worktree.bare ? "Bare worktree\n\n" : "") +
        (worktree.main ? "Main worktree" : ""),
    )
    this.tooltip.isTrusted = true
    this.tooltip.supportThemeIcons = true
    this.iconPath = new vscode.ThemeIcon(
      worktree.main ? "folder-library" : "folder-opened",
    )
    this.id = `worktree:${worktree.path}`
  }
}

// ── Message Node (for loading/empty states) ──

export class MessageNode extends vscode.TreeItem {
  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None)
    this.contextValue = "gitless:message"
  }
}

// ── Helpers ──

/** Encode command arguments for use in MarkdownString command URIs. */
function commandArgs(...args: unknown[]): string {
  return encodeURIComponent(JSON.stringify(args))
}

function formatRelativeDate(date: Date): string {
  const now = Date.now()
  const diff = now - date.getTime()
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  const weeks = Math.floor(days / 7)
  const months = Math.floor(days / 30)
  const years = Math.floor(days / 365)

  if (years > 0) return `${years}y ago`
  if (months > 0) return `${months}mo ago`
  if (weeks > 0) return `${weeks}w ago`
  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  return "just now"
}
