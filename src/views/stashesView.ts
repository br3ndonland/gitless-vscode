import * as vscode from "vscode"
import type { GitService } from "../git/gitService"
import { StashNode, FileNode, MessageNode } from "./nodes"

export class StashesView implements vscode.TreeDataProvider<vscode.TreeItem> {
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

    if (element instanceof StashNode) {
      try {
        const files = await this.gitService.getStashFiles(
          element.repoPath,
          element.sha,
        )
        const baseSha = `${element.sha}^1`
        return files.map((file) =>
          file.status === "untracked"
            ? new FileNode(
                file,
                `${element.sha}^3`,
                element.repoPath,
                baseSha,
                { remoteSha: baseSha },
              )
            : new FileNode(file, element.sha, element.repoPath, undefined, {
                remoteSha: baseSha,
              }),
        )
      } catch {
        return [new MessageNode("Failed to load files")]
      }
    }

    if (!element) {
      try {
        const stashes = await this.gitService.getStashes(repoPath)
        if (stashes.length === 0) return [new MessageNode("No stashes found")]
        return stashes.map((s) => new StashNode(s, repoPath))
      } catch {
        return [new MessageNode("Failed to load stashes")]
      }
    }

    return []
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose()
  }
}
