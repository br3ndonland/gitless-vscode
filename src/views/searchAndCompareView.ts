import * as vscode from "vscode"
import type { GitService } from "../git/gitService"
import { CommitNode, FileNode, MessageNode, getRepositoryLabel } from "./nodes"
import { ViewIds, Commands, ContextValues } from "../constants"
import { shortenSha } from "../config"

export type SearchMode = "message" | "author" | "file" | "changes" | "sha"
type SearchAndCompareCommandExecutor = Pick<
  typeof vscode.commands,
  "executeCommand"
>
type SearchAndCompareTreeView = Pick<
  vscode.TreeView<vscode.TreeItem>,
  "description" | "dispose" | "reveal"
>
interface SearchAndCompareViewOptions {
  skipRegistration?: boolean
  commandExecutor?: SearchAndCompareCommandExecutor
  treeView?: SearchAndCompareTreeView
}

const searchAndCompareViewContainerCommand =
  "workbench.view.extension.gitlessInspect"
const searchAndCompareViewFocusCommand = `${ViewIds.SearchAndCompare}.focus`

const searchModeLabels: Record<SearchMode, string> = {
  message: "Message",
  author: "Author",
  file: "File",
  changes: "Changes",
  sha: "SHA",
}

export function isShaSearchQuery(query: string): boolean {
  return /^[0-9a-f]{4,40}$/i.test(query.trim())
}

export class CompareResultNode extends vscode.TreeItem {
  readonly contextValue = ContextValues.CompareResult
  constructor(
    public readonly ref1: string,
    public readonly ref2: string,
    public readonly ref1Label: string,
    public readonly ref2Label: string,
    public readonly repoPath: string,
    public readonly repoLabel = getRepositoryLabel(repoPath),
    collapsibleState = vscode.TreeItemCollapsibleState.Collapsed,
    idSuffix = "",
  ) {
    super(`${ref1Label} <-> ${ref2Label}`, collapsibleState)
    this.iconPath = new vscode.ThemeIcon("git-compare")
    this.id = `compare:${repoPath}:${ref1}:${ref2}${idSuffix}`
    this.description = `comparison | ${this.repoLabel}`
    this.tooltip = new vscode.MarkdownString(
      `$(git-compare) **${ref1Label}** (\`${shortenSha(ref1)}\`) <-> **${ref2Label}** (\`${shortenSha(ref2)}\`)\n\nRepository: ${this.repoLabel}`,
    )
    this.tooltip.supportThemeIcons = true
  }
}

export class SearchResultNode extends vscode.TreeItem {
  readonly contextValue = ContextValues.SearchResult
  constructor(
    public readonly query: string,
    public readonly repoPath: string,
    public readonly mode: SearchMode = "message",
    public readonly repoLabel = getRepositoryLabel(repoPath),
    collapsibleState = vscode.TreeItemCollapsibleState.Collapsed,
    idSuffix = "",
  ) {
    super(`"${query}"`, collapsibleState)
    this.iconPath = new vscode.ThemeIcon("search")
    this.id = `search:${repoPath}:${mode}:${query}${idSuffix}`
    this.description = `by ${searchModeLabels[mode]} | ${this.repoLabel}`
    this.tooltip = new vscode.MarkdownString(
      `$(search) Search: **${query}**\n\nMode: ${searchModeLabels[mode]}\n\nRepository: ${this.repoLabel}`,
    )
    this.tooltip.supportThemeIcons = true
  }
}

