import * as assert from "node:assert"
import { suite, test } from "mocha"
import {
  parseCommits,
  parseBranches,
  parseRemotes,
  parseTags,
  parseStashes,
  parseWorktrees,
  parseFiles,
  parseRemoteProvider,
} from "../git/parsers"

suite("Parsers", () => {
  suite("parseCommits", () => {
    test("should parse a single commit", () => {
      const output = [
        "abc1234567890abcdef1234567890abcdef123456",
        "abc1234",
        "parent123456789abcdef1234567890abcdef12345",
        "John Doe",
        "john@example.com",
        "2024-01-15T10:30:00-05:00",
        "Jane Smith",
        "jane@example.com",
        "2024-01-15T10:30:00-05:00",
        "Initial commit",
        "",
        "This is the body of the commit message.",
        "<<END_COMMIT>>",
      ].join("\n")

      const commits = parseCommits(output)
      assert.strictEqual(commits.length, 1)
      assert.strictEqual(
        commits[0].sha,
        "abc1234567890abcdef1234567890abcdef123456",
      )
      assert.strictEqual(commits[0].shortSha, "abc1234")
      assert.strictEqual(commits[0].summary, "Initial commit")
      assert.strictEqual(commits[0].author.name, "John Doe")
      assert.strictEqual(commits[0].author.email, "john@example.com")
      assert.strictEqual(commits[0].parents.length, 1)
    })

    test("should parse multiple commits", () => {
      const commit1 = [
        "sha1aaa",
        "sha1a",
        "",
        "Author One",
        "one@test.com",
        "2024-01-01T00:00:00Z",
        "Author One",
        "one@test.com",
        "2024-01-01T00:00:00Z",
        "First commit",
        "<<END_COMMIT>>",
      ].join("\n")

      const commit2 = [
        "sha2bbb",
        "sha2b",
        "sha1aaa",
        "Author Two",
        "two@test.com",
        "2024-01-02T00:00:00Z",
        "Author Two",
        "two@test.com",
        "2024-01-02T00:00:00Z",
        "Second commit",
        "<<END_COMMIT>>",
      ].join("\n")

      const commits = parseCommits(commit1 + "\n" + commit2)
      assert.strictEqual(commits.length, 2)
      assert.strictEqual(commits[0].summary, "First commit")
      assert.strictEqual(commits[1].summary, "Second commit")
    })

    test("should return empty array for empty input", () => {
      assert.deepStrictEqual(parseCommits(""), [])
      assert.deepStrictEqual(parseCommits("   "), [])
    })
  })

  suite("parseBranches", () => {
    test("should parse local branches", () => {
      const output = [
        "*<|>main<|>abc1234<|>origin/main<|><|> 2024-01-15T10:00:00-05:00",
        " <|>feature<|>def5678<|>origin/feature<|><|> 2024-01-14T10:00:00-05:00",
      ].join("\n")

      const branches = parseBranches(output)
      assert.strictEqual(branches.length, 2)
      assert.strictEqual(branches[0].name, "main")
      assert.strictEqual(branches[0].current, true)
      assert.strictEqual(branches[0].upstream?.name, "origin/main")
      assert.strictEqual(branches[0].upstream?.ahead, 0)
      assert.strictEqual(branches[0].upstream?.behind, 0)
      assert.strictEqual(branches[1].name, "feature")
      assert.strictEqual(branches[1].current, false)
    })

    test("should parse ahead and behind tracking counts", () => {
      const output =
        " <|>feature<|>abc123<|>origin/feature<|>[ahead 2, behind 1]<|> 2024-01-15T10:00:00-05:00"
      const branches = parseBranches(output)
      assert.strictEqual(branches.length, 1)
      assert.strictEqual(branches[0].upstream?.ahead, 2)
      assert.strictEqual(branches[0].upstream?.behind, 1)
    })

    test("should handle branches with gone upstream", () => {
      const output =
        " <|>feature<|>abc123<|>origin/feature<|>[gone]<|> 2024-01-15T10:00:00-05:00"
      const branches = parseBranches(output)
      assert.strictEqual(branches.length, 1)
      assert.strictEqual(branches[0].upstream?.missing, true)
      assert.strictEqual(branches[0].upstream?.ahead, 0)
      assert.strictEqual(branches[0].upstream?.behind, 0)
    })
  })

  suite("parseRemotes", () => {
    test("should parse remote -v output", () => {
      const output = [
        "origin\thttps://github.com/user/repo.git\t(fetch)",
        "origin\thttps://github.com/user/repo.git\t(push)",
        "upstream\tgit@github.com:org/repo.git\t(fetch)",
        "upstream\tgit@github.com:org/repo.git\t(push)",
      ].join("\n")

      const remotes = parseRemotes(output)
      assert.strictEqual(remotes.length, 2)
      assert.strictEqual(remotes[0].name, "origin")
      assert.strictEqual(
        remotes[0].fetchUrl,
        "https://github.com/user/repo.git",
      )
      assert.strictEqual(remotes[0].pushUrl, "https://github.com/user/repo.git")
      assert.strictEqual(remotes[1].name, "upstream")
    })

    test("should identify providers", () => {
      const output = "origin\thttps://github.com/user/repo.git\t(fetch)"
      const remotes = parseRemotes(output)
      assert.strictEqual(remotes[0].provider?.id, "github")
      assert.strictEqual(remotes[0].provider?.owner, "user")
      assert.strictEqual(remotes[0].provider?.repo, "repo")
    })

    test("should identify Codeberg SSH remotes as Forgejo", () => {
      const output = [
        "origin\tssh://git@codeberg.org/owner-name/repo-name.git\t(fetch)",
        "origin\tssh://git@codeberg.org/owner-name/repo-name.git\t(push)",
      ].join("\n")
      const remotes = parseRemotes(output)
      assert.strictEqual(remotes[0].provider?.id, "forgejo")
      assert.strictEqual(remotes[0].provider?.domain, "codeberg.org")
      assert.strictEqual(remotes[0].provider?.owner, "owner-name")
      assert.strictEqual(remotes[0].provider?.repo, "repo-name")
    })
  })

  suite("parseRemoteProvider", () => {
    test("should parse GitHub HTTPS URL", () => {
      const provider = parseRemoteProvider("https://github.com/owner/repo.git")
      assert.strictEqual(provider?.id, "github")
      assert.strictEqual(provider?.domain, "github.com")
      assert.strictEqual(provider?.owner, "owner")
      assert.strictEqual(provider?.repo, "repo")
    })

    test("should parse GitHub SSH URL", () => {
      const provider = parseRemoteProvider("git@github.com:owner/repo.git")
      assert.strictEqual(provider?.id, "github")
      assert.strictEqual(provider?.owner, "owner")
      assert.strictEqual(provider?.repo, "repo")
    })

    test("should parse GitLab URL", () => {
      const provider = parseRemoteProvider("https://gitlab.com/owner/repo.git")
      assert.strictEqual(provider?.id, "gitlab")
    })

    test("should parse Bitbucket URL", () => {
      const provider = parseRemoteProvider(
        "https://bitbucket.org/owner/repo.git",
      )
      assert.strictEqual(provider?.id, "bitbucket")
    })

    test("should parse Codeberg URL as Forgejo", () => {
      const provider = parseRemoteProvider(
        "https://codeberg.org/owner/repo.git",
      )
      assert.strictEqual(provider?.id, "forgejo")
      assert.strictEqual(provider?.name, "Forgejo")
    })

    test("should parse Codeberg SSH URL as Forgejo", () => {
      const provider = parseRemoteProvider(
        "ssh://git@codeberg.org/owner-name/repo-name.git",
      )
      assert.strictEqual(provider?.id, "forgejo")
      assert.strictEqual(provider?.domain, "codeberg.org")
      assert.strictEqual(provider?.owner, "owner-name")
      assert.strictEqual(provider?.repo, "repo-name")
    })

    test("should return undefined for unknown providers", () => {
      const provider = parseRemoteProvider(
        "https://unknown-host.com/owner/repo.git",
      )
      assert.strictEqual(provider, undefined)
    })
  })

  suite("parseStashes", () => {
    test("should parse stash list", () => {
      const output = [
        "stash@{0}\0abc123\0 2024-01-15T10:00:00-05:00\0John\0john@test.com\0WIP on main",
        "stash@{1}\0def456\0 2024-01-14T10:00:00-05:00\0John\0john@test.com\0Fix bug",
      ].join("\n")

      const stashes = parseStashes(output)
      assert.strictEqual(stashes.length, 2)
      assert.strictEqual(stashes[0].index, 0)
      assert.strictEqual(stashes[0].message, "WIP on main")
      assert.strictEqual(stashes[1].index, 1)
    })
  })

  suite("parseWorktrees", () => {
    test("should parse worktree list", () => {
      const output = [
        "worktree /path/to/main",
        "HEAD abc123",
        "branch refs/heads/main",
        "",
        "worktree /path/to/feature",
        "HEAD def456",
        "branch refs/heads/feature",
        "",
      ].join("\n")

      const worktrees = parseWorktrees(output)
      assert.strictEqual(worktrees.length, 2)
      assert.strictEqual(worktrees[0].path, "/path/to/main")
      assert.strictEqual(worktrees[0].branch, "main")
      assert.strictEqual(worktrees[0].main, true)
      assert.strictEqual(worktrees[1].branch, "feature")
      assert.strictEqual(worktrees[1].main, false)
    })

    test("should handle locked worktrees", () => {
      const output = [
        "worktree /path/to/main",
        "HEAD abc123",
        "branch refs/heads/main",
        "",
        "worktree /path/to/locked",
        "HEAD def456",
        "branch refs/heads/locked",
        "locked",
        "",
      ].join("\n")

      const worktrees = parseWorktrees(output)
      assert.strictEqual(worktrees[1].locked, true)
    })
  })

  suite("parseFiles", () => {
    test("should parse name-status output", () => {
      const output = [
        "A\tsrc/new.ts",
        "M\tsrc/modified.ts",
        "D\tsrc/deleted.ts",
      ].join("\n")

      const files = parseFiles(output)
      assert.strictEqual(files.length, 3)
      assert.strictEqual(files[0].status, "added")
      assert.strictEqual(files[0].path, "src/new.ts")
      assert.strictEqual(files[1].status, "modified")
      assert.strictEqual(files[2].status, "deleted")
    })

    test("should parse renamed files", () => {
      const output = "R100\told-name.ts\tnew-name.ts"
      const files = parseFiles(output)
      assert.strictEqual(files.length, 1)
      assert.strictEqual(files[0].status, "renamed")
      assert.strictEqual(files[0].path, "new-name.ts")
      assert.strictEqual(files[0].originalPath, "old-name.ts")
    })
  })

  suite("parseTags", () => {
    test("should parse tags", () => {
      const output = [
        "v1.0.0<|>abc123<|><|> 2024-01-15T10:00:00-05:00<|>Release v1.0.0<<END_TAG>>",
        "v0.9.0<|>def456<|><|> 2024-01-01T10:00:00-05:00<|>Pre-release<<END_TAG>>",
      ].join("\n")

      const tags = parseTags(output)
      assert.strictEqual(tags.length, 2)
      assert.strictEqual(tags[0].name, "v1.0.0")
      assert.strictEqual(tags[0].sha, "abc123")
    })
  })
})
