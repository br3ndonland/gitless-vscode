# GitLess

[![Open VSX Version](https://img.shields.io/open-vsx/v/br3ndonland/gitless-vscode?style=flat-square&color=%23C160EF)](https://open-vsx.org/extension/br3ndonland/gitless-vscode)
[![VSCode marketplace](https://img.shields.io/badge/br3ndonland.gitless-vscode?style=flat-square&label=vscode&color=blue)](https://marketplace.visualstudio.com/items?itemName=br3ndonland.gitless-vscode)

Git in VSCode with less bloat.

GitLess is a minimal VSCode extension for Git integration. The built-in Git features don't do enough, but other extensions do too much. GitLess provides a focused set of features for everyday Git workflows.

## Features

### Command Palette

Access these commands from the VSCode command palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command                              | Description                                    |
| ------------------------------------ | ---------------------------------------------- |
| GitLess: Copy link to repository     | Copy the remote repository URL                 |
| GitLess: Copy remote file URL        | Copy the URL of the current file on the remote |
| GitLess: Copy remote file URL from   | Copy the file URL for a specific branch or tag |
| GitLess: Copy remote commit URL      | Copy the URL of the current commit             |
| GitLess: Copy remote commit URL from | Copy the commit URL from a specific remote     |
| GitLess: Copy SHA                    | Copy the full commit SHA                       |
| GitLess: Copy short SHA              | Copy the short commit SHA                      |

### Source Control Panel

GitLess adds a grouped section to the Source Control panel with toggle buttons to switch between views:

- **Commits** - Browse the commit history with expandable file trees
- **Branches** - View local and remote branches
- **Remotes** - Inspect configured remotes and their branches
- **Stashes** - Manage stashed changes
- **Tags** - Browse tags and their associated commits
- **Worktrees** - View and manage Git worktrees

#### Commit Hover Actions

Hover over a commit to reveal inline buttons:

| Button           | Action                     | Alt/Option Action                       |
| ---------------- | -------------------------- | --------------------------------------- |
| Open all changes | Open diffs for all files   | Open all changes against working tree   |
| Compare          | Compare to/from HEAD       | Compare working tree to this commit     |
| Copy SHA         | Copy the full commit SHA   | Copy the commit message                 |
| Open on remote   | Open the commit on the web | Copy the remote commit URL to clipboard |

#### File Hover Actions

Expand a commit to see its files, then hover for inline buttons:

| Button                | Action                       | Alt/Option Action          |
| --------------------- | ---------------------------- | -------------------------- |
| Open file at revision | Open the file at this commit | Open the working tree file |
| Open changes          | Diff against working file    |                            |
| Open file on remote   | Open the file on the web     | Copy the remote file URL   |

#### Tag Hover Actions

| Button   | Action               | Alt/Option Action                |
| -------- | -------------------- | -------------------------------- |
| Checkout | Checkout this tag    |                                  |
| Compare  | Compare to/from HEAD | Compare working tree to this tag |

#### Context Menus

Right-click on items for additional actions:

- **Commits**: Copy SHA, Copy message, Share > Copy remote commit URL
- **Files**: Share > Copy link to commit, Copy link to file, Copy link at revision
- **Tags**: Copy tag name, Copy tag message
- **Branches**: Copy branch name, Share > Copy remote branch URL
- **Stashes**: Apply stash, Drop stash, Copy stash message

### GitLess Inspect Panel

The GitLess Inspect sidebar panel provides:

- **File History** - View the commit history of the active file
- **Line History** - View the commit history of selected lines
- **Search & Compare** - Search commits by message or compare two refs

### Remote Provider Support

GitLess generates correct URLs for:

- GitHub
- GitLab
- Bitbucket
- Azure DevOps
- Gitea (including Codeberg)

## Configuration

Available settings:

| Setting                                      | Default      | Description                                                                     |
| -------------------------------------------- | ------------ | ------------------------------------------------------------------------------- |
| `gitless.shortShaLength`                     | `7`          | Length of short commit SHAs (5 - 40)                                            |
| `gitless.repositoryScanMaxDepth`             | `1`          | Depth used when scanning workspace folders for Git repositories (`-1` no limit) |
| `gitless.views.commits.showBranchComparison` | `true`       | Show branch comparison in Commits view                                          |
| `gitless.defaultDateFormat`                  | `null`       | Date format (dayjs tokens)                                                      |
| `gitless.defaultDateStyle`                   | `"relative"` | Date style: `relative` or `absolute`                                            |
| `gitless.views.branches.layout`              | `"tree"`     | Branch view layout: `list` or `tree`                                            |

Notes:

- `gitless.defaultDateFormat` uses [dayjs format tokens](https://day.js.org/docs/en/display/format).
  - `YYYY-MM-DD` renders `2026-04-11`.
  - `MMM D, YYYY` renders `Apr 11, 2026`.
  - `YYYY-MM-DD HH:mm` renders `2026-04-11 14:30`.
  - `null` will use the default date formatting.
- `gitless.repositoryScanMaxDepth` controls how many levels of subdirectories GitLess traverses when scanning workspace folders for Git repositories. Equivalent to `git.repositoryScanMaxDepth`. For the best multi-repo workspace experience, set both `git.repositoryScanMaxDepth` and `gitless.repositoryScanMaxDepth` to the same number.

Set custom values in your VS Code `settings.json`:

```jsonc
{
  "gitless.defaultDateFormat": "YYYY-MM-DD HH:mm",
  "gitless.defaultDateStyle": "absolute",
  "gitless.repositoryScanMaxDepth": 5,
  "git.repositoryScanMaxDepth": 5,
}
```

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [pnpm](https://pnpm.io/) 10+

### Setup

```sh
pnpm install
```

### Build

```sh
pnpm run build       # Production build
pnpm run build:dev   # Development build (with sourcemaps)
pnpm run watch       # Watch mode
```

### Test

```sh
pnpm run test        # Unit tests (runs in VS Code test host)
pnpm run test:e2e    # E2E tests (Playwright)
```

### Lint and Format

```sh
pnpm run lint        # Check formatting
pnpm run format      # Fix formatting
```

### Debug

Launch the Extension Development Host by pressing `F5` or running **"Debug: Start Debugging"** from the command palette. This opens a second VSCode window with the extension loaded. After making code changes, run **"Developer: Reload Window"** in the Extension Development Host to pick up the new build. See `.vscode/launch.json` for debug configurations.

### Package

```sh
pnpm run package     # Create .vsix file
```

## Publishing

Publishing is fully automated with [semantic-release](https://github.com/semantic-release/semantic-release). When commits are pushed to `main`, semantic-release analyzes the commit messages to determine the next version, generates a changelog, publishes to both the [VS Code Marketplace](https://marketplace.visualstudio.com/) and [Open VSX](https://open-vsx.org/) (for VSCodium and other non-Microsoft distributions), and creates a GitHub release.

## License

[MIT](LICENSE)
