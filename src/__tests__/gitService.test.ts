import * as assert from "node:assert"
import { suite, teardown, test } from "mocha"
import * as vscode from "vscode"
import { GitService } from "../git/gitService"
import { getLogFormat } from "../git/parsers"
import type { GitExecOptions } from "../git/shell"
import type {
  API,
  APIState,
  Branch,
  Commit,
  GitExtension,
  Remote,
  Repository,
  Worktree,
} from "../types/vscode.git"

const REPO_A = "/workspace/repo-a"
const REPO_NESTED = `${REPO_A}/packages/nested`
const REPO_B = "/workspace/repo-b"
const LINKED_WORKTREE = "/workspace/linked-worktree"
const SHA_A = "a".repeat(40)
const SHA_B = "b".repeat(40)
const STASH_SHA = "c".repeat(40)
const SEARCH_SHA = "deadbeef".repeat(5)
const GIT_PATH = "/configured/bin/git"
const DATE = new Date("2024-01-15T10:30:00Z")

interface ApiCall {
  method: string
  args: unknown[]
}

interface CliCall {
  args: string[]
  options: GitExecOptions
}

type CliHandler = (args: string[], options: GitExecOptions) => Promise<string>

const disposables: vscode.Disposable[] = []

function createRepository(repoPath: string, headSha = SHA_A) {
  const changed = new vscode.EventEmitter<void>()
  disposables.push(changed)
  const calls: ApiCall[] = []
  const state = {
    HEAD: { type: 0, name: "main", commit: headSha } as Branch | undefined,
    remotes: [] as Remote[],
    worktrees: [] as Worktree[],
    onDidChange: changed.event,
  }
  const behavior = {
    failure: undefined as Error | undefined,
    commits: [makeApiCommit(headSha)],
  }

  async function record(method: string, ...args: unknown[]): Promise<void> {
    calls.push({ method, args })
    if (behavior.failure) throw behavior.failure
  }

  const stub = {
    rootUri: vscode.Uri.file(repoPath),
    state,
    async log(options: unknown): Promise<Commit[]> {
      await record("log", options)
      return behavior.commits
    },
    async getCommit(ref: string): Promise<Commit> {
      await record("getCommit", ref)
      return behavior.commits[0]!
    },
    async status(): Promise<void> {
      await record("status")
      changed.fire()
    },
    async checkout(ref: string): Promise<void> {
      await record("checkout", ref)
      changed.fire()
    },
    async applyStash(index?: number): Promise<void> {
      await record("applyStash", index)
      changed.fire()
    },
    async popStash(index?: number): Promise<void> {
      await record("popStash", index)
      changed.fire()
    },
    async dropStash(index?: number): Promise<void> {
      await record("dropStash", index)
      changed.fire()
    },
  }

  return {
    repository: stub as unknown as Repository,
    state,
    changed,
    behavior,
    calls,
  }
}

