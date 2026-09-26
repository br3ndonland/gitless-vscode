import * as vscode from "vscode"
import type { GitService } from "../git/gitService"
import { CommitNode, FileNode, MessageNode } from "./nodes"
import { ViewIds } from "../constants"

type LineHistoryWindow = Pick<
  typeof vscode.window,
  | "activeTextEditor"
  | "createTreeView"
  | "onDidChangeActiveTextEditor"
  | "onDidChangeTextEditorSelection"
>

export class LineHistoryView implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    vscode.TreeItem | undefined | null | void
  >()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  private treeView: vscode.TreeView<vscode.TreeItem>
  private activeRepoPath: string | undefined
  private activeFilePath: string | undefined
  private activeSelection: { start: number; end: number } | undefined
  private trackedUri: vscode.Uri | undefined
  private trackedSelection: { start: number; end: number } | undefined
  private contextGeneration = 0
  private treeGeneration = 0
  private disposed = false
  private readonly disposables: vscode.Disposable[] = []

  constructor(
    private readonly gitService: GitService,
    window: LineHistoryWindow = vscode.window,
  ) {
    this.treeView = window.createTreeView(ViewIds.LineHistory, {
      treeDataProvider: this,
      showCollapseAll: true,
    })

    this.disposables.push(
      this.treeView,
      window.onDidChangeTextEditorSelection((e) => {
        if (e.textEditor.document.uri.scheme !== "file") return

        void this.updateSelection(e)
      }),
      window.onDidChangeActiveTextEditor(
        (editor) => void this.updateActiveEditor(editor),
      ),
      this.gitService.onDidChange(() => void this.updateContext()),
    )

    void this.updateActiveEditor(window.activeTextEditor)
  }

  refresh(): void {
    if (this.disposed) return
    this.treeGeneration++
    this._onDidChangeTreeData.fire()
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    const generation = this.treeGeneration
    const repoPath = this.activeRepoPath
    const filePath = this.activeFilePath
    const selection = this.activeSelection
    if (this.disposed) return []
    if (!repoPath) return [new MessageNode("No repository found")]

    if (!filePath || !selection) {
      return [new MessageNode("Select lines to see their history")]
    }

    if (element instanceof CommitNode) {
      if (element.repoPath !== repoPath) return []
      try {
        const files = await this.gitService.getCommitFiles(
          element.repoPath,
          element.sha,
        )
        if (generation !== this.treeGeneration) return []
        return files.map((f) => new FileNode(f, element.sha, element.repoPath))
      } catch {
        if (generation !== this.treeGeneration) return []
        return [new MessageNode("Failed to load files")]
      }
    }

    if (!element) {
      try {
        const commits = await this.gitService.getLineHistory(
          repoPath,
          filePath,
          selection.start,
          selection.end,
        )
        if (generation !== this.treeGeneration) return []
        if (commits.length === 0) {
          return [new MessageNode("No history found for selection")]
        }
        const remoteProvider = (
          await this.gitService
            .getPreferredAutolinkRemote(repoPath)
            .catch(() => undefined)
        )?.provider
        if (generation !== this.treeGeneration) return []
        this.treeView.description = `${filePath} L${selection.start}-${selection.end}`
        return commits.map(
          (c) => new CommitNode(c, repoPath, { remoteProvider }),
        )
      } catch {
        if (generation !== this.treeGeneration) return []
        return [new MessageNode("Failed to load line history")]
      }
    }

    return []
  }

  dispose(): void {
    this.disposed = true
    this.contextGeneration++
    this.treeGeneration++
    this.disposables.forEach((d) => d.dispose())
    this._onDidChangeTreeData.dispose()
  }

  private async updateActiveEditor(
    editor: vscode.TextEditor | undefined,
  ): Promise<void> {
    if (!editor || editor.document.uri.scheme !== "file") return
    await this.trackSelection(editor.document.uri, editor.selections[0])
  }

  private async updateSelection(
    event: vscode.TextEditorSelectionChangeEvent,
  ): Promise<void> {
    await this.trackSelection(
      event.textEditor.document.uri,
      event.selections[0],
    )
  }

  private async trackSelection(
    uri: vscode.Uri,
    selection: vscode.Selection | undefined,
  ): Promise<void> {
    if (!selection) return

    this.trackedUri = uri
    this.trackedSelection = {
      start: selection.start.line + 1,
      end: selection.end.line + 1,
    }
    await this.updateContext()
  }

  private async updateContext(): Promise<void> {
    if (this.disposed || !this.trackedUri) return
    const generation = ++this.contextGeneration
    this.treeGeneration++
    this.activeRepoPath = undefined
    this.activeFilePath = undefined
    this.activeSelection = undefined
    this.treeView.description = undefined

    const fileContext = await this.gitService
      .getRepoFileContext(this.trackedUri)
      .catch(() => undefined)
    if (generation !== this.contextGeneration) return

    this.activeRepoPath = fileContext?.repoPath
    this.activeFilePath = fileContext?.relativePath
    this.activeSelection = fileContext ? this.trackedSelection : undefined
    this.refresh()
  }
}
