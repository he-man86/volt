/**
 * Volt CLI integration for VS Code — command implementations, CLI
 * invocation helpers, and unified user-facing feedback.
 *
 * One namespace (`volt.*`), one OutputChannel ("Volt"), two feedback
 * patterns:
 *
 *   1. QUICK ops (status, build, refresh feedback) — `runCliQuick`:
 *      `withProgress(Window)` indicator, 3s status-bar message on
 *      completion, error toast with "Show Output" on failure.
 *
 *   2. MUTATING ops (init, pull, push, force*, merge) — `runCliMutating`:
 *      `withProgress(Notification)` while running, info/error toast on
 *      completion, optional context-aware actions ("Pull first" on push
 *      drift, etc.).
 *
 * Concurrency: `runWithCliGuard` ensures spamming a button doesn't
 * spawn duplicate CLI processes per workspace. Shared with scm.ts.
 *
 * The CLI binary itself is resolved via `cliBin()` (PATH or
 * `volt.cli.path` setting). Workspace cwd is whichever folder owns the
 * active editor, falling back to the first workspace folder.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";

/** POU extensions volt-agent materializes — used by build diagnostics
 *  to resolve a `BridgeDiagnostic.object` name to its workspace file. */
const POU_EXTENSIONS = ["st", "gvl", "struct", "enum", "union", "alias", "itf", "fbd", "ld", "sfc", "cfc"] as const;

// ─── OutputChannel singleton ─────────────────────────────────────────
//
// One channel for every Volt CLI invocation. Replaces the old "Volt"
// terminal — terminal UI was vestigial from when the extension WAS
// a thin shell over `volt <verb>`; today the SCM view drives almost
// everything. OutputChannel is non-modal, scrollable, and doesn't
// fight with the integrated terminal.

let channel: vscode.OutputChannel | undefined;

/** Lazy-create the shared "Volt" output channel. */
export function getOutputChannel(): vscode.OutputChannel {
	if (channel === undefined) {
		channel = vscode.window.createOutputChannel("Volt");
	}
	return channel;
}

/** Append a `volt <verb>` invocation's output to the channel, with a
 *  header line so the log stays readable across many runs. */
function logCli(label: string, stdout: string, stderr: string, code: number): void {
	const ch = getOutputChannel();
	const ts = new Date().toISOString();
	ch.appendLine("");
	ch.appendLine(`──── ${ts}  ${label}  exit=${code} ────`);
	if (stdout.length > 0) ch.appendLine(stdout.trimEnd());
	if (stderr.length > 0) {
		ch.appendLine("[stderr]");
		ch.appendLine(stderr.trimEnd());
	}
}

// ─── Concurrency guard ───────────────────────────────────────────────
//
// Pull and push are not safe to run concurrently against the same
// workspace — two `volt pull`s would both write the same files; a
// `pull` racing a `push` could ship a half-merged state. Keyed by
// workspace cwd so multi-root workspaces stay independent. Shared
// between this file's commands and scm.ts's view-bound commands.

type GuardedOp = "pull" | "push";
const inflightOps = new Map<string, GuardedOp>();

/**
 * Wrap a pull or push body so duplicate invocations against the same
 * workspace are suppressed. On collision: show a 3s status-bar hint
 * and return without running.
 */
export async function runWithCliGuard(
	cwd: string,
	op: GuardedOp,
	body: () => Promise<void>,
): Promise<void> {
	const current = inflightOps.get(cwd);
	if (current !== undefined) {
		vscode.window.setStatusBarMessage(
			`$(sync~spin) Volt: ${current} already in progress`,
			3000,
		);
		return;
	}
	inflightOps.set(cwd, op);
	try {
		await body();
	} finally {
		inflightOps.delete(cwd);
	}
}

// ─── Unified feedback helpers ────────────────────────────────────────

interface CliResult {
	stdout: string;
	stderr: string;
	code: number;
	ok: boolean;
}

interface QuickOptions {
	cwd: string;
	/** Short verb-ish label for the OutputChannel header + error toast. */
	describe: string;
}

