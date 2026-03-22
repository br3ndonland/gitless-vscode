import * as vscode from "vscode"
import type { GitService } from "../git/gitService"

export class RevisionContentProvider
  implements vscode.TextDocumentContentProvider
{
  static readonly scheme = "gitless-revision"

  constructor(private readonly gitService: GitService) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const repoPath = uri.authority
    const filePath = uri.path.startsWith("/") ? uri.path.slice(1) : uri.path
    const params = new URLSearchParams(uri.query)
    const sha = params.get("sha")

    if (!sha || !repoPath || !filePath) {
      return ""
    }

    try {
      return await this.gitService.getFileContent(repoPath, sha, filePath)
    } catch {
      return ""
    }
  }
}
