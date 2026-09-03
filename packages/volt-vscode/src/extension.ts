import * as vscode from "vscode"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { startLsp, stopLsp, registerLspCommands, markLspFailed } from "./lsp.js"
import { registerCommands } from "./commands.js"
import { hasVoltConfig, workspaceFolders } from "./workspace.js"
import { VoltViews } from "./panel.js"
import { VoltDecorations } from "./decorations.js"
import { VoltContentProvider, SCHEME } from "./content.js"
import { VoltStatus, aggregate, connectorStatus, setBundledCli, connectWorkspace, leaveWorkspace, closeSession, startConnectorFeed, onConnectorView, voltLog } from "@volt/control"

// Resolve volt.exe by ABSOLUTE path. Relying on `volt` from PATH fails as `spawn volt ENOENT` whenever VS Code was
// launched BEFORE the installer put it on PATH — the running process captured the old PATH, and a broadcast can't
// retro-fit it. The installer lays volt.exe down at a known place (…\Programs\Volt\current\bin); fall back to PATH
// (dev / non-default install) so cliScript still works.
function resolveVoltCli(): string | undefined {
  const exe = process.platform === "win32" ? "volt.exe" : "volt"
  if (!process.env.LOCALAPPDATA) return undefined
  return [join(process.env.LOCALAPPDATA, "Programs", "Volt", "current", "bin", exe)].find(existsSync)
}

const statuses = new Map<string, VoltStatus>()
let views: VoltViews | undefined

export async function activate(context: vscode.ExtensionContext) {
	// The `volt` CLI is the shipped C# binary the Volt installer lays down (a per-platform native exe is too heavy
	// to bundle in a Marketplace .vsix). Resolve it by absolute path — PATH alone breaks with `spawn volt ENOENT`
	// when VS Code predates the install. If not found (dev / non-default install) volt-control's cliScript falls
	// back to `volt` on PATH; the LSP + language features work standalone regardless.
	const voltCli = resolveVoltCli()
	if (voltCli) setBundledCli(voltCli)

	// No agent command here. Volt does not launch, bundle or configure an AI agent — the user's agent (Claude Code,
	// Cursor, Windsurf, anything with a terminal) reaches Volt through the `volt` CLI on PATH. See the host
	// integration docs on the website.

	const decorations = new VoltDecorations()
	views = new VoltViews()
	context.subscriptions.push(views)

	// Ask the connector (the one aggregator) whether any PLC project is detected across all IDEs. The RESULT drives
	// the Bridge view — which owns the whole connection lifecycle (name the project → initialize → connect →
	// disconnect); the Sync view's welcomes only point there. No vendor buttons: the user picks a project, vendor
	// is derived. Skipped once a folder is bound.
	const refreshBridgeLive = async (): Promise<void> => {
		// One connector probe drives BOTH onboarding signals: whether the connector is even running (so the Bridge
		// view can tell "connector not running" apart from "no IDE project open" — they used to look identical) AND
		// the detected-project list. Probed regardless of bound state: the list ALSO feeds the Bridge view's offline
		// reconnect surface (pick your project to reconnect, or a renamed one to rebind), not just unbound onboarding.
		const view = await connectorStatus()
		const projects = view?.projects ?? []
		// NOTE: no `volt.hasProjects` context key any more. It used to gate `volt.init`'s `enablement`, which made
		// the detected-project ROWS dead on click whenever the key was stale or false — VS Code silently does
		// nothing when a TreeItem's command is disabled, so "click to set up" did exactly that: nothing. The
		// command reports "No PLC project detected…" itself, which beats a button that ignores you.
		views?.setDetected(projects, view !== undefined)
	}
	// The list rides the connector feed's ONE clock — no second timer for a value the session client already has.
	const bridgeSub = onConnectorView.event(() => void refreshBridgeLive())
	void startConnectorFeed()

	// Bring a (possibly just-initialized) folder online without a reload.
	const ensureWorkspace = (folderPath: string): void => {
		if (statuses.has(folderPath)) { void statuses.get(folderPath)?.refresh(true); return }
		const folder = workspaceFolders().find((f) => f.uri.fsPath === folderPath)
		if (folder !== undefined && hasVoltConfig(folder)) addWorkspace(folder, decorations)
		updateContextKeys()
		void refreshBridgeLive()
	}

	context.subscriptions.push(
		bridgeSub,
		vscode.window.registerFileDecorationProvider(decorations),
		vscode.workspace.registerTextDocumentContentProvider(SCHEME, new VoltContentProvider()),
		...registerCommands(statuses, ensureWorkspace),
	)

	for (const folder of workspaceFolders()) {
		if (hasVoltConfig(folder)) addWorkspace(folder, decorations)
	}
	// Gate the UI immediately (before the first status lands) so the menu when-clauses resolve.
	views.update(statuses)
	updateContextKeys()
	void refreshBridgeLive()

	context.subscriptions.push(
		vscode.workspace.onDidChangeWorkspaceFolders((e) => {
			for (const folder of e.added) { if (hasVoltConfig(folder)) addWorkspace(folder, decorations) }
			for (const folder of e.removed) {
				voltLog("vscode", `releasing workspace ${folder.uri.fsPath} — folder removed`)
				void leaveWorkspace(folder.uri.fsPath) // left this project → disconnect the bridge (shared lifecycle)
				statuses.get(folder.uri.fsPath)?.dispose(); statuses.delete(folder.uri.fsPath)
				decorations.remove(folder.uri.fsPath)
			}
			views?.update(statuses)
			updateContextKeys()
			void refreshBridgeLive()
		}),
		// A save can only change OUTGOING — the IDE cannot have moved because we wrote a file on disk. Refresh
		// LOCALLY so this doesn't issue a /refs, which walks the entire project on the IDE's single thread and
		// freezes CODESYS for seconds on every save. Incoming still updates on the 4s health poll and on the
		// state-file mtime poll, which are the events that can actually change it.
		vscode.workspace.onDidSaveTextDocument((doc) => {
			for (const [, s] of statuses) {
				if (doc.uri.fsPath.startsWith(s.workspaceRoot) && s.isTrackedFile(doc.fileName)) s.refresh(false, true)
			}
		}),
		// Re-probe when the window regains focus, so reconnecting an IDE updates the onboarding promptly.
		vscode.window.onDidChangeWindowState((ws) => { if (ws.focused) void refreshBridgeLive() }),
	)

	// Register the LSP commands UNCONDITIONALLY (they guard on the live client internally) so a palette
	// invocation never errors "command not found" even when the server fails to launch below.
	context.subscriptions.push(...registerLspCommands())

	// The LSP is best-effort: a failure to launch the server must NOT fail activation (which would
	// tear down the Volt views). Sync + views work without it.
	try {
		const clients = await startLsp(context)
		context.subscriptions.push(...clients)
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err)
		console.error("Volt: language server failed to start —", err)
		// Leave a PERSISTENT, clickable trace in the status bar. A toast is dismissible (and easy to miss on
		// startup), after which nothing on screen said the language server was dead — code just quietly had no
		// navigation or diagnostics.
		markLspFailed(reason)
		void vscode.window.showWarningMessage(
			"Volt: the language server didn't start — IDE sync and the Volt views still work.",
			"Show Output",
		).then((pick) => { if (pick === "Show Output") void vscode.commands.executeCommand("volt.lsp.showOutput") })
	}
}

