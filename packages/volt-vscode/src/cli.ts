/**
 * Volt CLI integration for VS Code.
 *
 * Two-way coupling between VS Code and the `volt` CLI:
 *
 *  1. Buttons + commands — status bar items and command palette entries
 *     invoke `volt {verb}` in the integrated terminal so users can drive
 *     the workspace ↔ IDE sync without typing the command themselves.
 *
 *  2. Build diagnostics — when `volt build` is run, the JSON output is
 *     parsed and pushed into a VS Code `DiagnosticCollection` so build
 *     errors appear as red squigglies inline in `.st` files and as
 *     entries in the Problems panel. The terminal still shows the
 *     human-readable summary on the side.
 *
 * The CLI is assumed to be on PATH — provided automatically by `bun
 * install` (via the `volt-agent` package's `bin` field). If the user
 * needs an override path, expose it as a setting (see `volt.cli.path`
 * in package.json).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";

/**
 * Every POU file extension volt-agent writes — keep in sync with
 * `packages/volt-agent/src/engine/pou-files.ts:POU_EXTENSIONS`.
 * Order matters for resolvePouUri's first-match search: textual
 * extensions first (most common), graphical last.
 */
const POU_EXTENSIONS = ["st", "gvl", "dut", "itf", "fbd", "ld", "sfc", "cfc"] as const;

const TERMINAL_NAME = "Volt";

/** All five CLI verbs we expose to VS Code. */
type Verb = "status" | "pull" | "push" | "build" | "init";

/** Wire up CLI commands, status bar items, and build diagnostics. */
export function registerCli(context: vscode.ExtensionContext): void {
	const diagnostics = vscode.languages.createDiagnosticCollection("volt-build");
	context.subscriptions.push(diagnostics);

	registerCommands(context, diagnostics);
	registerStatusBar(context);
}

// ─── Commands ──────────────────────────────────────────────────────────

