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
  private activeRepoPath: string | undefined
  private activeFilePath: string | undefined
  private activeSelection: { start: number; end: number } | undefined
  private readonly disposables: vscode.Disposable[] = []

  constructor(private readonly gitService: GitService) {
    this.treeView = vscode.window.createTreeView(ViewIds.LineHistory, {
      treeDataProvider: this,
      showCollapseAll: true,
    })

    this.disposables.push(
      this.treeView,
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (e.textEditor.document.uri.scheme !== "file") return

        void this.updateSelection(e)
      }),
    )
  }

  refresh(): void {
    this._onDidChangeTreeData.fire()
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!this.activeRepoPath) return [new MessageNode("No repository found")]

    if (!this.activeFilePath || !this.activeSelection) {
      return [new MessageNode("Select lines to see their history")]
    }

    if (!element) {
      try {
        const commits = await this.gitService.getLineHistory(
          this.activeRepoPath,
          this.activeFilePath,
          this.activeSelection.start,
          this.activeSelection.end,
        )
        if (commits.length === 0) {
          return [new MessageNode("No history found for selection")]
        }
        this.treeView.description = `${this.activeFilePath} L${this.activeSelection.start}-${this.activeSelection.end}`
        return commits.map((c) => new CommitNode(c, this.activeRepoPath!))
      } catch {
        return [new MessageNode("Failed to load line history")]
      }
    }

    return []
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose())
    this._onDidChangeTreeData.dispose()
  }

  private async updateSelection(
    event: vscode.TextEditorSelectionChangeEvent,
  ): Promise<void> {
    const fileContext = await this.gitService.getRepoFileContext(
      event.textEditor.document.uri,
    )
    if (!fileContext) return

    const selection = event.selections[0]
    if (!selection) return

    this.activeRepoPath = fileContext.repoPath
    this.activeFilePath = fileContext.relativePath
    this.activeSelection = {
      start: selection.start.line + 1,
      end: selection.end.line + 1,
    }
    this.refresh()
  }
}
