import * as assert from "node:assert"
import { suite, test } from "mocha"
import * as vscode from "vscode"
import { GitService } from "../git/gitService"

const REPO_A = "/workspace/repo-a"
const REPO_A_NESTED = "/workspace/repo-a/packages/pkg-a"
const REPO_B = "/workspace/repo-b"
const NON_GIT = "/workspace/not-git"

type GitExecArgs = readonly string[]

interface CommandsStub {
  calls: Array<{ command: string; args: unknown[] }>
  executeCommand(command: string, ...args: unknown[]): Promise<void>
}

function createCommandsStub(): CommandsStub {
  return {
    calls: [],
    async executeCommand(command: string, ...args: unknown[]): Promise<void> {
      this.calls.push({ command, args })
    },
  }
}

function createWindowStub(initialFilePath?: string) {
  const listeners: Array<(editor: vscode.TextEditor | undefined) => unknown> =
    []
  let activeTextEditor = initialFilePath
    ? makeTextEditor(initialFilePath)
    : undefined

  return {
    stub: {
      get activeTextEditor(): vscode.TextEditor | undefined {
        return activeTextEditor
      },
      onDidChangeActiveTextEditor(
        listener: (editor: vscode.TextEditor | undefined) => unknown,
      ): vscode.Disposable {
        listeners.push(listener)
        return { dispose: () => {} }
      },
    },
    async setActiveTextEditor(filePath?: string): Promise<void> {
      activeTextEditor = filePath ? makeTextEditor(filePath) : undefined
      for (const listener of listeners) {
        await listener(activeTextEditor)
      }
    },
  }
}

function createWorkspaceStub(folderPaths: string[]) {
  let workspaceFolders = folderPaths.map((folderPath, index) => ({
    uri: vscode.Uri.file(folderPath),
    name: folderPath.split("/").pop() ?? folderPath,
    index,
  })) as vscode.WorkspaceFolder[]

  const workspaceFolderListeners: Array<
    (event: vscode.WorkspaceFoldersChangeEvent) => unknown
  > = []

  return {
    stub: {
      get workspaceFolders(): readonly vscode.WorkspaceFolder[] {
        return workspaceFolders
      },
      createFileSystemWatcher(): vscode.FileSystemWatcher {
        return {
          onDidChange: () => ({ dispose: () => {} }),
          onDidCreate: () => ({ dispose: () => {} }),
          onDidDelete: () => ({ dispose: () => {} }),
          dispose: () => {},
        } as unknown as vscode.FileSystemWatcher
      },
      onDidChangeWorkspaceFolders(
        listener: (event: vscode.WorkspaceFoldersChangeEvent) => unknown,
      ): vscode.Disposable {
        workspaceFolderListeners.push(listener)
        return { dispose: () => {} }
      },
    },
    async setWorkspaceFolders(nextFolderPaths: string[]): Promise<void> {
      workspaceFolders = nextFolderPaths.map((folderPath, index) => ({
        uri: vscode.Uri.file(folderPath),
        name: folderPath.split("/").pop() ?? folderPath,
        index,
      })) as vscode.WorkspaceFolder[]

      for (const listener of workspaceFolderListeners) {
        await listener({ added: [], removed: [] })
      }
    },
  }
}

function makeTextEditor(filePath: string): vscode.TextEditor {
  return {
    document: {
      uri: vscode.Uri.file(filePath),
    },
  } as vscode.TextEditor
}

async function gitExecStub(
  args: GitExecArgs,
  options: { cwd: string },
): Promise<string> {
  const repository = getRepositoryForPath(options.cwd)
  if (!repository) {
    throw new Error(`Not a repository: ${options.cwd}`)
  }

  if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
    return repository.rootPath
  }

  if (args[0] === "rev-parse" && args[1] === "HEAD") {
    return repository.headSha
  }

  if (
    args[0] === "symbolic-ref" &&
    args[1] === "--short" &&
    args[2] === "HEAD"
  ) {
    return repository.headBranch
  }

  throw new Error(`Unexpected git command: ${args.join(" ")}`)
}

