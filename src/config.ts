import * as vscode from "vscode"

const EXTENSION_PREFIX = "gitless"

let shortShaLength = 7

export function getConfig<T>(key: string): T | undefined {
  return vscode.workspace.getConfiguration(EXTENSION_PREFIX).get<T>(key)
}

export function getShortShaLength(): number {
  return shortShaLength
}

export function updateShortShaLength(): void {
  const configured = getConfig<number>("shortShaLength")
  shortShaLength = Math.max(5, Math.min(40, configured ?? 7))
}

export function shortenSha(sha: string): string {
  return sha.slice(0, shortShaLength)
}

export function onConfigurationChanged(
  callback: (e: vscode.ConfigurationChangeEvent) => void,
): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration(EXTENSION_PREFIX)) {
      callback(e)
    }
  })
}
