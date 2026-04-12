import type { RemoteProviderInfo } from "./models"
import { getRemoteUrl } from "./remoteUrls"

interface TextRange {
  start: number
  end: number
}

type LinkTokenMap = Map<string, string>

const RAW_URL_REGEX = /\bhttps?:\/\/[^\s<>)\]]+/g
const CROSS_REPO_ISSUE_REGEX =
  /(^|[^\w/.-])([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)\b/g
const CROSS_REPO_PULL_REQUEST_REGEX =
  /(^|[^\w/.-])([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)!(\d+)\b/g
const GITHUB_ISSUE_REGEX = /(^|[^\w-])(GH-(\d+))\b/gi
const GITLAB_ISSUE_REGEX = /(^|[^\w-])(GL-(\d+))\b/gi
const ISSUE_REGEX = /(^|[^\w/#])#(\d+)\b/g
const PULL_REQUEST_REGEX = /(^|[^\w!])!(\d+)\b/g
const CROSS_REPO_SHA_REGEX =
  /(^|[^\w/.-])([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@([0-9a-f]{7,40})\b/gi
const USER_SHA_REGEX = /(^|[^\w/.-])([A-Za-z0-9_.-]+@[0-9a-f]{7,40})\b/gi
const BARE_SHA_REGEX = /(^|[^\w])([0-9a-f]{7,40})\b/gi
const TRAILING_URL_PUNCTUATION_REGEX = /[.,;:!?]+$/

export function linkifyAutolinks(
  text: string,
  provider?: RemoteProviderInfo,
): string {
  if (!text) return text

  const protectedRanges = collectProtectedRanges(text)
  if (protectedRanges.length === 0) return linkifyPlainText(text, provider)

  let result = ""
  let offset = 0

  for (const range of protectedRanges) {
    if (offset < range.start) {
      result += linkifyPlainText(text.slice(offset, range.start), provider)
    }
    result += text.slice(range.start, range.end)
    offset = range.end
  }

  if (offset < text.length) {
    result += linkifyPlainText(text.slice(offset), provider)
  }

  return result
}

function collectProtectedRanges(text: string): TextRange[] {
  return mergeRanges([
    ...collectFencedCodeRanges(text),
    ...collectInlineCodeRanges(text),
    ...collectMarkdownLinkRanges(text),
  ])
}

function collectFencedCodeRanges(text: string): TextRange[] {
  const ranges: TextRange[] = []
  const lineRegex = /.*(?:\n|$)/g
  let openStart: number | undefined
  let openMarker: string | undefined
  let match: RegExpExecArray | null

  while ((match = lineRegex.exec(text))) {
    const line = match[0]
    if (!line) break

    const markerMatch = line.match(/^[ \t]*(`{3,}|~{3,})/)
    if (markerMatch) {
      const marker = markerMatch[1]
      if (openStart === undefined) {
        openStart = match.index
        openMarker = marker
      } else if (
        openMarker &&
        marker[0] === openMarker[0] &&
        marker.length >= openMarker.length
      ) {
        ranges.push({ start: openStart, end: match.index + line.length })
        openStart = undefined
        openMarker = undefined
      }
    }

    if (lineRegex.lastIndex === match.index) lineRegex.lastIndex++
  }

  if (openStart !== undefined)
    ranges.push({ start: openStart, end: text.length })

  return ranges
}

function collectInlineCodeRanges(text: string): TextRange[] {
  const ranges: TextRange[] = []
  const regex = /(`+)([^`\n]|`(?!\1))*?\1/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(text))) {
    ranges.push({ start: match.index, end: match.index + match[0].length })
  }

  return ranges
}

function collectMarkdownLinkRanges(text: string): TextRange[] {
  const ranges: TextRange[] = []
  const regex = /!?\[[^\]\n]*\]\([^)]+\)/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(text))) {
    ranges.push({ start: match.index, end: match.index + match[0].length })
  }

  return ranges
}

function mergeRanges(ranges: TextRange[]): TextRange[] {
  if (ranges.length === 0) return []

  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: TextRange[] = [sorted[0]]

  for (const range of sorted.slice(1)) {
    const previous = merged[merged.length - 1]
    if (range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end)
    } else {
      merged.push({ ...range })
    }
  }

  return merged
}

function linkifyPlainText(
  text: string,
  provider: RemoteProviderInfo | undefined,
): string {
  const tokens: LinkTokenMap = new Map()
  let result = linkifyRawUrls(text, tokens)

  if (provider) {
    result = linkifyIssues(result, provider, tokens)
    result = linkifyPullRequests(result, provider, tokens)
    result = linkifyShas(result, provider, tokens)
  }

  return restoreTokens(result, tokens)
}

function linkifyRawUrls(text: string, tokens: LinkTokenMap): string {
  return text.replace(RAW_URL_REGEX, (rawUrl) => {
    const trailing = rawUrl.match(TRAILING_URL_PUNCTUATION_REGEX)?.[0] ?? ""
    const url = trailing ? rawUrl.slice(0, -trailing.length) : rawUrl
    return createToken(tokens, markdownLink(url, url)) + trailing
  })
}

function linkifyIssues(
  text: string,
  provider: RemoteProviderInfo,
  tokens: LinkTokenMap,
): string {
  let result = text.replace(
    CROSS_REPO_ISSUE_REGEX,
    (match, prefix: string, repoRef: string, number: string) => {
      const repo = parseRepoReference(repoRef)
      const url =
        repo && supportsIssues(provider)
          ? getRemoteUrl(provider, {
              type: "issue",
              owner: repo.owner,
              repo: repo.repo,
              number,
            })
          : undefined
      return url
        ? `${prefix}${createToken(tokens, markdownLink(repoRef + "#" + number, url))}`
        : match
    },
  )

  if (provider.id === "github") {
    result = result.replace(
      GITHUB_ISSUE_REGEX,
      (match, prefix: string, linkText: string, number: string) => {
        const url = getRemoteUrl(provider, { type: "issue", number })
        return url
          ? `${prefix}${createToken(tokens, markdownLink(linkText, url))}`
          : match
      },
    )
  }

  if (provider.id === "gitlab") {
    result = result.replace(
      GITLAB_ISSUE_REGEX,
      (match, prefix: string, linkText: string, number: string) => {
        const url = getRemoteUrl(provider, { type: "issue", number })
        return url
          ? `${prefix}${createToken(tokens, markdownLink(linkText, url))}`
          : match
      },
    )
  }

  if (supportsIssues(provider)) {
    result = result.replace(
      ISSUE_REGEX,
      (match, prefix: string, number: string) => {
        const linkText = `#${number}`
        const url = getRemoteUrl(provider, { type: "issue", number })
        return url
          ? `${prefix}${createToken(tokens, markdownLink(linkText, url))}`
          : match
      },
    )
  }

  return result
}

function linkifyPullRequests(
  text: string,
  provider: RemoteProviderInfo,
  tokens: LinkTokenMap,
): string {
  if (!supportsPullRequestMarkers(provider)) return text

  let result = text.replace(
    CROSS_REPO_PULL_REQUEST_REGEX,
    (match, prefix: string, repoRef: string, number: string) => {
      const repo = parseRepoReference(repoRef)
      const url = repo
        ? getRemoteUrl(provider, {
            type: "pullRequest",
            owner: repo.owner,
            repo: repo.repo,
            number,
          })
        : undefined
      return url
        ? `${prefix}${createToken(tokens, markdownLink(repoRef + "!" + number, url))}`
        : match
    },
  )

  result = result.replace(
    PULL_REQUEST_REGEX,
    (match, prefix: string, number: string) => {
      const linkText = `!${number}`
      const url = getRemoteUrl(provider, { type: "pullRequest", number })
      return url
        ? `${prefix}${createToken(tokens, markdownLink(linkText, url))}`
        : match
    },
  )

  return result
}

function linkifyShas(
  text: string,
  provider: RemoteProviderInfo,
  tokens: LinkTokenMap,
): string {
  let result = text.replace(
    CROSS_REPO_SHA_REGEX,
    (match, prefix: string, repoRef: string, sha: string) => {
      const repo = parseRepoReference(repoRef)
      const url = repo
        ? getRemoteUrl(provider, {
            type: "commit",
            owner: repo.owner,
            repo: repo.repo,
            sha,
          })
        : undefined
      return url
        ? `${prefix}${createToken(tokens, markdownLink(repoRef + "@" + sha, url))}`
        : match
    },
  )

  result = result.replace(
    USER_SHA_REGEX,
    (match, prefix: string, linkText: string) => {
      const [, sha] = linkText.split("@")
      const url = getRemoteUrl(provider, { type: "commit", sha })
      return url
        ? `${prefix}${createToken(tokens, markdownLink(linkText, url))}`
        : match
    },
  )

  result = result.replace(
    BARE_SHA_REGEX,
    (match, prefix: string, sha: string) => {
      const url = getRemoteUrl(provider, { type: "commit", sha })
      return url
        ? `${prefix}${createToken(tokens, markdownLink(sha, url))}`
        : match
    },
  )

  return result
}

function supportsIssues(provider: RemoteProviderInfo): boolean {
  return provider.id !== "azure-devops"
}

function supportsPullRequestMarkers(provider: RemoteProviderInfo): boolean {
  return provider.id === "gitlab" || provider.id === "forgejo"
}

function parseRepoReference(
  value: string,
): { owner: string; repo: string } | undefined {
  const [owner, repo] = value.split("/")
  return owner && repo ? { owner, repo } : undefined
}

function createToken(tokens: LinkTokenMap, replacement: string): string {
  const token = `\0${tokens.size}\0`
  tokens.set(token, replacement)
  return token
}

function restoreTokens(text: string, tokens: LinkTokenMap): string {
  let result = text
  for (const [token, replacement] of tokens) {
    result = result.split(token).join(replacement)
  }
  return result
}

function markdownLink(text: string, url: string): string {
  return `[${escapeMarkdownLinkText(text)}](${escapeMarkdownUrl(url)})`
}

function escapeMarkdownLinkText(text: string): string {
  return text.replace(/[\\[\]]/g, "\\$&")
}

function escapeMarkdownUrl(url: string): string {
  return url.replace(/\)/g, "%29")
}
