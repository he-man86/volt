import * as vscode from "vscode"
import { existsSync } from "node:fs"
import { join, basename } from "node:path"
import { type StatusJson, changeCount, totalChanges } from "./types.js"
import { readBridgePort, probeHealth, isBridgeOnline, type HealthState, describeOffline } from "./health.js"
import { spawnCapture } from "./cli.js"
import { isMutationInFlight } from "./gate.js"
import { isPouFile, readStateMtime } from "./workspace.js"
import { VoltTreeProvider, type StatusSource } from "./tree.js"
import { VoltHistoryProvider } from "./history.js"
import { VoltDriftDecorationProvider } from "./drift.js"
import { VoltContentProvider, VOLT_URI_SCHEME } from "./content.js"

let _output: vscode.OutputChannel | undefined

export function output(): vscode.OutputChannel {
  if (_output === undefined) _output = vscode.window.createOutputChannel("Volt")
  return _output
}

type EventCallback = (workspaceRoot: string) => void

const HEALTH_HEARTBEAT_MS = 30_000
const STATE_MTIME_POLL_MS = 3_000

function logln(msg: string): void {
  output().appendLine(`[${new Date().toISOString()}] ${msg}`)
}

function firstNonEmptyLine(stderr: string): string | undefined {
  const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
  if (lines.length === 0) return undefined
  if (lines.length > 1 && /^volt:.*failed/i.test(lines[0]!)) return lines[1]
  return lines[0]
}

function maybeNotifyProjectMismatch(
  prev: StatusJson | undefined,
  next: StatusJson,
): void {
  if (next.projectMismatch === null) return
  if (prev !== undefined && prev.projectMismatch !== null) return
  const m = next.projectMismatch
  const from = m.configuredAs.plcProjectName
  const to = m.bridgeReports.plcProjectName
  const accept = "Accept (run init --force)"
  const show = "Show Output"
  void vscode.window
    .showWarningMessage(
      `Volt: PLC project renamed in the IDE — "${from}" → "${to}". Pull/push will refuse until you accept the new name.`,
      accept,
      show,
    )
    .then((pick) => {
      if (pick === accept) void vscode.commands.executeCommand("volt.acceptProjectRename")
      else if (pick === show) void vscode.commands.executeCommand("volt.showOutput")
    })
}

function maybeNotifyConnectionLoss(
  workspaceRoot: string,
  prev: HealthState,
  next: HealthState,
): void {
  const isWorking = (s: HealthState): boolean => s.kind === "connected" || s.kind === "degraded"
  const isBroken = (s: HealthState): boolean => s.kind === "disconnected" || s.kind === "unreachable"
  if (!(isWorking(prev) && isBroken(next))) return
  if (isMutationInFlight(workspaceRoot)) return
  const reason =
    next.kind === "unreachable" ? next.reason
      : next.kind === "disconnected" ? next.health.degradedReason ?? "no IDE attached"
      : "unknown"
  const folderLabel = basename(workspaceRoot)
  void vscode.window
    .showWarningMessage(`Volt: lost IDE connection (${folderLabel}) — ${reason}`, "Show Output")
    .then((pick) => { if (pick === "Show Output") void vscode.commands.executeCommand("volt.showOutput") })
}

export class VoltStatus implements StatusSource, vscode.Disposable {
  private cached: StatusJson | undefined
  private latestStatusError: string | undefined
  private health: HealthState = { kind: "unknown" }
  private lastMtime = 0
  private heartbeatHandle: ReturnType<typeof setInterval> | null = null
  private mtimeHandle: ReturnType<typeof setInterval> | null = null
  private refreshInflight: Promise<void> | undefined
  private sourcesChanged: EventCallback
  readonly workspaceRoot: string

  tree: VoltTreeProvider
  history: VoltHistoryProvider
  drift: VoltDriftDecorationProvider

