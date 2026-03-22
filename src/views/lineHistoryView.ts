import * as vscode from "vscode"
import type { GitService } from "../git/gitService"
import { CommitNode, MessageNode } from "./nodes"
import { ViewIds } from "../constants"

export class LineHistoryView implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    vscode.TreeItem | undefined | null | void
  >()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  private treeView: vscode.TreeView<vscode.TreeItem>
  private activeFilePath: string | undefined
  private activeSelection: { start: number; end: number } | undefined

  constructor(private readonly gitService: GitService) {
    this.treeView = vscode.window.createTreeView(ViewIds.LineHistory, {
      treeDataProvider: this,
      showCollapseAll: true,
    })

    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (e.textEditor.document.uri.scheme !== "file") return

      const workspaceFolder = vscode.workspace.getWorkspaceFolder(
        e.textEditor.document.uri,
      )
      if (!workspaceFolder) return

      const selection = e.selections[0]
      if (!selection) return

      this.activeFilePath = vscode.workspace.asRelativePath(
        e.textEditor.document.uri,
        false,
      )
      this.activeSelection = {
        start: selection.start.line + 1,
        end: selection.end.line + 1,
      }
      this.refresh()
    })
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

    if (!this.activeFilePath || !this.activeSelection) {
      return [new MessageNode("Select lines to see their history")]
    }

    if (!element) {
      try {
        const commits = await this.gitService.getLineHistory(
          repoPath,
          this.activeFilePath,
          this.activeSelection.start,
          this.activeSelection.end,
        )
        if (commits.length === 0) {
          return [new MessageNode("No history found for selection")]
        }
        this.treeView.description = `${this.activeFilePath} L${this.activeSelection.start}-${this.activeSelection.end}`
        return commits.map((c) => new CommitNode(c, repoPath))
      } catch {
        return [new MessageNode("Failed to load line history")]
      }
    }

    return []
  }

  dispose(): void {
    this.treeView.dispose()
    this._onDidChangeTreeData.dispose()
  }
}
