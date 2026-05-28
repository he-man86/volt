/**
 * Volt VS Code extension.
 *
 * Single extension, multiple PLC languages. ST is the first; the
 * registry pattern (PLC_LANGUAGES below) makes adding the next one
 * (IL, vendor-XML-flavoured Ladder, etc.) a matter of:
 *   1. Drop a grammar + language-configuration into
 *      `languages/<name>/` and register it in package.json.
 *   2. Add an entry here pointing at the corresponding LSP server.
 *
 * The extension does four jobs:
 *   1. Spawn the LSP server(s) for real-time intelligence (this file)
 *   2. Forward VS Code workspace settings as LSP `initializationOptions`
 *      so users can tune diagnostics + hover + completion behavior
 *   3. Expose user-facing commands for the LSP (restart, show output,
 *      open the local CODESYS reference docs)
 *   4. Drive the `volt` CLI from VS Code — buttons + commands + build
 *      diagnostics into the Problems panel (see ./cli.ts)
 *
 * Syntax highlighting comes from the TextMate grammar and works
 * without the LSP running. The LSP adds hover, navigation,
 * diagnostics, completion, signature help, and semantic tokens.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import * as vscode from "vscode";
import {
	LanguageClient,
	type LanguageClientOptions,
	type ServerOptions,
	TransportKind,
} from "vscode-languageclient/node";
import { registerCli } from "./cli.js";

interface PlcLanguage {
	languageId: string;
	lspPackage: string;
	displayName: string;
	configKey: string;
	/** Workspace settings root for this language (e.g. "volt.structuredText"). */
	settingsRoot: string;
	/** Relative path under the workspace for the language reference. */
	referencePath: string;
}

const PLC_LANGUAGES: PlcLanguage[] = [
	{
		languageId: "structured-text",
		lspPackage: "@opencode-ai/volt-lsp-st",
		displayName: "Structured Text",
		configKey: "volt.structuredText.lspServer",
		settingsRoot: "volt.structuredText",
		referencePath: "docs/codesys-reference/00-index.md",
	},
];

interface ClientState {
	lang: PlcLanguage;
	client: LanguageClient;
	statusItem: vscode.StatusBarItem;
}

const clients = new Map<string, ClientState>();

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	registerCommands(context);
	registerCli(context);
	for (const lang of PLC_LANGUAGES) {
		await startLanguageClient(context, lang);
	}
	// React to settings changes — restart the affected client so init
	// options are re-read.
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			for (const lang of PLC_LANGUAGES) {
				if (e.affectsConfiguration(lang.settingsRoot)) {
					void restartClient(context, lang);
				}
			}
		}),
	);
}

export async function deactivate(): Promise<void> {
	await Promise.all([...clients.values()].map((s) => s.client.stop()));
	clients.clear();
}

// ─── Client lifecycle ────────────────────────────────────────────────

