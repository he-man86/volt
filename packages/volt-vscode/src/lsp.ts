import * as vscode from "vscode"
import { join, dirname } from "node:path"
import { existsSync } from "node:fs"
import { LanguageClient, type LanguageClientOptions, type ServerOptions, TransportKind, DidChangeConfigurationNotification } from "vscode-languageclient/node"

// Every writable PLC source item is one kind-named file (.fb/.prg/.fun/.itf/.gvl, and a DUT under its
// subtype .struct/.enum/.union/.alias) carrying Structured Text. A network-text (FBD/LD) body is detected by content (a leading
// NETWORK token) and highlighted via a TextMate injection; the server routes per-body. Diagnostics
// flow to the host's native Problems panel automatically via the language client.
const LANGUAGE_IDS = ["structured-text"]

// The LSP's real LIVE config surface (see volt-lsp-iec/src/analysis/config.ts): dead-code + the opt-in style
// lints. Vendor is NOT here — the server takes it only from its launch CLI flag (a vendor change needs a
// restart), so sending it would be dead wiring. Compiler-parity checks always run; nothing here maps to the
// 80 diagnostic codes.
// The codes in CODESYS's "Compiler warnings" dialog that Volt implements (matches CONFIGURABLE_CHECKS in
// volt-lsp-iec/src/analysis/config.ts). Each is a `volt.iec.diagnostics.<code>` 3-state control (off/warning/
// error), default "warning" — CODESYS's default. Non-configurable errors are never here. Kept in sync by hand:
// adding a configurable check adds a row here + a `volt.iec.diagnostics.<code>` setting in package.json.
const CONFIGURABLE_CODES = [
	"pointer-not-convertible",
	"jump-label-unreferenced",
	"no-op-statement",
	"sign-change-conversion",
	"narrowing-conversion",
	"string-constant-too-long",
	"constant-no-initial-value",
	"loop-exit-constant",
	"unknown-attribute",
	"enum-comparison",
	"adr-on-bit",
	"inout-own-access",
	"message-pragma-warning",
	"obsolete-usage",
	"interface-implements",
	"inout-in-initializer",
	"input-default-composite",
	"default-not-constant",
	"abstract-output-default",
	"union-inheritance",
	"reserved-keyword",
] as const

function analysisOptions(): { diagnoseDeadCode: boolean; diagnostics: Record<string, string> } {
	const c = vscode.workspace.getConfiguration("volt.iec")
	const diagnostics: Record<string, string> = {}
	for (const code of CONFIGURABLE_CODES) diagnostics[code] = c.get<string>(`diagnostics.${code}`, "warning")
	return { diagnoseDeadCode: c.get<boolean>("diagnostics.deadCode", false), diagnostics }
}

// The live client, so `deactivate()` can AWAIT the server's shutdown. Without this the client was only
// disposed via context.subscriptions (fire-and-forget) — on an extension UPDATE the host is torn down
// before the stdio child exits, orphaning it as a zombie LSP that survives reloads and serves stale,
// wrong go-to-def results. Holding the ref + returning stop() from deactivate makes the editor wait.
let activeClient: LanguageClient | undefined
let lspInfo: { version: string; module: string } | undefined

/** Stop the running server and wait for it to exit — called from the extension's `deactivate`. */
export async function stopLsp(): Promise<void> {
	const c = activeClient
	activeClient = undefined
	lspInfo = undefined
	if (c !== undefined) await c.stop().catch(() => c.dispose())
}

/** The LSP commands, registered UNCONDITIONALLY at activation (not inside startLsp) so they exist even when
 *  the server failed to launch — otherwise invoking a palette command declared in package.json errors with
 *  "command not found" exactly when the user is trying to diagnose why the LSP is down. Each guards on the
 *  live client and offers a recovery path. */
// ONE status-bar item for the language server's whole life, created lazily and reused. It used to be created only
// AFTER a successful start, so when the server failed the item never appeared — and with it went the only visible
// way to restart, exactly when a restart is what you want. Now a failure repaints it red and points at the restart.
let statusItem: vscode.StatusBarItem | undefined
function ensureStatusItem(): vscode.StatusBarItem {
	if (statusItem === undefined) statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0)
	return statusItem
}

/** The server didn't start. Show it, in the same place the healthy state lives, wired straight to a restart —
 *  a dismissible toast is not an affordance, and the palette only helps someone who knows the command exists. */
export function markLspFailed(reason: string): void {
	const status = ensureStatusItem()
	status.text = "$(error) Volt LSP"
	status.tooltip = `The Volt language server isn't running.
${reason}
Click to retry.`
	status.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground")
	status.command = "volt.lsp.restart"
	status.show()
}

export function registerLspCommands(): vscode.Disposable[] {
	const notRunning = async (): Promise<void> => {
		const pick = await vscode.window.showWarningMessage("Volt LSP is not running.", "Reload Window")
		if (pick === "Reload Window") void vscode.commands.executeCommand("workbench.action.reloadWindow")
	}
	return [
		vscode.commands.registerCommand("volt.lsp.showInfo", async () => {
			if (activeClient === undefined || lspInfo === undefined) return notRunning()
			// Version in the message (a notification collapses newlines, so the module path would be truncated
			// here); the full path lives in the status-bar tooltip and the output channel's startup line.
			const pick = await vscode.window.showInformationMessage(`Volt LSP v${lspInfo.version}`, "Show Output", "Restart")
			if (pick === "Show Output") activeClient.outputChannel.show()
			else if (pick === "Restart") await vscode.commands.executeCommand("volt.lsp.restart")
		}),
		vscode.commands.registerCommand("volt.lsp.restart", async () => {
			// No client means the server never started (or died). `client.restart()` can't help there, and the old
			// behaviour — "Volt LSP is not running" + Reload Window — made Restart useless in the one state where
			// the user reaches for it. Reload is still the honest fix (activate() owns the client's lifetime), so
			// offer it directly rather than reporting a dead end.
			if (activeClient === undefined) return notRunning()
			await activeClient.restart()
			vscode.window.showInformationMessage("Volt LSP restarted")
		}),
		vscode.commands.registerCommand("volt.lsp.showOutput", () => {
			if (activeClient === undefined) void vscode.window.showWarningMessage("Volt LSP is not running.")
			else activeClient.outputChannel.show()
		}),
	]
}

