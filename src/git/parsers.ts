import type {
  GitCommit,
  GitBranch,
  GitRemote,
  GitTag,
  GitStash,
  GitWorktree,
  GitFile,
  GitFileStatus,
} from "./models"

const COMMIT_FORMAT =
  "%H%n%h%n%P%n%an%n%ae%n%aI%n%cn%n%ce%n%cI%n%B%n<<END_COMMIT>>"

// Separator for ref-filter format commands (git branch, git tag).
// These commands don't support %x00 for null bytes like git-log does,
// so we use a unique text delimiter instead.
const SEP = "<|>"

export function getLogFormat(): string {
  return COMMIT_FORMAT
}

export function parseCommits(output: string): GitCommit[] {
  const commits: GitCommit[] = []
  const chunks = output.split("<<END_COMMIT>>").filter((c) => c.trim())

  for (const chunk of chunks) {
    // Strip diff output that git log -L inserts between commits.
    // Find the first line that looks like a full SHA (40 hex chars).
    const rawLines = chunk.trim().split("\n")
    let startIndex = 0
    for (let i = 0; i < rawLines.length; i++) {
      if (/^[0-9a-f]{40}$/.test(rawLines[i].trim())) {
        startIndex = i
        break
      }
    }
    const lines = rawLines.slice(startIndex)
    if (lines.length < 9) continue

    const sha = lines[0].trim()
    const shortSha = lines[1]
    const parents = lines[2] ? lines[2].split(" ") : []
    const authorName = lines[3]
    const authorEmail = lines[4]
    const authorDate = new Date(lines[5])
    const committerName = lines[6]
    const committerEmail = lines[7]
    const committerDate = new Date(lines[8])
    const message = lines.slice(9).join("\n").trim()
    const summary = message.split("\n")[0]

    commits.push({
      sha,
      shortSha,
      message,
      summary,
      author: { name: authorName, email: authorEmail, date: authorDate },
      committer: {
        name: committerName,
        email: committerEmail,
        date: committerDate,
      },
      date: authorDate,
      parents,
    })
  }

  return commits
}

export function parseBranches(output: string): GitBranch[] {
  const branches: GitBranch[] = []
  const lines = output.trim().split("\n").filter(Boolean)

  for (const line of lines) {
    const parts = line.split(SEP)
    if (parts.length < 4) continue

    const current = parts[0] === "*"
    const name = parts[1]
    const sha = parts[2]
    const upstream = parts[3] || undefined
    const date = parts[5] ? new Date(parts[5]) : undefined

    branches.push({
      name,
      remote: false,
      current,
      upstream: upstream
        ? { name: upstream, missing: parts[4]?.includes("gone") ?? false }
        : undefined,
      sha,
      date,
    })
  }

  return branches
}

export function parseRemoteBranches(output: string): GitBranch[] {
  const branches: GitBranch[] = []
  const lines = output.trim().split("\n").filter(Boolean)

  for (const line of lines) {
    const parts = line.split(SEP)
    if (parts.length < 3) continue

    const sha = parts[1]
    const date = parts[2] ? new Date(parts[2]) : undefined

    branches.push({
      name: parts[0],
      remote: true,
      current: false,
      sha,
      date,
    })
  }

  return branches
}

export function parseRemotes(output: string): GitRemote[] {
  const remoteMap = new Map<string, GitRemote>()
  const lines = output.trim().split("\n").filter(Boolean)

  for (const line of lines) {
    const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/)
    if (!match) continue

    const [, name, url, type] = match
    let remote = remoteMap.get(name)
    if (!remote) {
      remote = { name, url, provider: parseRemoteProvider(url) }
      remoteMap.set(name, remote)
    }

    if (type === "fetch") remote.fetchUrl = url
    if (type === "push") remote.pushUrl = url
  }

  return Array.from(remoteMap.values())
}

