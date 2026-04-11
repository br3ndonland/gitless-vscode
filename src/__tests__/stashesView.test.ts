import * as assert from "node:assert"
import { suite, test } from "mocha"
import { StashesView } from "../views/stashesView"
import { FileNode, StashNode } from "../views/nodes"
import type { GitService } from "../git/gitService"
import type { GitFile, GitStash } from "../git/models"

const REPO_PATH = "/test/repo"
const TEST_DATE = new Date("2024-01-15T10:30:00Z")
const STASH_SHA = "cccccccccccccccccccccccccccccccccccccccc"

function makeStash(overrides?: Partial<GitStash>): GitStash {
  return {
    index: 0,
    sha: STASH_SHA,
    message: "WIP: stash changes",
    date: TEST_DATE,
    author: { name: "John Doe", email: "john@example.com", date: TEST_DATE },
    ...overrides,
  }
}

function makeGitServiceStub(files: GitFile[]): {
  gitService: GitService
  getStashFilesCalls: Array<{ repoPath: string; stashSha: string }>
} {
  const getStashFilesCalls: Array<{ repoPath: string; stashSha: string }> = []

  return {
    gitService: {
      getActiveRepoPath: async () => REPO_PATH,
      getStashes: async () => [makeStash()],
      getStashFiles: async (repoPath: string, stashSha: string) => {
        getStashFilesCalls.push({ repoPath, stashSha })
        return files
      },
      onDidChange: (_listener: () => void) => ({ dispose: () => {} }),
    } as unknown as GitService,
    getStashFilesCalls,
  }
}

suite("StashesView", () => {
  test("should load stash files with the stash SHA", async () => {
    const stash = makeStash()
    const { gitService, getStashFilesCalls } = makeGitServiceStub([
      { path: "src/tracked.ts", status: "modified" },
    ])
    const view = new StashesView(gitService)

    const children = await view.getChildren(new StashNode(stash, REPO_PATH))

    assert.deepStrictEqual(getStashFilesCalls, [
      { repoPath: REPO_PATH, stashSha: STASH_SHA },
    ])
    assert.strictEqual(children.length, 1)
    assert.ok(children[0] instanceof FileNode)
  })

  test("should use stash refs for tracked and untracked file nodes", async () => {
    const stash = makeStash()
    const { gitService } = makeGitServiceStub([
      { path: "src/tracked.ts", status: "modified" },
      { path: "src/untracked.ts", status: "untracked" },
    ])
    const view = new StashesView(gitService)

    const children = await view.getChildren(new StashNode(stash, REPO_PATH))
    const trackedNode = children[0] as FileNode
    const untrackedNode = children[1] as FileNode

    assert.ok(trackedNode instanceof FileNode)
    assert.strictEqual(trackedNode.sha, STASH_SHA)
    assert.strictEqual(trackedNode.previousSha, undefined)
    assert.strictEqual(trackedNode.remoteSha, `${STASH_SHA}^1`)
    assert.ok(untrackedNode instanceof FileNode)
    assert.strictEqual(untrackedNode.sha, `${STASH_SHA}^3`)
    assert.strictEqual(untrackedNode.previousSha, `${STASH_SHA}^1`)
    assert.strictEqual(untrackedNode.remoteSha, `${STASH_SHA}^1`)
  })
})