/**
 * Run a cheap CLI invocation with a Window-level progress indicator
 * (subtle, bottom-left). Always logs to the OutputChannel. Returns the
 * raw result so the caller can format its own status-bar message
 * (different commands want different one-liners). On failure the caller
 * decides whether to toast — `runCliQuick` itself only shows a toast
 * for crashes (no output at all).
 */
async function runCliQuick(args: string[], options: QuickOptions): Promise<CliResult> {
	const result = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Window, title: `volt ${args.join(" ")}` },
		() => spawnCapture(cliBin(), args, options.cwd),
	);
	const ok = result.code === 0;
	logCli(`volt ${args.join(" ")}`, result.stdout, result.stderr, result.code);
	return { ...result, ok };
}

interface MutatingOptions {
	cwd: string;
	/** Title shown in the Notification-area progress popup. */
	progressTitle: string;
	/** Short verb label used in error toasts and the OutputChannel header. */
	describe: string;
	/** Build a success toast from stdout. Return undefined → show generic OK message. */
	successMessage?: (stdout: string) => string | undefined;
	/** Build a context-aware error UI. Return undefined → use the default. */
	errorActions?: (stderr: string, code: number) => {
		message: string;
		actions: string[];
		onPick: (pick: string | undefined) => Promise<void> | void;
	} | undefined;
	/** Set when the op should be guarded against concurrent invocation. */
	guardOp?: GuardedOp;
}

/**
 * Run a mutating CLI invocation with a Notification-area progress
 * popup. Routes through the concurrency guard if `guardOp` is set.
 * On success: status-bar message (or `successMessage(stdout)` if
 * provided). On failure: error toast with actions (or
 * `errorActions(stderr, code)` for context-aware UX like the
 * "Pull first" recovery on push drift).
 */
async function runCliMutating(args: string[], options: MutatingOptions): Promise<boolean> {
	const body = async (): Promise<boolean> => {
		const result = await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: options.progressTitle,
				cancellable: false,
			},
			() => spawnCapture(cliBin(), args, options.cwd),
		);
		logCli(`volt ${args.join(" ")}`, result.stdout, result.stderr, result.code);

		if (result.code === 0) {
			const headline =
				options.successMessage?.(result.stdout) ??
				`Volt: ${options.describe} complete.`;
			// Honest toast level: when the success message itself carries
			// a warning marker (⚠) — e.g. a pull where the agent skipped
			// some POUs but the verb still exited 0 — surface as a WARNING
			// toast with a Show Output action, NOT a green info toast. A
			// green "pull complete" hides the truth that the workspace is
			// missing files; the warning toast forces the engineer to
			// notice.
			if (headline.includes("⚠")) {
				const action = "Show Output";
				void vscode.window
					.showWarningMessage(headline, action)
					.then((pick) => {
						if (pick === action) getOutputChannel().show(true);
					});
			} else {
				vscode.window.showInformationMessage(headline);
			}
			return true;
		}

		const custom = options.errorActions?.(result.stderr, result.code);
		if (custom !== undefined) {
			const pick = await vscode.window.showErrorMessage(custom.message, ...custom.actions);
			await custom.onPick(pick);
			return false;
		}

		const firstLine = result.stderr.trim().split("\n")[0] ?? `exit ${result.code}`;
		const pick = await vscode.window.showErrorMessage(
			`Volt: ${options.describe} failed: ${firstLine}`,
			"Show Output",
		);
		if (pick === "Show Output") getOutputChannel().show(true);
		return false;
	};

	if (options.guardOp !== undefined) {
		let ok = false;
		await runWithCliGuard(options.cwd, options.guardOp, async () => {
			ok = await body();
		});
		return ok;
	}
	return body();
}

// ─── Workspace cwd resolution ────────────────────────────────────────
//
// Single-folder workspaces: trivial — that one folder. Multi-root:
// prefer the folder owning the active editor; otherwise pick the
// first. scm.ts has a smarter `pickRepo` for view-bound commands;
// these globals (init/pull/push triggered from palette) use this.

