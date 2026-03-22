import * as assert from "node:assert"
import { suite, test } from "mocha"
// Note: These tests run in the VS Code extension test host
import { shortenSha } from "../config"

suite("Config", () => {
  suite("shortenSha", () => {
    test("should shorten SHA to default length", () => {
      const sha = "abc1234567890abcdef1234567890abcdef123456"
      const short = shortenSha(sha)
      // Default length is 7
      assert.strictEqual(short, "abc1234")
      assert.strictEqual(short.length, 7)
    })

    test("should handle short input", () => {
      const sha = "abc"
      const short = shortenSha(sha)
      assert.strictEqual(short, "abc")
    })
  })
})
