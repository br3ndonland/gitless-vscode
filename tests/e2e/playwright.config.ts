import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./specs",
  timeout: 60000,
  retries: 1,
  use: {
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "vscode",
      use: {},
    },
  ],
})