export async function startLsp(context: vscode.ExtensionContext): Promise<vscode.Disposable[]> {
	// Read the manifest's declared namespace `volt.iec.*`. Was `volt.lsp.*` (never existed); the keys
	// were also declared under the legacy `volt.structuredText.*` (the LSP's old name) — now `volt.iec.*`.
	const cfg = vscode.workspace.getConfiguration("volt.iec")

	const serverModule = resolveServerModule(context, cfg.get<string>("server", "").trim())
	if (serverModule === undefined) {
		vscode.window.showWarningMessage("Volt LSP server not found — Structured Text intelligence is disabled.")
		return []
	}
	// The one number that identifies which build is serving you: the extension version moves every build
	// (<maj>.<min>.<commit-count>, see scripts/version.ts), and the server bundle ships inside this
	// extension — so extension version == server version, and the resolved module PATH names the exact folder.
	const extVersion = (context.extension.packageJSON as { version?: string }).version ?? "unknown"

	// The server is stdio-only and needs `--stdio` plus a vendor flag (it defaults to codesys, so
	// `auto`/`codesys` both pass --codesys). Run it via the editor's own runtime with
	// ELECTRON_RUN_AS_NODE=1 — the same proven pattern volt-control's cli.ts uses to run bundled JS
	// under VS Code / Cursor / Windsurf / Electron with no external node (execing a raw .js is wrong).
	const vendor = cfg.get<"codesys" | "twincat" | "auto">("vendor", "auto")
	const serverOptions: ServerOptions = {
		command: process.execPath,
		// `--server-version` gives the server its true identity: running under the editor's node it executes the
		// LSP's raw .js (not the stamped exe), so without this its serverInfo would report "(dev)". This is the
		// extension version, which moves every build (see scripts/version.ts).
		args: [serverModule, "--stdio", vendor === "twincat" ? "--twincat" : "--codesys", "--server-version", extVersion],
		transport: TransportKind.stdio,
		options: { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } },
	}

	const clientOptions: LanguageClientOptions = {
		documentSelector: LANGUAGE_IDS.map((id) => ({ language: id })),
		// No file-watcher glob here: the server owns its file interest. On `initialized` it dynamically
		// registers didChangeWatchedFiles watchers built from its authoritative SOURCE_EXTENSIONS list (see
		// volt-lsp-iec/src/server/server.ts), so the client never enumerates PLC kinds — add a kind in the
		// LSP and both the crawl and the watchers follow, with nothing to change here.
		initializationOptions: analysisOptions(),
	}

	const client = new LanguageClient("volt-lsp", "Volt LSP", serverOptions, clientOptions)
	await client.start()
	activeClient = client
	lspInfo = { version: extVersion, module: serverModule }

	// Make "which LSP am I running" answerable at a glance. The status-bar item shows the version; its
	// tooltip + the "Volt LSP: Show Info" command reveal the exact server MODULE PATH — which names the
	// installed extension folder (…/volt-vscode-<version>/dist/lsp-server.js), so a stale build is obvious.
	// (No PID: the client doesn't expose the server child's PID, and process.pid is the editor's host, not
	// the server — showing it would send you hunting the wrong process. The module path is the identity.)
	client.outputChannel.appendLine(`Volt LSP started — extension v${extVersion}\n  server module: ${serverModule}`)
	const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0)
	status.text = `$(server-process) Volt LSP ${extVersion}`
	status.tooltip = `Volt LSP ${extVersion}\n${serverModule}\nClick for info`
	status.command = "volt.lsp.showInfo"
	status.show()

	// The client is NOT returned here (so it isn't also torn down via context.subscriptions) — `stopLsp()`
	// from `deactivate` is its sole, awaited teardown. The LSP commands live in `registerLspCommands` (wired
	// unconditionally in activate). This returns only the disposables tied to a live client.
	return [
		status,
		// Push the live-togglable config (dead-code + lints) whenever a `volt.iec.*` setting changes, so a
		// toggle takes effect without a restart. Vendor is fixed at launch (a change needs Volt LSP: Restart).
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("volt.iec"))
				void client.sendNotification(DidChangeConfigurationNotification.type, { settings: analysisOptions() })
		}),
	]
}

/** First existing server module, honoring the explicit override first, then the packaged bundle,
 *  then the installed dep, then the dev workspace sibling. */
function resolveServerModule(context: vscode.ExtensionContext, override: string): string | undefined {
	const candidates = [
		override, // volt.iec.server
		join(context.extensionPath, "dist", "lsp-server.js"), // packaged (the `bun run build` output)
		join(context.extensionPath, "node_modules", "@volt", "lsp-iec", "dist", "src", "bin.js"),
		join(dirname(context.extensionPath), "volt-lsp-iec", "dist", "src", "bin.js"), // dev workspace
	]
	return candidates.find((p) => p.length > 0 && existsSync(p))
}
