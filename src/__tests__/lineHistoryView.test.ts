import * as assert from "node:assert"
import * as vscode from "vscode"
import { suite, test } from "mocha"
import { LineHistoryView } from "../views/lineHistoryView"
import { CommitNode, FileNode, MessageNode } from "../views/nodes"
import type { GitService } from "../git/gitService"
import type { GitCommit, GitFile } from "../git/models"

const REPO_PATH = "/test/repo"
const OTHER_REPO_PATH = "/test/other"
const COMMIT_SHA = "aaaa1234567890abcdef1234567890abcdef123456"

function makeCommit(): GitCommit {
  const date = new Date("2024-01-15T10:30:00Z")
  return {
    sha: COMMIT_SHA,
    shortSha: COMMIT_SHA.slice(0, 7),
    message: "fix: update file",
    summary: "fix: update file",
    author: { name: "Test", email: "test@test.com", date },
    committer: { name: "Test", email: "test@test.com", date },
    date,
    parents: [],
  }
}

function makeEditor(
  filePath: string,
  start = 9,
  end = start,
): vscode.TextEditor {
  return {
    document: { uri: vscode.Uri.file(filePath) },
    selections: [new vscode.Selection(start, 0, end, 0)],
  } as unknown as vscode.TextEditor
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

function createHarness(
  overrides: Partial<
    Pick<
      GitService,
      | "getRepoFileContext"
      | "getLineHistory"
      | "getCommitFiles"
      | "getPreferredAutolinkRemote"
    >
  > = {},
  initiallyOpen = true,
) {
  const editorChanged = new vscode.EventEmitter<vscode.TextEditor | undefined>()
  const gitChanged = new vscode.EventEmitter<void>()
  const selectionChanged =
    new vscode.EventEmitter<vscode.TextEditorSelectionChangeEvent>()
  const treeView = {
    description: undefined as string | undefined,
    dispose: () => {},
  }
  const calls: Array<{
    repoPath: string
    filePath: string
    start: number
    end: number
  }> = []
  const lookups: string[] = []
  let activeTextEditor: vscode.TextEditor | undefined = makeEditor(
    `${REPO_PATH}/src/example.ts`,
  )
  let open = initiallyOpen
  const service = {
    onDidChange: gitChanged.event,
    getRepoFileContext: async (uri: vscode.Uri) => {
      lookups.push(uri.fsPath)
      if (!open) return undefined
      const repoPath = uri.fsPath.startsWith(`${OTHER_REPO_PATH}/`)
        ? OTHER_REPO_PATH
        : REPO_PATH
      return { repoPath, relativePath: uri.fsPath.slice(repoPath.length + 1) }
    },
    getLineHistory: async (
      repoPath: string,
      filePath: string,
      start: number,
      end: number,
    ) => {
      calls.push({ repoPath, filePath, start, end })
      return [makeCommit()]
    },
    getCommitFiles: async () => [
      { path: "src/example.ts", status: "modified" as const },
    ],
    getPreferredAutolinkRemote: async () => undefined,
    ...overrides,
  } as unknown as GitService
  const view = new LineHistoryView(service, {
    get activeTextEditor() {
      return activeTextEditor
    },
    createTreeView: <T>() => treeView as vscode.TreeView<T>,
    onDidChangeActiveTextEditor: editorChanged.event,
    onDidChangeTextEditorSelection: selectionChanged.event,
  })

  return {
    view,
    treeView,
    calls,
    lookups,
    changeEditor(editor: vscode.TextEditor | undefined) {
      activeTextEditor = editor
      editorChanged.fire(editor)
    },
    changeSelection(editor: vscode.TextEditor) {
      selectionChanged.fire({
        textEditor: editor,
        selections: editor.selections,
        kind: undefined,
      })
    },
    setOpen(value: boolean) {
      open = value
      gitChanged.fire()
    },
    dispose() {
      view.dispose()
      editorChanged.dispose()
      gitChanged.dispose()
      selectionChanged.dispose()
    },
  }
}

suite("LineHistoryView", () => {
  test("should retain a selection made before its repository opens", async () => {
    const harness = createHarness({}, false)
    try {
      harness.changeSelection(makeEditor(`${REPO_PATH}/src/example.ts`, 3, 6))
      await settle()
      harness.changeEditor(undefined)
      harness.setOpen(true)
      await settle()
      assert.ok((await harness.view.getChildren())[0] instanceof CommitNode)
      assert.deepStrictEqual(harness.calls, [
        { repoPath: REPO_PATH, filePath: "src/example.ts", start: 4, end: 7 },
      ])
    } finally {
      harness.dispose()
    }
  })

  test("should ignore delayed history after selecting different lines", async () => {
    const history = deferred<GitCommit[]>()
    const calls: number[] = []
    const harness = createHarness({
      getLineHistory: async (_repoPath, _filePath, startLine) => {
        calls.push(startLine)
        return history.promise
      },
    })
    try {
      await settle()
      const pending = harness.view.getChildren()
      harness.changeSelection(makeEditor(`${REPO_PATH}/src/example.ts`, 19, 21))
      await settle()
      history.resolve([makeCommit()])
      assert.deepStrictEqual(await pending, [])
      assert.ok((await harness.view.getChildren())[0] instanceof CommitNode)
      assert.deepStrictEqual(calls, [10, 20])
      assert.strictEqual(harness.treeView.description, "src/example.ts L20-22")
    } finally {
      harness.dispose()
    }
  })

  test("should discover an already-open selection after Git initializes", async () => {
    const harness = createHarness({}, false)
    try {
      await settle()
      const initial = await harness.view.getChildren()
      assert.strictEqual(initial[0].label, "No repository found")

      harness.setOpen(true)
      await settle()
      const children = await harness.view.getChildren()
      assert.ok(children[0] instanceof CommitNode)
      assert.deepStrictEqual(harness.calls, [
        { repoPath: REPO_PATH, filePath: "src/example.ts", start: 10, end: 10 },
      ])
    } finally {
      harness.dispose()
    }
  })

  test("should clear closed repositories and restore history with Inspect focused", async () => {
    const harness = createHarness()
    try {
      await settle()
      await harness.view.getChildren()
      assert.strictEqual(harness.treeView.description, "src/example.ts L10-10")
      harness.changeEditor(undefined)
      harness.setOpen(false)
      await settle()
      assert.strictEqual(harness.treeView.description, undefined)
      assert.strictEqual(
        (await harness.view.getChildren())[0].label,
        "No repository found",
      )

      harness.setOpen(true)
      await settle()
      assert.ok((await harness.view.getChildren())[0] instanceof CommitNode)
      assert.strictEqual(harness.treeView.description, "src/example.ts L10-10")
    } finally {
      harness.dispose()
    }
  })

  test("should ignore an older context lookup after switching editors", async () => {
    const first =
      deferred<Awaited<ReturnType<GitService["getRepoFileContext"]>>>()
    const harness = createHarness({
      getRepoFileContext: async (uri) =>
        uri.fsPath.startsWith(`${REPO_PATH}/`)
          ? first.promise
          : { repoPath: OTHER_REPO_PATH, relativePath: "next.ts" },
    })
    try {
      harness.changeEditor(makeEditor(`${OTHER_REPO_PATH}/next.ts`))
      await settle()
      first.resolve({ repoPath: REPO_PATH, relativePath: "src/example.ts" })
      await settle()
      const children = await harness.view.getChildren()
      assert.strictEqual((children[0] as CommitNode).repoPath, OTHER_REPO_PATH)
      assert.deepStrictEqual(harness.calls, [
        { repoPath: OTHER_REPO_PATH, filePath: "next.ts", start: 10, end: 10 },
      ])
    } finally {
      harness.dispose()
    }
  })

  test("should ignore delayed history after switching repositories", async () => {
    const history = deferred<GitCommit[]>()
    const harness = createHarness({
      getLineHistory: async () => history.promise,
    })
    try {
      await settle()
      const pending = harness.view.getChildren()
      harness.changeEditor(makeEditor(`${OTHER_REPO_PATH}/next.ts`))
      await settle()
      history.resolve([makeCommit()])
      assert.deepStrictEqual(await pending, [])
      assert.strictEqual(harness.treeView.description, undefined)
      const current = await harness.view.getChildren()
      assert.strictEqual((current[0] as CommitNode).repoPath, OTHER_REPO_PATH)
    } finally {
      harness.dispose()
    }
  })

  test("should ignore delayed remote metadata after repository closure", async () => {
    const remote = deferred<undefined>()
    const harness = createHarness({
      getPreferredAutolinkRemote: async () => remote.promise,
    })
    try {
      await settle()
      const pending = harness.view.getChildren()
      await settle()
      harness.setOpen(false)
      await settle()
      remote.resolve(undefined)
      assert.deepStrictEqual(await pending, [])
      assert.strictEqual(harness.treeView.description, undefined)
    } finally {
      harness.dispose()
    }
  })

  test("should load changed files when a commit expands", async () => {
    const harness = createHarness()
    try {
      await settle()
      const children = await harness.view.getChildren(
        new CommitNode(makeCommit(), REPO_PATH),
      )
      assert.ok(children[0] instanceof FileNode)
      assert.strictEqual((children[0] as FileNode).filePath, "src/example.ts")
    } finally {
      harness.dispose()
    }
  })

  test("should ignore delayed commit expansion after repository closure", async () => {
    const files = deferred<GitFile[]>()
    const harness = createHarness({ getCommitFiles: async () => files.promise })
    try {
      await settle()
      const pending = harness.view.getChildren(
        new CommitNode(makeCommit(), REPO_PATH),
      )
      harness.setOpen(false)
      await settle()
      files.resolve([{ path: "src/example.ts", status: "modified" }])
      assert.deepStrictEqual(await pending, [])
    } finally {
      harness.dispose()
    }
  })

  test("should show a message when changed files fail to load", async () => {
    const harness = createHarness({
      getCommitFiles: async () => {
        throw new Error("failed")
      },
    })
    try {
      await settle()
      const children = await harness.view.getChildren(
        new CommitNode(makeCommit(), REPO_PATH),
      )
      assert.ok(children[0] instanceof MessageNode)
      assert.strictEqual(children[0].label, "Failed to load files")
    } finally {
      harness.dispose()
    }
  })

  test("should stop observing editor and Git changes after disposal", async () => {
    const harness = createHarness()
    try {
      await settle()
      const lookups = harness.lookups.length
      harness.view.dispose()
      harness.changeEditor(makeEditor(`${OTHER_REPO_PATH}/next.ts`))
      harness.setOpen(false)
      await settle()
      assert.strictEqual(harness.lookups.length, lookups)
      assert.deepStrictEqual(await harness.view.getChildren(), [])
    } finally {
      harness.dispose()
    }
  })
})
