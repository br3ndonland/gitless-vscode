import { defineConfig } from "@vscode/test-cli"

export default defineConfig({
  files: "out/test/src/__tests__/**/*.test.js",
  mocha: {
    ui: "tdd",
    failZero: true,
    timeout: 20000,
  },
})
