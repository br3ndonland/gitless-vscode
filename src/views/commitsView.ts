import * as vscode from "vscode"
import type { GitService } from "../git/gitService"
import { CommitNode, FileNode, MessageNode } from "./nodes"

export class CommitsView implements vscode.TreeDataProvider<vscode.TreeItem> {
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
        const [commits, branches] = await Promise.all([
          this.gitService.getCommits(repoPath),
          this.gitService.getBranches(repoPath).catch(() => []),
        ])
        if (commits.length === 0) return [new MessageNode("No commits found")]

        const currentBranch = branches.find((branch) => branch.current)
        const outgoingCommitShas = new Set(
          currentBranch
            ? await this.gitService
                .getOutgoingCommitShasForBranch(repoPath, currentBranch)
                .catch(() => [])
            : [],
        )

        return commits.map(
          (commit) =>
            new CommitNode(commit, repoPath, {
              outgoing: outgoingCommitShas.has(commit.sha),
              upstreamName: currentBranch?.upstream?.name,
            }),
        )
      } catch {
        return [new MessageNode("Failed to load commits")]
      }
    }

    return []
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose()
  }
}
