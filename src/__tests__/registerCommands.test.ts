import * as assert from "node:assert"
import { suite, test } from "mocha"
import {
  getRemoteFileUrlRevision,
  getRemoteRevisionSha,
} from "../commands/registerCommands"

suite("registerCommands helpers", () => {
  suite("getRemoteRevisionSha", () => {
    test("should prefer remoteSha over sha", () => {
      const sha = getRemoteRevisionSha({
        sha: "content-sha",
        remoteSha: "remote-sha",
      })

      assert.strictEqual(sha, "remote-sha")
    })

    test("should fall back to sha", () => {
      const sha = getRemoteRevisionSha({ sha: "content-sha" })

      assert.strictEqual(sha, "content-sha")
    })
  })

  suite("getRemoteFileUrlRevision", () => {
    test("should use the node sha for tree file URLs", () => {
      const revision = getRemoteFileUrlRevision({ sha: "node-sha" }, "main")

      assert.deepStrictEqual(revision, { sha: "node-sha" })
    })

    test("should use the remote sha for remote file URLs", () => {
      const revision = getRemoteFileUrlRevision(
        { sha: "content-sha", remoteSha: "remote-sha" },
        "main",
      )

      assert.deepStrictEqual(revision, { sha: "remote-sha" })
    })

    test("should use the branch when no node sha exists", () => {
      const revision = getRemoteFileUrlRevision(undefined, "main")

      assert.deepStrictEqual(revision, { branch: "main" })
    })
  })
})
