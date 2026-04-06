import * as assert from "node:assert"
import { suite, test, teardown } from "mocha"
import { TreeItemCollapsibleState, MarkdownString } from "vscode"
import {
  SearchAndCompareView,
  CompareResultNode,
  SearchResultNode,
} from "../views/searchAndCompareView"
import { CommitNode, FileNode, MessageNode } from "../views/nodes"
import { ContextValues } from "../constants"
import type { GitService } from "../git/gitService"
import type { GitCommit, GitFile } from "../git/models"

const REPO_PATH = "/test/repo"
const SHA_A = "aaaa1234567890abcdef1234567890abcdef123456"
const SHA_B = "bbbb1234567890abcdef1234567890abcdef123456"
const SHA_C = "cccc1234567890abcdef1234567890abcdef123456"
const TEST_DATE = new Date("2024-01-15T10:30:00Z")

function makeCommit(sha: string, summary: string): GitCommit {
  return {
    sha,
    shortSha: sha.slice(0, 7),
    message: summary,
    summary,
    author: { name: "Test", email: "test@test.com", date: TEST_DATE },
    committer: { name: "Test", email: "test@test.com", date: TEST_DATE },
    date: TEST_DATE,
    parents: [],
  }
}

/** Minimal stub of GitService for SearchAndCompareView tests. */
function makeGitServiceStub(overrides?: {
  repoPath?: string | undefined
  searchResults?: GitCommit[]
  diffResults?: GitFile[]
  commitFiles?: GitFile[]
}): GitService {
  const repoPath =
    overrides && "repoPath" in overrides ? overrides.repoPath : REPO_PATH
  const searchResults = overrides?.searchResults ?? []
  const diffResults = overrides?.diffResults ?? []
  const commitFiles = overrides?.commitFiles ?? []
  return {
    getRepoPath: async () => repoPath,
    searchCommits: async () => searchResults,
    diff: async () => diffResults,
    getCommitFiles: async () => commitFiles,
    getShaForRef: async (_rp: string, ref: string) => ref,
    getBranches: async () => [],
    getTags: async () => [],
    onDidChange: { dispose: () => {} } as any,
  } as unknown as GitService
}

/** Create a SearchAndCompareView that skips command/treeView registration
 *  so it can be instantiated alongside the extension's own instance. */
function makeTestView(stub?: GitService): SearchAndCompareView {
  return new SearchAndCompareView(stub ?? makeGitServiceStub(), {
    skipRegistration: true,
  })
}

