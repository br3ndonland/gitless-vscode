import * as vscode from "vscode"
import type { GitService } from "../git/gitService"
import { CommitNode, FileNode, MessageNode } from "./nodes"
import { ViewIds, Commands, ContextValues } from "../constants"
import { shortenSha } from "../config"

export type SearchMode = "message" | "author" | "file" | "changes"

const searchModeLabels: Record<SearchMode, string> = {
  message: "Message",
  author: "Author",
  file: "File",
  changes: "Changes",
}

export class CompareResultNode extends vscode.TreeItem {
  readonly contextValue = ContextValues.CompareResult
  constructor(
    public readonly ref1: string,
    public readonly ref2: string,
    public readonly ref1Label: string,
    public readonly ref2Label: string,
    public readonly repoPath: string,
    collapsibleState = vscode.TreeItemCollapsibleState.Collapsed,
    idSuffix = "",
  ) {
    super(`${ref1Label} <-> ${ref2Label}`, collapsibleState)
    this.iconPath = new vscode.ThemeIcon("git-compare")
    this.id = `compare:${ref1}:${ref2}${idSuffix}`
    this.description = "comparison"
    this.tooltip = new vscode.MarkdownString(
      `$(git-compare) **${ref1Label}** (\`${shortenSha(ref1)}\`) <-> **${ref2Label}** (\`${shortenSha(ref2)}\`)`,
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
    collapsibleState = vscode.TreeItemCollapsibleState.Collapsed,
    idSuffix = "",
  ) {
    super(`"${query}"`, collapsibleState)
    this.iconPath = new vscode.ThemeIcon("search")
    this.id = `search:${mode}:${query}${idSuffix}`
    this.description = `by ${searchModeLabels[mode]}`
    this.tooltip = new vscode.MarkdownString(
      `$(search) Search: **${query}**\n\nMode: ${searchModeLabels[mode]}`,
    )
    this.tooltip.supportThemeIcons = true
  }
}

export class SearchAndCompareView implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    vscode.TreeItem | undefined | null | void
  >()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  private treeView: vscode.TreeView<vscode.TreeItem> | undefined
  private items: (CompareResultNode | SearchResultNode)[] = []
  private disposables: vscode.Disposable[] = []
  private idGeneration = 0

  constructor(
    private readonly gitService: GitService,
    options?: { skipRegistration?: boolean },
  ) {
    if (!options?.skipRegistration) {
      this.treeView = vscode.window.createTreeView(ViewIds.SearchAndCompare, {
        treeDataProvider: this,
        showCollapseAll: true,
      })
      this.disposables.push(this.treeView)

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
    this._onDidChangeTreeData.fire()
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    const repoPath = await this.gitService.getRepoPath()
    if (!repoPath) return [new MessageNode("No repository found")]

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
          repoPath,
          element.sha,
        )
        return files.map((f) => new FileNode(f, element.sha, repoPath))
      } catch {
        return [new MessageNode("Failed to load files")]
      }
    }

    // Root level: return items (welcome content shows when empty via viewsWelcome)
    if (!element) {
      return this.items
    }

    return []
  }

  private async searchCommits(): Promise<void> {
    const repoPath = await this.gitService.getRepoPath()
    if (!repoPath) return

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
      }

      query = await vscode.window.showInputBox({
        prompt: `Search commits by ${searchModeLabels[mode].toLowerCase()}`,
        placeHolder: placeholders[mode],
      })
    }
    if (!query) return

    this.collapseAllItems()
    this.items.unshift(
      new SearchResultNode(
        query,
        repoPath,
        mode,
        vscode.TreeItemCollapsibleState.Expanded,
      ),
    )
    this.refresh()
  }

  /** Show a QuickPick for search mode. If the user types a query and presses
   *  Enter without selecting an item, return that text with mode "message". */
  private pickSearchMode(): Promise<
    { mode: SearchMode; query?: string } | undefined
  > {
    return new Promise((resolve) => {
      const qp = vscode.window.createQuickPick<
        vscode.QuickPickItem & { mode: SearchMode }
      >()
      qp.placeholder =
        "Search commits by... (or type a query to search messages)"
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
          // User typed a query without selecting an item -- default to message
          done({ mode: "message", query: qp.value.trim() })
        }
        // If nothing selected and nothing typed, ignore the accept
      })

      qp.onDidHide(() => done(undefined))
      qp.show()
    })
  }

  private async compareRefs(): Promise<void> {
    const repoPath = await this.gitService.getRepoPath()
    if (!repoPath) return

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
      this.items.unshift(
        new CompareResultNode(
          sha1,
          sha2,
          ref1Pick.label,
          ref2Pick.label,
          repoPath,
          vscode.TreeItemCollapsibleState.Expanded,
        ),
      )
      this.refresh()
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to resolve refs: ${err instanceof Error ? err.message : String(err)}`,
      )
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
          vscode.TreeItemCollapsibleState.Collapsed,
          suffix,
        )
      }
      return new SearchResultNode(
        item.query,
        item.repoPath,
        item.mode,
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
            vscode.TreeItemCollapsibleState.Expanded,
          ),
        )
        this.refresh()
      },
      clearAll: () => this.clearAll(),
      dismissNode: (node: CompareResultNode | SearchResultNode) =>
        this.dismissNode(node),
    }
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose())
    this._onDidChangeTreeData.dispose()
  }
}