function workspaceCwd(): string | undefined {
	const folders = vscode.workspace.workspaceFolders;
	if (folders === undefined || folders.length === 0) return undefined;
	const active = vscode.window.activeTextEditor?.document.uri;
	if (active !== undefined) {
		const owner = vscode.workspace.getWorkspaceFolder(active);
		if (owner !== undefined) return owner.uri.fsPath;
	}
	return folders[0]!.uri.fsPath;
}

function requireCwd(): string | undefined {
	const cwd = workspaceCwd();
	if (cwd === undefined) {
		vscode.window.showWarningMessage("Volt: open a workspace folder first.");
		return undefined;
	}
	return cwd;
}

// ─── Init flow ───────────────────────────────────────────────────────
//
// Two welcome-view buttons drive every init. Each button knows its own
// port (read from a per-IDE setting that defaults to the IEC standard
// — 8555 for TwinCAT, 8556 for CODESYS) and runs `volt init --port X`
// directly. No IDE-select setting, no persistence dance, no precedence
// resolution. The button IS the selection.
//
// `volt.init` from the command palette pops a QuickPick (TwinCAT or
// CODESYS) so power users can init without the welcome view. Re-init
// of an already-bound workspace skips the picker and uses the port
// already in `.volt/config.json`.

const TWINCAT_PORT_DEFAULT = 8555;
const CODESYS_PORT_DEFAULT = 8556;

/** Read the configured port for an IDE platform. The two `volt.bridge.*Port`
 *  settings are the only bridge knobs the user has — they fall through to
 *  the IEC defaults if not set. */
function portFor(ide: "twincat" | "codesys"): number {
	const cfg = vscode.workspace.getConfiguration("volt.bridge");
	return ide === "twincat"
		? cfg.get<number>("twincatPort", TWINCAT_PORT_DEFAULT)
		: cfg.get<number>("codesysPort", CODESYS_PORT_DEFAULT);
}

async function commandInitTwincat(): Promise<void> {
	await runInit("twincat");
}

async function commandInitCodesys(): Promise<void> {
	await runInit("codesys");
}

/**
 * Palette init — picks port from QuickPick when the workspace is
 * fresh, or reuses the bound port when re-initing an existing one.
 */
async function commandInit(): Promise<void> {
	const cwd = requireCwd();
	if (cwd === undefined) return;
	const existing = readBridgePortFromConfig(cwd);
	if (existing !== undefined) {
		await runInitWithPort(existing, cwd);
		return;
	}
	const TC = "TwinCAT";
	const CS = "CODESYS";
	const pick = await vscode.window.showQuickPick(
		[
			{ label: TC, description: `port ${portFor("twincat")}` },
			{ label: CS, description: `port ${portFor("codesys")}` },
		],
		{ placeHolder: "Which IDE bridge should Volt target?", ignoreFocusOut: true },
	);
	if (pick === undefined) return;
	await runInit(pick.label === TC ? "twincat" : "codesys");
}

async function runInit(ide: "twincat" | "codesys"): Promise<void> {
	const cwd = requireCwd();
	if (cwd === undefined) return;
	await runInitWithPort(portFor(ide), cwd);
}

async function runInitWithPort(port: number, cwd: string): Promise<void> {
	const ok = await runCliMutating(["init", "--port", String(port)], {
		cwd,
		progressTitle: "Volt: initializing workspace…",
		describe: "init",
		successMessage: () =>
			"Volt initialized. Click any incoming change to preview it without pulling, or pull to materialize everything.",
	});
	if (!ok) return;
	await vscode.commands.executeCommand("workbench.view.extension.volt");
	// Do NOT fire `volt.refresh` here. `extension.ts` watches
	// `**/.volt/config.json` for creation; when init writes that file,
	// `maybeRegisterRepo` creates the workspace controller and calls
	// `ws.refresh()` automatically. Firing a second refresh here races
	// the watcher: it either no-ops (workspace not registered yet) OR
	// queues behind the watcher's refresh and re-spawns `volt status`
	// the moment the first completes — back-to-back /refs walks slam
	// the CODESYS COM thread and the second call can take ~5x longer
	// than the first (observed: 8s → 44s on a 243-item project, then
	// the next health probe timed out at 2s). The watcher's refresh is
	// authoritative.
}

