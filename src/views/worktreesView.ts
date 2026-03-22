import * as vscode from "vscode"
import type { GitService } from "../git/gitService"
import { WorktreeNode, CommitNode, FileNode, MessageNode } from "./nodes"

export class WorktreesView implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    vscode.TreeItem | undefined | null | void
  >()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  constructor(private readonly gitService: GitService) {
    gitService.onDidChange(() => this.refresh())
  }

  refresh(): void {
    this._onDidChangeTreeData.fire()
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    const repoPath = await this.gitService.getRepoPath()
    if (!repoPath) return [new MessageNode("No repository found")]

    if (element instanceof WorktreeNode) {
      try {
        const sha = element.worktree.sha
        if (!sha) return [new MessageNode("No commits")]
        const commits = await this.gitService.getCommits(
          element.worktree.path,
          { maxCount: 20 },
        )
        return commits.map((c) => new CommitNode(c, repoPath))
      } catch {
        return [new MessageNode("Failed to load commits")]
      }
    }

    if (element instanceof CommitNode) {
      try {
        const files = await this.gitService.getCommitFiles(
          repoPath,
          element.sha,
        )
        return files.map((f) => new FileNode(f, element.sha, repoPath))
      } catch {
        return [new MessageNode("Failed to load files")]
      }
    }

    if (!element) {
      try {
        const worktrees = await this.gitService.getWorktrees(repoPath)
        if (worktrees.length === 0) {
          return [new MessageNode("No worktrees found")]
        }
        return worktrees.map((w) => new WorktreeNode(w, repoPath))
      } catch {
        return [new MessageNode("Failed to load worktrees")]
      }
    }

    return []
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose()
  }
}
