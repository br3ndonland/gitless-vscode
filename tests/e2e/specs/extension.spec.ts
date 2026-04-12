import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import * as vscode from "vscode"
import { suite, suiteSetup, test } from "mocha"
import { Commands } from "../../../src/constants"
import { REVISION_SCHEME } from "../../../src/commands/revisionContentProvider"

interface FixtureMetadata {
  repoPath: string
  fixtureFile: string
  remoteBaseUrl: string
  initialSha: string
  initialFileContent: string
  headSha: string
  branch: string
}

const extensionId = "br3ndonland.gitless-vscode"

let fixture: FixtureMetadata

suite("GitLess Extension E2E", () => {
  suiteSetup(async () => {
    fixture = await readFixtureMetadata()
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
    assert.equal(workspaceFolder?.uri.fsPath, fixture.repoPath)

    const extension = vscode.extensions.getExtension(extensionId)
    assert.ok(extension, `Expected ${extensionId} to be installed`)
    await extension.activate()
    assert.equal(extension.isActive, true)
  })

  test("registers the extension and expected commands", async () => {
    const commands = new Set(await vscode.commands.getCommands(true))

    for (const command of [
      Commands.CopyRemoteRepoUrl,
      Commands.CopyRemoteFileUrl,
      Commands.CopyRemoteFileUrlFrom,
      Commands.CopyRemoteCommitUrl,
      Commands.CopyRemoteCommitUrlFrom,
      Commands.CopySha,
      Commands.CopyShortSha,
      Commands.CopyMessage,
      Commands.CopyTag,
      Commands.CopyTagMessage,
      Commands.CopyRemoteFileUrlAtRevision,
      Commands.CopyRemoteCommitFileUrl,
      Commands.CopyRemoteCommitFileUrlAtRevision,
      Commands.SearchCommits,
      Commands.CompareRefs,
      Commands.RefreshView,
      Commands.ShowCommits,
      Commands.ShowTags,
      Commands.ShowBranches,
      Commands.ShowRemotes,
      Commands.ShowStashes,
      Commands.ShowWorktrees,
    ]) {
      assert.equal(commands.has(command), true, `Missing command ${command}`)
    }
  })

  test("copies commit and remote repository values", async () => {
    await vscode.commands.executeCommand(Commands.CopySha)
    assert.equal(await vscode.env.clipboard.readText(), fixture.headSha)

    await vscode.commands.executeCommand(Commands.CopyShortSha)
    const shortShaLength =
      vscode.workspace
        .getConfiguration("gitless")
        .get<number>("shortShaLength") ?? 7
    assert.equal(
      await vscode.env.clipboard.readText(),
      fixture.headSha.slice(0, shortShaLength),
    )

    await vscode.commands.executeCommand(Commands.CopyRemoteRepoUrl)
    assert.equal(await vscode.env.clipboard.readText(), fixture.remoteBaseUrl)

    await vscode.commands.executeCommand(Commands.CopyRemoteCommitUrl)
    assert.equal(
      await vscode.env.clipboard.readText(),
      `${fixture.remoteBaseUrl}/commit/${fixture.headSha}`,
    )
  })

  test("copies the active file remote URL", async () => {
    await openFixtureFile()

    await vscode.commands.executeCommand(Commands.CopyRemoteFileUrl)
    assert.equal(
      await vscode.env.clipboard.readText(),
      `${fixture.remoteBaseUrl}/blob/${fixture.branch}/${fixture.fixtureFile}`,
    )
  })

  test("opens fixture file content at a revision", async () => {
    await vscode.commands.executeCommand(Commands.OpenFileAtRevision, {
      sha: fixture.initialSha,
      filePath: fixture.fixtureFile,
      repoPath: fixture.repoPath,
    })

    const editor = await waitFor(() => {
      const activeEditor = vscode.window.activeTextEditor
      return activeEditor?.document.uri.scheme === REVISION_SCHEME
        ? activeEditor
        : undefined
    }, "Expected revision document to open")

    assert.equal(editor.document.getText(), fixture.initialFileContent)
  })

  test("runs view commands in a real extension host", async () => {
    await vscode.commands.executeCommand("workbench.view.scm")
    await vscode.commands.executeCommand(
      "workbench.view.extension.gitlessInspect",
    )

    for (const command of [
      Commands.ShowCommits,
      Commands.ShowTags,
      Commands.ShowBranches,
      Commands.ShowRemotes,
      Commands.ShowStashes,
      Commands.ShowWorktrees,
    ]) {
      await vscode.commands.executeCommand(command)
    }
  })
})

async function readFixtureMetadata(): Promise<FixtureMetadata> {
  const metadataPath = process.env.GITLESS_E2E_METADATA
  assert.ok(metadataPath, "GITLESS_E2E_METADATA must be set")

  return JSON.parse(await readFile(metadataPath, "utf8")) as FixtureMetadata
}

async function openFixtureFile(): Promise<vscode.TextEditor> {
  const fixtureFilePath = path.join(fixture.repoPath, fixture.fixtureFile)
  const document = await vscode.workspace.openTextDocument(
    vscode.Uri.file(fixtureFilePath),
  )
  await vscode.window.showTextDocument(document)

  return waitFor(() => {
    const activeEditor = vscode.window.activeTextEditor
    return activeEditor?.document.uri.fsPath === fixtureFilePath
      ? activeEditor
      : undefined
  }, "Expected fixture file to open")
}

async function waitFor<T>(
  getValue: () => T | undefined | Promise<T | undefined>,
  message: string,
): Promise<T> {
  const timeoutAt = Date.now() + 10000

  while (Date.now() < timeoutAt) {
    const value = await getValue()
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  assert.fail(message)
}