  constructor(workspaceRoot: string, sourcesChanged: EventCallback) {
    this.workspaceRoot = workspaceRoot
    this.sourcesChanged = sourcesChanged
    this.lastMtime = readStateMtime(workspaceRoot)
    this.tree = new VoltTreeProvider(() => [this])
    this.history = new VoltHistoryProvider(() => [this.workspaceRoot])
    this.drift = new VoltDriftDecorationProvider()
  }

  get status(): StatusJson | undefined { return this.cached }
  get healthState(): HealthState { return this.health }
  get isRefreshing(): boolean { return this.refreshInflight !== undefined }
  get statusError(): string | undefined { return this.latestStatusError }

  asSource(): StatusSource { return this }

  async start(): Promise<void> {
    this.startHeartbeat()
    this.startMtimePoll()
    await this.refresh()
  }

  async refresh(options: { skipHealthProbe?: boolean } = {}): Promise<void> {
    if (this.refreshInflight !== undefined) {
      logln(`refresh[${basename(this.workspaceRoot)}]: already running — coalesced`)
      return
    }
    const skipHealth = options.skipHealthProbe ?? false
    logln(`refresh[${basename(this.workspaceRoot)}]: starting (mutationInFlight=${isMutationInFlight(this.workspaceRoot)} skipHealth=${skipHealth})`)
    this.refreshInflight = (async () => {
      if (!skipHealth) {
        await this.probeHealth()
        logln(`refresh[${basename(this.workspaceRoot)}]: probeHealth done — kind=${this.health.kind}`)
      }
      if (skipHealth || isBridgeOnline(this.health)) {
        await this.doRefresh()
      } else {
        logln(`refresh[${basename(this.workspaceRoot)}]: skipping — bridge is ${this.health.kind} (${describeOffline(this.health)})`)
        this.clearStatusForError(undefined)
      }
    })().finally(() => {
      this.refreshInflight = undefined
      logln(`refresh[${basename(this.workspaceRoot)}]: finished (status=${this.cached === undefined ? "undefined" : `inc=${changeCount(this.cached.incoming)} out=${changeCount(this.cached.outgoing)}`})`)
      this.tree.refresh()
      this.history.refresh()
      this.sourcesChanged(this.workspaceRoot)
    })
    this.tree.refresh()
    this.sourcesChanged(this.workspaceRoot)
    return this.refreshInflight
  }

  async probeHealth(): Promise<void> {
    const port = readBridgePort(this.workspaceRoot)
    const prev = this.health
    const next: HealthState = port === undefined
      ? { kind: "unreachable", reason: ".volt/config.json missing or has no bridge.port" }
      : await probeHealth(port)
    this.health = next
    maybeNotifyConnectionLoss(this.workspaceRoot, prev, next)
  }

  pollStateMtime(): boolean {
    const current = readStateMtime(this.workspaceRoot)
    if (current !== this.lastMtime) {
      logln(`pollStateMtime[${basename(this.workspaceRoot)}]: mtime changed (cached=${this.lastMtime} current=${current})`)
      return true
    }
    return false
  }

  applyStatus(source: "walk" | "post-mutation", status: StatusJson): void {
    logln(`applyStatus[${basename(this.workspaceRoot)}] source=${source} inc=${changeCount(status.incoming)} out=${changeCount(status.outgoing)} projectMismatch=${status.projectMismatch !== null}`)
    const prevStatus = this.cached
    this.cached = status
    this.latestStatusError = undefined
    this.lastMtime = readStateMtime(this.workspaceRoot)
    maybeNotifyProjectMismatch(prevStatus, status)
  }

  dispose(): void {
    if (this.heartbeatHandle !== null) { clearInterval(this.heartbeatHandle); this.heartbeatHandle = null }
    if (this.mtimeHandle !== null) { clearInterval(this.mtimeHandle); this.mtimeHandle = null }
    this.tree.dispose()
    this.history.dispose()
    this.drift.dispose()
  }

