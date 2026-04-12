import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "@vscode/test-cli"

const rootPath = path.dirname(fileURLToPath(import.meta.url))
const fixtureWorkspacePath = path.join(rootPath, "tests/e2e/.tmp/workspace")
const fixtureRepoPath = path.join(fixtureWorkspacePath, "repo")
const fixtureMetadataPath = path.join(fixtureWorkspacePath, "metadata.json")

export default defineConfig({
  label: "e2e",
  files: "out/test/tests/e2e/specs/**/*.spec.js",
  workspaceFolder: fixtureRepoPath,
  env: {
    GITLESS_E2E_REPO: fixtureRepoPath,
    GITLESS_E2E_METADATA: fixtureMetadataPath,
  },
  launchArgs: [
    "--disable-workspace-trust",
    "--disable-telemetry",
    "--skip-release-notes",
    "--skip-welcome",
  ],
  mocha: {
    ui: "tdd",
    failZero: true,
    timeout: 60000,
  },
})
