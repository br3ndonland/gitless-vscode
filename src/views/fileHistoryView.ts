import * as vscode from "vscode"
import type { GitService } from "../git/gitService"
import { CommitNode, FileNode, MessageNode } from "./nodes"
import { ViewIds } from "../constants"

export class FileHistoryView implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    vscode.TreeItem | undefined | null | void
  >()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  private treeView: vscode.TreeView<vscode.TreeItem>
  private activeRepoPath: string | undefined
  private activeFilePath: string | undefined
  private readonly disposables: vscode.Disposable[] = []

  constructor(private readonly gitService: GitService) {
    this.treeView = vscode.window.createTreeView(ViewIds.FileHistory, {
      treeDataProvider: this,
      showCollapseAll: true,
    })

    this.disposables.push(
      this.treeView,
      vscode.window.onDidChangeActiveTextEditor(
        (editor) => void this.updateActiveEditor(editor),
      ),
    )

    void this.updateActiveEditor(vscode.window.activeTextEditor)
  }

  refresh(): void {
    this._onDidChangeTreeData.fire()
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!this.activeRepoPath) return [new MessageNode("No repository found")]

    if (!this.activeFilePath) {
      return [new MessageNode("Open a file to see its history")]
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
        const commits = await this.gitService.getFileHistory(
          this.activeRepoPath,
          this.activeFilePath,
        )
        if (commits.length === 0) {
          return [new MessageNode("No history found")]
        }
        this.treeView.description = this.activeFilePath
        const remoteProvider = (
          await this.gitService
            .getPreferredAutolinkRemote(this.activeRepoPath!)
            .catch(() => undefined)
        )?.provider
        return commits.map(
          (c) => new CommitNode(c, this.activeRepoPath!, { remoteProvider }),
        )
      } catch {
        return [new MessageNode("Failed to load file history")]
      }
    }

    return []
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose())
    this._onDidChangeTreeData.dispose()
  }

  private async updateActiveEditor(
    editor: vscode.TextEditor | undefined,
  ): Promise<void> {
    if (!editor || editor.document.uri.scheme !== "file") return

    const fileContext = await this.gitService.getRepoFileContext(
      editor.document.uri,
    )
    if (!fileContext) return

    this.activeRepoPath = fileContext.repoPath
    this.activeFilePath = fileContext.relativePath
    this.refresh()
  }
}