  private startHeartbeat(): void {
    if (this.heartbeatHandle !== null) return
    logln(`heartbeat[${basename(this.workspaceRoot)}]: starting (/health every ${HEALTH_HEARTBEAT_MS}ms)`)
    this.heartbeatHandle = setInterval(() => {
      if (isMutationInFlight(this.workspaceRoot)) return
      void this.probeHealth().then(() => this.tree.refresh())
    }, HEALTH_HEARTBEAT_MS)
  }

  private startMtimePoll(): void {
    if (this.mtimeHandle !== null) return
    this.mtimeHandle = setInterval(() => {
      if (isMutationInFlight(this.workspaceRoot)) return
      if (this.pollStateMtime()) void this.refresh()
    }, STATE_MTIME_POLL_MS)
  }

  private clearStatusForError(reason: string | undefined): void {
    this.cached = undefined
    this.latestStatusError = reason
  }

  private async doRefresh(): Promise<void> {
    logln(`doRefresh: spawning 'volt status --json' in ${this.workspaceRoot}`)
    const result = await spawnCapture(this.workspaceRoot, ["status", "--json"])
    logln(`doRefresh: exit=${result.code} stdout.len=${result.stdout.length} stderr.len=${result.stderr.length}`)
    if (result.code !== 0) {
      logln(`doRefresh: non-zero exit, stderr: ${result.stderr.slice(0, 500)}`)
      const firstErrLine = firstNonEmptyLine(result.stderr) ?? `volt status exited ${result.code}`
      const transitionedToError = this.latestStatusError === undefined
      this.clearStatusForError(firstErrLine)
      if (transitionedToError) {
        const action = "Show Output"
        void vscode.window
          .showErrorMessage(`Volt: status failed — ${firstErrLine}`, action)
          .then((pick) => { if (pick === action) void vscode.commands.executeCommand("volt.showOutput") })
      }
      return
    }
    let parsed: StatusJson
    try {
      parsed = JSON.parse(result.stdout) as StatusJson
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logln(`doRefresh: JSON parse failed: ${msg}`)
      const transitionedToError = this.latestStatusError === undefined
      this.clearStatusForError(`volt status produced malformed JSON: ${msg}`)
      if (transitionedToError) {
        const action = "Show Output"
        void vscode.window
          .showErrorMessage(`Volt: status produced unreadable JSON — ${msg}`, action)
          .then((pick) => { if (pick === action) void vscode.commands.executeCommand("volt.showOutput") })
      }
      return
    }
    this.applyStatus("walk", parsed)
  }
}