/**
 * Accept a detected project rename. Fired by the SCM tree's yellow
 * "Project rename detected" warning node and by the one-shot toast
 * (`scm.ts` → `maybeNotifyProjectMismatch`). Runs `volt init --port X
 * --force` against the bound port so `.volt/config.json` picks up the
 * bridge's current identity. Snapshot history (`/.volt/snapshot/`,
 * `state.json`) is preserved by `volt init --force`.
 */
async function commandAcceptProjectRename(): Promise<void> {
	const cwd = requireCwd();
	if (cwd === undefined) return;
	const port = readBridgePortFromConfig(cwd);
	if (port === undefined) {
		vscode.window.showWarningMessage(
			"Volt: can't determine the bridge port — `.volt/config.json` is missing or malformed. Re-run Initialize Volt from the welcome view.",
		);
		return;
	}
	const ok = await runCliMutating(["init", "--port", String(port), "--force"], {
		cwd,
		progressTitle: "Volt: accepting project rename…",
		describe: "rebind",
		successMessage: () => "Volt: project rename accepted. Snapshot history preserved.",
	});
	if (!ok) return;
	await vscode.commands.executeCommand("volt.refresh");
}

/** Read the port a workspace is bound to (from `.volt/config.json`).
 *  Used by the palette `volt.init` to skip the QuickPick on re-init,
 *  and by `volt-tree.ts` to display the bound bridge target. */
export function readBridgePortFromConfig(cwd: string): number | undefined {
	try {
		const path = join(cwd, ".volt", "config.json");
		if (!existsSync(path)) return undefined;
		const raw = readFileSync(path, "utf-8");
		const parsed = JSON.parse(raw) as { bridge?: { port?: unknown } };
		const port = parsed.bridge?.port;
		if (typeof port === "number" && Number.isFinite(port)) return port;
		return undefined;
	} catch {
		return undefined;
	}
}

// ─── Pull / push (+ force variants) ──────────────────────────────────

async function commandPull(): Promise<void> {
	const cwd = requireCwd();
	if (cwd === undefined) return;
	await runCliMutating(["pull"], {
		cwd,
		progressTitle: "Volt: Pulling from IDE…",
		describe: "pull",
		guardOp: "pull",
		successMessage: extractPullSummary,
	});
}

async function commandForcePull(): Promise<void> {
	const cwd = requireCwd();
	if (cwd === undefined) return;
	await runCliMutating(["pull", "--force"], {
		cwd,
		progressTitle: "Volt: Force-pulling from IDE…",
		describe: "pull --force",
		guardOp: "pull",
		successMessage: extractPullSummary,
	});
}

async function commandPush(): Promise<void> {
	const cwd = requireCwd();
	if (cwd === undefined) return;
	await runCliMutating(["push"], {
		cwd,
		progressTitle: "Volt: Pushing to IDE…",
		describe: "push",
		guardOp: "push",
		successMessage: extractPushSummary,
		errorActions: (stderr, code) => buildPushErrorActions(stderr, code, false),
	});
}

async function commandForcePush(): Promise<void> {
	const cwd = requireCwd();
	if (cwd === undefined) return;
	const confirm = await vscode.window.showWarningMessage(
		"Force push will overwrite anything the engineer has changed in the IDE since your last pull. This cannot be undone from VS Code.",
		{ modal: true },
		"Yes, force push",
	);
	if (confirm !== "Yes, force push") return;
	await runCliMutating(["push", "--force"], {
		cwd,
		progressTitle: "Volt: Force-pushing to IDE…",
		describe: "push --force",
		guardOp: "push",
		successMessage: extractPushSummary,
	});
}

/** Parse the first "pulled: ... (breakdown)" pair out of `volt pull` stdout,
 *  and APPEND a warning when the agent reported skipped items so the engineer
 *  doesn't see a green "pull complete" toast when their workspace is actually
 *  missing POUs the transpiler couldn't handle. Without this surfacing, a
 *  partial pull looked identical to a clean pull in the UI. */
