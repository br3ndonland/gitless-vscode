import * as vscode from "vscode"
import type { GitService } from "../git/gitService"
import { RemoteNode, BranchNode, MessageNode } from "./nodes"

export class RemotesView implements vscode.TreeDataProvider<vscode.TreeItem> {
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

    if (element instanceof RemoteNode) {
      try {
        const branches = await this.gitService.getBranches(repoPath)
        const remoteBranches = branches.filter(
          (b) => b.remote && b.name.startsWith(`${element.remote.name}/`),
        )
        if (remoteBranches.length === 0) {
          return [new MessageNode("No remote branches")]
        }
        return remoteBranches.map((b) => new BranchNode(b, repoPath))
      } catch {
        return [new MessageNode("Failed to load remote branches")]
      }
    }

    if (!element) {
      try {
        const remotes = await this.gitService.getRemotes(repoPath)
        if (remotes.length === 0) return [new MessageNode("No remotes found")]
        return remotes.map((r) => new RemoteNode(r, repoPath))
      } catch {
        return [new MessageNode("Failed to load remotes")]
      }
    }

    return []
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose()
  }
}
