import type { RemoteProviderInfo } from "./models"

export type RemoteResourceType = "repo" | "commit" | "file" | "branch" | "tag"

export interface RemoteResource {
  type: RemoteResourceType
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
  const baseUrl = getBaseUrl(provider)
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
    default:
      return undefined
  }
}

function getBaseUrl(provider: RemoteProviderInfo): string {
  switch (provider.id) {
    case "azure-devops":
      return `https://${provider.domain}/${provider.owner}/_git/${provider.repo}`
    default:
      return `https://${provider.domain}/${provider.owner}/${provider.repo}`
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
  const { sha, branch, fileName, range } = resource

  const lineFragment = range ? getLineFragment(provider, range) : ""

  const ref = sha || branch || "HEAD"

  switch (provider.id) {
    case "gitlab":
      return `${baseUrl}/-/blob/${ref}/${fileName}${lineFragment}`
    case "bitbucket":
      return `${baseUrl}/src/${ref}/${fileName}${lineFragment}`
    case "azure-devops":
      return `${baseUrl}?path=/${fileName}&version=G${ref.startsWith("refs/") ? ref : `C${ref}`}${lineFragment}`
    case "gitea":
      return `${baseUrl}/src/${sha ? "commit" : "branch"}/${ref}/${fileName}${lineFragment}`
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
    case "gitea":
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
    case "gitea":
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
    case "gitea":
      return `${baseUrl}/releases/tag/${encodeURIComponent(tag)}`
    case "github":
    default:
      return `${baseUrl}/releases/tag/${encodeURIComponent(tag)}`
  }
}
