import * as path from "node:path"
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
  RemoteProviderInfo,
} from "../git/models"
import { linkifyAutolinks } from "../git/autolinks"
import { Commands, ContextValues } from "../constants"
import { formatDate, shortenSha } from "../config"

/** Custom URI scheme used for file nodes to trigger file-icon-theme resolution
 * without conflicting with real workspace file decorations. */
export const FILE_NODE_URI_SCHEME = "gitless-file"

export interface CommitNodeOptions {
  outgoing?: boolean
  remoteProvider?: RemoteProviderInfo
  upstreamName?: string
}

export interface FileNodeOptions {
  remoteSha?: string
}

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

// Commit Node

export class CommitNode extends ViewNode {
  readonly contextValue = ContextValues.Commit
  readonly sha: string
  readonly message: string
  readonly outgoing: boolean
  readonly upstreamName?: string

  constructor(
    public readonly commit: GitCommit,
    repoPath: string,
    options: CommitNodeOptions = {},
  ) {
    super(commit.summary, repoPath, vscode.TreeItemCollapsibleState.Collapsed)
    this.sha = commit.sha
    this.message = commit.message
    this.outgoing = options.outgoing ?? false
    this.upstreamName = options.upstreamName
    const descriptionParts = [shortenSha(commit.sha), formatDate(commit.date)]
    if (this.outgoing) descriptionParts.push("outgoing")
    this.description = descriptionParts.join(" | ")
    const copyShaArgs = commandArgs({ sha: commit.sha })
    const copyMessageArgs = commandArgs({ message: commit.message })
    const openRemoteArgs = commandArgs({ sha: commit.sha, repoPath })
    const statusLine = this.outgoing
      ? `Status: outgoing${this.upstreamName ? ` to ${this.upstreamName}` : ""}\n\n`
      : ""
    const summary = linkifyAutolinks(commit.summary, options.remoteProvider)
    const message =
      commit.message !== commit.summary
        ? linkifyAutolinks(
            truncateLines(commit.message, 20),
            options.remoteProvider,
          )
        : ""
    this.tooltip = new vscode.MarkdownString(
      `$(git-commit) **${summary}**\n\n` +
        statusLine +
        `SHA: \`${commit.sha}\`\n\n` +
        `Author: ${commit.author.name} <${commit.author.email}>\n\n` +
        `Date: ${formatDate(commit.date)}\n\n` +
        (message ? `---\n\n${message}` : ""),
    )
    this.tooltip.appendMarkdown(
      `\n\n---\n\n` +
        `[$(copy) Copy SHA](command:${Commands.CopySha}?${copyShaArgs} "Copy full commit SHA")` +
        ` | ` +
        `[$(copy) Copy message](command:${Commands.CopyMessage}?${copyMessageArgs} "Copy full commit message")` +
        ` | ` +
        `[$(link-external) Open on remote](command:${Commands.OpenCommitOnRemote}?${openRemoteArgs} "Open commit on remote")`,
    )
    this.tooltip.isTrusted = {
      enabledCommands: [
        Commands.CopySha,
        Commands.CopyMessage,
        Commands.OpenCommitOnRemote,
      ],
    }
    this.tooltip.supportThemeIcons = true
    this.iconPath = new vscode.ThemeIcon(
      "git-commit",
      this.outgoing
        ? new vscode.ThemeColor("gitDecoration.addedResourceForeground")
        : undefined,
    )
    this.id = `commit:${repoPath}:${commit.sha}`
  }
}

// File Node

export class FileNode extends ViewNode {
  readonly contextValue = ContextValues.File
  readonly sha: string
  readonly filePath: string
  readonly fileStatus: GitFileStatus
  readonly previousSha?: string
  readonly remoteSha?: string

  constructor(
    public readonly file: GitFile,
    sha: string,
    repoPath: string,
    /** Explicit left-side ref for diffs (e.g. ref1 in a compare).
     *  When omitted, OpenChanges defaults to `sha~1`. */
    previousSha?: string,
    options: FileNodeOptions = {},
  ) {
    super(
      file.path.split("/").pop() ?? file.path,
      repoPath,
      vscode.TreeItemCollapsibleState.None,
    )
    this.sha = sha
    this.filePath = file.path
    this.fileStatus = file.status
    this.previousSha = previousSha
    this.remoteSha = options.remoteSha
    this.description = file.path.includes("/")
      ? file.path.slice(0, file.path.lastIndexOf("/"))
      : ""
    const openChangesArgs = commandArgs({
      sha,
      previousSha,
      filePath: file.path,
      repoPath,
    })
    const openRemoteArgs = commandArgs({
      sha,
      remoteSha: options.remoteSha,
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
    this.id = `file:${repoPath}:${sha}:${file.path}`

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
      arguments: [{ sha, previousSha, filePath: file.path, repoPath }],
    }
  }
}

// Branch Node

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
    if (branch.current) parts.push("current")
    if (branch.upstream) {
      const upstreamStatus = formatBranchUpstreamStatus(branch.upstream)
      parts.push(
        upstreamStatus
          ? `-> ${branch.upstream.name} (${upstreamStatus})`
          : `-> ${branch.upstream.name}`,
      )
    }
    this.description = parts.join(" | ")

