import * as vscode from "vscode"
import { join, dirname } from "node:path"
import { existsSync } from "node:fs"
import { LanguageClient, type LanguageClientOptions, type ServerOptions, TransportKind, DidChangeConfigurationNotification } from "vscode-languageclient/node"

// Every writable PLC source item is one kind-named file (.fb/.prg/.fun/.itf/.dut/.gvl — every DUT is
// one .dut) carrying Structured Text. A graphical (VG) body is detected by content (a leading
// NETWORK token) and highlighted via a TextMate injection; the server routes per-body. Diagnostics
// flow to the host's native Problems panel automatically via the language client.
const LANGUAGE_IDS = ["structured-text"]

// The LSP's real LIVE config surface (see volt-lsp-iec/src/analysis/config.ts): dead-code + the opt-in style
// lints. Vendor is NOT here — the server takes it only from its launch CLI flag (a vendor change needs a
// restart), so sending it would be dead wiring. Compiler-parity checks always run; nothing here maps to the
// 80 diagnostic codes.
function analysisOptions(): { diagnoseDeadCode: boolean; lints: Record<string, boolean> } {
	const c = vscode.workspace.getConfiguration("volt.iec")
	return {
		diagnoseDeadCode: c.get<boolean>("diagnostics.deadCode", false),
		lints: {
			shadowing: c.get<boolean>("lints.shadowing", false),
			unknownAttribute: c.get<boolean>("lints.unknownAttribute", false),
			unknownType: c.get<boolean>("lints.unknownType", false),
			inoutOwnAccess: c.get<boolean>("lints.inoutOwnAccess", true),
		},
	}
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

	// The server is stdio-only and needs `--stdio` plus a vendor flag (it defaults to codesys, so
	// `auto`/`codesys` both pass --codesys). Run it via the editor's own runtime with
	// ELECTRON_RUN_AS_NODE=1 — the same proven pattern volt-control's cli.ts uses to run bundled JS
	// under VS Code / Cursor / Windsurf / Electron with no external node (execing a raw .js is wrong).
	const vendor = cfg.get<"codesys" | "twincat" | "auto">("vendor", "auto")
	const serverOptions: ServerOptions = {
		command: process.execPath,
		args: [serverModule, "--stdio", vendor === "twincat" ? "--twincat" : "--codesys"],
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

	return [
		client,
		// Push the live-togglable config (dead-code + lints) whenever a `volt.iec.*` setting changes, so a
		// toggle takes effect without a restart. Vendor is fixed at launch (a change needs Volt LSP: Restart).
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("volt.iec"))
				void client.sendNotification(DidChangeConfigurationNotification.type, { settings: analysisOptions() })
		}),
		vscode.commands.registerCommand("volt.lsp.restart", async () => {
			await client.restart()
			vscode.window.showInformationMessage("Volt LSP restarted")
		}),
		vscode.commands.registerCommand("volt.lsp.showOutput", () => {
			client.outputChannel.show()
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
