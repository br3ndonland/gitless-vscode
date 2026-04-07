import * as vscode from "vscode"
import type { GitService } from "../git/gitService"
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

  constructor(gitService: GitService) {
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
    this.treeView = vscode.window.createTreeView("gitless.views.scm.grouped", {
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

    // Register toggle commands (switch to view)
    this.disposables.push(
      vscode.commands.registerCommand("gitless.views.grouped.commits", () =>
        this.setView("commits"),
      ),
      vscode.commands.registerCommand("gitless.views.grouped.tags", () =>
        this.setView("tags"),
      ),
      vscode.commands.registerCommand("gitless.views.grouped.branches", () =>
        this.setView("branches"),
      ),
      vscode.commands.registerCommand("gitless.views.grouped.remotes", () =>
        this.setView("remotes"),
      ),
      vscode.commands.registerCommand("gitless.views.grouped.stashes", () =>
        this.setView("stashes"),
      ),
      vscode.commands.registerCommand("gitless.views.grouped.worktrees", () =>
        this.setView("worktrees"),
      ),
    )

    // Register active (no-op) commands for the selected state icons
    const noop = () => {}
    this.disposables.push(
      vscode.commands.registerCommand(
        "gitless.views.grouped.commits.active",
        noop,
      ),
      vscode.commands.registerCommand(
        "gitless.views.grouped.tags.active",
        noop,
      ),
      vscode.commands.registerCommand(
        "gitless.views.grouped.branches.active",
        noop,
      ),
      vscode.commands.registerCommand(
        "gitless.views.grouped.remotes.active",
        noop,
      ),
      vscode.commands.registerCommand(
        "gitless.views.grouped.stashes.active",
        noop,
      ),
      vscode.commands.registerCommand(
        "gitless.views.grouped.worktrees.active",
        noop,
      ),
    )

    // Set initial context
    this.updateContext()
  }

  private get activeView(): SubView {
    return this.subViews[this.activeType]
  }

  setView(type: GroupedViewType): void {
    if (this.activeType === type) return
    this.activeType = type
    this.updateContext()
    this._onDidChangeTreeData.fire()
  }

  refresh(): void {
    for (const view of Object.values(this.subViews)) {
      view.refresh()
    }
  }

  private updateContext(): void {
    vscode.commands.executeCommand(
      "setContext",
      "gitless:views:scm:grouped:view",
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
