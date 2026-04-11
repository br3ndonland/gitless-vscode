import * as vscode from "vscode"
import type { GitService } from "../git/gitService"
import { Commands, GROUPED_VIEW_CONTEXT_KEY, ViewIds } from "../constants"
import { CommitsView } from "./commitsView"
import { BranchesView } from "./branchesView"
import { RemotesView } from "./remotesView"
import { StashesView } from "./stashesView"
import { TagsView } from "./tagsView"
import { WorktreesView } from "./worktreesView"

export type GroupedViewType =
  | "commits"
  | "branches"
  | "remotes"
  | "stashes"
  | "tags"
  | "worktrees"

type SubView =
  | CommitsView
  | BranchesView
  | RemotesView
  | StashesView
  | TagsView
  | WorktreesView

export class GroupedView implements vscode.Disposable {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    vscode.TreeItem | undefined | null | void
  >()

  private treeView: vscode.TreeView<vscode.TreeItem>
  private activeType: GroupedViewType = "commits"
  private subViews: Record<GroupedViewType, SubView>
  private readonly disposables: vscode.Disposable[] = []

  constructor(private readonly gitService: GitService) {
    // Create all sub-view providers
    this.subViews = {
      commits: new CommitsView(gitService),
      branches: new BranchesView(gitService),
      remotes: new RemotesView(gitService),
      stashes: new StashesView(gitService),
      tags: new TagsView(gitService),
      worktrees: new WorktreesView(gitService),
    }

    // Forward sub-view change events to our emitter
    for (const view of Object.values(this.subViews)) {
      this.disposables.push(
        view.onDidChangeTreeData(() => {
          if (this.activeView === view) {
            this._onDidChangeTreeData.fire()
          }
        }),
      )
    }

    // Create the single tree view
    this.treeView = vscode.window.createTreeView(ViewIds.ScmGrouped, {
      treeDataProvider: {
        onDidChangeTreeData: this._onDidChangeTreeData.event,
        getTreeItem: (element: vscode.TreeItem) =>
          this.activeView.getTreeItem(element),
        getChildren: (element?: vscode.TreeItem) =>
          this.activeView.getChildren(element),
      },
      showCollapseAll: true,
    })
    this.disposables.push(this.treeView)
    this.disposables.push(
      this.gitService.onDidChange(() => void this.updateViewState()),
    )

    // Register toggle commands (switch to view)
    this.disposables.push(
      vscode.commands.registerCommand(Commands.ShowCommits, () =>
        this.setView("commits"),
      ),
      vscode.commands.registerCommand(Commands.ShowTags, () =>
        this.setView("tags"),
      ),
      vscode.commands.registerCommand(Commands.ShowBranches, () =>
        this.setView("branches"),
      ),
      vscode.commands.registerCommand(Commands.ShowRemotes, () =>
        this.setView("remotes"),
      ),
      vscode.commands.registerCommand(Commands.ShowStashes, () =>
        this.setView("stashes"),
      ),
      vscode.commands.registerCommand(Commands.ShowWorktrees, () =>
        this.setView("worktrees"),
      ),
    )

    // Register active (no-op) commands for the selected state icons
    const noop = () => {}
    this.disposables.push(
      vscode.commands.registerCommand(Commands.ShowCommitsActive, noop),
      vscode.commands.registerCommand(Commands.ShowTagsActive, noop),
      vscode.commands.registerCommand(Commands.ShowBranchesActive, noop),
      vscode.commands.registerCommand(Commands.ShowRemotesActive, noop),
      vscode.commands.registerCommand(Commands.ShowStashesActive, noop),
      vscode.commands.registerCommand(Commands.ShowWorktreesActive, noop),
    )

    // Set initial context
    void this.updateViewState()
  }

  private get activeView(): SubView {
    return this.subViews[this.activeType]
  }

  setView(type: GroupedViewType): void {
    if (this.activeType === type) return
    this.activeType = type
    void this.updateViewState()
    this._onDidChangeTreeData.fire()
  }

  refresh(): void {
    for (const view of Object.values(this.subViews)) {
      view.refresh()
    }
    void this.updateViewState()
  }

  private async updateViewState(): Promise<void> {
    this.updateContext()

    const [repositories, activeRepository] = await Promise.all([
      this.gitService.getRepositories(),
      this.gitService.getActiveRepository(),
    ])

    this.treeView.description =
      repositories.length > 1 ? activeRepository?.label : undefined
  }

  private updateContext(): void {
    vscode.commands.executeCommand(
      "setContext",
      GROUPED_VIEW_CONTEXT_KEY,
      this.activeType,
    )
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose())
    for (const view of Object.values(this.subViews)) {
      view.dispose()
    }
    this._onDidChangeTreeData.dispose()
  }
}
