import * as assert from "node:assert"
import { suite, test } from "mocha"
import { getRemoteUrl } from "../git/remoteUrls"
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

const bitbucketProvider: RemoteProviderInfo = {
  id: "bitbucket",
  name: "Bitbucket",
  domain: "bitbucket.org",
  owner: "user",
  repo: "my-repo",
}

const azureProvider: RemoteProviderInfo = {
  id: "azure-devops",
  name: "Azure DevOps",
  domain: "dev.azure.com",
  owner: "org",
  repo: "my-repo",
}

const giteaProvider: RemoteProviderInfo = {
  id: "gitea",
  name: "Gitea",
  domain: "codeberg.org",
  owner: "user",
  repo: "my-repo",
}

suite("Remote URLs", () => {
  suite("Repo URLs", () => {
    test("GitHub repo URL", () => {
      const url = getRemoteUrl(githubProvider, { type: "repo" })
      assert.strictEqual(url, "https://github.com/user/my-repo")
    })

    test("GitLab repo URL", () => {
      const url = getRemoteUrl(gitlabProvider, { type: "repo" })
      assert.strictEqual(url, "https://gitlab.com/user/my-repo")
    })

    test("Azure DevOps repo URL", () => {
      const url = getRemoteUrl(azureProvider, { type: "repo" })
      assert.strictEqual(url, "https://dev.azure.com/org/_git/my-repo")
    })
  })

  suite("Commit URLs", () => {
    test("GitHub commit URL", () => {
      const url = getRemoteUrl(githubProvider, {
        type: "commit",
        sha: "abc123",
      })
      assert.strictEqual(url, "https://github.com/user/my-repo/commit/abc123")
    })

    test("GitLab commit URL", () => {
      const url = getRemoteUrl(gitlabProvider, {
        type: "commit",
        sha: "abc123",
      })
      assert.strictEqual(url, "https://gitlab.com/user/my-repo/commit/abc123")
    })
  })

  suite("File URLs", () => {
    test("GitHub file URL with branch", () => {
      const url = getRemoteUrl(githubProvider, {
        type: "file",
        fileName: "src/index.ts",
        branch: "main",
      })
      assert.strictEqual(
        url,
        "https://github.com/user/my-repo/blob/main/src/index.ts",
      )
    })

    test("GitHub file URL with SHA", () => {
      const url = getRemoteUrl(githubProvider, {
        type: "file",
        fileName: "src/index.ts",
        sha: "abc123",
      })
      assert.strictEqual(
        url,
        "https://github.com/user/my-repo/blob/abc123/src/index.ts",
      )
    })

    test("GitHub file URL with line range", () => {
      const url = getRemoteUrl(githubProvider, {
        type: "file",
        fileName: "src/index.ts",
        branch: "main",
        range: { start: 10, end: 20 },
      })
      assert.strictEqual(
        url,
        "https://github.com/user/my-repo/blob/main/src/index.ts#L10-L20",
      )
    })

    test("GitHub file URL with single line", () => {
      const url = getRemoteUrl(githubProvider, {
        type: "file",
        fileName: "src/index.ts",
        branch: "main",
        range: { start: 42 },
      })
      assert.strictEqual(
        url,
        "https://github.com/user/my-repo/blob/main/src/index.ts#L42",
      )
    })

    test("GitLab file URL", () => {
      const url = getRemoteUrl(gitlabProvider, {
        type: "file",
        fileName: "src/index.ts",
        branch: "main",
      })
      assert.strictEqual(
        url,
        "https://gitlab.com/user/my-repo/-/blob/main/src/index.ts",
      )
    })

    test("Bitbucket file URL", () => {
      const url = getRemoteUrl(bitbucketProvider, {
        type: "file",
        fileName: "src/index.ts",
        branch: "main",
      })
      assert.strictEqual(
        url,
        "https://bitbucket.org/user/my-repo/src/main/src/index.ts",
      )
    })

    test("Gitea file URL with branch", () => {
      const url = getRemoteUrl(giteaProvider, {
        type: "file",
        fileName: "src/index.ts",
        branch: "main",
      })
      assert.strictEqual(
        url,
        "https://codeberg.org/user/my-repo/src/branch/main/src/index.ts",
      )
    })

    test("Gitea file URL with SHA", () => {
      const url = getRemoteUrl(giteaProvider, {
        type: "file",
        fileName: "src/index.ts",
        sha: "abc123",
      })
      assert.strictEqual(
        url,
        "https://codeberg.org/user/my-repo/src/commit/abc123/src/index.ts",
      )
    })

    test("GitLab line range format", () => {
      const url = getRemoteUrl(gitlabProvider, {
        type: "file",
        fileName: "src/index.ts",
        branch: "main",
        range: { start: 10, end: 20 },
      })
      assert.strictEqual(
        url,
        "https://gitlab.com/user/my-repo/-/blob/main/src/index.ts#L10-20",
      )
    })

    test("Bitbucket line range format", () => {
      const url = getRemoteUrl(bitbucketProvider, {
        type: "file",
        fileName: "src/index.ts",
        branch: "main",
        range: { start: 10, end: 20 },
      })
      assert.strictEqual(
        url,
        "https://bitbucket.org/user/my-repo/src/main/src/index.ts#lines-10:20",
      )
    })
  })

  suite("Branch URLs", () => {
    test("GitHub branch URL", () => {
      const url = getRemoteUrl(githubProvider, {
        type: "branch",
        branch: "feature/my-branch",
      })
      assert.strictEqual(
        url,
        "https://github.com/user/my-repo/tree/feature%2Fmy-branch",
      )
    })

    test("GitLab branch URL", () => {
      const url = getRemoteUrl(gitlabProvider, {
        type: "branch",
        branch: "main",
      })
      assert.strictEqual(url, "https://gitlab.com/user/my-repo/-/tree/main")
    })
  })

  suite("Tag URLs", () => {
    test("GitHub tag URL", () => {
      const url = getRemoteUrl(githubProvider, {
        type: "tag",
        tag: "v1.0.0",
      })
      assert.strictEqual(
        url,
        "https://github.com/user/my-repo/releases/tag/v1.0.0",
      )
    })

    test("GitLab tag URL", () => {
      const url = getRemoteUrl(gitlabProvider, {
        type: "tag",
        tag: "v1.0.0",
      })
      assert.strictEqual(url, "https://gitlab.com/user/my-repo/-/tags/v1.0.0")
    })

    test("Bitbucket tag URL", () => {
      const url = getRemoteUrl(bitbucketProvider, {
        type: "tag",
        tag: "v1.0.0",
      })
      assert.strictEqual(
        url,
        "https://bitbucket.org/user/my-repo/commits/tag/v1.0.0",
      )
    })
  })
})
