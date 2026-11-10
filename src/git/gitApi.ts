import * as vscode from "vscode"
import type { GitExtension } from "../types/vscode.git"

export async function getGitExtension(): Promise<GitExtension> {
  const extension = vscode.extensions.getExtension<GitExtension>("vscode.git")
  if (!extension) {
    throw new Error("The built-in Git extension (vscode.git) is unavailable.")
  }

  return extension.activate()
}
