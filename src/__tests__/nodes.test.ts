import * as assert from "node:assert"
import { suite, test } from "mocha"
import { MarkdownString } from "vscode"
import {
  CommitNode,
  FileNode,
  BranchNode,
  TagNode,
  StashNode,
  WorktreeNode,
  RemoteNode,
} from "../views/nodes"
import { Commands } from "../constants"
import type {
  GitCommit,
  GitBranch,
  GitTag,
  GitStash,
  GitWorktree,
  GitFile,
  GitRemote,
} from "../git/models"

const REPO_PATH = "/test/repo"
const TEST_DATE = new Date("2024-01-15T10:30:00Z")
const TEST_SHA = "abc1234567890abcdef1234567890abcdef123456"

function makeCommit(overrides?: Partial<GitCommit>): GitCommit {
  return {
    sha: TEST_SHA,
    shortSha: "abc1234",
    message: "Initial commit",
    summary: "Initial commit",
    author: { name: "John Doe", email: "john@example.com", date: TEST_DATE },
    committer: {
      name: "John Doe",
      email: "john@example.com",
      date: TEST_DATE,
    },
    date: TEST_DATE,
    parents: [],
    ...overrides,
  }
}

function makeBranch(overrides?: Partial<GitBranch>): GitBranch {
  return {
    name: "main",
    remote: false,
    current: true,
    sha: TEST_SHA,
    date: TEST_DATE,
    ...overrides,
  }
}

function makeTag(overrides?: Partial<GitTag>): GitTag {
  return {
    name: "v1.0.0",
    sha: TEST_SHA,
    message: "Release v1.0.0",
    date: TEST_DATE,
    ...overrides,
  }
}

function makeStash(overrides?: Partial<GitStash>): GitStash {
  return {
    index: 0,
    sha: TEST_SHA,
    message: "WIP: stash changes",
    date: TEST_DATE,
    author: { name: "John Doe", email: "john@example.com", date: TEST_DATE },
    ...overrides,
  }
}

function makeFile(overrides?: Partial<GitFile>): GitFile {
  return {
    path: "src/index.ts",
    status: "modified",
    ...overrides,
  }
}

function makeRemote(overrides?: Partial<GitRemote>): GitRemote {
  return {
    name: "origin",
    url: "https://github.com/test/repo.git",
    ...overrides,
  }
}

function makeWorktree(overrides?: Partial<GitWorktree>): GitWorktree {
  return {
    path: "/test/repo",
    branch: "main",
    bare: false,
    main: true,
    locked: false,
    prunable: false,
    sha: TEST_SHA,
    ...overrides,
  }
}

/** Extract the tooltip MarkdownString value from a node. */
function tooltipValue(
  tooltip: string | MarkdownString | undefined,
): string | undefined {
  if (tooltip instanceof MarkdownString) return tooltip.value
  return tooltip
}

/**
 * Decode the first set of command URI arguments from a tooltip value.
 * Finds `command:<commandId>?<encodedArgs>` and decodes the args.
 */
