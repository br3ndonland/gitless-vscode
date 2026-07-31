import * as assert from "node:assert"
import { suite, test } from "mocha"
import { LineHistoryView } from "../views/lineHistoryView"
import { CommitNode, FileNode, MessageNode } from "../views/nodes"
import type { GitService } from "../git/gitService"
import type { GitCommit, GitFile } from "../git/models"

const REPO_PATH = "/test/repo"
const COMMIT_SHA = "aaaa1234567890abcdef1234567890abcdef123456"
const TEST_DATE = new Date("2024-01-15T10:30:00Z")

function makeCommit(): GitCommit {
  return {
    sha: COMMIT_SHA,
    shortSha: COMMIT_SHA.slice(0, 7),
    message: "fix: update selected line",
    summary: "fix: update selected line",
    author: { name: "Test", email: "test@test.com", date: TEST_DATE },
    committer: { name: "Test", email: "test@test.com", date: TEST_DATE },
    date: TEST_DATE,
    parents: [],
  }
}

function makeTestView(gitService: GitService): LineHistoryView {
  const view = Object.create(LineHistoryView.prototype) as LineHistoryView
  Object.assign(view as unknown as Record<string, unknown>, {
    gitService,
    activeRepoPath: REPO_PATH,
    activeFilePath: "src/example.ts",
    activeSelection: { start: 10, end: 10 },
    treeView: { description: undefined },
  })
  return view
}

suite("LineHistoryView", () => {
  test("should load changed files when a commit expands", async () => {
    const files: GitFile[] = [
      { path: "src/example.ts", status: "modified" },
      { path: "src/related.ts", status: "added" },
    ]
    const calls: Array<{ repoPath: string; sha: string }> = []
    const view = makeTestView({
      getCommitFiles: async (repoPath: string, sha: string) => {
        calls.push({ repoPath, sha })
        return files
      },
    } as unknown as GitService)

    const children = await view.getChildren(
      new CommitNode(makeCommit(), REPO_PATH),
    )

    assert.deepStrictEqual(calls, [{ repoPath: REPO_PATH, sha: COMMIT_SHA }])
    assert.strictEqual(children.length, 2)
    assert.ok(children.every((child) => child instanceof FileNode))
    assert.strictEqual((children[0] as FileNode).filePath, "src/example.ts")
    assert.strictEqual((children[1] as FileNode).filePath, "src/related.ts")
  })

  test("should show a message when changed files fail to load", async () => {
    const view = makeTestView({
      getCommitFiles: async () => {
        throw new Error("failed")
      },
    } as unknown as GitService)

    const children = await view.getChildren(
      new CommitNode(makeCommit(), REPO_PATH),
    )

    assert.strictEqual(children.length, 1)
    assert.ok(children[0] instanceof MessageNode)
    assert.strictEqual(children[0].label, "Failed to load files")
  })
})
