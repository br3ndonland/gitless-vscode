# Contributing to GitLess

## Getting Started

1. Fork and clone the repository
2. Install dependencies: `pnpm install`
3. Open the project in VSCode
4. Launch the Extension Development Host by pressing `F5` or running **"Debug: Start Debugging"** from the command palette

## Development Workflow

### Branch Strategy

- Create feature branches from `main`
- Use descriptive branch names like `feature/add-blame-annotations` or `fix/remote-url-parsing`
- Do not commit directly to `main`

### Commit Messages

Commit messages should follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

Common types include `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `build`, `ci`, `chore`.

### Code Style

This project uses [Prettier](https://prettier.io/) for formatting with the following key settings:

- No semicolons
- Double quotes
- Trailing commas

Run `pnpm run format` to format all files, or configure your editor to format on save. The `.vscode/settings.json` file includes the recommended settings for VSCode.

Run `pnpm run lint` to verify formatting without modifying files.

### Project Structure

```
src/
├── __tests__/          # Unit tests (Mocha, tdd UI)
├── commands/           # VSCode command handlers
├── git/                # Git abstraction layer
│   ├── models.ts       # TypeScript interfaces for Git objects
│   ├── shell.ts        # Git subprocess execution
│   ├── parsers.ts      # Raw git output parsers
│   ├── remoteUrls.ts   # Remote URL generation per provider
│   └── gitService.ts   # High-level Git service
├── views/              # Tree view data providers
│   ├── nodes.ts        # Tree node classes
│   ├── groupedView.ts  # Grouped SCM view (single TreeView with toggle buttons)
│   └── *View.ts        # One file per sub-view
├── config.ts           # Configuration helpers
├── constants.ts        # Extension IDs, command IDs, context values
├── container.ts        # Dependency injection container
└── extension.ts        # Extension entry point (activate/deactivate)
tests/
└── e2e/                # End-to-end tests (Playwright)
```

### Adding a New Command

1. Add the command ID to `src/constants.ts` in the `Commands` object
2. Register the command handler in `src/commands/registerCommands.ts`
3. Declare the command in `package.json` under `contributes.commands`
4. Add menu entries in `package.json` under `contributes.menus` if the command should appear in context menus or inline toolbars
5. If the command should be hidden from the command palette, add it to the `commandPalette` menu entries with `"when": "false"`

### Adding a New View

1. Add the view ID to `src/constants.ts` in the `ViewIds` enum
2. Create a new view class in `src/views/` implementing `vscode.TreeDataProvider`
3. Export it from `src/views/index.ts`
4. Instantiate it in `src/container.ts`
5. Declare the view in `package.json` under `contributes.views`

### Adding a New Remote Provider

1. Add the provider ID to the `RemoteProviderId` type in `src/git/models.ts`
2. Add domain detection in `identifyProvider()` in `src/git/parsers.ts`
3. Add URL generation in the switch statements in `src/git/remoteUrls.ts`
4. Add tests in `src/__tests__/remoteUrls.test.ts`

## Testing

### Unit Tests

Unit tests use [Mocha](https://mochajs.org/) with the `tdd` UI (using `suite` and `test` instead of `describe` and `it`) and run inside the VSCode test host via `@vscode/test-cli`.

```sh
pnpm run test
```

Test files are located in `src/__tests__/` and follow the naming convention `*.test.ts`.

### E2E Tests

End-to-end tests use [Playwright](https://playwright.dev/).

```sh
pnpm run test:e2e
```

E2E test specs are in `tests/e2e/specs/`.

### Writing Tests

- Test pure logic (parsers, URL generation, configuration) with unit tests
- Test VSCode integration (commands, views, tree data providers) with E2E tests where possible
- Keep tests focused and independent

## Building and Packaging

```sh
pnpm run build        # Production build (minified)
pnpm run build:dev    # Development build (with sourcemaps)
pnpm run package      # Create .vsix package
```

The build uses [esbuild](https://esbuild.github.io/) to bundle `src/extension.ts` into `dist/extension.js`. The `vscode` module is marked as external since it's provided by the VSCode runtime.

## Pull Requests

- Keep PRs focused on a single change
- Include tests for new functionality
- Ensure `pnpm run lint` and `pnpm run build` pass
- Describe what the change does and why in the PR description

## Releases

Releases are automated via GitHub Actions. To publish a new version:

1. Update the version in `package.json`
2. Update `CHANGELOG.md` with the changes
3. Create and push a version tag: `git tag 0.1.0 && git push origin 0.1.0`
4. The publish workflow will build, package, and publish to both the VS Code Marketplace and Open VSX
