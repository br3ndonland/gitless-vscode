import * as assert from "node:assert"
import { suite, test } from "mocha"
import * as vscode from "vscode"
import { GitService } from "../git/gitService"
import { getLogFormat } from "../git/parsers"

const REPO_A = "/workspace/repo-a"
const REPO_A_NESTED = "/workspace/repo-a/packages/pkg-a"
const REPO_B = "/workspace/repo-b"
const NON_GIT = "/workspace/not-git"
const MULTI_REPO = "/workspace/multi-repo"
const FASTENV = `${MULTI_REPO}/fastenv`
const TEMPLATE_PYTHON = `${MULTI_REPO}/template-python`
const STASH_SHA = "cccccccccccccccccccccccccccccccccccccccc"
const SEARCH_SHA = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
const SCAN_DEPTH_ROOT = "/workspace/scan-depth"
const SCAN_DEPTH_REPOS = [
  `${SCAN_DEPTH_ROOT}/repo-depth-1`,
  `${SCAN_DEPTH_ROOT}/level-1/repo-depth-2`,
  `${SCAN_DEPTH_ROOT}/level-1/level-2/repo-depth-3`,
  `${SCAN_DEPTH_ROOT}/level-1/level-2/level-3/repo-depth-4`,
  `${SCAN_DEPTH_ROOT}/level-1/level-2/level-3/level-4/repo-depth-5`,
]
const SCAN_DEPTH_GIT_MARKERS = SCAN_DEPTH_REPOS.map(
  (repoPath) => `${repoPath}/.git/HEAD`,
)

type GitExecArgs = readonly string[]

interface CommandsStub {
  calls: Array<{ command: string; args: unknown[] }>
  executeCommand(command: string, ...args: unknown[]): Promise<void>
}

type ConfigStub = <T>(key: string) => T | undefined

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