export class SearchAndCompareView implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    vscode.TreeItem | undefined | null | void
  >()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  private treeView: SearchAndCompareTreeView | undefined
  private items: (CompareResultNode | SearchResultNode)[] = []
  private disposables: vscode.Disposable[] = []
  private idGeneration = 0
  private readonly commandExecutor: SearchAndCompareCommandExecutor

  constructor(
    private readonly gitService: GitService,
    options: SearchAndCompareViewOptions = {},
  ) {
    this.commandExecutor = options.commandExecutor ?? vscode.commands
    this.treeView = options.treeView

    if (!options.skipRegistration) {
      this.treeView =
        options.treeView ??
        vscode.window.createTreeView(ViewIds.SearchAndCompare, {
          treeDataProvider: this,
          showCollapseAll: true,
        })
      this.disposables.push(this.treeView)
      this.disposables.push(this.gitService.onDidChange(() => this.refresh()))
      void this.updateViewDescription()

      this.disposables.push(
        vscode.commands.registerCommand(Commands.SearchCommits, () =>
          this.searchCommits(),
        ),
        vscode.commands.registerCommand(Commands.CompareRefs, () =>
          this.compareRefs(),
        ),
        vscode.commands.registerCommand(
          Commands.DismissSearchAndCompareNode,
          (node?: CompareResultNode | SearchResultNode) =>
            this.dismissNode(node),
        ),
        vscode.commands.registerCommand(Commands.ClearSearchAndCompare, () =>
          this.clearAll(),
        ),
      )
    }
  }

  refresh(): void {
    void this.updateViewDescription()
    this._onDidChangeTreeData.fire()
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element instanceof CompareResultNode) {
      try {
        const files = await this.gitService.diff(
          element.repoPath,
          element.ref1,
          element.ref2,
        )
        if (files.length === 0) return [new MessageNode("No differences")]
        return files.map(
          (f) => new FileNode(f, element.ref2, element.repoPath, element.ref1),
        )
      } catch {
        return [new MessageNode("Failed to compare")]
      }
    }

    if (element instanceof SearchResultNode) {
      try {
        const commits = await this.gitService.searchCommits(
          element.repoPath,
          element.query,
          { mode: element.mode },
        )
        if (commits.length === 0) return [new MessageNode("No results")]
        return commits.map((c) => new CommitNode(c, element.repoPath))
      } catch {
        return [new MessageNode("Search failed")]
      }
    }

    if (element instanceof CommitNode) {
      try {
        const files = await this.gitService.getCommitFiles(
          element.repoPath,
          element.sha,
        )
        return files.map((f) => new FileNode(f, element.sha, element.repoPath))
      } catch {
        return [new MessageNode("Failed to load files")]
      }
    }

    // Root level: return items (welcome content shows when empty via viewsWelcome)
    if (!element) {
      const repoPath = await this.gitService.getActiveRepoPath()
      if (!repoPath && this.items.length === 0) {
        return [new MessageNode("No repository found")]
      }
      return this.items
    }

    return []
  }

  private async searchCommits(): Promise<void> {
    const activeRepository = await this.gitService.getActiveRepository()
    if (!activeRepository) return
    const repoPath = activeRepository.path

    // Step 1: Pick search mode (or type a query to search messages directly)
    const modeResult = await this.pickSearchMode()
    if (!modeResult) return

    let mode = modeResult.mode
    let query = modeResult.query

    // Step 2: If a mode was picked (no inline query), prompt for the query
    if (!query) {
      const placeholders: Record<SearchMode, string> = {
        message: "Enter search text (e.g. fix login)",
        author: "Enter author name or email",
        file: "Enter file path (e.g. src/index.ts)",
        changes: "Enter string to search for in diffs",
        sha: "Enter commit SHA or unique prefix (e.g. abc1234)",
      }

      query = await vscode.window.showInputBox({
        prompt: `Search commits by ${searchModeLabels[mode].toLowerCase()}`,
        placeHolder: placeholders[mode],
      })
    }
    if (!query) return

    this.collapseAllItems()
    const result = new SearchResultNode(
      query,
      repoPath,
      mode,
      activeRepository.label,
      vscode.TreeItemCollapsibleState.Expanded,
    )
    this.items.unshift(result)
    this.refresh()
    void this.revealResult(result)
  }

  /** Show a QuickPick for search mode. If the user types a query and presses
   *  Enter without selecting an item, infer SHA or default to message. */
  private pickSearchMode(): Promise<
    { mode: SearchMode; query?: string } | undefined
  > {
    return new Promise((resolve) => {
      const qp = vscode.window.createQuickPick<
        vscode.QuickPickItem & { mode: SearchMode }
      >()
      qp.placeholder = "Search commits by... (or type a message or SHA query)"
      qp.items = [
        {
          label: "$(mail) Message",
          description: "Search commit messages",
          mode: "message" as SearchMode,
        },
        {
          label: "$(person) Author",
          description: "Search by author name or email",
          mode: "author" as SearchMode,
        },
        {
          label: "$(git-commit) SHA",
          description: "Search by full SHA or unique prefix",
          mode: "sha" as SearchMode,
        },
        {
          label: "$(file) File",
          description: "Search commits that changed a file path",
          mode: "file" as SearchMode,
        },
        {
          label: "$(diff) Changes",
          description:
            "Search commits that added or removed a string (pickaxe)",
          mode: "changes" as SearchMode,
        },
      ]
      qp.matchOnDescription = true

      let resolved = false
      const done = (
        result: { mode: SearchMode; query?: string } | undefined,
      ) => {
        if (resolved) return
        resolved = true
        qp.dispose()
        resolve(result)
      }

      qp.onDidAccept(() => {
        const selected = qp.selectedItems[0]
        if (selected) {
          // User picked a mode item
          done({ mode: selected.mode })
        } else if (qp.value.trim()) {
          const query = qp.value.trim()
          done({ mode: isShaSearchQuery(query) ? "sha" : "message", query })
        }
        // If nothing selected and nothing typed, ignore the accept
      })

      qp.onDidHide(() => done(undefined))
      qp.show()
    })
  }

  private async compareRefs(): Promise<void> {
    const activeRepository = await this.gitService.getActiveRepository()
    if (!activeRepository) return
    const repoPath = activeRepository.path

    const refItems = await this.buildRefPickItems(repoPath)

    // Step 1: Pick first ref
    const ref1Pick = await vscode.window.showQuickPick(refItems, {
      placeHolder: "Select the first reference to compare",
      matchOnDescription: true,
    })
    if (!ref1Pick) return

    // Step 2: Pick second ref
    const ref2Pick = await vscode.window.showQuickPick(refItems, {
      placeHolder: `Compare "${ref1Pick.label}" with...`,
      matchOnDescription: true,
    })
    if (!ref2Pick) return

    try {
      const sha1 = await this.gitService.getShaForRef(repoPath, ref1Pick.ref)
      const sha2 = await this.gitService.getShaForRef(repoPath, ref2Pick.ref)
      this.collapseAllItems()
      const result = new CompareResultNode(
        sha1,
        sha2,
        ref1Pick.label,
        ref2Pick.label,
        repoPath,
        activeRepository.label,
        vscode.TreeItemCollapsibleState.Expanded,
      )
      this.items.unshift(result)
      this.refresh()
      void this.revealResult(result)
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to resolve refs: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  private async revealResult(
    item: CompareResultNode | SearchResultNode,
  ): Promise<void> {
    await this.executeWorkbenchCommand(searchAndCompareViewContainerCommand)
    await this.executeWorkbenchCommand(searchAndCompareViewFocusCommand)

    try {
      await this.treeView?.reveal(item, {
        select: true,
        focus: true,
        expand: true,
      })
    } catch {
      // The result is already stored; focus failures should not fail the search.
    }
  }

  private async executeWorkbenchCommand(command: string): Promise<void> {
    try {
      await this.commandExecutor.executeCommand(command)
    } catch {
      // The result is already stored; focus failures should not fail the search.
    }
  }

  private async buildRefPickItems(
    repoPath: string,
  ): Promise<(vscode.QuickPickItem & { ref: string })[]> {
    const [branches, tags] = await Promise.all([
      this.gitService.getBranches(repoPath),
      this.gitService.getTags(repoPath),
    ])

    const items: (vscode.QuickPickItem & { ref: string })[] = [
      {
        label: "HEAD",
        description: "Current HEAD",
        detail: "Special ref",
        ref: "HEAD",
      },
    ]

    for (const b of branches.filter((b) => !b.remote)) {
      items.push({
        label: b.name,
        description: b.current
          ? `$(check) current${b.sha ? " -- " + shortenSha(b.sha) : ""}`
          : b.sha
            ? shortenSha(b.sha)
            : "",
        detail: "Branch",
        ref: b.name,
      })
    }

    for (const b of branches.filter((b) => b.remote)) {
      items.push({
        label: b.name,
        description: b.sha ? shortenSha(b.sha) : "",
        detail: "Remote branch",
        ref: b.name,
      })
    }

    for (const t of tags) {
      items.push({
        label: t.name,
        description: t.sha ? shortenSha(t.sha) : "",
        detail: "Tag",
        ref: t.name,
      })
    }

    return items
  }

  /** Recreate all existing result nodes with fresh IDs so VS Code's cached
   *  expand/collapse state is discarded and the Collapsed default takes effect. */
  private collapseAllItems(): void {
    this.idGeneration++
    const suffix = `:g${this.idGeneration}`
    this.items = this.items.map((item) => {
      if (item instanceof CompareResultNode) {
        return new CompareResultNode(
          item.ref1,
          item.ref2,
          item.ref1Label,
          item.ref2Label,
          item.repoPath,
          item.repoLabel,
          vscode.TreeItemCollapsibleState.Collapsed,
          suffix,
        )
      }
      return new SearchResultNode(
        item.query,
        item.repoPath,
        item.mode,
        item.repoLabel,
        vscode.TreeItemCollapsibleState.Collapsed,
        suffix,
      )
    })
  }

  private dismissNode(node?: CompareResultNode | SearchResultNode): void {
    if (!node) return
    const index = this.items.indexOf(node)
    if (index >= 0) {
      this.items.splice(index, 1)
      this.refresh()
    }
  }

  private clearAll(): void {
    this.items = []
    this.refresh()
  }

  /** @internal Exposed for unit tests only. */
  get _test() {
    return {
      items: this.items,
      idGeneration: this.idGeneration,
      addSearchResult: (
        query: string,
        repoPath: string,
        mode: SearchMode = "message",
      ) => {
        this.collapseAllItems()
        this.items.unshift(
          new SearchResultNode(
            query,
            repoPath,
            mode,
            getRepositoryLabel(repoPath),
            vscode.TreeItemCollapsibleState.Expanded,
          ),
        )
        this.refresh()
      },
      addCompareResult: (
        ref1: string,
        ref2: string,
        ref1Label: string,
        ref2Label: string,
        repoPath: string,
      ) => {
        this.collapseAllItems()
        this.items.unshift(
          new CompareResultNode(
            ref1,
            ref2,
            ref1Label,
            ref2Label,
            repoPath,
            getRepositoryLabel(repoPath),
            vscode.TreeItemCollapsibleState.Expanded,
          ),
        )
        this.refresh()
      },
      clearAll: () => this.clearAll(),
      dismissNode: (node: CompareResultNode | SearchResultNode) =>
        this.dismissNode(node),
      isShaSearchQuery,
      revealResult: (node: CompareResultNode | SearchResultNode) =>
        this.revealResult(node),
    }
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose())
    this._onDidChangeTreeData.dispose()
  }

  private async updateViewDescription(): Promise<void> {
    if (!this.treeView) return

    const [repositories, activeRepository] = await Promise.all([
      this.gitService.getRepositories(),
      this.gitService.getActiveRepository(),
    ])

    this.treeView.description =
      repositories.length > 1 ? activeRepository?.label : undefined
  }
}
