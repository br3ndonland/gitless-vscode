import type { RemoteProviderInfo } from "./models"

export type RemoteResourceType =
  | "repo"
  | "commit"
  | "file"
  | "branch"
  | "tag"
  | "issue"
  | "pullRequest"

export interface RemoteResource {
  type: RemoteResourceType
  owner?: string
  repo?: string
  number?: string | number
  sha?: string
  branch?: string
  tag?: string
  fileName?: string
  range?: { start: number; end?: number }
}

export function getRemoteUrl(
  provider: RemoteProviderInfo,
  resource: RemoteResource,
): string | undefined {
  const baseUrl = getBaseUrl(provider, resource)
  if (!baseUrl) return undefined

  switch (resource.type) {
    case "repo":
      return baseUrl
    case "commit":
      return getCommitUrl(provider, baseUrl, resource.sha!)
    case "file":
      return getFileUrl(provider, baseUrl, resource)
    case "branch":
      return getBranchUrl(provider, baseUrl, resource.branch!)
    case "tag":
      return getTagUrl(provider, baseUrl, resource.tag!)
    case "issue":
      return getIssueUrl(provider, baseUrl, resource.number)
    case "pullRequest":
      return getPullRequestUrl(provider, baseUrl, resource.number)
    default:
      return undefined
  }
}

function getBaseUrl(
  provider: RemoteProviderInfo,
  resource?: RemoteResource,
): string {
  const owner = resource?.owner ?? provider.owner
  const repo = resource?.repo ?? provider.repo

  switch (provider.id) {
    case "azure-devops":
      return `https://${provider.domain}/${owner}/_git/${repo}`
    default:
      return `https://${provider.domain}/${owner}/${repo}`
  }
}

function getCommitUrl(
  provider: RemoteProviderInfo,
  baseUrl: string,
  sha: string,
): string {
  switch (provider.id) {
    case "azure-devops":
      return `${baseUrl}/commit/${sha}`
    default:
      return `${baseUrl}/commit/${sha}`
  }
}

function getFileUrl(
  provider: RemoteProviderInfo,
  baseUrl: string,
  resource: RemoteResource,
): string {
  const { sha, branch, tag, fileName, range } = resource

  const lineFragment = range ? getLineFragment(provider, range) : ""

  const ref = sha || branch || tag || "HEAD"

  switch (provider.id) {
    case "gitlab":
      return `${baseUrl}/-/blob/${ref}/${fileName}${lineFragment}`
    case "bitbucket":
      return `${baseUrl}/src/${ref}/${fileName}${lineFragment}`
    case "azure-devops": {
      const versionPrefix = tag ? "T" : branch ? "B" : "C"
      return `${baseUrl}?path=/${fileName}&version=G${versionPrefix}${ref}${lineFragment}`
    }
    case "forgejo":
      return `${baseUrl}/src/${sha ? "commit" : tag ? "tag" : "branch"}/${ref}/${fileName}${lineFragment}`
    case "github":
    default:
      return `${baseUrl}/blob/${ref}/${fileName}${lineFragment}`
  }
}

function getLineFragment(
  provider: RemoteProviderInfo,
  range: { start: number; end?: number },
): string {
  const { start, end } = range

  switch (provider.id) {
    case "gitlab":
      return end && end !== start ? `#L${start}-${end}` : `#L${start}`
    case "bitbucket":
      return end && end !== start ? `#lines-${start}:${end}` : `#lines-${start}`
    case "azure-devops":
      return end && end !== start
        ? `&line=${start}&lineEnd=${end}`
        : `&line=${start}`
    case "forgejo":
      return end && end !== start ? `#L${start}-L${end}` : `#L${start}`
    case "github":
    default:
      return end && end !== start ? `#L${start}-L${end}` : `#L${start}`
  }
}

function getBranchUrl(
  provider: RemoteProviderInfo,
  baseUrl: string,
  branch: string,
): string {
  switch (provider.id) {
    case "gitlab":
      return `${baseUrl}/-/tree/${encodeURIComponent(branch)}`
    case "bitbucket":
      return `${baseUrl}/branch/${encodeURIComponent(branch)}`
    case "azure-devops":
      return `${baseUrl}?version=GB${encodeURIComponent(branch)}`
    case "forgejo":
      return `${baseUrl}/src/branch/${encodeURIComponent(branch)}`
    case "github":
    default:
      return `${baseUrl}/tree/${encodeURIComponent(branch)}`
  }
}

function getTagUrl(
  provider: RemoteProviderInfo,
  baseUrl: string,
  tag: string,
): string {
  switch (provider.id) {
    case "gitlab":
      return `${baseUrl}/-/tags/${encodeURIComponent(tag)}`
    case "bitbucket":
      return `${baseUrl}/commits/tag/${encodeURIComponent(tag)}`
    case "azure-devops":
      return `${baseUrl}?version=GT${encodeURIComponent(tag)}`
    case "forgejo":
      return `${baseUrl}/src/tag/${encodeURIComponent(tag)}`
    case "github":
    default:
      return `${baseUrl}/releases/tag/${encodeURIComponent(tag)}`
  }
}

function getIssueUrl(
  provider: RemoteProviderInfo,
  baseUrl: string,
  number: string | number | undefined,
): string | undefined {
  if (number === undefined) return undefined

  switch (provider.id) {
    case "gitlab":
      return `${baseUrl}/-/issues/${number}`
    case "bitbucket":
      return `${baseUrl}/issues/${number}`
    case "forgejo":
      return `${baseUrl}/issues/${number}`
    case "github":
      return `${baseUrl}/issues/${number}`
    case "azure-devops":
    default:
      return undefined
  }
}

function getPullRequestUrl(
  provider: RemoteProviderInfo,
  baseUrl: string,
  number: string | number | undefined,
): string | undefined {
  if (number === undefined) return undefined

  switch (provider.id) {
    case "gitlab":
      return `${baseUrl}/-/merge_requests/${number}`
    case "bitbucket":
      return `${baseUrl}/pull-requests/${number}`
    case "azure-devops":
      return `${baseUrl}/pullrequest/${number}`
    case "forgejo":
      return `${baseUrl}/pulls/${number}`
    case "github":
    default:
      return `${baseUrl}/pull/${number}`
  }
}