function getRepositoryForPath(
  fsPath: string,
): { rootPath: string; headSha: string; headBranch: string } | undefined {
  if (isInside(REPO_A, fsPath)) {
    return {
      rootPath: REPO_A,
      headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      headBranch: "main",
    }
  }

  if (isInside(REPO_B, fsPath)) {
    return {
      rootPath: REPO_B,
      headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      headBranch: "develop",
    }
  }

  return undefined
}

function isInside(basePath: string, candidatePath: string): boolean {
  return candidatePath === basePath || candidatePath.startsWith(`${basePath}/`)
}

suite("GitService", () => {
  test("should discover and dedupe repositories from workspace folders", async () => {
    const workspace = createWorkspaceStub([
      REPO_A,
      REPO_A_NESTED,
      REPO_B,
      NON_GIT,
    ])
    const window = createWindowStub()
    const commands = createCommandsStub()
    const service = new GitService({
      gitExec: gitExecStub,
      workspace: workspace.stub,
      window: window.stub,
      commands,
    })

    const repositories = await service.getRepositories()

    assert.deepStrictEqual(
      repositories.map((repository) => repository.path),
      [REPO_A, REPO_B],
    )
    assert.deepStrictEqual(
      repositories.map((repository) => repository.label),
      ["repo-a", "repo-b"],
    )
    assert.ok(
      commands.calls.some(
        (call) =>
          call.command === "setContext" &&
          call.args[0] === "gitless:repositories:multiple" &&
          call.args[1] === true,
      ),
    )

    service.dispose()
  })

  test("should use the active editor repo as the initial active repository", async () => {
    const workspace = createWorkspaceStub([REPO_A, REPO_B])
    const window = createWindowStub(`${REPO_B}/src/index.ts`)
    const service = new GitService({
      gitExec: gitExecStub,
      workspace: workspace.stub,
      window: window.stub,
      commands: createCommandsStub(),
    })

    const activeRepository = await service.getActiveRepository()

    assert.strictEqual(activeRepository?.path, REPO_B)
    assert.strictEqual(activeRepository?.label, "repo-b")

    service.dispose()
  })

  test("should follow the editor after a manual repository selection", async () => {
    const workspace = createWorkspaceStub([REPO_A, REPO_B])
    const window = createWindowStub(`${REPO_A}/src/index.ts`)
    const service = new GitService({
      gitExec: gitExecStub,
      workspace: workspace.stub,
      window: window.stub,
      commands: createCommandsStub(),
    })

    await service.getRepositories()
    await service.setActiveRepository(REPO_B)
    assert.strictEqual(await service.getActiveRepoPath(), REPO_B)

    await window.setActiveTextEditor(`${REPO_A}/src/other.ts`)
    assert.strictEqual(await service.getActiveRepoPath(), REPO_A)

    service.dispose()
  })

  test("should resolve repository and repo-relative file path for a URI", async () => {
    const workspace = createWorkspaceStub([REPO_A, REPO_B])
    const service = new GitService({
      gitExec: gitExecStub,
      workspace: workspace.stub,
      window: createWindowStub().stub,
      commands: createCommandsStub(),
    })

    const repository = await service.getRepositoryForUri(
      vscode.Uri.file(`${REPO_A}/src/features/example.ts`),
    )
    const fileContext = await service.getRepoFileContext(
      vscode.Uri.file(`${REPO_A}/src/features/example.ts`),
    )

    assert.strictEqual(repository?.path, REPO_A)
    assert.deepStrictEqual(fileContext, {
      repoPath: REPO_A,
      relativePath: "src/features/example.ts",
    })

    service.dispose()
  })

  test("should return undefined for files outside discovered repositories", async () => {
    const workspace = createWorkspaceStub([REPO_A, REPO_B])
    const service = new GitService({
      gitExec: gitExecStub,
      workspace: workspace.stub,
      window: createWindowStub().stub,
      commands: createCommandsStub(),
    })

    const repository = await service.getRepositoryForUri(
      vscode.Uri.file(`${NON_GIT}/src/index.ts`),
    )
    const fileContext = await service.getRepoFileContext(
      vscode.Uri.file(`${NON_GIT}/src/index.ts`),
    )

    assert.strictEqual(repository, undefined)
    assert.strictEqual(fileContext, undefined)

    service.dispose()
  })
})
