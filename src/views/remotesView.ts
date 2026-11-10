import * as vscode from "vscode"
import type { GitService } from "../git/gitService"
import type { BranchesView } from "./branchesView"
import { RemoteNode, BranchNode, CommitNode, MessageNode } from "./nodes"

export class RemotesView implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    vscode.TreeItem | undefined | null | void
  >()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  constructor(
    private readonly gitService: GitService,
    private readonly branchesView: BranchesView,
  ) {
    gitService.onDidChange(() => this.refresh())
  }

  refresh(): void {
    this._onDidChangeTreeData.fire()
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element instanceof BranchNode || element instanceof CommitNode) {
      const children = await this.branchesView.getChildren(element)
      // Remote branches can contain the same commits and changed files.
      for (const child of children) {
        if (child.id) child.id = `${element.id}:${child.id}`
      }
      return children
    }

    const repoPath = await this.gitService.getActiveRepoPath()
    if (!repoPath) return [new MessageNode("No repository found")]

    if (element instanceof RemoteNode) {
      try {
        const branches = await this.gitService.getBranches(element.repoPath)
        const remoteBranches = branches.filter(
          (b) => b.remote && b.name.startsWith(`${element.remote.name}/`),
        )
        if (remoteBranches.length === 0) {
          return [new MessageNode("No remote branches")]
        }
        return remoteBranches.map((b) => new BranchNode(b, element.repoPath))
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