function extractPullSummary(stdout: string): string | undefined {
	const lines = stdout.split(/\r?\n/);
	const skippedMatch = stdout.match(/^!?\s*skipped\s+(\d+)\s+item\(s\)/m);
	const skippedSuffix = skippedMatch === null
		? ""
		: ` — ⚠ ${skippedMatch[1]} item(s) skipped (transpile failures; see Output)`;
	const pulled = lines.find((l) => l.startsWith("pulled:"));
	if (pulled === undefined) return `Volt: pull complete — already up to date.${skippedSuffix}`;
	const breakdown = lines.find((l) => l.startsWith("  ("));
	const body = breakdown !== undefined ? `${pulled} ${breakdown.trim()}` : pulled;
	return `Volt: ${body}${skippedSuffix}`;
}

/** Parse the "pushed:" headline out of `volt push` stdout. */
function extractPushSummary(stdout: string): string | undefined {
	const headline = stdout.split(/\r?\n/).find((l) => l.startsWith("pushed:"));
	return headline !== undefined ? `Volt: ${headline}` : "Volt: push complete.";
}

/** Build the context-aware error UI for push: drift offers "Pull first";
 *  generic failures fall through to the default "Show Output" handler. */
function buildPushErrorActions(
	stderr: string,
	code: number,
	isForce: boolean,
): { message: string; actions: string[]; onPick: (pick: string | undefined) => Promise<void> } | undefined {
	if (isForce) return undefined; // no special drift recovery for force
	if (!stderr.includes("drift detected")) return undefined;
	return {
		message:
			"Volt: push refused — the IDE has changed since your last pull. Pull first to absorb the engineer's edits, then push again.",
		actions: ["Pull first", "Show Output"],
		onPick: async (pick) => {
			if (pick === "Pull first") {
				await vscode.commands.executeCommand("volt.pull");
			} else if (pick === "Show Output") {
				getOutputChannel().show(true);
			}
		},
	};
}

// ─── Status ──────────────────────────────────────────────────────────
//
// Old behavior: opened a terminal and ran `volt status`. New behavior:
// runs `volt status --json` quietly, surfaces a status-bar summary
// (incoming / outgoing counts) and reveals the Volt activity bar so
// the tree gives the full picture. The OutputChannel still gets the
// raw stdout for users who want the verbose human-readable output.

async function commandStatus(): Promise<void> {
	const cwd = requireCwd();
	if (cwd === undefined) return;
	const result = await runCliQuick(["status", "--json"], { cwd, describe: "status" });
	if (!result.ok) {
		const firstLine = result.stderr.trim().split("\n")[0] ?? `exit ${result.code}`;
		const pick = await vscode.window.showErrorMessage(
			`Volt: status failed: ${firstLine}`,
			"Show Output",
		);
		if (pick === "Show Output") getOutputChannel().show(true);
		return;
	}
	let summary = "Volt: status — in sync with IDE";
	try {
		const parsed = JSON.parse(result.stdout) as {
			incoming?: { added?: unknown[]; modified?: unknown[]; removed?: unknown[] };
			outgoing?: { added?: unknown[]; modified?: unknown[]; removed?: unknown[] };
			merging?: unknown;
		};
		const inc =
			(parsed.incoming?.added?.length ?? 0) +
			(parsed.incoming?.modified?.length ?? 0) +
			(parsed.incoming?.removed?.length ?? 0);
		const out =
			(parsed.outgoing?.added?.length ?? 0) +
			(parsed.outgoing?.modified?.length ?? 0) +
			(parsed.outgoing?.removed?.length ?? 0);
		if (parsed.merging !== null && parsed.merging !== undefined) {
			summary = "Volt: status — merge in progress";
		} else if (inc + out > 0) {
			summary = `Volt: status — ${inc} incoming, ${out} outgoing`;
		}
	} catch {
		// JSON parse failure → fall through to the default sync message.
	}
	vscode.window.setStatusBarMessage(`$(git-pull-request) ${summary}`, 5000);
	await vscode.commands.executeCommand("workbench.view.extension.volt");
}

