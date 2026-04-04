import * as vscode from "vscode"
import { GitService } from "./git/gitService"
import {
  GroupedView,
  FileHistoryView,
  LineHistoryView,
  SearchAndCompareView,
  GitFileDecorationProvider,
} from "./views"
import { registerCommands } from "./commands"
import { RevisionContentProvider } from "./commands/revisionContentProvider"
import { updateShortShaLength, onConfigurationChanged } from "./config"
import { EXTENSION_NAME } from "./constants"

export class Container implements vscode.Disposable {
  readonly gitService: GitService
  readonly outputChannel: vscode.OutputChannel

  private readonly disposables: vscode.Disposable[] = []

  // Views
  readonly groupedView: GroupedView
  readonly fileHistoryView: FileHistoryView
  readonly lineHistoryView: LineHistoryView
  readonly searchAndCompareView: SearchAndCompareView

  constructor(_context: vscode.ExtensionContext) {
    this.outputChannel = vscode.window.createOutputChannel(EXTENSION_NAME)
    this.disposables.push(this.outputChannel)

    // Initialize configuration
    updateShortShaLength()

    // Watch configuration changes
    this.disposables.push(
      onConfigurationChanged(() => {
        updateShortShaLength()
        this.refreshAllViews()
      }),
    )

    // Initialize git service
    this.gitService = new GitService()
    this.disposables.push(this.gitService)

    // Register revision content provider
    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(
        RevisionContentProvider.scheme,
        new RevisionContentProvider(this.gitService),
      ),
    )

    // Register file decoration provider for git-status badges on file nodes
    const fileDecorationProvider = new GitFileDecorationProvider()
    this.disposables.push(
      vscode.window.registerFileDecorationProvider(fileDecorationProvider),
      fileDecorationProvider,
    )

    // Register commands
    const commandDisposables = registerCommands({
      gitService: this.gitService,
      outputChannel: this.outputChannel,
    })
    this.disposables.push(...commandDisposables)

    // Initialize views
    this.groupedView = new GroupedView(this.gitService)
    this.fileHistoryView = new FileHistoryView(this.gitService)
    this.lineHistoryView = new LineHistoryView(this.gitService)
    this.searchAndCompareView = new SearchAndCompareView(this.gitService)

    this.disposables.push(
      this.groupedView,
      this.fileHistoryView,
      this.lineHistoryView,
      this.searchAndCompareView,
    )

    this.outputChannel.appendLine(`${EXTENSION_NAME} initialized successfully`)
  }

  private refreshAllViews(): void {
    this.groupedView.refresh()
    this.fileHistoryView.refresh()
    this.lineHistoryView.refresh()
    this.searchAndCompareView.refresh()
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose())
  }
}