function decodeCommandArgs(
  markdown: string,
  commandId: string,
): unknown[] | undefined {
  const prefix = `command:${commandId}?`
  const idx = markdown.indexOf(prefix)
  if (idx === -1) return undefined
  const start = idx + prefix.length
  // Args end at the next space, quote, or closing paren
  const endMatch = markdown.slice(start).match(/[\s")]/u)
  const end = endMatch ? start + endMatch.index! : markdown.length
  const encoded = markdown.slice(start, end)
  return JSON.parse(decodeURIComponent(encoded)) as unknown[]
}

suite("Nodes", () => {
  // ── CommitNode ──

  suite("CommitNode", () => {
    suite("tooltip", () => {
      test("should be a MarkdownString with isTrusted true", () => {
        const node = new CommitNode(makeCommit(), REPO_PATH)
        assert.ok(node.tooltip instanceof MarkdownString)
        assert.strictEqual((node.tooltip as MarkdownString).isTrusted, true)
      })

      test("should have supportThemeIcons enabled", () => {
        const node = new CommitNode(makeCommit(), REPO_PATH)
        assert.strictEqual(
          (node.tooltip as MarkdownString).supportThemeIcons,
          true,
        )
      })

      test("should contain command link for Copy SHA", () => {
        const node = new CommitNode(makeCommit(), REPO_PATH)
        const value = tooltipValue(node.tooltip)!
        assert.ok(
          value.includes(`command:${Commands.CopySha}?`),
          "tooltip should contain CopySha command URI",
        )
      })

      test("should contain command link for Open on remote", () => {
        const node = new CommitNode(makeCommit(), REPO_PATH)
        const value = tooltipValue(node.tooltip)!
        assert.ok(
          value.includes(`command:${Commands.OpenCommitOnRemote}?`),
          "tooltip should contain OpenCommitOnRemote command URI",
        )
      })

      test("should encode commit SHA in command arguments", () => {
        const node = new CommitNode(makeCommit(), REPO_PATH)
        const value = tooltipValue(node.tooltip)!
        const args = decodeCommandArgs(value, Commands.CopySha)
        assert.ok(args, "should have decodable CopySha args")
        assert.deepStrictEqual(args, [{ sha: TEST_SHA }])
      })

      test("should include title attributes on command links", () => {
        const node = new CommitNode(makeCommit(), REPO_PATH)
        const value = tooltipValue(node.tooltip)!
        assert.ok(
          value.includes('"Copy full commit SHA"'),
          "Copy SHA link should have a title attribute",
        )
        assert.ok(
          value.includes('"Open commit on remote"'),
          "Open on remote link should have a title attribute",
        )
      })

      test("should contain commit summary and SHA", () => {
        const commit = makeCommit({ summary: "feat: add feature" })
        const node = new CommitNode(commit, REPO_PATH)
        const value = tooltipValue(node.tooltip)!
        assert.ok(value.includes("**feat: add feature**"))
        assert.ok(value.includes(`\`${TEST_SHA}\``))
      })

      test("should include body when message differs from summary", () => {
        const commit = makeCommit({
          summary: "feat: add feature",
          message: "feat: add feature\n\nDetailed description here.",
        })
        const node = new CommitNode(commit, REPO_PATH)
        const value = tooltipValue(node.tooltip)!
        assert.ok(
          value.includes("Detailed description here."),
          "tooltip should contain the commit body",
        )
      })

      test("should truncate body exceeding 20 lines with italicized indicator", () => {
        const bodyLines = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}`)
        const fullMessage = "summary\n\n" + bodyLines.join("\n")
        const commit = makeCommit({
          summary: "summary",
          message: fullMessage,
        })
        const node = new CommitNode(commit, REPO_PATH)
        const value = tooltipValue(node.tooltip)!
        assert.ok(
          value.includes("_... (message truncated)_"),
          "tooltip should contain italicized truncation indicator",
        )
        assert.ok(
          !value.includes("Line 30"),
          "tooltip should not contain lines beyond the limit",
        )
      })

      test("should not truncate body within 20 lines", () => {
        const bodyLines = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`)
        const fullMessage = "summary\n\n" + bodyLines.join("\n")
        const commit = makeCommit({
          summary: "summary",
          message: fullMessage,
        })
        const node = new CommitNode(commit, REPO_PATH)
        const value = tooltipValue(node.tooltip)!
        assert.ok(
          !value.includes("_... (message truncated)_"),
          "tooltip should not contain truncation indicator for short messages",
        )
        assert.ok(value.includes("Line 10"), "tooltip should contain all lines")
      })

      test("should contain command link for Copy message", () => {
        const node = new CommitNode(makeCommit(), REPO_PATH)
        const value = tooltipValue(node.tooltip)!
        assert.ok(
          value.includes(`command:${Commands.CopyMessage}?`),
          "tooltip should contain CopyMessage command URI",
        )
      })

      test("should encode full message in Copy message arguments", () => {
        const commit = makeCommit({
          summary: "feat: something",
          message: "feat: something\n\nLong body here.",
        })
        const node = new CommitNode(commit, REPO_PATH)
        const value = tooltipValue(node.tooltip)!
        const args = decodeCommandArgs(value, Commands.CopyMessage)
        assert.ok(args, "should have decodable CopyMessage args")
        assert.deepStrictEqual(args, [
          { message: "feat: something\n\nLong body here." },
        ])
      })

      test("should include title attribute on Copy message link", () => {
        const node = new CommitNode(makeCommit(), REPO_PATH)
        const value = tooltipValue(node.tooltip)!
        assert.ok(
          value.includes('"Copy full commit message"'),
          "Copy message link should have a title attribute",
        )
      })
    })
  })

  // ── FileNode ──

  suite("FileNode", () => {
    suite("tooltip", () => {
      test("should be a MarkdownString with isTrusted true", () => {
        const node = new FileNode(makeFile(), TEST_SHA, REPO_PATH)
        assert.ok(node.tooltip instanceof MarkdownString)
        assert.strictEqual((node.tooltip as MarkdownString).isTrusted, true)
      })

      test("should have supportThemeIcons enabled", () => {
        const node = new FileNode(makeFile(), TEST_SHA, REPO_PATH)
        assert.strictEqual(
          (node.tooltip as MarkdownString).supportThemeIcons,
          true,
        )
      })

      test("should contain command link for Open changes", () => {
        const node = new FileNode(makeFile(), TEST_SHA, REPO_PATH)
        const value = tooltipValue(node.tooltip)!
        assert.ok(
          value.includes(`command:${Commands.OpenChanges}?`),
          "tooltip should contain OpenChanges command URI",
        )
      })

      test("should contain command link for Open on remote", () => {
        const node = new FileNode(makeFile(), TEST_SHA, REPO_PATH)
        const value = tooltipValue(node.tooltip)!
        assert.ok(
          value.includes(`command:${Commands.OpenFileOnRemote}?`),
          "tooltip should contain OpenFileOnRemote command URI",
        )
      })

      test("should encode file info in command arguments", () => {
        const file = makeFile({ path: "src/app.ts" })
        const node = new FileNode(file, TEST_SHA, REPO_PATH)
        const value = tooltipValue(node.tooltip)!
        const args = decodeCommandArgs(value, Commands.OpenChanges)
        assert.ok(args, "should have decodable OpenChanges args")
        assert.deepStrictEqual(args, [
          { sha: TEST_SHA, filePath: "src/app.ts", repoPath: REPO_PATH },
        ])
      })

      test("should include title attributes on command links", () => {
        const node = new FileNode(makeFile(), TEST_SHA, REPO_PATH)
        const value = tooltipValue(node.tooltip)!
        assert.ok(
          value.includes('"Open file changes"'),
          "Open changes link should have a title attribute",
        )
        assert.ok(
          value.includes('"Open file on remote"'),
          "Open on remote link should have a title attribute",
        )
      })
    })

    suite("previousSha (compare diffs)", () => {
      const PREV_SHA = "def0000000000000000000000000000000000000"

      test("should store previousSha when provided", () => {
        const node = new FileNode(makeFile(), TEST_SHA, REPO_PATH, PREV_SHA)
        assert.strictEqual(node.previousSha, PREV_SHA)
      })

      test("should leave previousSha undefined when not provided", () => {
        const node = new FileNode(makeFile(), TEST_SHA, REPO_PATH)
        assert.strictEqual(node.previousSha, undefined)
      })

      test("should include previousSha in click command arguments", () => {
        const file = makeFile({ path: "src/app.ts" })
        const node = new FileNode(file, TEST_SHA, REPO_PATH, PREV_SHA)
        const cmdArgs = node.command?.arguments?.[0] as Record<string, unknown>
        assert.strictEqual(cmdArgs.previousSha, PREV_SHA)
        assert.strictEqual(cmdArgs.sha, TEST_SHA)
      })

      test("should not include previousSha in click args when omitted", () => {
        const file = makeFile({ path: "src/app.ts" })
        const node = new FileNode(file, TEST_SHA, REPO_PATH)
        const cmdArgs = node.command?.arguments?.[0] as Record<string, unknown>
        assert.strictEqual(cmdArgs.previousSha, undefined)
      })

      test("should include previousSha in tooltip OpenChanges command args", () => {
        const file = makeFile({ path: "src/app.ts" })
        const node = new FileNode(file, TEST_SHA, REPO_PATH, PREV_SHA)
        const value = tooltipValue(node.tooltip)!
        const args = decodeCommandArgs(value, Commands.OpenChanges)
        assert.ok(args, "should have decodable OpenChanges args")
        const argObj = args[0] as Record<string, unknown>
        assert.strictEqual(argObj.previousSha, PREV_SHA)
        assert.strictEqual(argObj.sha, TEST_SHA)
        assert.strictEqual(argObj.filePath, "src/app.ts")
      })

      test("should omit previousSha from tooltip args when not provided", () => {
        const file = makeFile({ path: "src/app.ts" })
        const node = new FileNode(file, TEST_SHA, REPO_PATH)
        const value = tooltipValue(node.tooltip)!
        const args = decodeCommandArgs(value, Commands.OpenChanges)
        assert.ok(args, "should have decodable OpenChanges args")
        const argObj = args[0] as Record<string, unknown>
        assert.strictEqual(argObj.previousSha, undefined)
      })
    })
  })

  // ── BranchNode ──

  suite("BranchNode", () => {
    suite("tooltip", () => {
      test("should be a MarkdownString with isTrusted true", () => {
        const node = new BranchNode(makeBranch(), REPO_PATH)
        assert.ok(node.tooltip instanceof MarkdownString)
        assert.strictEqual((node.tooltip as MarkdownString).isTrusted, true)
      })

      test("should contain Compare with HEAD link when SHA is present", () => {
        const node = new BranchNode(makeBranch({ sha: TEST_SHA }), REPO_PATH)
        const value = tooltipValue(node.tooltip)!
        assert.ok(
          value.includes(`command:${Commands.CompareWithHead}?`),
          "tooltip should contain CompareWithHead command URI",
        )
      })

      test("should encode branch SHA in Compare command arguments", () => {
        const node = new BranchNode(makeBranch({ sha: TEST_SHA }), REPO_PATH)
        const value = tooltipValue(node.tooltip)!
        const args = decodeCommandArgs(value, Commands.CompareWithHead)
        assert.ok(args, "should have decodable CompareWithHead args")
        assert.deepStrictEqual(args, [{ sha: TEST_SHA, repoPath: REPO_PATH }])
      })

      test("should NOT contain Compare link when SHA is absent", () => {
        const node = new BranchNode(makeBranch({ sha: undefined }), REPO_PATH)
        const value = tooltipValue(node.tooltip)!
        assert.ok(
          !value.includes(`command:${Commands.CompareWithHead}?`),
          "tooltip should not contain CompareWithHead command URI",
        )
      })

      test("should include title attribute on Compare link", () => {
        const node = new BranchNode(makeBranch({ sha: TEST_SHA }), REPO_PATH)
        const value = tooltipValue(node.tooltip)!
        assert.ok(
          value.includes('"Compare branch with HEAD"'),
          "Compare link should have a title attribute",
        )
      })
    })
  })

  // ── TagNode ──

  suite("TagNode", () => {
    suite("tooltip", () => {
      test("should be a MarkdownString with isTrusted true", () => {
        const node = new TagNode(makeTag(), REPO_PATH)
        assert.ok(node.tooltip instanceof MarkdownString)
        assert.strictEqual((node.tooltip as MarkdownString).isTrusted, true)
      })

      test("should contain command link for Copy tag name", () => {
        const node = new TagNode(makeTag(), REPO_PATH)
        const value = tooltipValue(node.tooltip)!
        assert.ok(
          value.includes(`command:${Commands.CopyTag}?`),
          "tooltip should contain CopyTag command URI",
        )
      })

      test("should contain command link for Checkout", () => {
        const node = new TagNode(makeTag(), REPO_PATH)
        const value = tooltipValue(node.tooltip)!
        assert.ok(
          value.includes(`command:${Commands.CheckoutTag}?`),
          "tooltip should contain CheckoutTag command URI",
        )
      })

      test("should encode tag name in Copy command arguments", () => {
        const node = new TagNode(makeTag({ name: "v2.0.0" }), REPO_PATH)
        const value = tooltipValue(node.tooltip)!
        const args = decodeCommandArgs(value, Commands.CopyTag)
        assert.ok(args, "should have decodable CopyTag args")
        assert.deepStrictEqual(args, [{ name: "v2.0.0" }])
      })

      test("should encode tag name and repoPath in Checkout arguments", () => {
        const node = new TagNode(makeTag({ name: "v2.0.0" }), REPO_PATH)
        const value = tooltipValue(node.tooltip)!
        const args = decodeCommandArgs(value, Commands.CheckoutTag)
        assert.ok(args, "should have decodable CheckoutTag args")
        assert.deepStrictEqual(args, [{ name: "v2.0.0", repoPath: REPO_PATH }])
      })

      test("should include title attributes on command links", () => {
        const node = new TagNode(makeTag(), REPO_PATH)
        const value = tooltipValue(node.tooltip)!
        assert.ok(
          value.includes('"Copy tag name to clipboard"'),
          "Copy tag name link should have a title attribute",
        )
        assert.ok(
          value.includes('"Checkout this tag"'),
          "Checkout link should have a title attribute",
        )
      })
    })
  })

  // ── StashNode ──

  suite("StashNode", () => {
    suite("tooltip", () => {
      test("should be a MarkdownString with isTrusted true", () => {
        const node = new StashNode(makeStash(), REPO_PATH)
        assert.ok(node.tooltip instanceof MarkdownString)
        assert.strictEqual((node.tooltip as MarkdownString).isTrusted, true)
      })

      test("should contain command link for Copy SHA", () => {
        const node = new StashNode(makeStash(), REPO_PATH)
        const value = tooltipValue(node.tooltip)!
        assert.ok(
          value.includes(`command:${Commands.CopySha}?`),
          "tooltip should contain CopySha command URI",
        )
      })

      test("should encode stash SHA in command arguments", () => {
        const node = new StashNode(makeStash(), REPO_PATH)
        const value = tooltipValue(node.tooltip)!
        const args = decodeCommandArgs(value, Commands.CopySha)
        assert.ok(args, "should have decodable CopySha args")
        assert.deepStrictEqual(args, [{ sha: TEST_SHA }])
      })

      test("should include title attribute on Copy SHA link", () => {
        const node = new StashNode(makeStash(), REPO_PATH)
        const value = tooltipValue(node.tooltip)!
        assert.ok(
          value.includes('"Copy full stash SHA"'),
          "Copy SHA link should have a title attribute",
        )
      })
    })
  })

  // ── WorktreeNode ──

  suite("WorktreeNode", () => {
    suite("tooltip", () => {
      test("should be a MarkdownString with isTrusted true", () => {
        const node = new WorktreeNode(makeWorktree(), REPO_PATH)
        assert.ok(node.tooltip instanceof MarkdownString)
        assert.strictEqual((node.tooltip as MarkdownString).isTrusted, true)
      })

      test("should have supportThemeIcons enabled", () => {
        const node = new WorktreeNode(makeWorktree(), REPO_PATH)
        assert.strictEqual(
          (node.tooltip as MarkdownString).supportThemeIcons,
          true,
        )
      })
    })
  })

  // ── RemoteNode ──

  suite("RemoteNode", () => {
    suite("tooltip", () => {
      test("should be a MarkdownString with isTrusted true", () => {
        const node = new RemoteNode(makeRemote(), REPO_PATH)
        assert.ok(node.tooltip instanceof MarkdownString)
        assert.strictEqual((node.tooltip as MarkdownString).isTrusted, true)
      })

      test("should have supportThemeIcons enabled", () => {
        const node = new RemoteNode(makeRemote(), REPO_PATH)
        assert.strictEqual(
          (node.tooltip as MarkdownString).supportThemeIcons,
          true,
        )
      })
    })
  })
})
