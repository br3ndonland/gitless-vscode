import { spawn } from "node:child_process"
import { rm } from "node:fs/promises"
import path from "node:path"

const tempPath = path.resolve("tests/e2e/.tmp")

let exitCode = 0

try {
  await runCommand(process.execPath, ["tests/e2e/setup-fixture.mjs"])
  await runCommand("tsc", ["-p", "tsconfig.test.json"])
  await runCommand("vscode-test", ["--config", ".vscode-test.e2e.mjs"])
} catch (err) {
  exitCode = 1
  console.error(err instanceof Error ? err.message : String(err))
} finally {
  await rm(tempPath, { recursive: true, force: true })
}

process.exitCode = exitCode

async function runCommand(command, args) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: process.platform === "win32" && command !== process.execPath,
      stdio: "inherit",
    })

    child.on("error", reject)
    child.on("exit", (code, signal) => resolve({ code, signal }))
  })

  if (result.code === 0) return

  const reason =
    result.signal === null
      ? `exit code ${result.code ?? 1}`
      : `signal ${result.signal}`
  throw new Error(`${command} ${args.join(" ")} failed with ${reason}`)
}