async function startLanguageClient(
	context: vscode.ExtensionContext,
	lang: PlcLanguage,
): Promise<void> {
	const serverModule = resolveServerModule(lang);
	const statusItem = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Right,
		100,
	);
	statusItem.text = `$(circle-slash) ${lang.displayName}`;
	statusItem.tooltip = "Volt language server status";
	statusItem.command = `volt.${lang.languageId}.showOutput`;
	context.subscriptions.push(statusItem);

	if (serverModule === undefined) {
		statusItem.text = `$(warning) ${lang.displayName}`;
		statusItem.tooltip = `LSP server not found. Set ${lang.configKey} or install ${lang.lspPackage}.`;
		statusItem.show();
		vscode.window.showWarningMessage(
			`Volt: couldn't find ${lang.lspPackage}. ` +
				`Syntax highlighting works, but features like hover and go-to-definition are disabled. ` +
				`Install the package or set ${lang.configKey} to a path.`,
		);
		return;
	}

	const serverOptions: ServerOptions = {
		run: {
			command: process.execPath,
			args: [serverModule, "--stdio"],
			transport: TransportKind.stdio,
		},
		debug: {
			command: process.execPath,
			args: [serverModule, "--stdio"],
			transport: TransportKind.stdio,
		},
	};

	const clientOptions: LanguageClientOptions = {
		documentSelector: [{ scheme: "file", language: lang.languageId }],
		synchronize: {
			fileEvents: vscode.workspace.createFileSystemWatcher("**/*.st"),
		},
		outputChannelName: `Volt — ${lang.displayName}`,
		initializationOptions: buildInitializationOptions(lang),
	};

	const client = new LanguageClient(
		`volt-${lang.languageId}`,
		`Volt (${lang.displayName})`,
		serverOptions,
		clientOptions,
	);

	statusItem.text = `$(sync~spin) ${lang.displayName}`;
	statusItem.show();

	clients.set(lang.languageId, { lang, client, statusItem });
	context.subscriptions.push({ dispose: () => void client.stop() });

	try {
		await client.start();
		statusItem.text = `$(check) ${lang.displayName}`;
		statusItem.tooltip = `Volt (${lang.displayName}) — running`;
	} catch (err) {
		statusItem.text = `$(error) ${lang.displayName}`;
		statusItem.tooltip = `Volt (${lang.displayName}) — failed to start`;
		vscode.window.showErrorMessage(
			`Volt: ${lang.displayName} LSP failed to start. ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

async function restartClient(
	context: vscode.ExtensionContext,
	lang: PlcLanguage,
): Promise<void> {
	const existing = clients.get(lang.languageId);
	if (existing !== undefined) {
		existing.statusItem.dispose();
		await existing.client.stop();
		clients.delete(lang.languageId);
	}
	await startLanguageClient(context, lang);
}

// ─── Settings → initializationOptions ────────────────────────────────

interface PlcLspInitOptions {
	diagnostics?: Partial<Record<string, boolean>>;
	hover?: { showSource?: boolean };
	completion?: { snippetSupport?: boolean };
}

const DIAGNOSTIC_FLAGS = [
	"reservedKeyword",
	"doubleUnderscore",
	"consecutiveUnderscores",
	"duplicateDeclaration",
	"unresolvedIdentifier",
	"unknownPragma",
	"wrongVendorPragma",
	"pragmaMissingCompanion",
	"pragmaConflict",
	"fbLifecycleSignature",
	"shadowingDeclaration",
	"initSlotCollision",
	"conversionSourceMismatch",
] as const;

interface PlcLspInitOptionsExtended extends PlcLspInitOptions {
	vendor?: "codesys" | "twincat" | "auto";
}

function buildInitializationOptions(lang: PlcLanguage): PlcLspInitOptionsExtended {
	const cfg = vscode.workspace.getConfiguration(lang.settingsRoot);
	const diagnostics: Record<string, boolean> = {};
	for (const flag of DIAGNOSTIC_FLAGS) {
		diagnostics[flag] = cfg.get<boolean>(`diagnostics.${flag}`, true);
	}
	const vendor = cfg.get<"codesys" | "twincat" | "auto">("vendor", "auto");
	return {
		vendor,
		diagnostics,
		hover: {
			showSource: cfg.get<boolean>("hover.showSource", true),
		},
		completion: {
			snippetSupport: cfg.get<boolean>("completion.snippetSupport", true),
		},
	};
}

// ─── Commands ────────────────────────────────────────────────────────

function registerCommands(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand("volt.restart", async () => {
			for (const lang of PLC_LANGUAGES) {
				await restartClient(context, lang);
			}
			vscode.window.setStatusBarMessage("Volt: language server(s) restarted", 2000);
		}),
	);

	for (const lang of PLC_LANGUAGES) {
		context.subscriptions.push(
			vscode.commands.registerCommand(
				`volt.${lang.languageId}.showOutput`,
				() => {
					const c = clients.get(lang.languageId);
					if (c !== undefined) c.client.outputChannel.show();
				},
			),
		);
	}

	context.subscriptions.push(
		vscode.commands.registerCommand("volt.openReference", async () => {
			const folder = vscode.workspace.workspaceFolders?.[0];
			if (folder === undefined) {
				vscode.window.showWarningMessage(
					"Volt: no workspace folder open. Open a project first.",
				);
				return;
			}
			const candidates = PLC_LANGUAGES.map((l) =>
				vscode.Uri.joinPath(folder.uri, l.referencePath),
			);
			for (const uri of candidates) {
				try {
					await vscode.workspace.fs.stat(uri);
					await vscode.commands.executeCommand("vscode.open", uri);
					return;
				} catch {
					// try the next
				}
			}
			const installed = await vscode.window.showWarningMessage(
				"CODESYS reference not found in this workspace. Run `volt init` to install it?",
				"Run volt init",
				"Cancel",
			);
			if (installed === "Run volt init") {
				const term = vscode.window.createTerminal("volt init");
				term.show();
				term.sendText("volt init");
			}
		}),
	);
}

// ─── Server module resolution ────────────────────────────────────────

function resolveServerModule(lang: PlcLanguage): string | undefined {
	const cfg = vscode.workspace.getConfiguration();
	const override = cfg.get<string>(lang.configKey, "").trim();
	if (override.length > 0 && existsSync(override)) return override;

	const candidates: string[] = [];
	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		candidates.push(folder.uri.fsPath);
	}
	const extDir = dirname(__filename);
	candidates.push(extDir);

	for (const startDir of candidates) {
		const hit = findUpward(
			startDir,
			join("node_modules", lang.lspPackage, "dist", "bin.js"),
		);
		if (hit !== undefined) return hit;
	}

	const globalHit = findGlobalNpmPackage(lang.lspPackage);
	if (globalHit !== undefined) return globalHit;

	return undefined;
}

function findUpward(startDir: string, relativePath: string): string | undefined {
	let current = resolve(startDir);
	const parsed = { root: resolve(current, "/") };
	for (;;) {
		const candidate = join(current, relativePath);
		if (existsSync(candidate)) return candidate;
		const parent = dirname(current);
		if (parent === current || parent === parsed.root) {
			const rootCandidate = join(parent, relativePath);
			return existsSync(rootCandidate) ? rootCandidate : undefined;
		}
		current = parent;
	}
}

function findGlobalNpmPackage(pkg: string): string | undefined {
	try {
		const r = spawnSync("npm", ["root", "-g"], {
			encoding: "utf-8",
			shell: process.platform === "win32",
		});
		if (r.status !== 0) return undefined;
		const globalRoot = r.stdout.trim();
		const candidate = join(globalRoot, pkg, "dist", "bin.js");
		return existsSync(candidate) ? candidate : undefined;
	} catch {
		return undefined;
	}
}
