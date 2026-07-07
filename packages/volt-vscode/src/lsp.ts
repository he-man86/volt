import * as vscode from "vscode"
import { join, dirname } from "node:path"
import { existsSync } from "node:fs"
import { LanguageClient, type LanguageClientOptions, type ServerOptions, TransportKind } from "vscode-languageclient/node"

// Every writable PLC source item is one kind-named file (.fb/.prg/.fun/.itf/.struct/.enum/.union/
// .alias/.gvl) carrying Structured Text. A graphical (VG) body is detected by content (a leading
// NETWORK token) and highlighted via a TextMate injection; the server routes per-body. Diagnostics
// flow to the host's native Problems panel automatically via the language client.
const LANGUAGE_IDS = ["structured-text"]

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
		synchronize: {
			// Source kinds + the reference files (.library/.device/.task) so the server re-indexes after a
			// `volt pull` without a restart (open buffers still win over disk).
			fileEvents: vscode.workspace.createFileSystemWatcher(
				"**/*.{fb,prg,fun,itf,struct,enum,union,alias,gvl,library,device,task}",
			),
		},
		// Forward the declared settings the server may consume (the `diagnostics.*` subtree resolves
		// to a nested object). Was reading nonexistent `volt.lsp.*` keys.
		initializationOptions: {
			vendor,
			trace: cfg.get("trace"),
			diagnostics: cfg.get("diagnostics"),
			hover: cfg.get("hover"),
			completion: cfg.get("completion"),
		},
	}

	const client = new LanguageClient("volt-lsp", "Volt LSP", serverOptions, clientOptions)
	await client.start()

	return [
		client,
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
		join(context.extensionPath, "node_modules", "@opencode-ai", "volt-lsp-iec", "dist", "src", "bin.js"),
		join(dirname(context.extensionPath), "volt-lsp-iec", "dist", "src", "bin.js"), // dev workspace
	]
	return candidates.find((p) => p.length > 0 && existsSync(p))
}
