import * as vscode from "vscode"
import type { GitFileStatus } from "../git/models"
import { FILE_NODE_URI_SCHEME } from "./nodes"

/**
 * Provides git-status file decorations (color tint and status badge) for
 * FileNode tree items.  FileNodes use a custom URI scheme so that these
 * decorations do not interfere with the built-in git decorations applied
 * to real workspace files.
 */
export class GitFileDecorationProvider
  implements vscode.FileDecorationProvider
{
  private readonly _onDidChangeFileDecorations = new vscode.EventEmitter<
    vscode.Uri | vscode.Uri[] | undefined
  >()
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event

  provideFileDecoration(
    uri: vscode.Uri,
  ): vscode.ProviderResult<vscode.FileDecoration> {
    if (uri.scheme !== FILE_NODE_URI_SCHEME) {
      return undefined
    }

    const status = new URLSearchParams(uri.query).get(
      "status",
    ) as GitFileStatus | null
    if (!status) {
      return undefined
    }

    return getDecoration(status)
  }

  dispose(): void {
    this._onDidChangeFileDecorations.dispose()
  }
}

function getDecoration(status: GitFileStatus): vscode.FileDecoration {
  switch (status) {
    case "added":
      return new vscode.FileDecoration(
        "A",
        "Added",
        new vscode.ThemeColor("gitDecoration.addedResourceForeground"),
      )
    case "modified":
      return new vscode.FileDecoration(
        "M",
        "Modified",
        new vscode.ThemeColor("gitDecoration.modifiedResourceForeground"),
      )
    case "deleted":
      return new vscode.FileDecoration(
        "D",
        "Deleted",
        new vscode.ThemeColor("gitDecoration.deletedResourceForeground"),
      )
    case "renamed":
      return new vscode.FileDecoration(
        "R",
        "Renamed",
        new vscode.ThemeColor("gitDecoration.renamedResourceForeground"),
      )
    case "copied":
      return new vscode.FileDecoration(
        "C",
        "Copied",
        new vscode.ThemeColor("gitDecoration.addedResourceForeground"),
      )
    case "untracked":
      return new vscode.FileDecoration(
        "U",
        "Untracked",
        new vscode.ThemeColor("gitDecoration.untrackedResourceForeground"),
      )
    default:
      return new vscode.FileDecoration()
  }
}
