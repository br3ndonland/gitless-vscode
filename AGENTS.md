# AGENTS.md

Instructions for AI coding agents working on this project.

## Project Overview

GitLess is a minimal VSCode extension for Git integration. It provides a dedicated Source Control panel section with views (Commits, Tags, Branches, Remotes, Stashes, Worktrees), an Inspect panel (File History, Line History, Search and Compare), and command palette commands for remote URLs, commit SHAs, remote links, repository selection, commit search, and ref comparison.

## Key Conventions

- Use pnpm for package management (not npm or yarn).
- Use Conventional Commits and Angular commit message conventions for all commit messages (e.g. `feat:`, `fix:`, `docs:`).
- Use Prettier for formatting with `"semi": false` (no semicolons).
- Use double quotes for strings.
- Use ASCII characters in written output, code comments, commit messages, and documentation, except for box-drawing characters (`├`, `└`, `│`, `─`) in filesystem tree diagrams.
- Do not create Git commits on `main`; always work on a feature branch.
- Do not Git push to `main`; always push to a feature branch.

## Architecture

- **Entry point**: `src/extension.ts` - `activate()` creates a `Container` instance.
- **DI container**: `src/container.ts` - Wires up the `GitService`, revision content provider, file decoration provider, commands, views, and configuration.
- **Git layer**: `src/git/` - `models.ts` (interfaces), `shell.ts` (subprocess execution), `parsers.ts` (output parsing), `remoteUrls.ts` (URL generation), `gitService.ts` (repository discovery, active repository selection, high-level Git API).
- **Commands**: `src/commands/registerCommands.ts` - All command handlers registered in one function. Command IDs defined in `src/constants.ts`.
- **Views**: `src/views/` - `groupedView.ts` owns a single `TreeView` in the SCM panel and switches among sub-view `TreeDataProvider`s. `fileHistoryView.ts`, `lineHistoryView.ts`, and `searchAndCompareView.ts` back the GitLess Inspect panel. Tree node classes are in `src/views/nodes.ts`, and `gitFileDecorationProvider.ts` adds Git status badges to file nodes.
- **Configuration**: `src/config.ts` - Reads `gitless.*` settings. `src/constants.ts` has all command/view/context IDs.

## Adding Features

When adding a new command:

1. Add to `Commands` in `src/constants.ts`
2. Add handler in `src/commands/registerCommands.ts`
3. Add to `contributes.commands` in `package.json`
4. Add menu entries and command palette exclusions in `package.json` if needed

When adding a new grouped Source Control sub-view:

1. Add the view type to `GroupedViewType` in `src/views/groupedView.ts`
2. Create the view class in `src/views/`
3. Add it to the `subViews` map and command registrations in `groupedView.ts`
4. Add command IDs to `Commands` in `src/constants.ts`
5. Add command entries and `view/title` toggle buttons in `package.json`

When adding a new Inspect panel view:

1. Add to `ViewIds` in `src/constants.ts`
2. Create view class in `src/views/`
3. Export from `src/views/index.ts`
4. Instantiate in `src/container.ts`
5. Declare in `package.json` under `contributes.views`

## Build and Test

```sh
pnpm install           # Install dependencies
pnpm run build         # Production build (esbuild -> dist/extension.js)
pnpm run build:dev     # Dev build with sourcemaps
pnpm run lint          # Prettier check
pnpm run format        # Prettier write
```

At this time, agents should not automatically run `pnpm run test` (unit tests with Mocha in VS Code test host) or `pnpm run test:e2e` (Playwright). The VS Code test host and Playwright extension tests may not be able to run properly in agent sandboxes. Run them only when explicitly requested or when an unsandboxed local environment is available.

## Important Files

- `package.json` - Extension manifest. All commands, views, menus, and configuration are declared here.
- `src/constants.ts` - Single source of truth for command IDs, view IDs, and context value strings.
- `src/git/gitService.ts` - Repository discovery, active repository selection, and high-level Git operations.
- `src/git/parsers.ts` - Git output parsing. Changes here should be accompanied by unit tests in `src/__tests__/parsers.test.ts`.
- `src/git/remoteUrls.ts` - Remote URL generation for GitHub, GitLab, Bitbucket, Azure DevOps, and Gitea. Tests in `src/__tests__/remoteUrls.test.ts`.
- `src/views/searchAndCompareView.ts` - Search and Compare Inspect panel behavior. Tests are in `src/__tests__/searchAndCompareView.test.ts`.

## Testing Guidelines

- Unit tests are in `src/__tests__/` using Mocha `tdd` UI (`suite`/`test`, not `describe`/`it`).
- Prefer testing pure functions (parsers, URL generation) over VSCode API integration.
- Do not automatically run `pnpm run test` or `pnpm run test:e2e` in agent sandboxes.
- Run `pnpm run lint` and `pnpm run build` to verify before committing when those commands are relevant.
