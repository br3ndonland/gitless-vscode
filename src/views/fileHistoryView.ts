import * as vscode from "vscode"
import type { GitService } from "../git/gitService"
import { CommitNode, FileNode, MessageNode } from "./nodes"
import { ViewIds } from "../constants"

type FileHistoryWindow = Pick<
  typeof vscode.window,
  "activeTextEditor" | "createTreeView" | "onDidChangeActiveTextEditor"
>

export class FileHistoryView implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    vscode.TreeItem | undefined | null | void
  >()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  private treeView: vscode.TreeView<vscode.TreeItem>
  private activeRepoPath: string | undefined
  private activeFilePath: string | undefined
  private trackedUri: vscode.Uri | undefined
  private contextGeneration = 0
  private treeGeneration = 0
  private disposed = false
  private readonly disposables: vscode.Disposable[] = []

  constructor(
    private readonly gitService: GitService,
    window: FileHistoryWindow = vscode.window,
  ) {
    this.treeView = window.createTreeView(ViewIds.FileHistory, {
      treeDataProvider: this,
      showCollapseAll: true,
    })

    this.disposables.push(
      this.treeView,
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
    if (this.disposed) return []
    if (!repoPath) return [new MessageNode("No repository found")]

    if (!filePath) {
      return [new MessageNode("Open a file to see its history")]
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
        const commits = await this.gitService.getFileHistory(repoPath, filePath)
        if (generation !== this.treeGeneration) return []
        if (commits.length === 0) {
          return [new MessageNode("No history found")]
        }
        const remoteProvider = (
          await this.gitService
            .getPreferredAutolinkRemote(repoPath)
            .catch(() => undefined)
        )?.provider
        if (generation !== this.treeGeneration) return []
        this.treeView.description = filePath
        return commits.map(
          (c) => new CommitNode(c, repoPath, { remoteProvider }),
        )
      } catch {
        if (generation !== this.treeGeneration) return []
        return [new MessageNode("Failed to load file history")]
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

    this.trackedUri = editor.document.uri
    await this.updateContext()
  }

  private async updateContext(): Promise<void> {
    if (this.disposed || !this.trackedUri) return
    const generation = ++this.contextGeneration
    this.treeGeneration++
    this.activeRepoPath = undefined
    this.activeFilePath = undefined
    this.treeView.description = undefined

    const fileContext = await this.gitService
      .getRepoFileContext(this.trackedUri)
      .catch(() => undefined)
    if (generation !== this.contextGeneration) return

    this.activeRepoPath = fileContext?.repoPath
    this.activeFilePath = fileContext?.relativePath
    this.refresh()
  }
}
