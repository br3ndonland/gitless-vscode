import * as vscode from "vscode"
import dayjs from "dayjs"

const EXTENSION_PREFIX = "gitless"

let shortShaLength = 7

type DateStyle = "relative" | "absolute"

export interface DateFormatOptions {
  style?: DateStyle
  format?: string | null
}

export function getConfig<T>(key: string): T | undefined {
  return vscode.workspace.getConfiguration(EXTENSION_PREFIX).get<T>(key)
}

export function getShortShaLength(): number {
  return shortShaLength
}

export function updateShortShaLength(): void {
  const configured = getConfig<number>("shortShaLength")
  shortShaLength = Math.max(5, Math.min(40, configured ?? 7))
}

export function shortenSha(sha: string): string {
  return sha.slice(0, shortShaLength)
}

export function formatDate(
  date: Date,
  options: DateFormatOptions = {},
): string {
  const format = normalizeDateFormat(
    options.format === undefined
      ? getConfig<string | null>("defaultDateFormat")
      : options.format,
  )

  if (format) return dayjs(date).format(format)

  const style =
    options.style ?? normalizeDateStyle(getConfig<string>("defaultDateStyle"))
  return style === "absolute" ? date.toLocaleString() : formatRelativeDate(date)
}

export function onConfigurationChanged(
  callback: (e: vscode.ConfigurationChangeEvent) => void,
): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration(EXTENSION_PREFIX)) {
      callback(e)
    }
  })
}

function normalizeDateStyle(value: string | undefined): DateStyle {
  return value === "absolute" ? "absolute" : "relative"
}

function normalizeDateFormat(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function formatRelativeDate(date: Date): string {
  const now = Date.now()
  const diff = now - date.getTime()
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  const weeks = Math.floor(days / 7)
  const months = Math.floor(days / 30)
  const years = Math.floor(days / 365)

  if (years > 0) return `${years}y ago`
  if (months > 0) return `${months}mo ago`
  if (weeks > 0) return `${weeks}w ago`
  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  return "just now"
}
