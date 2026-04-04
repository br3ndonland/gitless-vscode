import * as vscode from "vscode"
import type { GitService } from "../git/gitService"

export const REVISION_SCHEME = "gitless-revision"

/** Build a URI that the RevisionContentProvider can resolve. */
export function makeRevisionUri(
  repoPath: string,
  filePath: string,
  sha: string,
): vscode.Uri {
  const query = new URLSearchParams({ sha, repoPath }).toString()
  return vscode.Uri.from({
    scheme: REVISION_SCHEME,
    path: "/" + filePath,
    query,
  })
}

export class RevisionContentProvider
  implements vscode.TextDocumentContentProvider
{
  static readonly scheme = REVISION_SCHEME

  constructor(private readonly gitService: GitService) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const params = new URLSearchParams(uri.query)
    const sha = params.get("sha")
    const repoPath = params.get("repoPath")
    const filePath = uri.path.startsWith("/") ? uri.path.slice(1) : uri.path

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
