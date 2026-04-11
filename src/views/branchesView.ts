import * as vscode from "vscode"
import type { GitService } from "../git/gitService"
import { BranchNode, CommitNode, FileNode, MessageNode } from "./nodes"

export class BranchesView implements vscode.TreeDataProvider<vscode.TreeItem> {
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

    if (element instanceof BranchNode) {
      try {
        const sha = element.branch.sha
        if (!sha) return [new MessageNode("No commits")]
        const [commits, outgoingShas] = await Promise.all([
          this.gitService.getCommits(element.repoPath, {
            ref: element.branch.name,
            maxCount: 20,
          }),
          this.gitService
            .getOutgoingCommitShasForBranch(element.repoPath, element.branch)
            .catch(() => []),
        ])
        const outgoingCommitShas = new Set(outgoingShas)
        return commits.map(
          (commit) =>
            new CommitNode(commit, element.repoPath, {
              outgoing: outgoingCommitShas.has(commit.sha),
              upstreamName: element.branch.upstream?.name,
            }),
        )
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
        const branches = await this.gitService.getBranches(repoPath)
        if (branches.length === 0) {
          return [new MessageNode("No branches found")]
        }
        // Sort: current first, then local, then remote
        const sorted = [...branches].sort((a, b) => {
          if (a.current) return -1
          if (b.current) return 1
          if (a.remote !== b.remote) return a.remote ? 1 : -1
          return a.name.localeCompare(b.name)
        })
        return sorted.map((b) => new BranchNode(b, repoPath))
      } catch {
        return [new MessageNode("Failed to load branches")]
      }
    }

    return []
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose()
  }
}
