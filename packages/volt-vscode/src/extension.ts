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
import { registerMergeEditor } from "./scm-merge-editor.js";
import { registerScm } from "./scm.js";

interface PlcLanguage {
	languageId: string;
	lspPackage: string;
	displayName: string;
	configKey: string;
	/** Workspace settings root for this language (e.g. "volt.structuredText"). */
	settingsRoot: string;
	/** Relative path under the workspace for the language reference. */
	referencePath: string;
	/**
	 * VS Code language IDs this client subscribes to. The primary
	 * `languageId` is always implicitly included; this lists the
	 * ADDITIONAL ones (graphical-POU languages whose files have ST
	 * text on top + a PLCopenXML body — the LSP parses the text
	 * portion and treats the rest opaquely).
	 */
	additionalLanguageIds?: readonly string[];
	/**
	 * File-watcher glob — must cover every extension whose contents
	 * the LSP wants to know about (for diagnostics refresh, cross-
	 * file resolution, etc.). Defaults to `**\/*.st` for back-compat.
	 */
	fileWatcherGlob?: string;
}

const PLC_LANGUAGES: PlcLanguage[] = [
	{
		languageId: "structured-text",
		lspPackage: "@opencode-ai/volt-lsp",
		displayName: "Structured Text",
		configKey: "volt.structuredText.lspServer",
		settingsRoot: "volt.structuredText",
		referencePath: "docs/codesys-reference/00-index.md",
		// volt-lsp-st handles every POU language Volt analyzes
		// today: ST/IL via parsed source, FBD/LD via the text
		// declaration on top of the marker block (body XML
		// parsed by the graphical body parser). SFC and CFC
		// files still live in workspaces (pulled by the agent)
		// but the LSP doesn't analyze them — VS Code opens
		// them as plaintext.
		//
		// Deliberately NOT in this list (byte-shuttle only — agent
		// syncs them with the bridge, VS Code shows them with their
		// per-extension icon, no LSP analysis): plc-visualization,
		// plc-recipes, plc-task, plc-library, plc-textlist,
		// plc-imagepool, plc-device, plc-trace, plc-cam, plc-alarm,
		// plc-uml, plc-tmc. These are XML / binary config formats
		// without ST-grammar declarations on top, so the LSP has
		// nothing to parse. Don't add them here without first
		// writing a dedicated parser + diagnostics — routing them
		// through volt-lsp-st today would just produce noise.
		additionalLanguageIds: [
			"plc-interface",
			"plc-gvl",
			"plc-dut",
			"plc-fbd",
			"plc-ld",
		],
		fileWatcherGlob: "**/*.{st,gvl,dut,itf,fbd,ld}",
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
	registerConfigXmlFormatter(context);
	registerScm(context);
	registerMergeEditor(context);
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

// ─── XML formatter for plc-config languages ───────────────────────────
//
// The plc-visualization / plc-recipes / plc-task / plc-library /
// plc-textlist / plc-imagepool / plc-device / plc-trace / plc-cam /
// plc-alarm / plc-uml / plc-tmc languages exist so each kind gets its
// own file icon — but they don't have a TextMate XML grammar attached
// (the source bytes are vendor-emitted XML; we don't bundle the full
// XML grammar). Without grammar, VS Code's built-in XML formatter
// doesn't apply, and Format Document fails with "no formatter
// installed".
//
// Solution: register a simple Document Formatting Provider that runs a
// line-based XML pretty-printer over the file contents. Keeps the
// on-disk bytes byte-identical to whatever the bridge emitted (so push
// round-trips don't shift content), but adds newlines + indentation
// the moment the user hits Format Document / formatOnSave.
const CONFIG_XML_LANGUAGES = [
	"plc-visualization",
	"plc-recipes",
	"plc-task",
	"plc-library",
	"plc-textlist",
	"plc-imagepool",
	"plc-device",
	"plc-trace",
	"plc-cam",
	"plc-alarm",
	"plc-uml",
	"plc-tmc",
];

function registerConfigXmlFormatter(context: vscode.ExtensionContext): void {
	const provider: vscode.DocumentFormattingEditProvider = {
		provideDocumentFormattingEdits(document, options) {
			const text = document.getText();
			const formatted = formatXml(text, options.insertSpaces ? " ".repeat(options.tabSize) : "\t");
			if (formatted === text) return [];
			const fullRange = new vscode.Range(
				document.positionAt(0),
				document.positionAt(text.length),
			);
			return [vscode.TextEdit.replace(fullRange, formatted)];
		},
	};
	for (const languageId of CONFIG_XML_LANGUAGES) {
		context.subscriptions.push(
			vscode.languages.registerDocumentFormattingEditProvider(
				{ language: languageId, scheme: "file" },
				provider,
			),
		);
	}
}

/**
 * Line-based XML pretty-printer. Splits on `><` boundaries, then walks
 * each line tracking nesting depth — opening tags increase indent,
 * closing tags decrease it, self-closing and inline-text tags keep
 * the current depth. Preserves CDATA sections and processing
 * instructions (`<?xml ... ?>`) unchanged.
 *
 * Not a full XML parser — purpose-built for the vendor-emitted single-
 * line XML our bridges produce (ProduceXml from TwinCAT, export_xml
 * from CODESYS). For pathological inputs (malformed, mixed-content
 * documents) we may indent imperfectly but never corrupt content.
 */
function formatXml(xml: string, indent: string): string {
	const trimmed = xml.trim();
	if (!trimmed) return xml;
	// Inject a newline boundary between adjacent tags so the line
	// loop can process one element per line.
	const lines = trimmed.replace(/>\s*</g, ">\n<").split("\n");
	let depth = 0;
	const out: string[] = [];
	for (let raw of lines) {
		const line = raw.trim();
		if (!line) continue;
		const isClosing = /^<\//.test(line);
		const isSelfClosing = /\/\s*>$/.test(line) || /^<\?/.test(line) || /^<!--/.test(line) || /^<!\[CDATA\[/.test(line);
		const hasInlineClose = /^<([\w:.-]+)(\s[^>]*)?>.*<\/\1>$/.test(line);
		if (isClosing) depth = Math.max(0, depth - 1);
		out.push(indent.repeat(depth) + line);
		if (!isClosing && !isSelfClosing && !hasInlineClose) depth++;
	}
	return out.join("\n") + "\n";
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
	const serverModule = resolveServerModule(lang, context);
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

	const languageIds = [lang.languageId, ...(lang.additionalLanguageIds ?? [])];
	const clientOptions: LanguageClientOptions = {
		documentSelector: languageIds.map((language) => ({ scheme: "file", language })),
		synchronize: {
			fileEvents: vscode.workspace.createFileSystemWatcher(
				lang.fileWatcherGlob ?? `**/*.${lang.languageId}`,
			),
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

function resolveServerModule(
	lang: PlcLanguage,
	context: vscode.ExtensionContext,
): string | undefined {
	const cfg = vscode.workspace.getConfiguration();
	const override = cfg.get<string>(lang.configKey, "").trim();
	if (override.length > 0 && existsSync(override)) return override;

	// 1. Bundled-with-extension LSP server. The extension's build
	//    script bundles the LSP into `dist/lsp-server.js` so a
	//    user-installed extension is self-contained — no separate
	//    `npm install @opencode-ai/volt-lsp` step required.
	//
	// Use `context.extensionPath` (VS Code's authoritative install
	// dir) — NOT `__filename`. bun's CJS bundler hardcodes __filename
	// to the build-machine source path, which doesn't exist on the
	// user's machine and silently breaks resolution.
	const extDir = join(context.extensionPath, "dist");
	const bundled = join(extDir, "lsp-server.js");
	if (existsSync(bundled)) return bundled;

	// 2. node_modules in the workspace folder(s) or alongside the
	//    extension. Useful for development setups where the LSP is
	//    being iterated and the dev wants to bypass the bundled copy.
	const candidates: string[] = [];
	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		candidates.push(folder.uri.fsPath);
	}
	candidates.push(context.extensionPath);

	for (const startDir of candidates) {
		const hit = findUpward(
			startDir,
			join("node_modules", lang.lspPackage, "dist", "bin.js"),
		);
		if (hit !== undefined) return hit;
	}

	// 3. Global npm install fallback (last resort — most users won't
	//    have it set up this way).
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
