import * as assert from "node:assert"
import { suite, test } from "mocha"
import { CommitsView } from "../views/commitsView"
import { CommitNode } from "../views/nodes"
import type { GitService } from "../git/gitService"
import type { GitBranch, GitCommit } from "../git/models"

const REPO_PATH = "/test/repo"
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

function makeGitServiceStub(overrides?: {
  repoPath?: string | undefined
  commits?: GitCommit[]
  branches?: GitBranch[]
  outgoingShas?: string[]
}): GitService {
  const repoPath =
    overrides && "repoPath" in overrides ? overrides.repoPath : REPO_PATH
  const commits = overrides?.commits ?? []
  const branches = overrides?.branches ?? []
  const outgoingShas = overrides?.outgoingShas ?? []

  return {
    getRepoPath: async () => repoPath,
    getCommits: async () => commits,
    getBranches: async () => branches,
    getOutgoingCommitShasForBranch: async () => outgoingShas,
    onDidChange: (_listener: () => void) => ({ dispose: () => {} }),
  } as unknown as GitService
}

suite("CommitsView", () => {
  test("should mark outgoing commits for the current branch", async () => {
    const outgoingCommit = makeCommit(
      "aaaa1234567890abcdef1234567890abcdef123456",
      "feat: local change",
    )
    const syncedCommit = makeCommit(
      "bbbb1234567890abcdef1234567890abcdef123456",
      "fix: synced change",
    )
    const branches: GitBranch[] = [
      {
        name: "main",
        remote: false,
        current: true,
        sha: outgoingCommit.sha,
        date: TEST_DATE,
        upstream: {
          name: "origin/main",
          missing: false,
          ahead: 1,
          behind: 0,
        },
      },
    ]

    const view = new CommitsView(
      makeGitServiceStub({
        commits: [outgoingCommit, syncedCommit],
        branches,
        outgoingShas: [outgoingCommit.sha],
      }),
    )

    const children = await view.getChildren()
    assert.strictEqual(children.length, 2)
    assert.ok(children[0] instanceof CommitNode)
    assert.ok(children[1] instanceof CommitNode)
    assert.strictEqual((children[0] as CommitNode).outgoing, true)
    assert.strictEqual((children[1] as CommitNode).outgoing, false)
  })

  test("should still return commits when tracking info lookup fails", async () => {
    const commit = makeCommit(
      "aaaa1234567890abcdef1234567890abcdef123456",
      "feat: local change",
    )
    const view = new CommitsView({
      getRepoPath: async () => REPO_PATH,
      getCommits: async () => [commit],
      getBranches: async () => {
        throw new Error("tracking lookup failed")
      },
      getOutgoingCommitShasForBranch: async () => [],
      onDidChange: (_listener: () => void) => ({ dispose: () => {} }),
    } as unknown as GitService)

    const children = await view.getChildren()
    assert.strictEqual(children.length, 1)
    assert.ok(children[0] instanceof CommitNode)
    assert.strictEqual((children[0] as CommitNode).outgoing, false)
  })
})