suite("SearchAndCompareView", () => {
  // ── CompareResultNode (no view instance needed) ──

  suite("CompareResultNode", () => {
    test("should set label with ref labels using ASCII separator", () => {
      const node = new CompareResultNode(SHA_A, SHA_B, "main", "dev", REPO_PATH)
      assert.strictEqual(node.label, "main <-> dev")
    })

    test("should default to Collapsed state", () => {
      const node = new CompareResultNode(SHA_A, SHA_B, "main", "dev", REPO_PATH)
      assert.strictEqual(
        node.collapsibleState,
        TreeItemCollapsibleState.Collapsed,
      )
    })

    test("should accept Expanded state", () => {
      const node = new CompareResultNode(
        SHA_A,
        SHA_B,
        "main",
        "dev",
        REPO_PATH,
        TreeItemCollapsibleState.Expanded,
      )
      assert.strictEqual(
        node.collapsibleState,
        TreeItemCollapsibleState.Expanded,
      )
    })

    test("should set contextValue to CompareResult", () => {
      const node = new CompareResultNode(SHA_A, SHA_B, "main", "dev", REPO_PATH)
      assert.strictEqual(node.contextValue, ContextValues.CompareResult)
    })

    test("should include refs in id", () => {
      const node = new CompareResultNode(SHA_A, SHA_B, "main", "dev", REPO_PATH)
      assert.ok(node.id!.includes(SHA_A))
      assert.ok(node.id!.includes(SHA_B))
    })

    test("should append idSuffix to id", () => {
      const node = new CompareResultNode(
        SHA_A,
        SHA_B,
        "main",
        "dev",
        REPO_PATH,
        TreeItemCollapsibleState.Collapsed,
        ":g1",
      )
      assert.ok(node.id!.endsWith(":g1"))
    })

    test("should set description to comparison", () => {
      const node = new CompareResultNode(SHA_A, SHA_B, "main", "dev", REPO_PATH)
      assert.strictEqual(node.description, "comparison")
    })

    test("should have a MarkdownString tooltip with ref labels", () => {
      const node = new CompareResultNode(SHA_A, SHA_B, "main", "dev", REPO_PATH)
      assert.ok(node.tooltip instanceof MarkdownString)
      const value = (node.tooltip as MarkdownString).value
      assert.ok(value.includes("main"), "tooltip should contain ref1Label")
      assert.ok(value.includes("dev"), "tooltip should contain ref2Label")
    })
  })

  // ── SearchResultNode (no view instance needed) ──

  suite("SearchResultNode", () => {
    test("should set label with quoted query", () => {
      const node = new SearchResultNode("fix login", REPO_PATH)
      assert.strictEqual(node.label, '"fix login"')
    })

    test("should default to Collapsed state", () => {
      const node = new SearchResultNode("fix login", REPO_PATH)
      assert.strictEqual(
        node.collapsibleState,
        TreeItemCollapsibleState.Collapsed,
      )
    })

    test("should accept Expanded state", () => {
      const node = new SearchResultNode(
        "fix login",
        REPO_PATH,
        "message",
        TreeItemCollapsibleState.Expanded,
      )
      assert.strictEqual(
        node.collapsibleState,
        TreeItemCollapsibleState.Expanded,
      )
    })

    test("should default mode to message", () => {
      const node = new SearchResultNode("fix login", REPO_PATH)
      assert.strictEqual(node.mode, "message")
    })

    test("should accept author mode", () => {
      const node = new SearchResultNode("john", REPO_PATH, "author")
      assert.strictEqual(node.mode, "author")
      assert.strictEqual(node.description, "by Author")
    })

    test("should accept file mode", () => {
      const node = new SearchResultNode("src/index.ts", REPO_PATH, "file")
      assert.strictEqual(node.mode, "file")
      assert.strictEqual(node.description, "by File")
    })

    test("should accept changes mode", () => {
      const node = new SearchResultNode("TODO", REPO_PATH, "changes")
      assert.strictEqual(node.mode, "changes")
      assert.strictEqual(node.description, "by Changes")
    })

    test("should set contextValue to SearchResult", () => {
      const node = new SearchResultNode("fix login", REPO_PATH)
      assert.strictEqual(node.contextValue, ContextValues.SearchResult)
    })

    test("should include mode and query in id", () => {
      const node = new SearchResultNode("fix login", REPO_PATH, "author")
      assert.ok(node.id!.includes("author"))
      assert.ok(node.id!.includes("fix login"))
    })

    test("should append idSuffix to id", () => {
      const node = new SearchResultNode(
        "fix",
        REPO_PATH,
        "message",
        TreeItemCollapsibleState.Collapsed,
        ":g2",
      )
      assert.ok(node.id!.endsWith(":g2"))
    })

    test("should have a MarkdownString tooltip with query and mode", () => {
      const node = new SearchResultNode("fix login", REPO_PATH, "author")
      assert.ok(node.tooltip instanceof MarkdownString)
      const value = (node.tooltip as MarkdownString).value
      assert.ok(value.includes("fix login"), "tooltip should contain query")
      assert.ok(value.includes("Author"), "tooltip should contain mode label")
    })
  })

  // ── getChildren ──

  suite("getChildren", () => {
    let view: SearchAndCompareView

    teardown(() => {
      view?.dispose()
    })

    test("should return empty array when no items (welcome content)", async () => {
      view = makeTestView()
      const children = await view.getChildren()
      assert.strictEqual(children.length, 0)
    })

    test("should return MessageNode when no repo found", async () => {
      view = makeTestView(makeGitServiceStub({ repoPath: undefined }))
      const children = await view.getChildren()
      assert.strictEqual(children.length, 1)
      assert.ok(children[0] instanceof MessageNode)
      assert.strictEqual(
        (children[0] as MessageNode).label,
        "No repository found",
      )
    })

    test("should return search result items at root", async () => {
      view = makeTestView()
      view._test.addSearchResult("test query", REPO_PATH)
      const children = await view.getChildren()
      assert.strictEqual(children.length, 1)
      assert.ok(children[0] instanceof SearchResultNode)
    })

    test("should return compare result items at root", async () => {
      view = makeTestView()
      view._test.addCompareResult(SHA_A, SHA_B, "main", "dev", REPO_PATH)
      const children = await view.getChildren()
      assert.strictEqual(children.length, 1)
      assert.ok(children[0] instanceof CompareResultNode)
    })

    test("should return CommitNode children for SearchResultNode", async () => {
      const commits = [
        makeCommit(SHA_A, "fix: login bug"),
        makeCommit(SHA_B, "feat: add feature"),
      ]
      view = makeTestView(makeGitServiceStub({ searchResults: commits }))
      view._test.addSearchResult("fix", REPO_PATH)
      const root = await view.getChildren()
      const searchNode = root[0] as SearchResultNode
      const children = await view.getChildren(searchNode)
      assert.strictEqual(children.length, 2)
      assert.ok(children[0] instanceof CommitNode)
      assert.ok(children[1] instanceof CommitNode)
    })

    test("should return MessageNode for empty search results", async () => {
      view = makeTestView(makeGitServiceStub({ searchResults: [] }))
      view._test.addSearchResult("nonexistent", REPO_PATH)
      const root = await view.getChildren()
      const children = await view.getChildren(root[0])
      assert.strictEqual(children.length, 1)
      assert.ok(children[0] instanceof MessageNode)
      assert.strictEqual((children[0] as MessageNode).label, "No results")
    })

    test("should return MessageNode for empty diff results", async () => {
      view = makeTestView(makeGitServiceStub({ diffResults: [] }))
      view._test.addCompareResult(SHA_A, SHA_B, "main", "dev", REPO_PATH)
      const root = await view.getChildren()
      const children = await view.getChildren(root[0])
      assert.strictEqual(children.length, 1)
      assert.ok(children[0] instanceof MessageNode)
      assert.strictEqual((children[0] as MessageNode).label, "No differences")
    })

    test("should pass search mode to gitService.searchCommits", async () => {
      let capturedMode: string | undefined
      const stub = makeGitServiceStub()
      stub.searchCommits = async (
        _rp: string,
        _q: string,
        opts?: { mode?: string },
      ) => {
        capturedMode = opts?.mode
        return []
      }
      view = makeTestView(stub)
      view._test.addSearchResult("john", REPO_PATH, "author")
      const root = await view.getChildren()
      await view.getChildren(root[0])
      assert.strictEqual(capturedMode, "author")
    })

    test("compare FileNodes should carry previousSha (ref1) for diffs", async () => {
      const diffFiles: GitFile[] = [
        { path: "src/app.ts", status: "modified" },
        { path: "README.md", status: "added" },
      ]
      view = makeTestView(makeGitServiceStub({ diffResults: diffFiles }))
      view._test.addCompareResult(SHA_A, SHA_B, "main", "dev", REPO_PATH)
      const root = await view.getChildren()
      const compareNode = root[0] as CompareResultNode
      const children = await view.getChildren(compareNode)
      assert.strictEqual(children.length, 2)
      const fileNode = children[0] as FileNode
      assert.ok(fileNode instanceof FileNode)
      assert.strictEqual(
        fileNode.previousSha,
        SHA_A,
        "previousSha should be ref1 from the compare",
      )
      assert.strictEqual(
        fileNode.sha,
        SHA_B,
        "sha should be ref2 from the compare",
      )
    })

    test("compare FileNode click args should include previousSha", async () => {
      const diffFiles: GitFile[] = [{ path: "src/app.ts", status: "modified" }]
      view = makeTestView(makeGitServiceStub({ diffResults: diffFiles }))
      view._test.addCompareResult(SHA_A, SHA_B, "main", "dev", REPO_PATH)
      const root = await view.getChildren()
      const children = await view.getChildren(root[0])
      const fileNode = children[0] as FileNode
      const cmdArgs = fileNode.command?.arguments?.[0] as Record<
        string,
        unknown
      >
      assert.strictEqual(
        cmdArgs.previousSha,
        SHA_A,
        "click command should pass previousSha for correct diff",
      )
      assert.strictEqual(cmdArgs.sha, SHA_B)
      assert.strictEqual(cmdArgs.filePath, "src/app.ts")
    })

    test("search result commit FileNodes should not have previousSha", async () => {
      const commits = [makeCommit(SHA_A, "fix: bug")]
      const commitFiles: GitFile[] = [
        { path: "src/index.ts", status: "modified" },
      ]
      view = makeTestView(
        makeGitServiceStub({ searchResults: commits, commitFiles }),
      )
      view._test.addSearchResult("fix", REPO_PATH)
      const root = await view.getChildren()
      const searchNode = root[0] as SearchResultNode
      const commitNodes = await view.getChildren(searchNode)
      const commitNode = commitNodes[0] as CommitNode
      const fileNodes = await view.getChildren(commitNode)
      const fileNode = fileNodes[0] as FileNode
      assert.ok(fileNode instanceof FileNode)
      assert.strictEqual(
        fileNode.previousSha,
        undefined,
        "search result files should not have previousSha",
      )
    })
  })

  // ── Collapse behavior ──

  suite("collapse behavior", () => {
    let view: SearchAndCompareView

    teardown(() => {
      view?.dispose()
    })

    test("newest item should be Expanded", async () => {
      view = makeTestView()
      view._test.addSearchResult("first", REPO_PATH)
      const items = await view.getChildren()
      assert.strictEqual(items.length, 1)
      assert.strictEqual(
        items[0].collapsibleState,
        TreeItemCollapsibleState.Expanded,
        "the only item should be Expanded",
      )
    })

    test("adding a second item should collapse the first", async () => {
      view = makeTestView()
      view._test.addSearchResult("first", REPO_PATH)
      view._test.addSearchResult("second", REPO_PATH)
      const items = await view.getChildren()
      assert.strictEqual(items.length, 2)
      assert.strictEqual(
        items[0].collapsibleState,
        TreeItemCollapsibleState.Expanded,
        "newest (second) should be Expanded",
      )
      assert.strictEqual(
        items[1].collapsibleState,
        TreeItemCollapsibleState.Collapsed,
        "older (first) should be Collapsed",
      )
    })

    test("adding a third item should collapse the first two", async () => {
      view = makeTestView()
      view._test.addSearchResult("first", REPO_PATH)
      view._test.addSearchResult("second", REPO_PATH)
      view._test.addSearchResult("third", REPO_PATH)
      const items = await view.getChildren()
      assert.strictEqual(items.length, 3)
      assert.strictEqual(
        items[0].collapsibleState,
        TreeItemCollapsibleState.Expanded,
        "newest (third) should be Expanded",
      )
      assert.strictEqual(
        items[1].collapsibleState,
        TreeItemCollapsibleState.Collapsed,
        "middle (second) should be Collapsed",
      )
      assert.strictEqual(
        items[2].collapsibleState,
        TreeItemCollapsibleState.Collapsed,
        "oldest (first) should be Collapsed",
      )
    })

    test("collapsed items should receive new IDs to invalidate VS Code cache", async () => {
      view = makeTestView()
      view._test.addSearchResult("first", REPO_PATH)
      const gen0Items = await view.getChildren()
      const gen0Id = gen0Items[0].id

      view._test.addSearchResult("second", REPO_PATH)
      const gen1Items = await view.getChildren()
      const collapsedId = gen1Items[1].id // "first" was recreated

      assert.notStrictEqual(
        gen0Id,
        collapsedId,
        "collapsed item should have a different id after generation bump",
      )
    })

    test("idGeneration should increment on each add", () => {
      view = makeTestView()
      assert.strictEqual(view._test.idGeneration, 0)
      view._test.addSearchResult("first", REPO_PATH)
      assert.strictEqual(view._test.idGeneration, 1)
      view._test.addSearchResult("second", REPO_PATH)
      assert.strictEqual(view._test.idGeneration, 2)
    })

    test("compare result should also collapse existing items", async () => {
      view = makeTestView()
      view._test.addSearchResult("first", REPO_PATH)
      view._test.addCompareResult(SHA_A, SHA_B, "main", "dev", REPO_PATH)
      const items = await view.getChildren()
      assert.strictEqual(items.length, 2)
      assert.ok(
        items[0] instanceof CompareResultNode,
        "newest should be CompareResultNode",
      )
      assert.strictEqual(
        items[0].collapsibleState,
        TreeItemCollapsibleState.Expanded,
      )
      assert.strictEqual(
        items[1].collapsibleState,
        TreeItemCollapsibleState.Collapsed,
      )
    })

    test("mixed search and compare items should all collapse except newest", async () => {
      view = makeTestView()
      view._test.addCompareResult(SHA_A, SHA_B, "main", "dev", REPO_PATH)
      view._test.addSearchResult("query", REPO_PATH)
      view._test.addCompareResult(SHA_B, SHA_C, "dev", "staging", REPO_PATH)
      const items = await view.getChildren()
      assert.strictEqual(items.length, 3)
      assert.strictEqual(
        items[0].collapsibleState,
        TreeItemCollapsibleState.Expanded,
        "newest compare should be Expanded",
      )
      assert.strictEqual(
        items[1].collapsibleState,
        TreeItemCollapsibleState.Collapsed,
        "search should be Collapsed",
      )
      assert.strictEqual(
        items[2].collapsibleState,
        TreeItemCollapsibleState.Collapsed,
        "oldest compare should be Collapsed",
      )
    })
  })

  // ── Dismiss and clear ──

  suite("dismiss and clear", () => {
    let view: SearchAndCompareView

    teardown(() => {
      view?.dispose()
    })

    test("dismissNode should remove a specific item", async () => {
      view = makeTestView()
      view._test.addSearchResult("first", REPO_PATH)
      view._test.addSearchResult("second", REPO_PATH)
      const items = await view.getChildren()
      assert.strictEqual(items.length, 2)

      view._test.dismissNode(items[1] as SearchResultNode)
      const after = await view.getChildren()
      assert.strictEqual(after.length, 1)
      assert.ok((after[0] as SearchResultNode).query === "second")
    })

    test("dismissNode with unknown node should be a no-op", async () => {
      view = makeTestView()
      view._test.addSearchResult("first", REPO_PATH)
      const orphan = new SearchResultNode("orphan", REPO_PATH)
      view._test.dismissNode(orphan)
      const items = await view.getChildren()
      assert.strictEqual(items.length, 1)
    })

    test("clearAll should remove all items", async () => {
      view = makeTestView()
      view._test.addSearchResult("first", REPO_PATH)
      view._test.addSearchResult("second", REPO_PATH)
      view._test.addCompareResult(SHA_A, SHA_B, "main", "dev", REPO_PATH)
      let items = await view.getChildren()
      assert.strictEqual(items.length, 3)

      view._test.clearAll()
      items = await view.getChildren()
      assert.strictEqual(items.length, 0)
    })
  })
})