// ─── Build ───────────────────────────────────────────────────────────

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

function commandBuild(diagnostics: vscode.DiagnosticCollection): () => Promise<void> {
	return async () => {
		const cwd = requireCwd();
		if (cwd === undefined) return;
		const result = await runCliQuick(["build"], { cwd, describe: "build" });
		diagnostics.clear();
		// Non-zero exit before parsing — surface the actual error from
		// stderr, not a misleading "couldn't be parsed". `volt build`
		// only emits JSON on success; failure modes (bridge unreachable,
		// no project open, etc.) only write to stderr.
		if (!result.ok) {
			const firstLine = result.stderr.trim().split("\n")[0] ?? `exit ${result.code}`;
			const pick = await vscode.window.showErrorMessage(
				`Volt: build failed: ${firstLine}`,
				"Show Output",
			);
			if (pick === "Show Output") getOutputChannel().show(true);
			return;
		}
		let parsed: BuildJson | undefined;
		try {
			parsed = JSON.parse(result.stdout) as BuildJson;
		} catch {
			const pick = await vscode.window.showErrorMessage(
				`Volt: build output couldn't be parsed. ${result.stderr.trim() || "(no stderr)"}`,
				"Show Output",
			);
			if (pick === "Show Output") getOutputChannel().show(true);
			return;
		}
		const byFile = mapDiagnosticsToFiles(parsed.diagnostics ?? [], cwd);
		for (const [uri, diags] of byFile) {
			diagnostics.set(uri, diags);
		}
		const counts = `${parsed.errors} error(s), ${parsed.warnings} warning(s)`;
		const verb = parsed.success ? "ok" : "failed";
		vscode.window.setStatusBarMessage(
			`Volt: build ${verb} — ${counts} (${parsed.duration_ms}ms)`,
			5000,
		);
		if (parsed.errors > 0) {
			vscode.window.showErrorMessage(`Volt build failed: ${counts}. See Problems panel.`);
		} else if (parsed.warnings > 0) {
			// Warnings without errors → warning toast (was previously silent
			// — just a status-bar count, easy to miss on a busy screen).
			// "Build ok" + warnings hidden in the Problems panel meant
			// engineers shipped builds with regressions they hadn't seen.
			const action = "Show Problems";
			void vscode.window
				.showWarningMessage(
					`Volt: build ok with ${parsed.warnings} warning(s). See Problems panel.`,
					action,
				)
				.then((pick) => {
					if (pick === action) {
						void vscode.commands.executeCommand("workbench.actions.view.problems");
					}
				});
		}
	};
}

/** Group `volt build`'s per-object diagnostics by workspace file URI.
 *  Resolution tries `src/POUs/<name>.<ext>` then `src/<name>.<ext>`
 *  for every POU extension; drops diagnostics whose object can't be
 *  resolved (better to lose a project-level diagnostic than pin it
 *  wrongly). The `src/` prefix reflects the workspace layout volt-agent
 *  materializes into — see `workspace-layout.ts`. */
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
		if (uri === undefined) continue;
		const line = Math.max(0, d.line - 1);
		const range = new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);
		const diag = new vscode.Diagnostic(range, d.message, toVscodeSeverity(d.severity));
		diag.source = "volt build";
		const existing = out.get(uri) ?? [];
		existing.push(diag);
		out.set(uri, existing);
	}
	return out;
}

