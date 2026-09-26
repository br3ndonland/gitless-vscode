import * as path from "node:path"
import type { Commit, Remote, Repository } from "../types/vscode.git"
import { shortenSha } from "../config"
import type { GitCommit, GitRemote, GitRepository } from "./models"
import { parseRemoteProvider } from "./parsers"

// RefType.Head from the pinned declarations. Declaration files have no runtime exports.
const HEAD_REF_TYPE = 0

export function getHeadBranch(repository: Repository): string | undefined {
  const head = repository.state.HEAD
  return head?.type === HEAD_REF_TYPE ? head.name : undefined
}

export function mapRepository(
  repository: Repository,
  workspaceFolderName?: string,
): GitRepository {
  const rootPath = repository.rootUri.fsPath
  return {
    path: rootPath,
    rootUri: repository.rootUri.toString(),
    label: path.basename(rootPath) || rootPath,
    workspaceFolderName,
    headSha: repository.state.HEAD?.commit,
    headBranch: getHeadBranch(repository),
  }
}

export function mapCommit(commit: Commit): GitCommit {
  // Git supplies authorDate, but the public API marks metadata as optional.
  // Reject incomplete results instead of displaying an invented timestamp.
  if (!commit.authorDate) {
    throw new Error(`Missing author date for commit ${commit.hash}`)
  }
  const message = commit.message.trim()
  return {
    sha: commit.hash,
    shortSha: shortenSha(commit.hash),
    message,
    summary: message.split("\n")[0],
    author: {
      name: commit.authorName ?? "",
      email: commit.authorEmail ?? "",
      date: commit.authorDate,
    },
    date: commit.authorDate,
    parents: [...commit.parents],
  }
}

export function mapRemote(remote: Remote): GitRemote | undefined {
  const url = remote.fetchUrl ?? remote.pushUrl
  if (!url) return undefined
  return {
    name: remote.name,
    url,
    fetchUrl: remote.fetchUrl,
    pushUrl: remote.pushUrl,
    provider: parseRemoteProvider(url),
  }
}
