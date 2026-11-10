import * as assert from "node:assert/strict"
import { suite, test } from "mocha"
import type { GitService } from "../git/gitService"
import type { GitBranch, GitCommit } from "../git/models"
import { BranchesView } from "../views/branchesView"
import { BranchNode, CommitNode, FileNode, RemoteNode } from "../views/nodes"
import { RemotesView } from "../views/remotesView"

suite("RemotesView", () => {
  test("should expand a remote branch into commits and changed files", async () => {
    const repoPath = "/test/repo"
    const date = new Date("2024-01-15T10:30:00Z")
    const author = { name: "Test", email: "test@example.com", date }
    const commit: GitCommit = {
      sha: "a".repeat(40),
      shortSha: "aaaaaaa",
      message: "Add a file",
      summary: "Add a file",
      author,
      committer: author,
      date,
      parents: [],
    }
    const mainBranch: GitBranch = {
      name: "origin/main",
      remote: true,
      current: false,
      sha: commit.sha,
    }
    const branches = [mainBranch, { ...mainBranch, name: "origin/release" }]
    const gitService = {
      getActiveRepoPath: async () => repoPath,
      getRemotes: async () => [
        { name: "origin", url: "https://example.com/test/repo.git" },
      ],
      getBranches: async () => branches,
      getCommits: async (path: string, options: { ref: string }) =>
        path === repoPath &&
        branches.some((branch) => branch.name === options.ref)
          ? [commit]
          : [],
      getOutgoingCommitShasForBranch: async () => [],
      getPreferredAutolinkRemote: async () => undefined,
      getCommitFiles: async (path: string, sha: string) =>
        path === repoPath && sha === commit.sha
          ? [{ path: "README.md", status: "added" }]
          : [],
      onDidChange: () => ({ dispose() {} }),
    } as unknown as GitService
    const branchesView = new BranchesView(gitService)
    const remotesView = new RemotesView(gitService, branchesView)

    try {
      const [remoteNode] = await remotesView.getChildren()
      assert.ok(remoteNode instanceof RemoteNode)
      const branchNodes = await remotesView.getChildren(remoteNode)
      assert.equal(branchNodes.length, 2)
      const commitIds = new Set<string>()
      const fileIds = new Set<string>()

      for (const branchNode of branchNodes) {
        assert.ok(branchNode instanceof BranchNode)
        const [commitNode] = await remotesView.getChildren(branchNode)
        assert.ok(commitNode instanceof CommitNode)
        assert.equal(commitNode.sha, commit.sha)
        assert.ok(commitNode.id)
        commitIds.add(commitNode.id)

        const [fileNode] = await remotesView.getChildren(commitNode)
        assert.ok(fileNode instanceof FileNode)
        assert.equal(fileNode.filePath, "README.md")
        assert.ok(fileNode.id)
        fileIds.add(fileNode.id)
      }

      assert.equal(commitIds.size, 2)
      assert.equal(fileIds.size, 2)
    } finally {
      remotesView.dispose()
      branchesView.dispose()
    }
  })
})