export function registerWorkspaces(
  context: vscode.ExtensionContext,
  statuses: Map<string, VoltStatus>,
): { tree: VoltTreeProvider; history: VoltHistoryProvider; drift: VoltDriftDecorationProvider } {
  output()
  logln(`registerWorkspaces: starting. workspaceFolders=${(vscode.workspace.workspaceFolders ?? []).length}`)

  const contentProvider = new VoltContentProvider()
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(VOLT_URI_SCHEME, contentProvider),
  )

  const treeProvider = new VoltTreeProvider(() => [...statuses.values()])
  const historyProvider = new VoltHistoryProvider(() => [...statuses.values()].map((s) => s.workspaceRoot))
  const driftProvider = new VoltDriftDecorationProvider()

  const addWorkspace = (folder: vscode.WorkspaceFolder): void => {
    logln(`addWorkspace: ${folder.uri.fsPath}`)
    const root = folder.uri.fsPath
    if (statuses.has(root)) return
    const configPath = join(root, ".volt", "config.json")
    if (!existsSync(configPath)) {
      watchForVoltConfig(folder, statuses, context)
      return
    }
    const s = new VoltStatus(root, () => { treeProvider.refresh(); historyProvider.refresh() })
    statuses.set(root, s)
    context.subscriptions.push(s)
    logln(`addWorkspace: created VoltStatus for ${root}`)
    void s.start()
  }

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    addWorkspace(folder)
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders((evt) => {
      for (const f of evt.added) addWorkspace(f)
      for (const f of evt.removed) {
        const s = statuses.get(f.uri.fsPath)
        if (s !== undefined) { s.dispose(); statuses.delete(f.uri.fsPath) }
      }
      treeProvider.refresh()
      historyProvider.refresh()
    }),
  )

  const tree = vscode.window.createTreeView("volt.scm", {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  })
  context.subscriptions.push(tree)

  const historyView = vscode.window.createTreeView("volt.history", {
    treeDataProvider: historyProvider,
    showCollapseAll: true,
  })
  context.subscriptions.push(historyView)

  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(driftProvider),
  )

  const driftStatusItem = vscode.window.createStatusBarItem("volt.drift", vscode.StatusBarAlignment.Left, 50)
  driftStatusItem.name = "Volt — IDE drift"
  driftStatusItem.command = "volt.scm.focus"
  context.subscriptions.push(driftStatusItem)

  const updateDrift = (): void => {
    const c = driftProvider.refresh(
      [...statuses.values()].map((s) => ({ root: vscode.Uri.file(s.workspaceRoot), status: s.status })),
    )
    if (c.incoming + c.outgoing + c.conflicts === 0) {
      driftStatusItem.hide()
      return
    }
    const parts: string[] = []
    if (c.conflicts > 0) parts.push(`$(warning) ${c.conflicts}`)
    if (c.incoming > 0) parts.push(`$(arrow-down) ${c.incoming}`)
    if (c.outgoing > 0) parts.push(`$(arrow-up) ${c.outgoing}`)
    driftStatusItem.text = `$(sync) Volt ${parts.join(" ")}`
    driftStatusItem.tooltip =
      `Volt — vs the IDE: ${c.incoming} to pull, ${c.outgoing} to push` +
      (c.conflicts > 0 ? `, ${c.conflicts} conflict(s)` : "") +
      `\nClick to open the Volt view.`
    driftStatusItem.show()
  }

  const updateBadge = (): void => {
    let total = 0
    let anyMerging = false
    for (const s of statuses.values()) {
      total += totalChanges(s.status)
      if (s.status?.merging != null) anyMerging = true
    }
    tree.badge = total > 0 ? { value: total, tooltip: `Volt: ${total} change(s) to review` } : undefined
    void vscode.commands.executeCommand("setContext", "volt.merging", anyMerging)
    updateDrift()
  }

  const origRefresh = treeProvider.refresh.bind(treeProvider)
  treeProvider.refresh = () => { origRefresh(); updateBadge() }

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.scheme !== "file") return
      if (!isPouFile(doc.uri.fsPath)) return
      const folder = vscode.workspace.getWorkspaceFolder(doc.uri)
      if (folder === undefined) return
      const s = statuses.get(folder.uri.fsPath)
      if (s === undefined) return
      logln(`onDidSaveTextDocument[${folder.name}] ${vscode.workspace.asRelativePath(doc.uri, false)}`)
      void s.refresh()
    }),
  )

  updateBadge()
  return { tree: treeProvider, history: historyProvider, drift: driftProvider }
}

function watchForVoltConfig(
  folder: vscode.WorkspaceFolder,
  statuses: Map<string, VoltStatus>,
  context: vscode.ExtensionContext,
): void {
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(folder, ".volt/config.json"),
  )
  const onAppear = (): void => {
    if (statuses.has(folder.uri.fsPath)) return
    const s = new VoltStatus(folder.uri.fsPath, () => {})
    statuses.set(folder.uri.fsPath, s)
    context.subscriptions.push(s)
    logln(`watchForVoltConfig[${folder.name}]: config appeared — creating VoltStatus`)
    void s.start()
  }
  const onGone = (): void => {
    const s = statuses.get(folder.uri.fsPath)
    if (s !== undefined) { s.dispose(); statuses.delete(folder.uri.fsPath) }
  }
  watcher.onDidCreate(onAppear)
  watcher.onDidChange(onAppear)
  watcher.onDidDelete(onGone)
  context.subscriptions.push(watcher)
}

