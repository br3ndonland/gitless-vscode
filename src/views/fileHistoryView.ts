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
  private activeFilePath: string | undefined

  constructor(private readonly gitService: GitService) {
    this.treeView = vscode.window.createTreeView(ViewIds.FileHistory, {
      treeDataProvider: this,
      showCollapseAll: true,
    })

    // Track active editor
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document.uri.scheme === "file") {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(
          editor.document.uri,
        )
        if (workspaceFolder) {
          this.activeFilePath = vscode.workspace.asRelativePath(
            editor.document.uri,
            false,
          )
          this.refresh()
        }
      }
    })

    // Initialize with current editor
    const editor = vscode.window.activeTextEditor
    if (editor && editor.document.uri.scheme === "file") {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(
        editor.document.uri,
      )
      if (workspaceFolder) {
        this.activeFilePath = vscode.workspace.asRelativePath(
          editor.document.uri,
          false,
        )
      }
    }
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

    if (!this.activeFilePath) {
      return [new MessageNode("Open a file to see its history")]
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
      try {
        const commits = await this.gitService.getFileHistory(
          repoPath,
          this.activeFilePath,
        )
        if (commits.length === 0) {
          return [new MessageNode("No history found")]
        }
        this.treeView.description = this.activeFilePath
        return commits.map((c) => new CommitNode(c, repoPath))
      } catch {
        return [new MessageNode("Failed to load file history")]
      }
    }

    return []
  }

  dispose(): void {
    this.treeView.dispose()
    this._onDidChangeTreeData.dispose()
  }
}
