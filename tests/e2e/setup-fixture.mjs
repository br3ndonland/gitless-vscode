import { execFile } from "node:child_process"
import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const workspacePath = path.resolve("tests/e2e/.tmp/workspace")
const repoPath = path.join(workspacePath, "repo")
const metadataPath = path.join(workspacePath, "metadata.json")
const fixtureFile = "fixture.txt"
const remoteBaseUrl = "https://github.com/br3ndonland/gitless-vscode"

async function git(args, options = {}) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repoPath,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      ...options.env,
    },
  })
  return options.trim === false ? stdout : stdout.trim()
}

async function commit(message, date) {
  await git(["commit", "-m", message], {
    env: {
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    },
  })
}

await rm(workspacePath, { recursive: true, force: true })
await mkdir(repoPath, { recursive: true })

await git(["init"])
await git(["checkout", "-b", "main"])
await git(["config", "user.name", "GitLess E2E"])
await git(["config", "user.email", "gitless-e2e@example.com"])
await git(["config", "core.autocrlf", "false"])
await git(["config", "commit.gpgSign", "false"])
await git(["config", "tag.gpgSign", "false"])

await writeFile(path.join(repoPath, fixtureFile), "alpha\nbravo\n")
await git(["add", fixtureFile])
await commit("Initial fixture commit", "2024-01-01T00:00:00Z")
const initialSha = await git(["rev-parse", "HEAD"])
const initialFileContent = await git(["show", `${initialSha}:${fixtureFile}`], {
  trim: false,
})

await git(["tag", "--no-sign", "v1.0.0"])
await writeFile(path.join(repoPath, fixtureFile), "alpha\nbravo\ncharlie\n")
await git(["add", fixtureFile])
await commit("Add charlie marker", "2024-01-02T00:00:00Z")
await git(["branch", "feature/e2e"])
await git(["remote", "add", "origin", remoteBaseUrl])

const headSha = await git(["rev-parse", "HEAD"])
const branch = await git(["branch", "--show-current"])

await writeFile(
  metadataPath,
  JSON.stringify(
    {
      repoPath,
      fixtureFile,
      remoteBaseUrl,
      initialSha,
      initialFileContent,
      headSha,
      branch,
    },
    null,
    2,
  ) + "\n",
)
