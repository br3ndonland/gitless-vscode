export const EXTENSION_ID = "gitless"
export const EXTENSION_NAME = "GitLess"

export const enum ContextValues {
  Commit = "gitless:commit",
  File = "gitless:file",
  Branch = "gitless:branch",
  BranchCurrent = "gitless:branch+current",
  BranchRemote = "gitless:branch+remote",
  Remote = "gitless:remote",
  Tag = "gitless:tag",
  Stash = "gitless:stash",
  Worktree = "gitless:worktree",
  WorktreeMain = "gitless:worktree+main",
  FileHistory = "gitless:fileHistory",
  LineHistory = "gitless:lineHistory",
  CompareResult = "gitless:compareResult",
  SearchResult = "gitless:searchResult",
}

export const enum ViewIds {
  ScmGrouped = "gitless.views.scm.grouped",
  FileHistory = "gitless.views.fileHistory",
  LineHistory = "gitless.views.lineHistory",
  SearchAndCompare = "gitless.views.searchAndCompare",
}

export const Commands = {
  CopyRemoteRepoUrl: "gitless.copyRemoteRepoUrl",
  CopyRemoteFileUrl: "gitless.copyRemoteFileUrl",
  CopyRemoteFileUrlFrom: "gitless.copyRemoteFileUrlFrom",
  CopyRemoteCommitUrl: "gitless.copyRemoteCommitUrl",
  CopyRemoteCommitUrlFrom: "gitless.copyRemoteCommitUrlFrom",
  CopySha: "gitless.copySha",
  CopyShortSha: "gitless.copyShortSha",
  CopyMessage: "gitless.copyMessage",
  OpenFileAtRevision: "gitless.openFileAtRevision",
  OpenFile: "gitless.openFile",
  OpenChanges: "gitless.openChanges",
  OpenChangesWithWorking: "gitless.openChangesWithWorking",
  OpenFileOnRemote: "gitless.openFileOnRemote",
  OpenCommitOnRemote: "gitless.openCommitOnRemote",
  CompareWithHead: "gitless.compareWithHead",
  CompareFromHead: "gitless.compareFromHead",
  CompareWorkingWith: "gitless.compareWorkingWith",
  CheckoutTag: "gitless.checkoutTag",
  CopyTag: "gitless.copyTag",
  CopyTagMessage: "gitless.copyTagMessage",
  OpenAllChanges: "gitless.openAllChanges",
  OpenAllChangesWithWorking: "gitless.openAllChangesWithWorking",
  RefreshView: "gitless.refreshView",
  CopyRemoteFileUrlAtRevision: "gitless.copyRemoteFileUrlAtRevision",
  CopyRemoteCommitFileUrl: "gitless.copyRemoteCommitFileUrl",
  CopyRemoteCommitFileUrlAtRevision:
    "gitless.copyRemoteCommitFileUrlAtRevision",
  // Search and Compare commands
  SearchCommits: "gitless.searchCommits",
  CompareRefs: "gitless.compareRefs",
  DismissSearchAndCompareNode: "gitless.dismissSearchAndCompareNode",
  ClearSearchAndCompare: "gitless.clearSearchAndCompare",
  // Toggle commands for grouped view
  ShowCommits: "gitless.views.grouped.commits",
  ShowBranches: "gitless.views.grouped.branches",
  ShowRemotes: "gitless.views.grouped.remotes",
  ShowStashes: "gitless.views.grouped.stashes",
  ShowTags: "gitless.views.grouped.tags",
  ShowWorktrees: "gitless.views.grouped.worktrees",
  // Active (no-op) variants for grouped view
  ShowCommitsActive: "gitless.views.grouped.commits.active",
  ShowBranchesActive: "gitless.views.grouped.branches.active",
  ShowRemotesActive: "gitless.views.grouped.remotes.active",
  ShowStashesActive: "gitless.views.grouped.stashes.active",
  ShowTagsActive: "gitless.views.grouped.tags.active",
  ShowWorktreesActive: "gitless.views.grouped.worktrees.active",
} as const
