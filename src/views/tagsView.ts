import * as vscode from "vscode"
import type { GitService } from "../git/gitService"
import { TagNode, CommitNode, FileNode, MessageNode } from "./nodes"

export class TagsView implements vscode.TreeDataProvider<vscode.TreeItem> {
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
    const repoPath = await this.gitService.getActiveRepoPath()
    if (!repoPath) return [new MessageNode("No repository found")]

    if (element instanceof TagNode) {
      try {
        const commits = await this.gitService.getTagCommits(
          element.repoPath,
          element.tag.name,
          { maxCount: 20 },
        )
        if (commits.length === 0) return [new MessageNode("No commits")]
        return commits.map((c) => new CommitNode(c, element.repoPath))
      } catch {
        return [new MessageNode("Failed to load commits")]
      }
    }

    if (element instanceof CommitNode) {
      try {
        const files = await this.gitService.getCommitFiles(
          element.repoPath,
          element.sha,
        )
        return files.map((f) => new FileNode(f, element.sha, element.repoPath))
      } catch {
        return [new MessageNode("Failed to load files")]
      }
    }

    if (!element) {
      try {
        const tags = await this.gitService.getTags(repoPath)
        if (tags.length === 0) return [new MessageNode("No tags found")]
        return tags.map((t) => new TagNode(t, repoPath))
      } catch {
        return [new MessageNode("Failed to load tags")]
      }
    }

    return []
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose()
  }
}