function resolvePouUri(cwd: string, pouName: string): vscode.Uri | undefined {
	// volt-agent materializes everything under `src/` (the workspace's
	// IDE-synced subtree). The bridge tells us POU names; the actual
	// folder under `src/` is vendor-driven (e.g. `src/POUs/Foo.st`,
	// `src/Devices/.../Foo.st`). Try the canonical `POUs` folder
	// first, then `src/` root for vendor-emitted root-level items.
	for (const ext of POU_EXTENSIONS) {
		for (const dir of ["src/POUs", "src"]) {
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

// ─── Misc commands ───────────────────────────────────────────────────

/** Open `.volt/config.json` with the cursor on `extensionAccess` (or
 *  line 0 if the key isn't there yet). This is for per-file access
 *  overrides — distinct from VS Code Settings (`volt.openSettings`). */
async function commandOpenConfig(): Promise<void> {
	const cwd = requireCwd();
	if (cwd === undefined) return;
	const uri = vscode.Uri.file(join(cwd, ".volt", "config.json"));
	try {
		const doc = await vscode.workspace.openTextDocument(uri);
		const editor = await vscode.window.showTextDocument(doc);
		const text = doc.getText();
		const idx = text.indexOf(`"extensionAccess"`);
		if (idx >= 0) {
			const pos = doc.positionAt(idx);
			editor.selection = new vscode.Selection(pos, pos);
			editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
		}
	} catch {
		vscode.window.showWarningMessage(
			"Volt: no .volt/config.json found. Run Initialize Volt first.",
		);
	}
}

/** Open VS Code Settings filtered to Volt's contributions. */
function commandOpenSettings(): void {
	void vscode.commands.executeCommand("workbench.action.openSettings", "volt.");
}

/** Reveal the shared "Volt" OutputChannel. */
function commandShowOutput(): void {
	getOutputChannel().show(true);
}

// ─── Registration ────────────────────────────────────────────────────

/** Register every `volt.*` command and the single status-bar item.
 *  Merge / refresh / discardOutgoing / merge.openEditor live in
 *  scm.ts and scm-merge-editor.ts respectively (they need workspace
 *  state) — see those files for the rest of the surface. */
export function registerCli(context: vscode.ExtensionContext): void {
	const diagnostics = vscode.languages.createDiagnosticCollection("volt-build");
	context.subscriptions.push(diagnostics);

	context.subscriptions.push(
		safe("init", commandInit),
		safe("initTwincat", commandInitTwincat),
		safe("initCodesys", commandInitCodesys),
		safe("acceptProjectRename", commandAcceptProjectRename),
		safe("pull", commandPull),
		safe("push", commandPush),
		safe("forcePull", commandForcePull),
		safe("forcePush", commandForcePush),
		safe("status", commandStatus),
		safe("build", commandBuild(diagnostics)),
		safe("openConfig", commandOpenConfig),
		vscode.commands.registerCommand("volt.openSettings", commandOpenSettings),
		vscode.commands.registerCommand("volt.showOutput", commandShowOutput),
	);

	registerStatusBar(context);
}

/** Wrapper that registers a `volt.<id>` command with uniform top-level
 *  error catching. */
function safe(id: string, handler: () => Promise<void> | void): vscode.Disposable {
	return vscode.commands.registerCommand(`volt.${id}`, async () => {
		try {
			await handler();
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			const pick = await vscode.window.showErrorMessage(
				`Volt: ${id} failed: ${message}`,
				"Show Output",
			);
			if (pick === "Show Output") getOutputChannel().show(true);
		}
	});
}

/** Single status-bar entry — the only one. Clicking shows status. The
 *  health badge on the activity bar handles persistent connection
 *  state; this is the always-visible read-only entry point. */
function registerStatusBar(context: vscode.ExtensionContext): void {
	const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 200);
	item.text = "$(git-pull-request) Volt";
	item.tooltip = "Volt: show drift between IDE / snapshot / workspace";
	item.command = "volt.status";
	item.show();
	context.subscriptions.push(item);
}

// ─── CLI binary resolution + spawn helpers ───────────────────────────

/** Resolve the CLI binary path. Default = `volt` on PATH (populated by
 *  `bun install` via `node_modules/.bin`). User can override with the
 *  `volt.cli.path` setting for non-standard installs. */
export function cliBin(): string {
	const override = vscode.workspace
		.getConfiguration("volt.cli")
		.get<string>("path", "")
		.trim();
	return override.length > 0 ? override : "volt";
}

/** Spawn the CLI and capture stdout/stderr as utf-8 strings. Shared
 *  with scm.ts and scm-content-provider.ts for consistent shell-out
 *  semantics across the extension.
 *
 *  Spawn-level failures (binary not on PATH, EACCES, etc.) are NOT
 *  rejected — they collapse into a synthetic result with `code=127`
 *  and a human-readable `stderr` so every existing `if (result.code
 *  !== 0)` branch surfaces them as a normal failure (toast + tree
 *  node + Output log). Rejecting here would have to be caught by
 *  every caller, and missing one means a silently-broken command. */
export function spawnCapture(
	cmd: string,
	args: string[],
	cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
	return new Promise((resolve) => {
		const { spawnCmd, spawnArgs } = prepareSpawn(cmd, args);
		const proc = spawn(spawnCmd, spawnArgs, { cwd, shell: process.platform === "win32" });
		let stdout = "";
		let stderr = "";
		proc.stdout.on("data", (chunk) => { stdout += chunk.toString("utf-8"); });
		proc.stderr.on("data", (chunk) => { stderr += chunk.toString("utf-8"); });
		proc.on("error", (err) => {
			resolve({ stdout: "", stderr: formatSpawnError(cmd, err), code: 127 });
		});
		proc.on("close", (code) => resolve({ stdout, stderr, code: code ?? 0 }));
	});
}

/** Same as `spawnCapture` but returns stdout as a raw Buffer. Used by
 *  the SCM content provider to feed bytes into VS Code's diff editor
 *  without forcing a utf-8 decode. Spawn-level failures collapse into
 *  the same `code=127` synthetic result as `spawnCapture`. */
export function spawnCaptureBuffer(
	cmd: string,
	args: string[],
	cwd: string,
): Promise<{ stdout: Buffer; stderr: string; code: number }> {
	return new Promise((resolve) => {
		const { spawnCmd, spawnArgs } = prepareSpawn(cmd, args);
		const proc = spawn(spawnCmd, spawnArgs, { cwd, shell: process.platform === "win32" });
		const chunks: Buffer[] = [];
		let stderr = "";
		proc.stdout.on("data", (chunk: Buffer) => { chunks.push(chunk); });
		proc.stderr.on("data", (chunk) => { stderr += chunk.toString("utf-8"); });
		proc.on("error", (err) => {
			resolve({ stdout: Buffer.alloc(0), stderr: formatSpawnError(cmd, err), code: 127 });
		});
		proc.on("close", (code) => resolve({ stdout: Buffer.concat(chunks), stderr, code: code ?? 0 }));
	});
}

/** Translate Node's child_process error into a stderr the user can act
 *  on. ENOENT = binary not on PATH (the common case); other codes get
 *  surfaced verbatim with a hint to check Output for the full trace. */
function formatSpawnError(cmd: string, err: unknown): string {
	const e = err as NodeJS.ErrnoException;
	if (e?.code === "ENOENT") {
		return `couldn't run \`${cmd}\` — binary not found on PATH. Install the volt CLI (\`bun install -g @opencode-ai/volt-agent\`) or set \`volt.cli.path\` to its location.`;
	}
	if (e?.code === "EACCES") {
		return `couldn't run \`${cmd}\` — permission denied (EACCES). Check the binary's executable bit.`;
	}
	const detail = e instanceof Error ? e.message : String(err);
	return `couldn't run \`${cmd}\`: ${detail}`;
}

/**
 * Windows + `shell: true` requires the caller to quote whitespace-
 * containing args — cmd.exe rejoins them on spaces otherwise. On
 * other platforms we pass argv arrays through verbatim.
 */
function prepareSpawn(
	cmd: string,
	args: string[],
): { spawnCmd: string; spawnArgs: string[] } {
	if (process.platform !== "win32") {
		return { spawnCmd: cmd, spawnArgs: args };
	}
	return { spawnCmd: quoteArg(cmd), spawnArgs: args.map(quoteArg) };
}

function quoteArg(arg: string): string {
	if (/^[A-Za-z0-9_\-./=]+$/.test(arg)) return arg;
	return `"${arg.replace(/"/g, '\\"')}"`;
}