function createHarness(
  options: {
    repositories?: ReturnType<typeof createRepository>[]
    enabled?: boolean
    state?: APIState
    activeFile?: string
    workspacePaths?: string[]
    gitExec?: CliHandler
  } = {},
) {
  const repositories = options.repositories ?? [createRepository(REPO_A)]
  const opened = new vscode.EventEmitter<Repository>()
  const closed = new vscode.EventEmitter<Repository>()
  const initialized = new vscode.EventEmitter<APIState>()
  const enablement = new vscode.EventEmitter<boolean>()
  const editorChanged = new vscode.EventEmitter<vscode.TextEditor | undefined>()
  const workspaceChanged =
    new vscode.EventEmitter<vscode.WorkspaceFoldersChangeEvent>()
  disposables.push(
    opened,
    closed,
    initialized,
    enablement,
    editorChanged,
    workspaceChanged,
  )
  const cliCalls: CliCall[] = []
  const contextCalls: Array<{ command: string; args: unknown[] }> = []
  const watchers: Array<{
    pattern: vscode.GlobPattern
    changed: vscode.EventEmitter<vscode.Uri>
    disposed: boolean
  }> = []
  let enabled = options.enabled ?? true
  let apiReady = enabled
  let activeTextEditor = options.activeFile
    ? makeTextEditor(options.activeFile)
    : undefined
  const folders = (options.workspacePaths ?? [REPO_A, REPO_B]).map(
    (folderPath, index) => ({
      uri: vscode.Uri.file(folderPath),
      name: folderPath.split("/").pop()!,
      index,
    }),
  )
  const apiState = {
    state: options.state ?? "initialized",
    git: { path: GIT_PATH },
    repositories: repositories.map((repo) => repo.repository),
    onDidChangeState: initialized.event,
    onDidOpenRepository: opened.event,
    onDidCloseRepository: closed.event,
    getRepository(uri: vscode.Uri): Repository | null {
      return (
        [...apiState.repositories]
          .sort((a, b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length)
          .find((repo) => isInside(repo.rootUri.fsPath, uri.fsPath)) ?? null
      )
    },
    async openRepository(): Promise<never> {
      throw new Error("Browsing must not open repositories in SCM")
    },
  }
  const extension: GitExtension = {
    get enabled() {
      return enabled
    },
    onDidChangeEnablement: enablement.event,
    getAPI(version: 1): API {
      assert.strictEqual(version, 1)
      assert.ok(enabled, "Do not acquire the API while disabled")
      if (!apiReady)
        throw new Error("API is not ready until enablement returns")
      return apiState as unknown as API
    },
  }
  const service = new GitService(extension, {
    async gitExec(args, cliOptions): Promise<string> {
      cliCalls.push({ args: [...args], options: { ...cliOptions } })
      if (options.gitExec) return options.gitExec(args, cliOptions)
      throw new Error(`Unexpected CLI call: ${args.join(" ")}`)
    },
    workspace: {
      getWorkspaceFolder(uri: vscode.Uri) {
        return [...folders]
          .sort((a, b) => b.uri.fsPath.length - a.uri.fsPath.length)
          .find((folder) => isInside(folder.uri.fsPath, uri.fsPath))
      },
      createFileSystemWatcher(pattern: vscode.GlobPattern) {
        const changed = new vscode.EventEmitter<vscode.Uri>()
        const watcher = { pattern, changed, disposed: false }
        watchers.push(watcher)
        return {
          onDidChange: changed.event,
          onDidCreate: changed.event,
          onDidDelete: changed.event,
          dispose() {
            watcher.disposed = true
            changed.dispose()
          },
        } as unknown as vscode.FileSystemWatcher
      },
      onDidChangeWorkspaceFolders: workspaceChanged.event,
    },
    window: {
      get activeTextEditor() {
        return activeTextEditor
      },
      onDidChangeActiveTextEditor: editorChanged.event,
    },
    commands: {
      async executeCommand<T = unknown>(
        command: string,
        ...args: unknown[]
      ): Promise<T> {
        contextCalls.push({ command, args })
        return undefined as T
      },
    },
  })
  disposables.push(service)

  return {
    service,
    apiState,
    repositories,
    cliCalls,
    contextCalls,
    watchers,
    setEnabled(value: boolean, readyAfterEvent = false) {
      enabled = value
      apiReady = value && !readyAfterEvent
      enablement.fire(value)
      apiReady = value
    },
    setInitialized() {
      apiState.state = "initialized"
      initialized.fire("initialized")
    },
    open(repo: ReturnType<typeof createRepository>) {
      apiState.repositories.push(repo.repository)
      opened.fire(repo.repository)
    },
    close(repo: ReturnType<typeof createRepository>) {
      apiState.repositories = apiState.repositories.filter(
        (entry) => entry !== repo.repository,
      )
      closed.fire(repo.repository)
    },
    setActiveFile(filePath?: string) {
      activeTextEditor = filePath ? makeTextEditor(filePath) : undefined
      editorChanged.fire(activeTextEditor)
    },
  }
}

function makeTextEditor(filePath: string): vscode.TextEditor {
  return {
    document: { uri: vscode.Uri.file(filePath) },
  } as vscode.TextEditor
}

function makeApiCommit(hash: string): Commit {
  return {
    hash,
    message: "fix: API history\n\nCommit details",
    parents: [SHA_B],
    authorName: "Test Author",
    authorEmail: "test@example.com",
    authorDate: DATE,
    commitDate: DATE,
  }
}

function makeLogOutput(sha: string, summary = "fix: supplemental history") {
  return [
    sha,
    sha.slice(0, 7),
    "",
    "Test",
    "test@test.com",
    DATE.toISOString(),
    "Test Committer",
    "committer@test.com",
    DATE.toISOString(),
    summary,
    "<<END_COMMIT>>",
  ].join("\n")
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`)
}

async function settleEvents(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

suite("GitService", () => {
  teardown(() => {
    for (const disposable of disposables.splice(0).reverse()) {
      disposable.dispose()
    }
  })

  suite("API repository lifecycle", () => {
    test("uses the API snapshot without probing workspace folders", async () => {
      const repoA = createRepository(REPO_A)
      const repoB = createRepository(REPO_B, SHA_B)
      const harness = createHarness({ repositories: [repoA, repoB] })
      const repositories = await harness.service.getRepositories()

      assert.deepStrictEqual(
        repositories.map((repo) => ({ path: repo.path, label: repo.label })),
        [
          { path: REPO_A, label: "repo-a" },
          { path: REPO_B, label: "repo-b" },
        ],
      )
      assert.strictEqual(repositories[0]?.headSha, SHA_A)
      assert.strictEqual(repositories[0]?.workspaceFolderName, "repo-a")
      assert.deepStrictEqual(harness.cliCalls, [])
      assert.ok(
        harness.contextCalls.some(
          (call) =>
            call.command === "setContext" &&
            call.args[0] === "gitless:repositories:multiple" &&
            call.args[1] === true,
        ),
      )
    })

    test("selects the deepest repository containing the initial editor", async () => {
      const harness = createHarness({
        repositories: [createRepository(REPO_A), createRepository(REPO_NESTED)],
        activeFile: `${REPO_NESTED}/index.ts`,
      })

      assert.strictEqual(await harness.service.getActiveRepoPath(), REPO_NESTED)
      assert.deepStrictEqual(
        await harness.service.getRepoFileContext(
          vscode.Uri.file(`${REPO_NESTED}/src/index.ts`),
        ),
        { repoPath: REPO_NESTED, relativePath: "src/index.ts" },
      )
    })

    test("preserves manual selection until the active editor changes", async () => {
      const harness = createHarness({
        repositories: [createRepository(REPO_A), createRepository(REPO_B)],
        activeFile: `${REPO_A}/first.ts`,
      })
      await harness.service.setActiveRepository(REPO_B)
      harness.open(createRepository(REPO_NESTED))
      await settleEvents()
      assert.strictEqual(await harness.service.getActiveRepoPath(), REPO_B)

      harness.setActiveFile(`${REPO_A}/second.ts`)
      await settleEvents()
      assert.strictEqual(await harness.service.getActiveRepoPath(), REPO_A)
    })

    test("tracks repositories opened and closed after initialization", async () => {
      const repoA = createRepository(REPO_A)
      const repoB = createRepository(REPO_B)
      const harness = createHarness({ repositories: [repoA] })
      harness.open(repoB)
      await settleEvents()
      await harness.service.setActiveRepository(REPO_B)
      harness.close(repoB)
      await settleEvents()

      assert.deepStrictEqual(
        (await harness.service.getRepositories()).map((repo) => repo.path),
        [REPO_A],
      )
      assert.strictEqual(await harness.service.getActiveRepoPath(), REPO_A)
      let changes = 0
      harness.service.onDidChange(() => changes++)
      repoB.changed.fire()
      await settleEvents()
      assert.strictEqual(changes, 0, "Closed repositories must be unsubscribed")
    })

    test("follows an editor repository discovered after API initialization", async () => {
      const harness = createHarness({ activeFile: `${REPO_A}/first.ts` })
      harness.setActiveFile(`${REPO_B}/first.ts`)
      await settleEvents()
      assert.strictEqual(await harness.service.getActiveRepoPath(), REPO_A)

      harness.open(createRepository(REPO_B))
      await settleEvents()
      assert.strictEqual(await harness.service.getActiveRepoPath(), REPO_B)
    })

    test("keeps manual selection over pending editor discovery until the editor changes", async () => {
      const harness = createHarness({
        repositories: [createRepository(REPO_A), createRepository(REPO_NESTED)],
        activeFile: `${REPO_A}/first.ts`,
      })
      harness.setActiveFile(`${REPO_B}/first.ts`)
      await settleEvents()
      await harness.service.setActiveRepository(REPO_NESTED)
      harness.open(createRepository(REPO_B))
      await settleEvents()
      assert.strictEqual(await harness.service.getActiveRepoPath(), REPO_NESTED)

      harness.setActiveFile(`${REPO_B}/second.ts`)
      await settleEvents()
      assert.strictEqual(await harness.service.getActiveRepoPath(), REPO_B)
    })

    test("accepts repositories arriving during API initialization", async () => {
      const harness = createHarness({
        repositories: [],
        state: "uninitialized",
        activeFile: `${REPO_B}/index.ts`,
      })
      assert.deepStrictEqual(await harness.service.getRepositories(), [])
      harness.open(createRepository(REPO_A))
      harness.open(createRepository(REPO_B))
      harness.setInitialized()
      await settleEvents()
      assert.strictEqual(await harness.service.getActiveRepoPath(), REPO_B)
    })

    test("rejects URI matches outside roots or using unsupported schemes", async () => {
      const { service } = createHarness()
      assert.strictEqual(
        await service.getRepositoryForUri(vscode.Uri.file(`${REPO_A}-other/a`)),
        undefined,
      )
      assert.strictEqual(
        await service.getRepositoryForUri(vscode.Uri.parse("untitled:example")),
        undefined,
      )
      assert.strictEqual(
        await service.getRepoFileContext(vscode.Uri.file(REPO_A)),
        undefined,
      )
    })

    test("coalesces state changes without recursively requesting status", async () => {
      const repo = createRepository(REPO_A)
      const { service } = createHarness({ repositories: [repo] })
      await settleEvents()
      let changes = 0
      service.onDidChange(() => changes++)
      repo.state.HEAD = { type: 0, name: "topic", commit: SHA_B }
      repo.changed.fire()
      repo.changed.fire()
      repo.changed.fire()
      await settleEvents()

      assert.strictEqual(changes, 1)
      assert.strictEqual((await service.getActiveRepository())?.headSha, SHA_B)
      assert.strictEqual(await service.getHeadBranch(REPO_A), "topic")
      assert.deepStrictEqual(repo.calls, [])
    })

    test("explicit refresh requests status once for each open repository", async () => {
      const repoA = createRepository(REPO_A)
      const repoB = createRepository(REPO_B)
      const { service } = createHarness({ repositories: [repoA, repoB] })
      await settleEvents()
      repoA.calls.length = 0
      repoB.calls.length = 0
      await service.refreshRepositories(true)
      await settleEvents()

      for (const repo of [repoA, repoB]) {
        assert.deepStrictEqual(repo.calls, [{ method: "status", args: [] }])
      }
    })

    test("supports detached and unborn HEAD without CLI probes", async () => {
      const repo = createRepository(REPO_A)
      repo.state.HEAD = { type: 0, commit: SHA_A }
      const harness = createHarness({ repositories: [repo] })
      assert.strictEqual(await harness.service.getHeadSha(REPO_A), SHA_A)
      assert.strictEqual(await harness.service.getHeadBranch(REPO_A), undefined)
      repo.state.HEAD = { type: 0, name: "main" }
      repo.changed.fire()
      await settleEvents()
      await assert.rejects(harness.service.getHeadSha(REPO_A))
      assert.deepStrictEqual(harness.cliCalls, [])
    })

    test("does not treat a detached tag name as a HEAD branch", async () => {
      const repo = createRepository(REPO_A)
      repo.state.HEAD = { type: 2, name: "v1", commit: SHA_A }
      const harness = createHarness({ repositories: [repo] })

      assert.strictEqual(await harness.service.getHeadSha(REPO_A), SHA_A)
      assert.strictEqual(await harness.service.getHeadBranch(REPO_A), undefined)
      assert.strictEqual(
        (await harness.service.getActiveRepository())?.headBranch,
        undefined,
      )
      assert.deepStrictEqual(harness.cliCalls, [])
    })

    test("refreshes other repositories and reports a status failure", async () => {
      const repoA = createRepository(REPO_A)
      const repoB = createRepository(REPO_B)
      const failure = new Error("Status failed")
      const { service } = createHarness({ repositories: [repoA, repoB] })
      await settleEvents()
      repoA.behavior.failure = failure
      let changes = 0
      service.onDidChange(() => changes++)

      await assert.rejects(
        service.refreshRepositories(true),
        (error) => error === failure,
      )
      await settleEvents()

      assert.deepStrictEqual(repoB.calls, [{ method: "status", args: [] }])
      assert.ok(changes > 0, "A failed refresh must still invalidate views")
    })

    test("does not retain subscriptions or watchers after disposal", async () => {
      const repo = createRepository(REPO_A)
      const harness = createHarness({ repositories: [repo] })
      await settleEvents()
      let changes = 0
      harness.service.onDidChange(() => changes++)
      harness.service.dispose()
      repo.changed.fire()
      harness.open(createRepository(REPO_B))
      await settleEvents()
      assert.strictEqual(changes, 0)
      assert.ok(harness.watchers.every((watcher) => watcher.disposed))
    })
  })

  suite("API enablement and routing", () => {
    test("acquires a reenabled API after its enablement event returns", async () => {
      const harness = createHarness({ enabled: false })
      harness.setEnabled(true, true)
      await settleEvents()
      assert.strictEqual(await harness.service.getActiveRepoPath(), REPO_A)
      harness.setEnabled(false)
      assert.deepStrictEqual(await harness.service.getRepositories(), [])
      await assert.rejects(harness.service.getTags(REPO_A))
      assert.deepStrictEqual(harness.cliCalls, [])
    })

    test("does not run CLI supplements when Git is disabled", async () => {
      const harness = createHarness({ enabled: false })
      assert.deepStrictEqual(await harness.service.getRepositories(), [])
      await assert.rejects(harness.service.getTags(REPO_A))
      await assert.rejects(harness.service.checkout(REPO_A, "topic"))
      assert.deepStrictEqual(harness.cliCalls, [])
      harness.setEnabled(true)
      await settleEvents()
      assert.strictEqual(await harness.service.getActiveRepoPath(), REPO_A)
      harness.setEnabled(false)
      await settleEvents()
      assert.deepStrictEqual(await harness.service.getRepositories(), [])
    })

    test("maps ordinary HEAD history through the API", async () => {
      const repo = createRepository(REPO_A)
      const harness = createHarness({ repositories: [repo] })
      const commits = await harness.service.getCommits(REPO_A, { maxCount: 12 })

      assert.deepStrictEqual(repo.calls, [
        { method: "log", args: [{ maxEntries: 12 }] },
      ])
      assert.strictEqual(commits[0]?.sha, SHA_A)
      assert.strictEqual(commits[0]?.summary, "fix: API history")
      assert.strictEqual(commits[0]?.author.name, "Test Author")
      assert.deepStrictEqual(commits[0]?.parents, [SHA_B])
      assert.deepStrictEqual(harness.cliCalls, [])
    })

    test("defaults HEAD history to 50 entries and forwards an optional path", async () => {
      const repo = createRepository(REPO_A)
      const harness = createHarness({ repositories: [repo] })
      await harness.service.getCommits(REPO_A)
      await harness.service.getCommits(REPO_A, { path: "src/index.ts" })

      assert.deepStrictEqual(repo.calls, [
        { method: "log", args: [{ maxEntries: 50 }] },
        {
          method: "log",
          args: [{ maxEntries: 50, path: "src/index.ts" }],
        },
      ])
      assert.deepStrictEqual(harness.cliCalls, [])
    })

    for (const method of [
      "checkout",
      "applyStash",
      "popStash",
      "dropStash",
    ] as const) {
      test(`uses API ${method} and never retries failures through CLI`, async () => {
        const repo = createRepository(REPO_A)
        const harness = createHarness({ repositories: [repo] })
        const argument = method === "checkout" ? "topic" : 2
        const run = () =>
          method === "checkout"
            ? harness.service.checkout(REPO_A, "topic")
            : harness.service[method](REPO_A, 2)
        await run()
        assert.deepStrictEqual(
          repo.calls.filter((call) => call.method === method),
          [{ method, args: [argument] }],
        )
        const failure = new Error("API operation failed")
        repo.behavior.failure = failure
        await assert.rejects(run(), (error) => error === failure)
        assert.deepStrictEqual(harness.cliCalls, [])
      })
    }

    test("does not retry failed API history through CLI", async () => {
      const repo = createRepository(REPO_A)
      const failure = new Error("API history failed")
      repo.behavior.failure = failure
      const harness = createHarness({ repositories: [repo] })
      await assert.rejects(
        harness.service.getCommits(REPO_A),
        (error) => error === failure,
      )
      assert.deepStrictEqual(harness.cliCalls, [])
    })

    test("resolves SHA prefixes through getCommit without broadening invalid queries", async () => {
      const repo = createRepository(REPO_A)
      repo.behavior.commits = [makeApiCommit(SEARCH_SHA)]
      const harness = createHarness({ repositories: [repo] })
      assert.deepStrictEqual(
        await harness.service.searchCommits(REPO_A, "fix login", {
          mode: "sha",
        }),
        [],
      )
      assert.strictEqual(repo.calls.length, 0)
      const commits = await harness.service.searchCommits(REPO_A, " DEADBEE ", {
        mode: "sha",
      })
      assert.strictEqual(commits[0]?.sha, SEARCH_SHA)
      assert.deepStrictEqual(repo.calls, [
        { method: "getCommit", args: ["deadbee^{commit}"] },
      ])
      assert.deepStrictEqual(harness.cliCalls, [])
    })

    test("returns no result for unresolved API SHA queries without CLI retry", async () => {
      const repo = createRepository(REPO_A)
      repo.behavior.failure = new Error("ambiguous revision")
      const harness = createHarness({ repositories: [repo] })
      assert.deepStrictEqual(
        await harness.service.searchCommits(REPO_A, "deadbee", { mode: "sha" }),
        [],
      )
      assert.deepStrictEqual(repo.calls, [
        { method: "getCommit", args: ["deadbee^{commit}"] },
      ])
      assert.deepStrictEqual(harness.cliCalls, [])
    })

    test("uses API remotes while preserving command and autolink preferences", async () => {
      const repo = createRepository(REPO_A)
      repo.state.remotes = [
        {
          name: "origin",
          fetchUrl: "ssh://git@codeberg.org/fork-owner/repo-name.git",
          pushUrl: "ssh://git@codeberg.org/fork-owner/repo-name.git",
          isReadOnly: false,
        },
        {
          name: "upstream",
          fetchUrl: "ssh://git@codeberg.org/upstream-owner/repo-name.git",
          isReadOnly: true,
        },
      ]
      const harness = createHarness({ repositories: [repo] })
      const preferred = await harness.service.getPreferredRemote(REPO_A)
      const autolink = await harness.service.getPreferredAutolinkRemote(REPO_A)
      assert.strictEqual(preferred?.provider?.owner, "fork-owner")
      assert.strictEqual(autolink?.provider?.owner, "upstream-owner")
      repo.state.remotes[1] = {
        name: "upstream",
        fetchUrl: "ssh://git@example.com/owner/repo.git",
        isReadOnly: true,
      }
      assert.strictEqual(
        (await harness.service.getPreferredAutolinkRemote(REPO_A))?.name,
        "origin",
      )
      assert.deepStrictEqual(harness.cliCalls, [])
    })
  })

  suite("CLI supplements", () => {
    test("preserves raw revision content and ref object resolution", async () => {
      const rawContent = "revision contents\r\n"
      const harness = createHarness({
        async gitExec(args) {
          return args[0] === "show" ? rawContent : `${SHA_B}\n`
        },
      })

      assert.strictEqual(
        await harness.service.getFileContent(REPO_A, SHA_A, "src/index.ts"),
        rawContent,
      )
      assert.strictEqual(
        await harness.service.getShaForRef(REPO_A, "tags/v1"),
        SHA_B,
      )
      assert.deepStrictEqual(
        harness.cliCalls.map((call) => call.args),
        [
          ["show", `${SHA_A}:src/index.ts`],
          ["rev-parse", "tags/v1"],
        ],
      )
      assert.deepStrictEqual(harness.repositories[0]?.calls, [])
    })

    test("preserves history and comparison arguments and configured Git path", async () => {
      const { service, cliCalls } = createHarness({ gitExec: async () => "" })
      await service.getFileHistory(REPO_A, "src/file.ts", { maxCount: 10 })
      await service.getLineHistory(REPO_A, "src/file.ts", 2, 5, { maxCount: 8 })
      await service.diff(REPO_A, "topic", "main")
      await service.getCommits(REPO_A, { ref: "topic", maxCount: 6 })
      await service.getTagCommits(REPO_A, "v1", { maxCount: 4 })

      assert.deepStrictEqual(
        cliCalls.map((call) => call.args),
        [
          [
            "log",
            `--format=${getLogFormat()}`,
            "--max-count=10",
            "--follow",
            "--",
            "src/file.ts",
          ],
          [
            "log",
            `--format=${getLogFormat()}`,
            "--max-count=8",
            "-L2,5:src/file.ts",
          ],
          ["diff", "--name-status", "topic", "main"],
          ["log", `--format=${getLogFormat()}`, "--max-count=6", "topic"],
          ["log", `--format=${getLogFormat()}`, "--max-count=4", "v1"],
        ],
      )
      assert.ok(cliCalls.every((call) => call.options.cwd === REPO_A))
      assert.ok(cliCalls.every((call) => call.options.gitPath === GIT_PATH))
    })

    test("preserves search modes and all-ref matching", async () => {
      const { service, cliCalls } = createHarness({ gitExec: async () => "" })
      for (const mode of ["message", "author", "file", "changes"] as const) {
        await service.searchCommits(REPO_A, "query", { mode, maxCount: 7 })
      }
      const prefix = [
        "log",
        `--format=${getLogFormat()}`,
        "--max-count=7",
        "--all",
      ]
      assert.deepStrictEqual(
        cliCalls.map((call) => call.args),
        [
          [...prefix, "--grep=query", "-i"],
          [...prefix, "--author=query", "-i"],
          [...prefix, "--", "query"],
          [...prefix, "-Squery"],
        ],
      )
    })

    test("preserves tracked and untracked stash file semantics", async () => {
      const harness = createHarness({
        async gitExec(args) {
          return args.includes("--only-untracked")
            ? "A\tsrc/new.ts"
            : "M\tsrc/tracked.ts"
        },
      })
      const files = await harness.service.getStashFiles(REPO_A, STASH_SHA)
      assert.deepStrictEqual(files, [
        { path: "src/tracked.ts", originalPath: undefined, status: "modified" },
        { path: "src/new.ts", originalPath: undefined, status: "untracked" },
      ])
      assert.deepStrictEqual(
        harness.cliCalls.map((call) => call.args),
        [
          ["stash", "show", "--name-status", STASH_SHA],
          ["stash", "show", "--only-untracked", "--name-status", STASH_SHA],
        ],
      )
    })

    test("retains tracked stash files when untracked lookup fails", async () => {
      const harness = createHarness({
        async gitExec(args) {
          if (args.includes("--only-untracked")) throw new Error("unsupported")
          return "M\tsrc/tracked.ts"
        },
      })
      assert.deepStrictEqual(
        await harness.service.getStashFiles(REPO_A, STASH_SHA),
        [
          {
            path: "src/tracked.ts",
            originalPath: undefined,
            status: "modified",
          },
        ],
      )
    })

    test("keeps stash branch as one CLI operation and refreshes API state", async () => {
      const repo = createRepository(REPO_A)
      const harness = createHarness({
        repositories: [repo],
        gitExec: async () => "",
      })
      await harness.service.createBranchFromStash(REPO_A, 2, "topic")
      assert.deepStrictEqual(
        harness.cliCalls.map((call) => call.args),
        [["stash", "branch", "topic", "stash@{2}"]],
      )
      assert.deepStrictEqual(repo.calls, [{ method: "status", args: [] }])
    })

    test("preserves a stash branch failure when the following status also fails", async () => {
      const repo = createRepository(REPO_A)
      const operationFailure = new Error("Stash application conflict")
      repo.behavior.failure = new Error("Status refresh failed")
      const harness = createHarness({
        repositories: [repo],
        async gitExec() {
          throw operationFailure
        },
      })

      await assert.rejects(
        harness.service.createBranchFromStash(REPO_A, 2, "topic"),
        (error) => error === operationFailure,
      )
      assert.deepStrictEqual(repo.calls, [{ method: "status", args: [] }])
      assert.strictEqual(harness.cliCalls.length, 1)
    })

    test("does not run supplements for paths outside known repository roots", async () => {
      const harness = createHarness({ gitExec: async () => "" })
      await assert.rejects(harness.service.getTags("/workspace/unknown"))
      await assert.rejects(harness.service.getTags(`${REPO_A}/src`))
      assert.deepStrictEqual(harness.cliCalls, [])
    })

    test("allows API-listed worktree reads but requires opening it for mutations", async () => {
      const repo = createRepository(REPO_A)
      repo.state.worktrees = [
        {
          name: "linked-worktree",
          path: LINKED_WORKTREE,
          ref: "refs/heads/topic",
          main: false,
          detached: false,
        },
      ]
      const harness = createHarness({
        repositories: [repo],
        gitExec: async () => makeLogOutput(SHA_B),
      })
      const commits = await harness.service.getCommits(LINKED_WORKTREE)
      assert.strictEqual(commits[0]?.sha, SHA_B)
      await assert.rejects(harness.service.checkout(LINKED_WORKTREE, "topic"))
      assert.strictEqual(harness.cliCalls.length, 1)
      harness.close(repo)
      await settleEvents()
      await assert.rejects(harness.service.getCommits(LINKED_WORKTREE))
      assert.strictEqual(harness.cliCalls.length, 1)
    })

    test("allows browsing a listed linked worktree without opening it in SCM", async () => {
      const harness = createHarness({
        async gitExec(args) {
          if (args[0] === "worktree") {
            return `worktree ${REPO_A}\nHEAD ${SHA_A}\nbranch refs/heads/main\n\nworktree ${LINKED_WORKTREE}\nHEAD ${SHA_B}\nbranch refs/heads/topic\n`
          }
          if (args[0] === "log") return makeLogOutput(SHA_B)
          throw new Error(`Unexpected supplement ${args[0]}`)
        },
      })
      await harness.service.getWorktrees(REPO_A)
      const commits = await harness.service.getCommits(LINKED_WORKTREE)
      assert.strictEqual(commits[0]?.sha, SHA_B)
      assert.strictEqual(harness.cliCalls.at(-1)?.options.cwd, LINKED_WORKTREE)
      assert.strictEqual(harness.apiState.repositories.length, 1)
    })
  })
})