export function parseRemoteProvider(
  url: string,
): import("./models").RemoteProviderInfo | undefined {
  // Parse SSH URLs: git@github.com:owner/repo.git
  let match = url.match(/^git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/)
  if (match) {
    const [, domain, owner, repo] = match
    const id = identifyProvider(domain)
    if (id) {
      return {
        id,
        name: providerName(id),
        domain,
        owner,
        repo,
      }
    }
  }

  // Parse HTTPS URLs: https://github.com/owner/repo.git
  match = url.match(/^https?:\/\/([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/)
  if (match) {
    const [, domain, owner, repo] = match
    const id = identifyProvider(domain)
    if (id) {
      return {
        id,
        name: providerName(id),
        domain,
        owner,
        repo,
      }
    }
  }

  return undefined
}

function identifyProvider(
  domain: string,
): import("./models").RemoteProviderId | undefined {
  if (domain.includes("github")) return "github"
  if (domain.includes("gitlab")) return "gitlab"
  if (domain.includes("bitbucket")) return "bitbucket"
  if (domain.includes("dev.azure") || domain.includes("visualstudio"))
    return "azure-devops"
  if (domain.includes("gitea") || domain.includes("codeberg")) return "gitea"
  return undefined
}

function providerName(id: import("./models").RemoteProviderId): string {
  switch (id) {
    case "github":
      return "GitHub"
    case "gitlab":
      return "GitLab"
    case "bitbucket":
      return "Bitbucket"
    case "azure-devops":
      return "Azure DevOps"
    case "gitea":
      return "Gitea"
  }
}

export function parseTags(output: string): GitTag[] {
  const tags: GitTag[] = []
  const entries = output.split("<<END_TAG>>").filter((e) => e.trim())

  for (const entry of entries) {
    const lines = entry.trim().split("\n")
    if (lines.length < 1) continue

    const firstLine = lines[0]
    const parts = firstLine.split(SEP)
    if (parts.length < 4) continue

    const name = parts[0]
    const sha = parts[2] || parts[1] // *objectname (dereferenced) or objectname
    const date = parts[3] ? new Date(parts[3]) : undefined
    const message =
      parts.slice(4).join(SEP).trim() +
      (lines.length > 1 ? "\n" + lines.slice(1).join("\n") : "")

    tags.push({
      name,
      sha,
      message: message || undefined,
      date,
      annotation: message || undefined,
    })
  }

  return tags
}

export function parseStashes(output: string): GitStash[] {
  const stashes: GitStash[] = []
  const lines = output.trim().split("\n").filter(Boolean)

  for (const line of lines) {
    // Format: stash@{0}%00sha%00date%00name%00email%00message
    const parts = line.split("\0")
    if (parts.length < 6) continue

    const indexMatch = parts[0].match(/stash@\{(\d+)\}/)
    if (!indexMatch) continue

    stashes.push({
      index: parseInt(indexMatch[1], 10),
      sha: parts[1],
      date: new Date(parts[2]),
      author: { name: parts[3], email: parts[4], date: new Date(parts[2]) },
      message: parts[5],
    })
  }

  return stashes
}

export function parseWorktrees(output: string): GitWorktree[] {
  const worktrees: GitWorktree[] = []
  let current: Partial<GitWorktree> | undefined

  const lines = output.trim().split("\n")

  for (const line of lines) {
    if (line.startsWith("worktree ")) {
      if (current?.path) {
        worktrees.push(current as GitWorktree)
      }
      current = {
        path: line.slice("worktree ".length),
        bare: false,
        main: false,
        locked: false,
        prunable: false,
      }
    } else if (line.startsWith("HEAD ") && current) {
      current.sha = line.slice("HEAD ".length)
    } else if (line.startsWith("branch ") && current) {
      current.branch = line.slice("branch ".length).replace("refs/heads/", "")
    } else if (line === "bare" && current) {
      current.bare = true
    } else if (line === "locked" && current) {
      current.locked = true
    } else if (line === "prunable" && current) {
      current.prunable = true
    } else if (line === "" && current?.path) {
      // empty line separates worktree entries
    }
  }

  if (current?.path) {
    worktrees.push(current as GitWorktree)
  }

  // First worktree is the main one
  if (worktrees.length > 0) {
    worktrees[0].main = true
  }

  return worktrees
}

export function parseFiles(output: string): GitFile[] {
  const files: GitFile[] = []
  const lines = output.trim().split("\n").filter(Boolean)

  for (const line of lines) {
    // Format from --name-status: STATUS\tPATH or STATUS\tOLD_PATH\tNEW_PATH
    const parts = line.split("\t")
    if (parts.length < 2) continue

    const statusChar = parts[0][0]
    const status = mapFileStatus(statusChar)
    const path = parts.length > 2 ? parts[2] : parts[1]
    const originalPath = parts.length > 2 ? parts[1] : undefined

    files.push({ path, originalPath, status })
  }

  return files
}

function mapFileStatus(char: string): GitFileStatus {
  switch (char) {
    case "A":
      return "added"
    case "M":
      return "modified"
    case "D":
      return "deleted"
    case "R":
      return "renamed"
    case "C":
      return "copied"
    default:
      return "modified"
  }
}
