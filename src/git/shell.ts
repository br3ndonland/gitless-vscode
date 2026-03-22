import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export interface GitExecOptions {
  cwd: string
  env?: Record<string, string>
  timeout?: number
  maxBuffer?: number
}

export async function gitExec(
  args: string[],
  options: GitExecOptions,
): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env, GIT_TERMINAL_PROMPT: "0" },
    timeout: options.timeout ?? 60000,
    maxBuffer: options.maxBuffer ?? 100 * 1024 * 1024,
  })
  return stdout
}

export async function findGitPath(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("which", ["git"])
    return stdout.trim()
  } catch {
    return undefined
  }
}