function registerCommands(
	context: vscode.ExtensionContext,
	diagnostics: vscode.DiagnosticCollection,
): void {
	const safe = (verb: Verb, handler: () => Promise<void> | void) =>
		vscode.commands.registerCommand(`volt.cli.${verb}`, async () => {
			try {
				await handler();
			} catch (err) {
				vscode.window.showErrorMessage(
					`Volt: ${verb} failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		});

	context.subscriptions.push(
		safe("status", () => runInTerminal(["status"])),
		safe("pull",   () => runPullWithToast()),
		safe("push",   () => confirmPushIfForce()),
		safe("build",  () => runBuildWithDiagnostics(diagnostics)),
		safe("init",   () => runInTerminal(["init"])),
		// Open `.volt/config.json` in the editor with the cursor on
		// `extensionAccess`. Easier than hunting through the JSON
		// for the right key.
		vscode.commands.registerCommand("volt.cli.configureAccess", () =>
			openConfigAtKey("extensionAccess"),
		),
	);
}

/**
 * Run `volt pull`, capture output, surface a toast with the per-kind
 * breakdown. The full stdout/stderr goes to the Volt SCM output
 * channel so users who want detail can read the log without staring
 * at a terminal.
 *
 * Replaces the old `runInTerminal(["pull"])` which gave no
 * notification when the pull completed — the SCM tree refreshed on
 * its own via the file watcher but the user had no signal of "done".
 */
async function runPullWithToast(): Promise<void> {
	const cwd = workspaceCwd();
	if (cwd === undefined) {
		vscode.window.showWarningMessage("Volt: open a workspace folder first.");
		return;
	}
	const result = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Window, title: "volt pull" },
		() => spawnCapture(cliBin(), ["pull"], cwd),
	);
	await echoToTerminal("volt pull", `${result.stderr}\n${result.stdout}`);
	if (result.code !== 0) {
		vscode.window.showErrorMessage(`Volt: pull failed (exit ${result.code}). See Volt SCM output for details.`);
		return;
	}
	const summary = extractPullSummary(result.stdout);
	if (summary === undefined) {
		vscode.window.showInformationMessage("Volt: pull complete — already up to date.");
		return;
	}
	vscode.window.showInformationMessage(`Volt: ${summary}`);
}

/**
 * Parse the CLI's pull-completion line — the human-readable summary
 * the user sees in their terminal. The CLI prints:
 *
 *   pulled: 244 file(s), removed: 0 file(s).
 *     (122 device, 47 library, ...)
 *
 * Returns the first line plus the per-kind breakdown joined as one
 * toast-ready string. Returns undefined when nothing was pulled
 * (the CLI says "already up to date.") so the caller can show a
 * different message.
 */
function extractPullSummary(stdout: string): string | undefined {
	const lines = stdout.split(/\r?\n/);
	const pulledLine = lines.find((l) => l.startsWith("pulled:"));
	if (pulledLine === undefined) return undefined;
	const breakdownLine = lines.find((l) => l.startsWith("  ("));
	return breakdownLine !== undefined ? `${pulledLine} ${breakdownLine.trim()}` : pulledLine;
}

/**
 * Run `volt push` with the given extra flags, capture output, show a
 * toast based on the result. Mirrors `runPullWithToast`. The detailed
 * output goes to the Volt SCM channel for users who want the log.
 *
 * Exit code semantics:
 *   0 → push went through (or nothing to push); show info toast
 *   2 → bridge refused (drift, policy block); show warning toast
 *       with "Show Volt SCM log" action so the user can see why
 *   other → unexpected failure; show error toast
 */
async function runPushWithToast(extraFlags: readonly string[]): Promise<void> {
	const cwd = workspaceCwd();
	if (cwd === undefined) {
		vscode.window.showWarningMessage("Volt: open a workspace folder first.");
		return;
	}
	const result = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Window, title: "volt push" },
		() => spawnCapture(cliBin(), ["push", ...extraFlags], cwd),
	);
	await echoToTerminal(`volt push ${extraFlags.join(" ")}`.trim(), `${result.stderr}\n${result.stdout}`);
	if (result.code === 0) {
		const summary = result.stdout.split(/\r?\n/).find((l) => l.startsWith("pushed:"));
		vscode.window.showInformationMessage(`Volt: ${summary ?? "push complete."}`);
		return;
	}
	if (result.code === 2) {
		const action = await vscode.window.showWarningMessage(
			"Volt: push refused — see Volt SCM output for details.",
			"Show Volt SCM log",
		);
		if (action === "Show Volt SCM log") {
			await vscode.commands.executeCommand("volt.scm.showOutput");
		}
		return;
	}
	vscode.window.showErrorMessage(`Volt: push failed (exit ${result.code}).`);
}

/** Open `.volt/config.json` and try to move the cursor onto the
 *  given key. Falls back to opening the file at line 0 if the key
 *  isn't present yet. */
async function openConfigAtKey(key: string): Promise<void> {
	const cwd = workspaceCwd();
	if (cwd === undefined) {
		vscode.window.showWarningMessage("Volt: open a workspace folder first.");
		return;
	}
	const path = `${cwd}/.volt/config.json`;
	const uri = vscode.Uri.file(path);
	const doc = await vscode.workspace.openTextDocument(uri);
	const editor = await vscode.window.showTextDocument(doc);
	const text = doc.getText();
	const idx = text.indexOf(`"${key}"`);
	if (idx >= 0) {
		const pos = doc.positionAt(idx);
		editor.selection = new vscode.Selection(pos, pos);
		editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
	}
}

/**
 * Push without force is safe; the bridge refuses drift on its own. But
 * if the user wants `--force` we surface a modal warning first — the
 * tool can clobber engineer-side IDE state.
 */
async function confirmPushIfForce(): Promise<void> {
	const choice = await vscode.window.showQuickPick(
		[
			{ label: "Normal push", description: "volt push (drift detection on)", verb: "normal" as const },
			{ label: "Force push", description: "volt push --force — overwrites IDE state", verb: "force" as const },
		],
		{
			placeHolder: "Choose how to push",
			ignoreFocusOut: true,
		},
	);
	if (choice === undefined) return;

	if (choice.verb === "normal") {
		await runPushWithToast([]);
		return;
	}

	// Modal confirmation for force — overwrites engineer's IDE changes.
	const confirm = await vscode.window.showWarningMessage(
		"Force push will overwrite anything the engineer has changed in the IDE since your last pull. This cannot be undone from VS Code.",
		{ modal: true },
		"Yes, force push",
	);
	if (confirm === "Yes, force push") {
		await runPushWithToast(["--force"]);
	}
}

// ─── Run helpers ───────────────────────────────────────────────────────

/**
 * Invoke `volt` in the integrated terminal. Cheap to call repeatedly —
 * always reuses the same terminal (named "Volt") instead of spawning
 * a new one per call, so users don't end up with a dozen tabs.
 */
async function runInTerminal(args: string[]): Promise<void> {
	const cwd = workspaceCwd();
	if (cwd === undefined) {
		vscode.window.showWarningMessage("Volt: open a workspace folder first.");
		return;
	}
	const existing = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME);
	const term = existing ?? vscode.window.createTerminal({ name: TERMINAL_NAME, cwd });
	term.show(true);
	term.sendText(`${cliBin()} ${args.map(quoteArg).join(" ")}`);
}

/**
 * `volt build` outputs structured JSON. Capture stdout, parse, map
 * diagnostics into the Problems panel + show a notification with the
 * summary. Also tee the JSON into the terminal for transparency.
 */
async function runBuildWithDiagnostics(
	diagnostics: vscode.DiagnosticCollection,
): Promise<void> {
	const cwd = workspaceCwd();
	if (cwd === undefined) {
		vscode.window.showWarningMessage("Volt: open a workspace folder first.");
		return;
	}

	const output = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Window, title: "volt build" },
		() => spawnCapture(cliBin(), ["build"], cwd),
	);

	diagnostics.clear();
	let parsed: BuildJson | undefined;
	try {
		parsed = JSON.parse(output.stdout) as BuildJson;
	} catch {
		vscode.window.showErrorMessage(
			`Volt: failed to parse \`volt build\` output. ${output.stderr.trim() || "(no stderr)"}`,
		);
		await echoToTerminal(`volt build`, output.stdout || output.stderr);
		return;
	}

	const byFile = mapDiagnosticsToFiles(parsed.diagnostics ?? [], cwd);
	for (const [uri, diags] of byFile) {
		diagnostics.set(uri, diags);
	}

	const verb = parsed.success ? "ok" : "failed";
	const counts = `${parsed.errors} error(s), ${parsed.warnings} warning(s)`;
	vscode.window.setStatusBarMessage(
		`Volt: build ${verb} — ${counts} (${parsed.duration_ms}ms)`,
		5000,
	);
	if (parsed.errors > 0) {
		vscode.window.showErrorMessage(`Volt build failed: ${counts}. See Problems panel.`);
	}

	await echoToTerminal("volt build", output.stdout);
}

/**
 * Synchronously spawn the CLI and capture stdout/stderr. Exported so
 * the SCM provider can reuse it — same shell-out shape across the
 * extension keeps behavior consistent.
 */
export function spawnCapture(
	cmd: string,
	args: string[],
	cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
	return new Promise((resolve, reject) => {
		const { spawnCmd, spawnArgs } = prepareSpawn(cmd, args);
		const proc = spawn(spawnCmd, spawnArgs, { cwd, shell: process.platform === "win32" });
		let stdout = "";
		let stderr = "";
		proc.stdout.on("data", (chunk) => { stdout += chunk.toString("utf-8"); });
		proc.stderr.on("data", (chunk) => { stderr += chunk.toString("utf-8"); });
		proc.on("error", (err) => reject(err));
		proc.on("close", (code) => resolve({ stdout, stderr, code: code ?? 0 }));
	});
}

/**
 * Same as `spawnCapture` but returns stdout as raw Buffer. Used by the
 * SCM content provider, which feeds bytes into VS Code's `TextDocumentContentProvider`
 * without forcing a utf-8 decode (preserves files that might be encoded oddly).
 */
export function spawnCaptureBuffer(
	cmd: string,
	args: string[],
	cwd: string,
): Promise<{ stdout: Buffer; stderr: string; code: number }> {
	return new Promise((resolve, reject) => {
		const { spawnCmd, spawnArgs } = prepareSpawn(cmd, args);
		const proc = spawn(spawnCmd, spawnArgs, { cwd, shell: process.platform === "win32" });
		const chunks: Buffer[] = [];
		let stderr = "";
		proc.stdout.on("data", (chunk: Buffer) => { chunks.push(chunk); });
		proc.stderr.on("data", (chunk) => { stderr += chunk.toString("utf-8"); });
		proc.on("error", (err) => reject(err));
		proc.on("close", (code) => resolve({ stdout: Buffer.concat(chunks), stderr, code: code ?? 0 }));
	});
}

/**
 * On Windows, `spawn(..., { shell: true })` routes through cmd.exe,
 * which JOINS argv with spaces and re-splits — corrupting any
 * argument containing whitespace (e.g. a workspace path like
 * `Device/Plc Logic/Application/FB_X.st`). Node does NOT quote args
 * for you; that's the caller's responsibility under `shell: true`.
 *
 * Fix: when shell mode is on, wrap each whitespace-containing arg
 * in double quotes. When shell is off (non-Windows), pass args
 * through verbatim — argv arrays are passed cleanly to the child.
 */
function prepareSpawn(
	cmd: string,
	args: string[],
): { spawnCmd: string; spawnArgs: string[] } {
	if (process.platform !== "win32") {
		return { spawnCmd: cmd, spawnArgs: args };
	}
	return {
		spawnCmd: quoteArg(cmd),
		spawnArgs: args.map(quoteArg),
	};
}

/** Print the JSON output in the Volt terminal for transparency. */
async function echoToTerminal(label: string, text: string): Promise<void> {
	const existing = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME);
	const cwd = workspaceCwd();
	const term = existing ?? vscode.window.createTerminal({ name: TERMINAL_NAME, cwd });
	term.show(true);
	// Echo the command + its captured output. We can't render a real
	// stdout pipe into the terminal, but `echo` + line-by-line dump
	// gives the user proof of what happened without running the CLI
	// twice (which would do real work twice).
	const lines = text.split("\n");
	term.sendText(`# ${label} (captured output)`);
	for (const line of lines) {
		term.sendText(`# ${line}`);
	}
}

// ─── Diagnostic mapping ────────────────────────────────────────────────

interface BuildJson {
	success: boolean;
	duration_ms: number;
	errors: number;
	warnings: number;
	diagnostics?: BridgeDiagnostic[];
	summary?: string;
}

interface BridgeDiagnostic {
	severity: "error" | "warning" | "info";
	message: string;
	line: number;
	object: string | null;
	section: "decl" | "impl" | null;
}

/**
 * Group diagnostics by file. The bridge gives us per-object diagnostics
 * (object = "FB_X" or "FB_X.Method"); we resolve each to its workspace
 * file by trying every POU extension (.st / .gvl / .dut / .itf for
 * textual; .fbd / .ld / .sfc / .cfc for graphical). If no file is
 * found, the diagnostic is dropped silently — better to lose a
 * project-level diagnostic than to pin it to the wrong file.
 */
function mapDiagnosticsToFiles(
	diagnostics: BridgeDiagnostic[],
	cwd: string,
): Map<vscode.Uri, vscode.Diagnostic[]> {
	const out = new Map<vscode.Uri, vscode.Diagnostic[]>();
	const resolveCache = new Map<string, vscode.Uri | undefined>();
	for (const d of diagnostics) {
		const pouName = d.object?.split(".")[0];
		if (pouName === undefined || pouName.length === 0) continue;
		let uri = resolveCache.get(pouName);
		if (uri === undefined && !resolveCache.has(pouName)) {
			uri = resolvePouUri(cwd, pouName);
			resolveCache.set(pouName, uri);
		}
		if (uri === undefined) continue; // dropped — no matching file in workspace
		const line = Math.max(0, d.line - 1); // VS Code is 0-indexed
		const range = new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);
		const diag = new vscode.Diagnostic(range, d.message, toVscodeSeverity(d.severity));
		diag.source = "volt build";
		const existing = out.get(uri) ?? [];
		existing.push(diag);
		out.set(uri, existing);
	}
	return out;
}

