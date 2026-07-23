import * as vscode from "vscode"
import { resolveOpencodeExe, hasOpencode } from "./agent.js"
import { startLsp, stopLsp, registerLspCommands } from "./lsp.js"
import { registerCommands } from "./commands.js"
import { hasVoltConfig, workspaceFolders } from "./workspace.js"
import { VoltViews } from "./panel.js"
import { VoltDecorations } from "./decorations.js"
import { VoltContentProvider, SCHEME } from "./content.js"
import { VoltStatus, aggregate, connectorStatus } from "@volt/control"

const statuses = new Map<string, VoltStatus>()
let views: VoltViews | undefined

// opencode is missing — say so and point at opencode.ai. The Volt installer offers the winget install as an
// opt-in task, so this doesn't reimplement one; the rest of Volt works without opencode either way.
async function promptInstallOpencode(): Promise<void> {
	const get = "Get it from opencode.ai"
	const pick = await vscode.window.showWarningMessage(
		"The Volt agent is powered by the opencode CLI, which isn't installed. Sync, the language server and the IDE bridge work without it.",
		get,
	)
	if (pick === get) void vscode.env.openExternal(vscode.Uri.parse("https://opencode.ai/download"))
}

export async function activate(context: vscode.ExtensionContext) {
	// The `volt` CLI is the shipped C# binary the Volt installer puts on PATH — a prerequisite the extension does
	// not bundle (a per-platform native exe is too heavy for a Marketplace .vsix). volt-control's cliScript falls
	// back to `volt` on PATH, so no setBundledCli here; the LSP + language features work standalone regardless.

	// "Volt: Open Agent" — open, or focus an already-open, agent terminal running opencode (which Volt makes
	// PLC-aware via OPENCODE_CONFIG_DIR). New Session always starts a fresh one. opencode is a PREREQUISITE the
	// extension doesn't bundle — if it's absent we prompt to install it (see agent.ts / promptInstallOpencode).
	let agentTerm: vscode.Terminal | undefined
	let opening = false // guard: the hasOpencode() await lets a second invocation race in and create a 2nd terminal
	const openAgent = async (newSession: boolean): Promise<void> => {
		if (!newSession && agentTerm !== undefined) {
			agentTerm.show()
			return
		}
		if (opening) return
		opening = true
		try {
			if (!(await hasOpencode())) {
				void promptInstallOpencode()
				return
			}
			const cwd = workspaceFolders()[0]?.uri.fsPath
			agentTerm = vscode.window.createTerminal({ name: "Volt Agent", cwd, shellPath: resolveOpencodeExe() })
			agentTerm.show()
		} finally {
			opening = false
		}
	}
	context.subscriptions.push(
		vscode.commands.registerCommand("volt.openAgent", () => void openAgent(false)),
		vscode.commands.registerCommand("volt.newAgentSession", () => void openAgent(true)),
		vscode.window.onDidCloseTerminal((t) => {
			if (t === agentTerm) agentTerm = undefined
		}),
	)

	const decorations = new VoltDecorations()
	views = new VoltViews()
	context.subscriptions.push(views)

	// Ask the connector (the one aggregator) whether any PLC project is detected across all IDEs. The RESULT drives
	// the Bridge view — which owns the whole connection lifecycle (name the project → initialize → connect →
	// disconnect); the Sync view's welcomes only point there. No vendor buttons: the user picks a project, vendor
	// is derived. Skipped once a folder is bound.
	const refreshBridgeLive = async (): Promise<void> => {
		const unbound = statuses.size === 0 && workspaceFolders().length > 0
		// One connector probe drives BOTH onboarding signals: whether the connector is even running (so the Bridge
		// view can tell "connector not running" apart from "no IDE project open" — they used to look identical) AND
		// the detected-project list. Only probed while unbound; a bound folder's live health comes from VoltStatus.
		const view = unbound ? await connectorStatus() : undefined
		const projects = view?.projects ?? []
		void vscode.commands.executeCommand("setContext", "volt.hasProjects", projects.length > 0)
		views?.setDetected(projects, !unbound || view !== undefined)
	}
	const bridgeTimer = setInterval(() => void refreshBridgeLive(), 10_000)

	// Bring a (possibly just-initialized) folder online without a reload.
	const ensureWorkspace = (folderPath: string): void => {
		if (statuses.has(folderPath)) { void statuses.get(folderPath)?.refresh(true); return }
		const folder = workspaceFolders().find((f) => f.uri.fsPath === folderPath)
		if (folder !== undefined && hasVoltConfig(folder)) addWorkspace(folder, decorations)
		updateContextKeys()
		void refreshBridgeLive()
	}

	context.subscriptions.push(
		{ dispose: () => clearInterval(bridgeTimer) },
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
				statuses.get(folder.uri.fsPath)?.dispose(); statuses.delete(folder.uri.fsPath)
			}
			views?.update(statuses)
			updateContextKeys()
			void refreshBridgeLive()
		}),
		vscode.workspace.onDidSaveTextDocument((doc) => {
			for (const [, s] of statuses) {
				if (doc.uri.fsPath.startsWith(s.workspaceRoot) && s.isTrackedFile(doc.fileName)) s.refresh()
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
		console.error("Volt: language server failed to start —", err)
		void vscode.window.showWarningMessage("Volt: the language server didn't start — IDE sync and the Volt views still work. See the Extension Host log for details.")
	}
}

function addWorkspace(folder: vscode.WorkspaceFolder, decorations: VoltDecorations): void {
	const s = new VoltStatus(folder.uri.fsPath)

	s.onDidChange.event(() => {
		views?.update(statuses)
		if (s.cached !== undefined) decorations.refresh(s.cached)
		updateContextKeys()
	})
	statuses.set(folder.uri.fsPath, s)
	void s.start()
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
	for (const [, s] of statuses) s.dispose()
	// Return the LSP shutdown PROMISE (not an array — VS Code only awaits a thenable return value, so the old
	// `return []` was never awaited) so the editor WAITS for the stdio server to exit before killing the
	// extension host. Fire-and-forget disposal let the server orphan on an extension update → the zombie LSP.
	return stopLsp()
}
