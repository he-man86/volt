import * as vscode from "vscode"
import { join, dirname } from "node:path"
import { existsSync } from "node:fs"
import { LanguageClient, type LanguageClientOptions, TransportKind } from "vscode-languageclient/node"

// FBD/LD bodies are their own `volt-graphical` (VG) language — Volt's ST-flavored graphical language;
// the server routes them to its VG path by the leading NETWORK token. (.cfc/.sfc are read-only and stay
// on structured-text.) The LSP attaches to all of these ids.
const LANGUAGE_IDS = [
	"structured-text", "volt-graphical", "plc-interface", "plc-gvl", "plc-dut",
]

export async function startLsp(context: vscode.ExtensionContext): Promise<LanguageClient[]> {
	const serverPath = resolveServerModule(context)
	const clients: LanguageClient[] = []

	const config = vscode.workspace.getConfiguration("volt.lsp")
	const clientOptions: LanguageClientOptions = {
		documentSelector: LANGUAGE_IDS.map((id) => ({ language: id })),
		synchronize: { fileEvents: vscode.workspace.createFileSystemWatcher("**/*.{st,gvl,struct,enum,union,alias,itf,fbd,ld,cfc,sfc}") },
		initializationOptions: {
			maxNumberOfProblems: config.get("maxNumberOfProblems"),
			trace: config.get("trace"),
			diagnosticLevel: config.get("diagnosticLevel"),
		},
	}

	const client = new LanguageClient(
		"volt-lsp",
		"Volt LSP",
		{ command: serverPath, transport: TransportKind.stdio },
		clientOptions,
	)

	await client.start()
	clients.push(client)

	context.subscriptions.push(
		vscode.commands.registerCommand("volt.lsp.restart", async () => {
			await client.restart()
			vscode.window.showInformationMessage("Volt LSP restarted")
		}),
		vscode.commands.registerCommand("volt.lsp.showOutput", () => { client.outputChannel.show() }),
	)

	return clients
}

function resolveServerModule(context: vscode.ExtensionContext): string {
	const bundled = join(context.extensionPath, "node_modules", "@opencode-ai", "volt-lsp", "dist", "server.js")
	if (existsSync(bundled)) return bundled

	const workspaceModule = join(dirname(context.extensionPath), "volt-lsp-st", "dist", "server.js")
	if (existsSync(workspaceModule)) return workspaceModule

	throw new Error("Volt LSP server not found")
}