/**
 * Find the workspace file for a POU by name, trying every supported
 * extension (textual + graphical) in both the conventional `POUs/`
 * subfolder and the workspace root. Returns the first existing file
 * or `undefined` when none match. Per-call resolution is cached at
 * the caller (one fs hit per unique POU name per build).
 *
 * Doesn't recurse into arbitrary nested folders — the agent's pull
 * mirrors the bridge's folder structure, so POUs/Motors/FB_X.st is
 * possible. For now we just try POUs/ and the root; if users hit
 * deeper layouts we can swap in `vscode.workspace.findFiles` here.
 */
function resolvePouUri(cwd: string, pouName: string): vscode.Uri | undefined {
	for (const ext of POU_EXTENSIONS) {
		for (const dir of ["POUs", ""]) {
			const fsPath = join(cwd, dir, `${pouName}.${ext}`);
			if (existsSync(fsPath)) return vscode.Uri.file(fsPath);
		}
	}
	return undefined;
}

function toVscodeSeverity(s: BridgeDiagnostic["severity"]): vscode.DiagnosticSeverity {
	if (s === "error") return vscode.DiagnosticSeverity.Error;
	if (s === "warning") return vscode.DiagnosticSeverity.Warning;
	return vscode.DiagnosticSeverity.Information;
}