    this.tooltip = new vscode.MarkdownString(
      `$(git-branch) **${branch.name}**\n\n` +
        (branch.current ? "Current branch\n\n" : "") +
        (branch.upstream
          ? `Upstream: ${branch.upstream.name}${formatBranchUpstreamDescription(branch.upstream)}\n\n`
          : "") +
        (branch.sha ? `SHA: \`${branch.sha}\`\n\n` : "") +
        (branch.date ? `Date: ${formatDate(branch.date)}` : ""),
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
      branch.upstream && branch.upstream.ahead > 0
        ? new vscode.ThemeColor("gitDecoration.addedResourceForeground")
        : undefined,
    )
    this.id = `branch:${repoPath}:${branch.remote ? "remote:" : ""}${branch.name}`
  }
}

// Remote Node

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
    this.id = `remote:${repoPath}:${remote.name}`
  }
}

// Tag Node

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
    this.description = tag.date ? formatDate(tag.date) : shortenSha(tag.sha)
    this.tooltip = new vscode.MarkdownString(
      `$(tag) **${tag.name}**\n\n` +
        `SHA: \`${tag.sha}\`\n\n` +
        (tag.date ? `Date: ${formatDate(tag.date)}\n\n` : "") +
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
    this.id = `tag:${repoPath}:${tag.name}`
  }
}

// Stash Node

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
    this.description = `stash@{${stash.index}} | ${formatDate(stash.date)}`
    this.tooltip = new vscode.MarkdownString(
      `$(archive) **stash@{${stash.index}}**\n\n` +
        `Message: ${stash.message}\n\n` +
        `Author: ${stash.author.name}\n\n` +
        `Date: ${formatDate(stash.date)}\n\n` +
        `SHA: \`${stash.sha}\``,
    )
    const copyShaArgs = commandArgs({ sha: stash.sha })
    this.tooltip.appendMarkdown(
      `\n\n---\n\n[$(copy) Copy SHA](command:${Commands.CopySha}?${copyShaArgs} "Copy full stash SHA")`,
    )
    this.tooltip.isTrusted = true
    this.tooltip.supportThemeIcons = true
    this.iconPath = new vscode.ThemeIcon("archive")
    this.id = `stash:${repoPath}:${stash.index}`
  }
}

// Worktree Node

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
    this.id = `worktree:${repoPath}:${worktree.path}`
  }
}

// Message Node (for loading/empty states)

export class MessageNode extends vscode.TreeItem {
  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None)
    this.contextValue = "gitless:message"
  }
}

// Helpers

/** Encode command arguments for use in MarkdownString command URIs. */
function commandArgs(...args: unknown[]): string {
  return encodeURIComponent(JSON.stringify(args))
}

/** Truncate text to a maximum number of lines for tooltip display.
 * VS Code hover widgets are capped at 50% of viewport height, so long
 * commit messages must be shortened to avoid silent clipping. */
function truncateLines(text: string, maxLines: number): string {
  const lines = text.split("\n")
  const displayText =
    lines.length <= maxLines ? text : lines.slice(0, maxLines).join("\n")
  const balancedDisplayText = closeUnterminatedCodeFence(displayText)
  if (lines.length <= maxLines) return balancedDisplayText
  return balancedDisplayText + "\n\n_... (message truncated)_"
}

/** Close an open fenced code block so later tooltip markdown is not swallowed. */
function closeUnterminatedCodeFence(text: string): string {
  let openFence: string | undefined

  for (const line of text.split("\n")) {
    const trimmedLine = line.trimStart()
    const fenceMatch = trimmedLine.match(/^(`{3,}|~{3,})/)
    if (!fenceMatch) continue

    const marker = fenceMatch[1]
    if (!openFence) {
      openFence = marker
      continue
    }

    if (marker[0] === openFence[0] && marker.length >= openFence.length) {
      openFence = undefined
    }
  }

  return openFence ? `${text}\n${openFence}` : text
}

function formatBranchUpstreamStatus(
  upstream: NonNullable<GitBranch["upstream"]>,
): string {
  const parts: string[] = []
  if (upstream.missing) parts.push("gone")
  if (upstream.ahead > 0) parts.push(`${upstream.ahead} ahead`)
  if (upstream.behind > 0) parts.push(`${upstream.behind} behind`)
  return parts.join(", ")
}

function formatBranchUpstreamDescription(
  upstream: NonNullable<GitBranch["upstream"]>,
): string {
  const status = formatBranchUpstreamStatus(upstream)
  return status ? ` (${status})` : ""
}

export function getRepositoryLabel(repoPath: string): string {
  return path.basename(repoPath) || repoPath
}
