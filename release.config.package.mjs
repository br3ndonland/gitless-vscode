/** @type {import('semantic-release').GlobalConfig} */
export default {
  branches: ["main"],
  plugins: [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    [
      "@semantic-release/changelog",
      {
        changelogTitle: "# Changelog",
      },
    ],
    [
      "@semantic-release/exec",
      {
        prepareCmd: "pnpm run format:changelog",
      },
    ],
    [
      "semantic-release-vsce",
      {
        packageVsix: true,
        publish: false,
      },
    ],
  ],
  tagFormat: "${version}",
}
