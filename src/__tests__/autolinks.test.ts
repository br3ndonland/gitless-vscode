import * as assert from "node:assert"
import { suite, test } from "mocha"
import { linkifyAutolinks } from "../git/autolinks"
import type { RemoteProviderInfo } from "../git/models"

const githubProvider: RemoteProviderInfo = {
  id: "github",
  name: "GitHub",
  domain: "github.com",
  owner: "user",
  repo: "my-repo",
}

const gitlabProvider: RemoteProviderInfo = {
  id: "gitlab",
  name: "GitLab",
  domain: "gitlab.com",
  owner: "user",
  repo: "my-repo",
}

const codebergProvider: RemoteProviderInfo = {
  id: "forgejo",
  name: "Forgejo",
  domain: "codeberg.org",
  owner: "user",
  repo: "my-repo",
}

suite("Autolinks", () => {
  test("should link raw URLs without changing visible text", () => {
    assert.strictEqual(
      linkifyAutolinks("Visit https://github.com/user/repo."),
      "Visit [https://github.com/user/repo](https://github.com/user/repo).",
    )
  })

  test("should link all-numeric bare short commit references", () => {
    assert.strictEqual(
      linkifyAutolinks("Refs 1765166", githubProvider),
      "Refs [1765166](https://github.com/user/my-repo/commit/1765166)",
    )
  })

  test("should link GitHub commit references", () => {
    const sha = "abc1234567890abcdef1234567890abcdef12345"

    assert.strictEqual(
      linkifyAutolinks(
        `See owner/repo@abc1234, a05b1ad, and ${sha}`,
        githubProvider,
      ),
      `See [owner/repo@abc1234](https://github.com/owner/repo/commit/abc1234), [a05b1ad](https://github.com/user/my-repo/commit/a05b1ad), and [${sha}](https://github.com/user/my-repo/commit/${sha})`,
    )
  })

  test("should link GitHub issue references", () => {
    assert.strictEqual(
      linkifyAutolinks("Fix #123 and GH-124", githubProvider),
      "Fix [#123](https://github.com/user/my-repo/issues/123) and [GH-124](https://github.com/user/my-repo/issues/124)",
    )
  })

  test("should link GitHub cross-repo issue references", () => {
    assert.strictEqual(
      linkifyAutolinks("Fix other/repo#5", githubProvider),
      "Fix [other/repo#5](https://github.com/other/repo/issues/5)",
    )
  })

  test("should link GitLab issues and merge requests", () => {
    assert.strictEqual(
      linkifyAutolinks("GL-124: fix #123 and !4", gitlabProvider),
      "[GL-124](https://gitlab.com/user/my-repo/-/issues/124): fix [#123](https://gitlab.com/user/my-repo/-/issues/123) and [!4](https://gitlab.com/user/my-repo/-/merge_requests/4)",
    )
  })

  test("should link Codeberg issues and pull requests", () => {
    assert.strictEqual(
      linkifyAutolinks(
        "Refs #123, !4, other/repo#5, and other/repo!6",
        codebergProvider,
      ),
      "Refs [#123](https://codeberg.org/user/my-repo/issues/123), [!4](https://codeberg.org/user/my-repo/pulls/4), [other/repo#5](https://codeberg.org/other/repo/issues/5), and [other/repo!6](https://codeberg.org/other/repo/pulls/6)",
    )
  })

  test("should not link provider-backed references without a provider", () => {
    assert.strictEqual(
      linkifyAutolinks("Fix #123 and https://example.com/x"),
      "Fix #123 and [https://example.com/x](https://example.com/x)",
    )
  })

  test("should not link inside code or existing links", () => {
    const input = [
      "`#123`",
      "[#456](https://example.com/456)",
      "```md",
      "#789",
      "```",
      "#999",
    ].join("\n")

    const actual = linkifyAutolinks(input, githubProvider)

    assert.ok(actual.includes("`#123`"))
    assert.ok(actual.includes("[#456](https://example.com/456)"))
    assert.ok(actual.includes("```md\n#789\n```"))
    assert.ok(
      actual.includes("[#999](https://github.com/user/my-repo/issues/999)"),
    )
  })

  test("should not link issue markers inside larger words", () => {
    assert.strictEqual(
      linkifyAutolinks("C#123 and abc#456", githubProvider),
      "C#123 and abc#456",
    )
  })
})