function createWorkspaceStub(
  folderPaths: string[],
  gitMarkerPaths: string[] = [],
) {
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
      findFiles(include: vscode.GlobPattern): Promise<vscode.Uri[]> {
        return Promise.resolve(findMatchingGitMarkers(include, gitMarkerPaths))
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

function createConfigStub(values: Record<string, unknown> = {}): ConfigStub {
  return <T>(key: string): T | undefined => values[key] as T | undefined
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

function createStashFilesService(overrides?: {
  trackedOutput?: string
  untrackedOutput?: string
  failUntracked?: boolean
}): { service: GitService; calls: GitExecArgs[] } {
  const trackedOutput = overrides?.trackedOutput ?? ""
  const untrackedOutput = overrides?.untrackedOutput ?? ""
  const failUntracked = overrides?.failUntracked ?? false
  const calls: GitExecArgs[] = []

  const service = new GitService({
    async gitExec(args: GitExecArgs): Promise<string> {
      calls.push([...args])

      if (
        args[0] === "stash" &&
        args[1] === "show" &&
        args[2] === "--name-status" &&
        args[3] === STASH_SHA
      ) {
        return trackedOutput
      }

      if (
        args[0] === "stash" &&
        args[1] === "show" &&
        args[2] === "--only-untracked" &&
        args[3] === "--name-status" &&
        args[4] === STASH_SHA
      ) {
        if (failUntracked) throw new Error("untracked lookup failed")
        return untrackedOutput
      }

      throw new Error(`Unexpected git command: ${args.join(" ")}`)
    },
    workspace: createWorkspaceStub([]).stub,
    window: createWindowStub().stub,
    commands: createCommandsStub(),
  })

  return { service, calls }
}

function createSearchCommitByShaService(overrides?: {
  revParseOutput?: string
  revParseError?: Error
  showOutput?: string
}): { service: GitService; calls: GitExecArgs[] } {
  const resolvedSha = overrides?.revParseOutput ?? SEARCH_SHA
  const showOutput =
    overrides?.showOutput ?? makeLogOutput(resolvedSha, "fix: sha search")
  const calls: GitExecArgs[] = []

  const service = new GitService({
    async gitExec(args: GitExecArgs): Promise<string> {
      calls.push([...args])

      if (
        args[0] === "rev-parse" &&
        args[1] === "--verify" &&
        args[2] === "--quiet"
      ) {
        if (overrides?.revParseError) throw overrides.revParseError
        return `${resolvedSha}\n`
      }

      if (args[0] === "show" && args[1] === "--no-patch") {
        return showOutput
      }

      throw new Error(`Unexpected git command: ${args.join(" ")}`)
    },
    workspace: createWorkspaceStub([]).stub,
    window: createWindowStub().stub,
    commands: createCommandsStub(),
  })

  return { service, calls }
}

function makeLogOutput(sha: string, summary: string): string {
  return [
    sha,
    sha.slice(0, 7),
    "",
    "Test",
    "test@test.com",
    "2024-01-15T10:30:00Z",
    "Test",
    "test@test.com",
    "2024-01-15T10:30:00Z",
    summary,
    "<<END_COMMIT>>",
  ].join("\n")
}

function getRepositoryForPath(
  fsPath: string,
): { rootPath: string; headSha: string; headBranch: string } | undefined {
  const scanDepthRepoIndex = SCAN_DEPTH_REPOS.findIndex((repoPath) =>
    isInside(repoPath, fsPath),
  )
  if (scanDepthRepoIndex >= 0) {
    const index = scanDepthRepoIndex + 1
    return {
      rootPath: SCAN_DEPTH_REPOS[scanDepthRepoIndex]!,
      headSha: `${index}`.repeat(40),
      headBranch: "main",
    }
  }

  if (isInside(FASTENV, fsPath)) {
    return {
      rootPath: FASTENV,
      headSha: "ffffffffffffffffffffffffffffffffffffffff",
      headBranch: "main",
    }
  }

  if (isInside(TEMPLATE_PYTHON, fsPath)) {
    return {
      rootPath: TEMPLATE_PYTHON,
      headSha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      headBranch: "main",
    }
  }

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

function findMatchingGitMarkers(
  include: vscode.GlobPattern,
  gitMarkerPaths: string[],
): vscode.Uri[] {
  if (!(include instanceof vscode.RelativePattern)) return []

  return gitMarkerPaths
    .filter((markerPath) => isInside(include.baseUri.fsPath, markerPath))
    .filter((markerPath) => {
      const relativePath = normalizePath(
        pathRelative(include.baseUri.fsPath, markerPath),
      )

      return matchGitMarkerPattern(relativePath, include.pattern)
    })
    .map((markerPath) => vscode.Uri.file(markerPath))
}

function matchGitMarkerPattern(relativePath: string, pattern: string): boolean {
  if (pattern === "**/.git") return relativePath.endsWith("/.git")
  if (pattern === "**/.git/HEAD") return relativePath.endsWith("/.git/HEAD")

  const relativeParts = relativePath.split("/")
  const patternParts = pattern.split("/")
  if (relativeParts.length !== patternParts.length) return false

  return patternParts.every((patternPart, index) => {
    const relativePart = relativeParts[index]
    return patternPart === "*" || patternPart === relativePart
  })
}

function pathRelative(basePath: string, candidatePath: string): string {
  return candidatePath.slice(basePath.length + 1)
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/")
}

suite("GitService", () => {
  suite("getStashFiles", () => {
    test("should use stash show rather than diff-tree", async () => {
      const { service, calls } = createStashFilesService({
        trackedOutput: "M\tsrc/tracked.ts",
        untrackedOutput: "A\tsrc/untracked.ts",
      })

      await service.getStashFiles(REPO_A, STASH_SHA)

      assert.deepStrictEqual(calls, [
        ["stash", "show", "--name-status", STASH_SHA],
        ["stash", "show", "--only-untracked", "--name-status", STASH_SHA],
      ])
      assert.ok(
        calls.every((args) => args[0] !== "diff-tree"),
        "stash files should not use diff-tree",
      )

      service.dispose()
    })

    test("should return tracked stash files", async () => {
      const { service } = createStashFilesService({
        trackedOutput: "M\tsrc/tracked.ts",
      })

      const files = await service.getStashFiles(REPO_A, STASH_SHA)

      assert.deepStrictEqual(files, [
        { path: "src/tracked.ts", originalPath: undefined, status: "modified" },
      ])

      service.dispose()
    })

    test("should return an empty list when both outputs are empty", async () => {
      const { service } = createStashFilesService()

      const files = await service.getStashFiles(REPO_A, STASH_SHA)

      assert.deepStrictEqual(files, [])

      service.dispose()
    })

    test("should mark only-untracked entries as untracked", async () => {
      const { service } = createStashFilesService({
        untrackedOutput: "A\tsrc/untracked.ts",
      })

      const files = await service.getStashFiles(REPO_A, STASH_SHA)

      assert.deepStrictEqual(files, [
        {
          path: "src/untracked.ts",
          originalPath: undefined,
          status: "untracked",
        },
      ])

      service.dispose()
    })

    test("should return tracked files when untracked lookup fails", async () => {
      const { service } = createStashFilesService({
        trackedOutput: "M\tsrc/tracked.ts",
        failUntracked: true,
      })

      const files = await service.getStashFiles(REPO_A, STASH_SHA)

      assert.deepStrictEqual(files, [
        { path: "src/tracked.ts", originalPath: undefined, status: "modified" },
      ])

      service.dispose()
    })
  })

  suite("searchCommits", () => {
    test("should resolve sha search by unique prefix", async () => {
      const prefix = SEARCH_SHA.slice(0, 7).toUpperCase()
      const { service, calls } = createSearchCommitByShaService()

      const commits = await service.searchCommits(REPO_A, prefix, {
        mode: "sha",
      })

      assert.strictEqual(commits.length, 1)
      assert.strictEqual(commits[0]?.sha, SEARCH_SHA)
      assert.deepStrictEqual(calls, [
        [
          "rev-parse",
          "--verify",
          "--quiet",
          `${SEARCH_SHA.slice(0, 7)}^{commit}`,
        ],
        ["show", "--no-patch", `--format=${getLogFormat()}`, SEARCH_SHA],
      ])

      service.dispose()
    })

    test("should return no results for invalid sha query", async () => {
      const { service, calls } = createSearchCommitByShaService()

      const commits = await service.searchCommits(REPO_A, "fix login", {
        mode: "sha",
      })

      assert.deepStrictEqual(commits, [])
      assert.deepStrictEqual(calls, [])

      service.dispose()
    })

    test("should return no results for unresolved sha query", async () => {
      const prefix = SEARCH_SHA.slice(0, 7)
      const { service, calls } = createSearchCommitByShaService({
        revParseError: new Error("ambiguous or missing revision"),
      })

      const commits = await service.searchCommits(REPO_A, prefix, {
        mode: "sha",
      })

      assert.deepStrictEqual(commits, [])
      assert.deepStrictEqual(calls, [
        ["rev-parse", "--verify", "--quiet", `${prefix}^{commit}`],
      ])

      service.dispose()
    })
  })

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

  test("should discover child repositories from a non-git workspace folder", async () => {
    const workspace = createWorkspaceStub(
      [MULTI_REPO],
      [`${FASTENV}/.git/HEAD`, `${TEMPLATE_PYTHON}/.git/HEAD`],
    )
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
      [FASTENV, TEMPLATE_PYTHON],
    )
    assert.deepStrictEqual(
      repositories.map((repository) => repository.label),
      ["fastenv", "template-python"],
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

  test("should use the active editor repo from child discovery", async () => {
    const workspace = createWorkspaceStub(
      [MULTI_REPO],
      [`${FASTENV}/.git/HEAD`, `${TEMPLATE_PYTHON}/.git/HEAD`],
    )
    const window = createWindowStub(`${TEMPLATE_PYTHON}/src/index.py`)
    const service = new GitService({
      gitExec: gitExecStub,
      workspace: workspace.stub,
      window: window.stub,
      commands: createCommandsStub(),
    })

    const activeRepository = await service.getActiveRepository()

    assert.strictEqual(activeRepository?.path, TEMPLATE_PYTHON)
    assert.strictEqual(activeRepository?.label, "template-python")

    service.dispose()
  })

  test("should dedupe child and direct workspace repositories", async () => {
    const workspace = createWorkspaceStub(
      [MULTI_REPO, FASTENV],
      [`${FASTENV}/.git/HEAD`],
    )
    const service = new GitService({
      gitExec: gitExecStub,
      workspace: workspace.stub,
      window: createWindowStub().stub,
      commands: createCommandsStub(),
    })

    const repositories = await service.getRepositories()

    assert.deepStrictEqual(
      repositories.map((repository) => repository.path),
      [FASTENV],
    )

    service.dispose()
  })

  test("should discover child repositories from git file markers", async () => {
    const workspace = createWorkspaceStub([MULTI_REPO], [`${FASTENV}/.git`])
    const service = new GitService({
      gitExec: gitExecStub,
      workspace: workspace.stub,
      window: createWindowStub().stub,
      commands: createCommandsStub(),
    })

    const repositories = await service.getRepositories()

    assert.deepStrictEqual(
      repositories.map((repository) => repository.path),
      [FASTENV],
    )

    service.dispose()
  })

  for (const { label, configuredDepth, expectedDepth } of [
    { label: "default depth", configuredDepth: undefined, expectedDepth: 1 },
    { label: "depth 2", configuredDepth: 2, expectedDepth: 2 },
    { label: "depth 3", configuredDepth: 3, expectedDepth: 3 },
    { label: "depth 4", configuredDepth: 4, expectedDepth: 4 },
    { label: "depth 5", configuredDepth: 5, expectedDepth: 5 },
  ]) {
    test(`should discover repositories at ${label}`, async () => {
      const workspace = createWorkspaceStub(
        [SCAN_DEPTH_ROOT],
        SCAN_DEPTH_GIT_MARKERS,
      )
      const configValues =
        configuredDepth === undefined
          ? {}
          : { repositoryScanMaxDepth: configuredDepth }
      const service = new GitService({
        gitExec: gitExecStub,
        getConfig: createConfigStub(configValues),
        workspace: workspace.stub,
        window: createWindowStub().stub,
        commands: createCommandsStub(),
      })

      const repositories = await service.getRepositories()

      assert.deepStrictEqual(
        repositories.map((repository) => repository.path),
        SCAN_DEPTH_REPOS.slice(0, expectedDepth),
      )

      service.dispose()
    })
  }

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
