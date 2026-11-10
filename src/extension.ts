import * as vscode from "vscode"
import { Container } from "./container"
import { EXTENSION_NAME } from "./constants"
import { getGitExtension } from "./git/gitApi"

let container: Container | undefined

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const start = Date.now()

  try {
    const gitExtension = await getGitExtension()
    container = new Container(context, gitExtension)
    context.subscriptions.push(container)

    const elapsed = Date.now() - start
    container.outputChannel.appendLine(
      `${EXTENSION_NAME} activated in ${elapsed}ms`,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    vscode.window.showErrorMessage(
      `${EXTENSION_NAME} failed to activate: ${message}`,
    )
    throw err
  }
}

export function deactivate(): void {
  container?.dispose()
  container = undefined
}
