import * as vscode from "vscode"
import { join } from "node:path"
import { resolveAgentExe } from "./agent.js"
import { startLsp } from "./lsp.js"
import { setBundledCli } from "@opencode-ai/volt-control"
import { registerCommands } from "./commands.js"
import { VoltStatus, hasVoltConfig, workspaceFolders } from "./state/status.js"
import { VoltViews } from "./views/panel.js"
import { VoltDecorations } from "./providers/decorations.js"
import { VoltContentProvider, SCHEME } from "./providers/content.js"
import { aggregate, probeVendors, isBridgeOnline, type VoltSeverity } from "@opencode-ai/volt-control"

const statuses = new Map<string, VoltStatus>()
let views: VoltViews | undefined

export async function activate(context: vscode.ExtensionContext) {
	// Use the CLI shipped inside the extension — no per-workspace Node install needed.
	setBundledCli(join(context.extensionPath, "dist", "cli.js"))

	// "Volt: Open Agent" — like opencode's Quick Launch: open, or focus an already-open, agent terminal.
	// New Session always starts a fresh one. The agent binary is a PREREQUISITE (desktop install or `volt`
	// on PATH) — the extension doesn't bundle or download it (see agent.ts).
	let agentTerm: vscode.Terminal | undefined
	const openAgent = (newSession: boolean): void => {
		if (!newSession && agentTerm !== undefined) {
			agentTerm.show()
			return
		}
		const cwd = workspaceFolders()[0]?.uri.fsPath
		agentTerm = vscode.window.createTerminal({ name: "Volt Agent", cwd, shellPath: resolveAgentExe() })
		agentTerm.show()
	}
	context.subscriptions.push(
		vscode.commands.registerCommand("volt.openAgent", () => openAgent(false)),
		vscode.commands.registerCommand("volt.newAgentSession", () => openAgent(true)),
		vscode.window.onDidCloseTerminal((t) => {
			if (t === agentTerm) agentTerm = undefined
		}),
	)

	const decorations = new VoltDecorations()
	views = new VoltViews()
	context.subscriptions.push(views)

	const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
	statusBar.command = "volt.status"

	// Probe both bridge ports (parallel) so the Source Control welcome's init buttons enable only for a
	// vendor whose IDE is actually connected — `volt.twincatLive` / `volt.codesysLive` drive their
	// command `enablement` (visible-but-disabled until the bridge is up). Skipped once a folder is bound.
	const refreshBridgeLive = async (): Promise<void> => {
		const cfg = vscode.workspace.getConfiguration("volt.bridge")
		const unbound = statuses.size === 0 && workspaceFolders().length > 0
		const live = unbound ? await probeVendors(cfg.get<number>("twincatPort", 8555), cfg.get<number>("codesysPort", 8556)) : []
		const isLive = (v: "twincat" | "codesys"): boolean => live.some((p) => p.vendor === v && isBridgeOnline(p.state))
		void vscode.commands.executeCommand("setContext", "volt.twincatLive", isLive("twincat"))
		void vscode.commands.executeCommand("setContext", "volt.codesysLive", isLive("codesys"))
	}
	const bridgeTimer = setInterval(() => void refreshBridgeLive(), 10_000)

	// Bring a (possibly just-initialized) folder online without a reload.
	const ensureWorkspace = (folderPath: string): void => {
		if (statuses.has(folderPath)) { void statuses.get(folderPath)?.refresh(true); return }
		const folder = workspaceFolders().find((f) => f.uri.fsPath === folderPath)
		if (folder !== undefined && hasVoltConfig(folder)) addWorkspace(folder, decorations, statusBar)
		updateGlobalUi(statusBar)
		void refreshBridgeLive()
	}

	context.subscriptions.push(
		statusBar,
		{ dispose: () => clearInterval(bridgeTimer) },
		vscode.window.registerFileDecorationProvider(decorations),
		vscode.workspace.registerTextDocumentContentProvider(SCHEME, new VoltContentProvider()),
		...registerCommands(statuses, ensureWorkspace),
	)

	for (const folder of workspaceFolders()) {
		if (hasVoltConfig(folder)) addWorkspace(folder, decorations, statusBar)
	}
	// Gate the UI immediately (before the first status lands) so the menu when-clauses resolve.
	views.update(statuses)
	updateGlobalUi(statusBar)
	void refreshBridgeLive()

	context.subscriptions.push(
		vscode.workspace.onDidChangeWorkspaceFolders((e) => {
			for (const folder of e.added) { if (hasVoltConfig(folder)) addWorkspace(folder, decorations, statusBar) }
			for (const folder of e.removed) {
				statuses.get(folder.uri.fsPath)?.dispose(); statuses.delete(folder.uri.fsPath)
			}
			views?.update(statuses)
			updateGlobalUi(statusBar)
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

function addWorkspace(folder: vscode.WorkspaceFolder, decorations: VoltDecorations, statusBar: vscode.StatusBarItem): void {
	const s = new VoltStatus(folder.uri.fsPath)

	s.onDidChange.event(() => {
		views?.update(statuses)
		if (s.cached !== undefined) decorations.refresh(s.cached, s.workspaceRoot)
		updateGlobalUi(statusBar)
	})
	statuses.set(folder.uri.fsPath, s)
	void s.start()
}

/** Drive the `volt.workspaceInitialized` context key (gates the view-title actions) AND the ambient
 *  status-bar indicator, both off the shared `aggregate()` display model (health / merge / mismatch /
 *  drift, worst-state-wins) — the one place that mapping lives now, rendered by every surface. */
const SEV_ICON: Record<VoltSeverity, string> = {
	uninitialized: "circle-slash",
	merging: "git-merge",
	mismatch: "warning",
	offline: "plug",
	noproject: "circle-slash",
	degraded: "warning",
	drift: "sync",
	insync: "check",
}

function updateGlobalUi(statusBar: vscode.StatusBarItem): void {
	const d = aggregate([...statuses.values()].map((s) => ({ status: s.cached, health: s.health })))
	const initialized = statuses.size > 0
	void vscode.commands.executeCommand("setContext", "volt.workspaceInitialized", initialized)

	if (!initialized) { statusBar.hide(); return }

	statusBar.text = `$(${SEV_ICON[d.severity]}) ${d.label}`
	statusBar.tooltip = d.tooltip
	statusBar.command = d.action === "startBridge" ? "volt.startBridge" : d.action === "acceptRename" ? "volt.acceptProjectRename" : "volt.status"
	statusBar.backgroundColor =
		d.severity === "mismatch" || d.severity === "offline" ? new vscode.ThemeColor("statusBarItem.warningBackground") : undefined
	statusBar.show()
}

export function deactivate(): Thenable<void>[] {
	for (const [, s] of statuses) s.dispose()
	return []
}
