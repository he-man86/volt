import * as vscode from "vscode"
import { join } from "node:path"
import { resolveOpencodeExe, hasOpencode } from "./agent.js"
import { startLsp } from "./lsp.js"
import { setBundledCli } from "@volt/control"
import { registerCommands } from "./commands.js"
import { VoltStatus, hasVoltConfig, workspaceFolders } from "./state/status.js"
import { VoltViews } from "./views/panel.js"
import { VoltDecorations } from "./providers/decorations.js"
import { VoltContentProvider, SCHEME } from "./providers/content.js"
import { aggregate, probeVendors, isBridgeOnline, type VoltSeverity } from "@volt/control"

const statuses = new Map<string, VoltStatus>()
let views: VoltViews | undefined

// opencode is missing — offer the same two paths as the desktop app: a one-click winget install (run live in
// a terminal so the user sees progress) or the opencode.ai download page. The rest of Volt works without it.
async function promptInstallOpencode(): Promise<void> {
	const install = "Install opencode",
		get = "Get it from opencode.ai"
	const pick = await vscode.window.showWarningMessage(
		"The Volt agent is powered by the opencode CLI, which isn't installed. Sync, the language server and the IDE bridge work without it.",
		install,
		get,
	)
	if (pick === install) {
		const t = vscode.window.createTerminal("Install opencode")
		t.show()
		t.sendText("winget install --exact --id SST.opencode --accept-source-agreements --accept-package-agreements")
	} else if (pick === get) {
		void vscode.env.openExternal(vscode.Uri.parse("https://opencode.ai/download"))
	}
}

export async function activate(context: vscode.ExtensionContext) {
	// Use the CLI shipped inside the extension — no per-workspace Node install needed.
	setBundledCli(join(context.extensionPath, "dist", "cli.js"))

	// "Volt: Open Agent" — open, or focus an already-open, agent terminal running opencode (which Volt makes
	// PLC-aware via OPENCODE_CONFIG_DIR). New Session always starts a fresh one. opencode is a PREREQUISITE the
	// extension doesn't bundle — if it's absent we prompt to install it (see agent.ts / promptInstallOpencode).
	let agentTerm: vscode.Terminal | undefined
	const openAgent = async (newSession: boolean): Promise<void> => {
		if (!newSession && agentTerm !== undefined) {
			agentTerm.show()
			return
		}
		if (!(await hasOpencode())) {
			void promptInstallOpencode()
			return
		}
		const cwd = workspaceFolders()[0]?.uri.fsPath
		agentTerm = vscode.window.createTerminal({ name: "Volt Agent", cwd, shellPath: resolveOpencodeExe() })
		agentTerm.show()
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

	const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
	statusBar.command = "volt.status"

	// Probe both bridge ports (parallel) so the IDE Sync view welcome's init buttons enable only for a
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
	statusBar.command = d.action === "acceptRename" ? "volt.acceptProjectRename" : "volt.status"
	statusBar.backgroundColor =
		d.severity === "mismatch" || d.severity === "offline" ? new vscode.ThemeColor("statusBarItem.warningBackground") : undefined
	statusBar.show()
}

export function deactivate(): Thenable<void>[] {
	for (const [, s] of statuses) s.dispose()
	return []
}