// ─── Status bar ────────────────────────────────────────────────────────

/**
 * Two highest-traffic buttons in the status bar: Status (read-only,
 * cheap, called constantly to check drift) and Push (the mutating
 * action with the most cognitive load — having it one click away
 * encourages running it deliberately). Pull/build/init live in the
 * command palette (Cmd+Shift+P → "Volt:").
 */
function registerStatusBar(context: vscode.ExtensionContext): void {
	const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 200);
	status.text = "$(git-pull-request) Volt: Status";
	status.tooltip = "Run `volt status` — show drift between IDE / snapshot / workspace";
	status.command = "volt.cli.status";
	status.show();

	const push = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 199);
	push.text = "$(cloud-upload) Volt: Push";
	push.tooltip = "Run `volt push` — send workspace state to the IDE. Prompts before force.";
	push.command = "volt.cli.push";
	push.show();

	context.subscriptions.push(status, push);
}

// ─── Utilities ─────────────────────────────────────────────────────────

function workspaceCwd(): string | undefined {
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * Resolve the CLI binary. Default = bare `volt` (relies on PATH, which
 * bun install populates via the workspace's `node_modules/.bin/`).
 * User can override via the `volt.cli.path` setting for non-standard
 * installs.
 */
export function cliBin(): string {
	const override = vscode.workspace
		.getConfiguration("volt.cli")
		.get<string>("path", "")
		.trim();
	return override.length > 0 ? override : "volt";
}

function quoteArg(arg: string): string {
	if (/^[A-Za-z0-9_\-./=]+$/.test(arg)) return arg;
	return `"${arg.replace(/"/g, '\\"')}"`;
}
