import * as assert from "node:assert"
import { suite, test } from "mocha"
import {
  REVISION_SCHEME,
  makeRevisionUri,
  RevisionContentProvider,
} from "../commands/revisionContentProvider"

suite("RevisionContentProvider", () => {
  suite("makeRevisionUri", () => {
    test("should use the gitless-revision scheme", () => {
      const uri = makeRevisionUri("/repo", "file.ts", "abc1234")
      assert.strictEqual(uri.scheme, REVISION_SCHEME)
    })

    test("should set the file path as the URI path", () => {
      const uri = makeRevisionUri("/repo", "src/file.ts", "abc1234")
      assert.strictEqual(uri.path, "/src/file.ts")
    })

    test("should include sha in query parameters", () => {
      const uri = makeRevisionUri("/repo", "file.ts", "abc1234")
      const params = new URLSearchParams(uri.query)
      assert.strictEqual(params.get("sha"), "abc1234")
    })

    test("should include repoPath in query parameters", () => {
      const uri = makeRevisionUri(
        "/Users/dev/code/my-repo",
        "file.ts",
        "abc1234",
      )
      const params = new URLSearchParams(uri.query)
      assert.strictEqual(params.get("repoPath"), "/Users/dev/code/my-repo")
    })

    test("should preserve tilde in parent commit SHA", () => {
      const uri = makeRevisionUri("/repo", "file.ts", "abc1234~1")
      const params = new URLSearchParams(uri.query)
      assert.strictEqual(params.get("sha"), "abc1234~1")
    })

    test("should handle nested file paths", () => {
      const uri = makeRevisionUri(
        "/repo",
        "src/components/Button.tsx",
        "abc1234",
      )
      assert.strictEqual(uri.path, "/src/components/Button.tsx")
    })

    test("should handle repo paths with many segments", () => {
      const repoPath = "/Users/developer/code/github/org/project"
      const uri = makeRevisionUri(repoPath, "README.md", "abc1234")
      const params = new URLSearchParams(uri.query)
      assert.strictEqual(params.get("repoPath"), repoPath)
    })
  })

  suite("provideTextDocumentContent", () => {
    test("should extract sha, repoPath, and filePath from URI", async () => {
      const calls: { repoPath: string; sha: string; filePath: string }[] = []
      const mockGitService = {
        getFileContent: async (
          repoPath: string,
          sha: string,
          filePath: string,
        ) => {
          calls.push({ repoPath, sha, filePath })
          return "file content"
        },
      }
      const provider = new RevisionContentProvider(
        mockGitService as Parameters<
          typeof RevisionContentProvider.prototype.provideTextDocumentContent
        > extends never[]
          ? never
          : // eslint-disable-next-line @typescript-eslint/no-explicit-any
            any,
      )

      const uri = makeRevisionUri(
        "/Users/dev/project",
        "src/index.ts",
        "abc1234",
      )
      const content = await provider.provideTextDocumentContent(uri)

      assert.strictEqual(content, "file content")
      assert.strictEqual(calls.length, 1)
      assert.strictEqual(calls[0].repoPath, "/Users/dev/project")
      assert.strictEqual(calls[0].sha, "abc1234")
      assert.strictEqual(calls[0].filePath, "src/index.ts")
    })

    test("should resolve parent commit SHA with tilde notation", async () => {
      const calls: { sha: string }[] = []
      const mockGitService = {
        getFileContent: async (
          _repoPath: string,
          sha: string,
          _filePath: string,
        ) => {
          calls.push({ sha })
          return "parent content"
        },
      }
      const provider = new RevisionContentProvider(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockGitService as any,
      )

      const uri = makeRevisionUri("/repo", "file.ts", "abc1234~1")
      const content = await provider.provideTextDocumentContent(uri)

      assert.strictEqual(content, "parent content")
      assert.strictEqual(calls[0].sha, "abc1234~1")
    })

    test("should return empty string when sha is missing", async () => {
      const mockGitService = {
        getFileContent: async () => "should not be called",
      }
      const provider = new RevisionContentProvider(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockGitService as any,
      )

      // Construct a URI without sha in query
      const { Uri } = await import("vscode")
      const uri = Uri.from({
        scheme: REVISION_SCHEME,
        path: "/file.ts",
        query: "repoPath=/repo",
      })
      const content = await provider.provideTextDocumentContent(uri)

      assert.strictEqual(content, "")
    })

    test("should return empty string when repoPath is missing", async () => {
      const mockGitService = {
        getFileContent: async () => "should not be called",
      }
      const provider = new RevisionContentProvider(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockGitService as any,
      )

      const { Uri } = await import("vscode")
      const uri = Uri.from({
        scheme: REVISION_SCHEME,
        path: "/file.ts",
        query: "sha=abc1234",
      })
      const content = await provider.provideTextDocumentContent(uri)

      assert.strictEqual(content, "")
    })

    test("should return empty string when git command fails", async () => {
      const mockGitService = {
        getFileContent: async () => {
          throw new Error("fatal: path does not exist")
        },
      }
      const provider = new RevisionContentProvider(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockGitService as any,
      )

      const uri = makeRevisionUri("/repo", "deleted-file.ts", "abc1234~1")
      const content = await provider.provideTextDocumentContent(uri)

      assert.strictEqual(content, "")
    })

    test("should handle HEAD as sha", async () => {
      const calls: { sha: string }[] = []
      const mockGitService = {
        getFileContent: async (
          _repoPath: string,
          sha: string,
          _filePath: string,
        ) => {
          calls.push({ sha })
          return "head content"
        },
      }
      const provider = new RevisionContentProvider(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockGitService as any,
      )

      const uri = makeRevisionUri("/repo", "file.ts", "HEAD")
      const content = await provider.provideTextDocumentContent(uri)

      assert.strictEqual(content, "head content")
      assert.strictEqual(calls[0].sha, "HEAD")
    })
  })

  suite("URI round-trip", () => {
    test("should round-trip repoPath with absolute path", () => {
      const repoPath = "/Users/developer/code/github/org/my-project"
      const uri = makeRevisionUri(repoPath, "file.ts", "abc1234")
      const params = new URLSearchParams(uri.query)
      assert.strictEqual(params.get("repoPath"), repoPath)
    })

    test("should round-trip filePath through URI path", () => {
      const filePath = "src/components/views/TreeView.tsx"
      const uri = makeRevisionUri("/repo", filePath, "abc1234")
      const extractedPath = uri.path.startsWith("/")
        ? uri.path.slice(1)
        : uri.path
      assert.strictEqual(extractedPath, filePath)
    })

    test("should produce different URIs for commit and parent", () => {
      const commitUri = makeRevisionUri("/repo", "file.ts", "abc1234")
      const parentUri = makeRevisionUri("/repo", "file.ts", "abc1234~1")
      assert.notStrictEqual(commitUri.toString(), parentUri.toString())
    })
  })
})