function addWorkspace(folder: vscode.WorkspaceFolder, decorations: VoltDecorations): void {
	const s = new VoltStatus(folder.uri.fsPath)

	s.onDidChange.event(() => {
		views?.update(statuses)
		if (s.cached !== undefined) decorations.refresh(s.workspaceRoot, s.cached)
		updateContextKeys()
	})
	statuses.set(folder.uri.fsPath, s)
	void s.start()
	// The active project view owns the connection: opening a Volt workspace connects its bridge, through the SAME
	// shared flow as the manual Reconnect (health settles cheaply; drift re-scans only if it connected — this used
	// to run a full `volt status` either way, walking the IDE over a bridge that wasn't serving). Fire-and-forget so
	// activation isn't blocked; a folder removed meanwhile disposes its tracker, which makes the settle a no-op.
	// LOGGED, not toasted: an automatic connect must not interrupt, and the Bridge view already states the outcome
	// (health says whether the connector or the project is the problem, and offers Reconnect).
	void connectWorkspace(s).then((view) =>
		voltLog("vscode", `auto-connect ${folder.uri.fsPath}: ${view.message}`, view.tone === "error" ? "warn" : "info"),
	)
}

/** Drive the menu when-clause context keys off the shared `aggregate()` display model (worst-state-wins). No
 *  status-bar item — Volt's ambient presence is the activity-bar container; the sync/bridge views carry the state.
 *   - `volt.workspaceInitialized` — any bound workspace exists (base gate for the view actions).
 *   - `volt.bridgeOnline` — the bridge is reachable (insync / drift / degraded) → pull/push/build are allowed.
 *   - `volt.bridgeOffline` — initialized but genuinely unreachable (offline / noproject / probing) → the Connect
 *     welcome shows. NOT a tray-deselect (that stays connected, sync still works), and NOT merge/mismatch (their
 *     own affordances handle those). */
function updateContextKeys(): void {
	const d = aggregate([...statuses.values()].map((s) => ({ status: s.cached, health: s.health })))
	const initialized = statuses.size > 0
	const online = d.severity === "insync" || d.severity === "drift" || d.severity === "degraded"
	void vscode.commands.executeCommand("setContext", "volt.workspaceInitialized", initialized)
	void vscode.commands.executeCommand("setContext", "volt.bridgeOnline", initialized && online)
	void vscode.commands.executeCommand("setContext", "volt.bridgeOffline", initialized && (d.severity === "offline" || d.severity === "noproject"))
}

export function deactivate(): Thenable<void> {
	// End the connector session — one DELETE drops every interest at once — bounded so a slow or absent connector
	// cannot hold VS Code open. Shared with the desktop (@volt/control `closeSession`), because both shells had the
	// same copy AND the same bug: they awaited a `leaveWorkspace` per root first, which could not finish inside the
	// bound, so the DELETE never fired. Folded into the returned thenable alongside the LSP shutdown so the editor
	// WAITS for both.
	const disconnected = closeSession()
	for (const [, s] of statuses) s.dispose()
	// Return a thenable (not an array — VS Code only awaits a thenable return value, so the old `return []` was never
	// awaited) so the editor waits for the stdio LSP to exit + the bridges to disconnect before killing the extension
	// host. Fire-and-forget disposal let the server orphan on an extension update → the zombie LSP.
	return Promise.all([stopLsp(), disconnected]).then(() => undefined)
}
