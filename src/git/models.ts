export interface GitCommit {
  sha: string
  shortSha: string
  message: string
  summary: string // first line of message
  author: GitAuthor
  committer: GitAuthor
  date: Date
  parents: string[]
}

export interface GitAuthor {
  name: string
  email: string
  date: Date
}

export interface GitBranchUpstream {
  name: string
  missing: boolean
  ahead: number
  behind: number
}

export interface GitBranch {
  name: string
  remote: boolean
  current: boolean
  upstream?: GitBranchUpstream
  sha?: string
  date?: Date
}

export interface GitRemote {
  name: string
  url: string
  fetchUrl?: string
  pushUrl?: string
  provider?: RemoteProviderInfo
}

export interface RemoteProviderInfo {
  id: RemoteProviderId
  name: string
  domain: string
  owner: string
  repo: string
}

export type RemoteProviderId =
  | "github"
  | "gitlab"
  | "bitbucket"
  | "azure-devops"
  | "gitea"

export interface GitTag {
  name: string
  sha: string
  message?: string
  date?: Date
  tagger?: GitAuthor
  annotation?: string
}

export interface GitStash {
  index: number
  sha: string
  message: string
  date: Date
  author: GitAuthor
}

export interface GitWorktree {
  path: string
  sha?: string
  branch?: string
  bare: boolean
  main: boolean
  locked: boolean
  prunable: boolean
}

export interface GitFile {
  path: string
  originalPath?: string
  status: GitFileStatus
}

export type GitFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"

export interface GitDiff {
  files: GitFile[]
  stats?: { additions: number; deletions: number; changed: number }
}

export interface GitRepository {
  path: string
  rootUri: string
  headSha?: string
  headBranch?: string
}
