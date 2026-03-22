import * as vscode from "vscode"
import type { GitService } from "../git/gitService"
import { CommitNode, FileNode, MessageNode } from "./nodes"
import { ViewIds, ContextValues } from "../constants"
import { shortenSha } from "../config"

class CompareResultNode extends vscode.TreeItem {
  readonly contextValue = ContextValues.CompareResult
  constructor(
    public readonly ref1: string,
    public readonly ref2: string,
    public readonly repoPath: string,
  ) {
    super(
      `${shortenSha(ref1)} ↔ ${shortenSha(ref2)}`,
      vscode.TreeItemCollapsibleState.Collapsed,
    )
    this.iconPath = new vscode.ThemeIcon("git-compare")
    this.id = `compare:${ref1}:${ref2}`
    this.description = "comparison"
  }
}

class SearchResultNode extends vscode.TreeItem {
  readonly contextValue = ContextValues.SearchResult
  constructor(
    public readonly query: string,
    public readonly repoPath: string,
  ) {
    super(`"${query}"`, vscode.TreeItemCollapsibleState.Collapsed)
    this.iconPath = new vscode.ThemeIcon("search")
    this.id = `search:${query}`
    this.description = "search results"
  }
}

export class SearchAndCompareView implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    vscode.TreeItem | undefined | null | void
  >()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  private treeView: vscode.TreeView<vscode.TreeItem>
  private items: (CompareResultNode | SearchResultNode)[] = []

  constructor(private readonly gitService: GitService) {
    this.treeView = vscode.window.createTreeView(ViewIds.SearchAndCompare, {
      treeDataProvider: this,
      showCollapseAll: true,
    })

    // Register search and compare commands
    vscode.commands.registerCommand("gitless.searchCommits", () =>
      this.searchCommits(),
    )
    vscode.commands.registerCommand("gitless.compareRefs", () =>
      this.compareRefs(),
    )
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

    if (element instanceof CompareResultNode) {
      try {
        const files = await this.gitService.diff(
          element.repoPath,
          element.ref1,
          element.ref2,
        )
        if (files.length === 0) return [new MessageNode("No differences")]
        return files.map((f) => new FileNode(f, element.ref2, element.repoPath))
      } catch {
        return [new MessageNode("Failed to compare")]
      }
    }

    if (element instanceof SearchResultNode) {
      try {
        const commits = await this.gitService.searchCommits(
          element.repoPath,
          element.query,
        )
        if (commits.length === 0) return [new MessageNode("No results")]
        return commits.map((c) => new CommitNode(c, element.repoPath))
      } catch {
        return [new MessageNode("Search failed")]
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
      if (this.items.length === 0) {
        return [
          new MessageNode(
            "Use 'Search Commits' or 'Compare Refs' to get started",
          ),
        ]
      }
      return this.items
    }

    return []
  }

  private async searchCommits(): Promise<void> {
    const repoPath = await this.gitService.getRepoPath()
    if (!repoPath) return

    const query = await vscode.window.showInputBox({
      prompt: "Search commits by message",
      placeHolder: "Enter search query",
    })
    if (!query) return

    this.items.push(new SearchResultNode(query, repoPath))
    this.refresh()
  }

  private async compareRefs(): Promise<void> {
    const repoPath = await this.gitService.getRepoPath()
    if (!repoPath) return

    const ref1 = await vscode.window.showInputBox({
      prompt: "Enter first ref (branch, tag, or SHA)",
      placeHolder: "e.g., main",
    })
    if (!ref1) return

    const ref2 = await vscode.window.showInputBox({
      prompt: "Enter second ref (branch, tag, or SHA)",
      placeHolder: "e.g., HEAD",
    })
    if (!ref2) return

    try {
      const sha1 = await this.gitService.getShaForRef(repoPath, ref1)
      const sha2 = await this.gitService.getShaForRef(repoPath, ref2)
      this.items.push(new CompareResultNode(sha1, sha2, repoPath))
      this.refresh()
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to resolve refs: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  dispose(): void {
    this.treeView.dispose()
    this._onDidChangeTreeData.dispose()
  }
}
