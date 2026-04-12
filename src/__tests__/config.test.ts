import * as assert from "node:assert"
import { suite, test } from "mocha"
import { formatDate, shortenSha } from "../config"

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

  suite("formatDate", () => {
    const date = new Date(2026, 3, 11, 16, 22, 12)

    function withNow<T>(now: Date, callback: () => T): T {
      const originalNow = Date.now
      Date.now = () => now.getTime()
      try {
        return callback()
      } finally {
        Date.now = originalNow
      }
    }

    test("should format dates with Day.js tokens", () => {
      assert.strictEqual(
        formatDate(date, {
          style: "absolute",
          format: "YYYY-M-DD H:mm",
        }),
        "2026-4-11 16:22",
      )
    })

    test("should use locale formatting for absolute dates without a format", () => {
      assert.strictEqual(
        formatDate(date, { style: "absolute", format: null }),
        date.toLocaleString(),
      )
    })

    test("should use relative dates by default without a format", () => {
      withNow(date, () => {
        assert.strictEqual(
          formatDate(new Date(2026, 3, 11, 16, 12, 12), {
            format: null,
          }),
          "10m ago",
        )
      })
    })

    test("should format relative date ranges", () => {
      withNow(date, () => {
        assert.strictEqual(
          formatDate(new Date(2026, 3, 11, 16, 21, 42), {
            style: "relative",
            format: null,
          }),
          "just now",
        )
        assert.strictEqual(
          formatDate(new Date(2026, 3, 11, 14, 22, 12), {
            style: "relative",
            format: null,
          }),
          "2h ago",
        )
        assert.strictEqual(
          formatDate(new Date(2026, 3, 8, 16, 22, 12), {
            style: "relative",
            format: null,
          }),
          "3d ago",
        )
        assert.strictEqual(
          formatDate(new Date(2026, 2, 11, 16, 22, 12), {
            style: "relative",
            format: null,
          }),
          "1mo ago",
        )
        assert.strictEqual(
          formatDate(new Date(2025, 3, 11, 16, 22, 12), {
            style: "relative",
            format: null,
          }),
          "1y ago",
        )
      })
    })
  })
})
