import * as vscode from "vscode"
import { join } from "node:path"
import {
	VoltStatus,
	pull, push, build, init as voltInit, initFromProject, reconnectBound, disconnect, detectedProjects, readBridgeVendor,
	mergeContinue, mergeAbort, mergeResolve,
	describePull, describePush, describeMerge, presentOutcome, settleOutcome, formatProgress, firstLine, FORCE_PULL, FORCE_PUSH,
	type ProgressUpdate, type OutcomePresenter, type PullOutcome, type PushOutcome, type MergeOutcome, type Vendor, type DetectedProject,
} from "@volt/control"

// ── Output channel ──────────────────────────────────────────────────────
const output = (() => {
	let ch: vscode.OutputChannel | undefined
	return () => {
		if (ch === undefined) ch = vscode.window.createOutputChannel("Volt")
		return ch
	}
})()

function logln(msg: string): void {
	output().appendLine(`[${new Date().toISOString()}] ${msg}`)
}

// ── Workspace selection ─────────────────────────────────────────────────
function pickStatus(statuses: Map<string, VoltStatus>): VoltStatus | undefined {
	if (statuses.size === 1) return [...statuses.values()][0]
	const active = vscode.window.activeTextEditor?.document.uri
	if (active !== undefined) {
		const folder = vscode.workspace.getWorkspaceFolder(active)
		if (folder !== undefined) {
			const s = statuses.get(folder.uri.fsPath)
			if (s !== undefined) return s
		}
	}
	return [...statuses.values()][0]
}

// The adopt-on-ok / refresh-on-fail rule lives once in @volt/control (settleOutcome); resolve the tracker here.
async function settleFor(statuses: Map<string, VoltStatus>, workspaceRoot: string, outcome: PullOutcome | PushOutcome | MergeOutcome): Promise<void> {
	const s = statuses.get(workspaceRoot)
	if (s !== undefined) await settleOutcome(s, outcome)
}

/** Conflicted files the tracker currently knows about (for the merge toast's "Open Conflicts"). */
function conflictPaths(statuses: Map<string, VoltStatus>, workspaceRoot: string): string[] {
	return statuses.get(workspaceRoot)?.cached?.merging?.conflicts.map((c) => c.path) ?? []
}

/** On-disk absolute path for a snapshot-tree-relative path (src/ is the tree root).
 *  Tolerates an already-src/-prefixed rel so we never produce src/src/…. */
function onDiskPath(workspaceRoot: string, rel: string): string {
	const treePath = rel.startsWith("src/") ? rel.slice(4) : rel
	return join(workspaceRoot, "src", treePath)
}

// Map the CLI's streamed progress frames to VS Code's notification bar. The frame→% math lives once in
// @volt/control (formatProgress); here we only turn the % into a delta increment for withProgress.
type VsProgress = vscode.Progress<{ increment?: number; message?: string }>
function progressBridge(progress: VsProgress): (p: ProgressUpdate) => void {
	let lastPct = 0
	return (p) => {
		const { pct, message } = formatProgress(p)
		if (pct !== undefined) {
			progress.report({ increment: Math.max(0, pct - lastPct), message })
			lastPct = pct
		} else progress.report({ message })
	}
}

// ── pull / push with outcome-aware UX ───────────────────────────────────
// The flow — filter actions, confirm destructive ones, dispatch — is @volt/control's presentOutcome. VS Code
// supplies only the dialog primitives; the destructive "cannot be undone" confirm is enforced there, not here.
const vscodePresenter: OutcomePresenter = {
	async choose(view) {
		if (view.actions.length === 0) {
			if (view.tone === "error") void vscode.window.showErrorMessage(view.message)
			else void vscode.window.showInformationMessage(view.message)
			return undefined
		}
		const labels = view.actions.map((a) => a.label)
		const picked =
			view.tone === "error"
				? await vscode.window.showErrorMessage(view.message, ...labels)
				: await vscode.window.showWarningMessage(view.message, ...labels)
		return view.actions.find((a) => a.label === picked)?.tag
	},
	async confirm(action) {
		const pick = await vscode.window.showWarningMessage(action.confirmMessage ?? `${action.label}?`, { modal: true }, action.label)
		return pick === action.label
	},
}

async function doPull(statuses: Map<string, VoltStatus>, workspaceRoot: string, force: boolean): Promise<void> {
	// volt-control.pull takes the gate + parses the outcome; the spinner wraps only
	// the CLI run, and the outcome dialogs run after (so they never hold the gate).
	const outcome = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: force ? "volt pull --force" : "volt pull" },
		(progress) => pull(workspaceRoot, { force, onProgress: progressBridge(progress) }),
	)
	await settleFor(statuses, workspaceRoot, outcome)
	if (outcome.kind === "error") logln(`pull: ${outcome.message}`)
	await presentOutcome(describePull(outcome), vscodePresenter, async (tag) => {
		if (tag === "open-conflicts" && outcome.kind === "conflict") await openConflicts(workspaceRoot, outcome.paths)
		else if (tag === "force-pull") await doPull(statuses, workspaceRoot, true)
		else if (tag === "finish-merge") await doFinishMerge(statuses, workspaceRoot)
		else if (tag === "abort-merge") await doAbortMerge(statuses, workspaceRoot)
	})
}

// ── merge finalization (git-native resolution; `volt merge` advances the IDE baseline) ──────────────
async function doFinishMerge(statuses: Map<string, VoltStatus>, workspaceRoot: string): Promise<void> {
	const outcome = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: "volt merge --continue" },
		() => mergeContinue(workspaceRoot),
	)
	await settleFor(statuses, workspaceRoot, outcome)
	if (outcome.kind === "error") logln(`merge --continue: ${outcome.message}`)
	await presentOutcome(describeMerge(outcome), vscodePresenter, async (tag) => {
		if (tag === "open-conflicts") await openConflicts(workspaceRoot, conflictPaths(statuses, workspaceRoot))
		else if (tag === "finish-merge") await doFinishMerge(statuses, workspaceRoot)
		else if (tag === "abort-merge") await doAbortMerge(statuses, workspaceRoot)
	})
}

async function doAbortMerge(statuses: Map<string, VoltStatus>, workspaceRoot: string): Promise<void> {
	const outcome = await mergeAbort(workspaceRoot)
	await settleFor(statuses, workspaceRoot, outcome)
	if (outcome.kind === "error") logln(`merge --abort: ${outcome.message}`)
	await presentOutcome(describeMerge(outcome), vscodePresenter, async () => {})
}

/** Take one whole side of a single conflicted file, then leave the rest to the user + Finish Merge. */
async function doTakeSide(statuses: Map<string, VoltStatus>, node: { merge?: { workspaceRoot: string; relPath: string } } | undefined, side: "mine" | "ide"): Promise<void> {
	const m = node?.merge
	if (m === undefined) return
	const outcome = await mergeResolve(m.workspaceRoot, m.relPath, side)
	await settleFor(statuses, m.workspaceRoot, outcome)
	if (outcome.kind === "error") {
		logln(`merge --resolve ${m.relPath}: ${outcome.message}`)
		void vscode.window.showErrorMessage(`Resolve failed: ${outcome.message}`)
	} else {
		void vscode.window.showInformationMessage(`${m.relPath}: took ${side === "ide" ? "the IDE's" : "your"} version. Finish Merge when every file is resolved.`)
	}
}

async function doPush(statuses: Map<string, VoltStatus>, workspaceRoot: string, force: boolean): Promise<void> {
	// volt-control.push takes the gate around the CLI run; outcome handling (which may
	// pop a dialog awaiting a click) runs AFTER push() returns — so a rejected push never
	// leaves the spinner stuck or holds the mutation gate (which would wedge the next push).
	const outcome = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: force ? "volt push --force" : "volt push" },
		(progress) => push(workspaceRoot, { force, onProgress: progressBridge(progress) }),
	)
	await settleFor(statuses, workspaceRoot, outcome)
	if (outcome.kind === "error") logln(`push: ${outcome.message}`)
	await presentOutcome(describePush(outcome, statuses.get(workspaceRoot)?.cached), vscodePresenter, async (tag) => {
		if (tag === "pull-first") await doPull(statuses, workspaceRoot, false)
		else if (tag === "force-push") await doPush(statuses, workspaceRoot, true)
	})
}

async function openConflicts(workspaceRoot: string, paths: readonly string[]): Promise<void> {
	for (const p of paths) {
		try {
			const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(onDiskPath(workspaceRoot, p)))
			await vscode.window.showTextDocument(doc, { preview: false })
		} catch (err) {
			logln(`openConflicts: ${p}: ${err instanceof Error ? err.message : String(err)}`)
		}
	}
}

// ── init / build (still simple shell-outs) ──────────────────────────────
/** The folder to initialize. A not-yet-Volt workspace is absent from `statuses`,
 *  so resolve it from the open workspace folders (prompt if there are several). */
async function initTarget(): Promise<string | undefined> {
	const folders = vscode.workspace.workspaceFolders ?? []
	if (folders.length === 0) {
		vscode.window.showErrorMessage("Open a folder first, then initialize a Volt workspace.")
		return undefined
	}
	if (folders.length === 1) return folders[0].uri.fsPath
	const pick = await vscode.window.showWorkspaceFolderPick({ placeHolder: "Select the folder to initialize as a Volt workspace" })
	return pick?.uri.fsPath
}

function finishInit(ensureWorkspace: (folder: string) => void, workspaceRoot: string, r: { code: number; stderr: string }): void {
	if (r.code !== 0) {
		// init needs a reachable bridge with a project loaded. Bridge lifecycle is the connector's job (tray),
		// not the editor's — so we report and point there rather than starting bridges from here.
		vscode.window.showErrorMessage(
			`volt init failed: ${firstLine(r.stderr) ?? `exit ${r.code}`}. Open your PLC project and start its bridge from the Volt Connector (tray), then try again.`,
		)
		return
	}
	vscode.window.showInformationMessage("Workspace initialized.")
	// The folder now has .git/volt/config.json — register it so the IDE Sync view, status bar and
	// decorations come alive without a reload. ensureWorkspace refreshes the tracker itself (mirrors the
	// desktop's single-refresh bind), so no extra refresh here.
	ensureWorkspace(workspaceRoot)
}

/** Init from a DETECTED PROJECT the user picked — the vendor is derived from it, never chosen. */
async function doInitFromProject(ensureWorkspace: (folder: string) => void, workspaceRoot: string, project: DetectedProject): Promise<void> {
	const r = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: "volt init" },
		(progress) => initFromProject(project, workspaceRoot, { onProgress: progressBridge(progress) }),
	)
	finishInit(ensureWorkspace, workspaceRoot, r)
}

/** Re-init the BOUND workspace with its existing vendor (accept-project-rename / force) — not the picker path. */
async function doReinit(ensureWorkspace: (folder: string) => void, workspaceRoot: string, vendor: Vendor): Promise<void> {
	const r = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: "volt init" },
		(progress) => voltInit(workspaceRoot, vendor, { force: true, onProgress: progressBridge(progress) }),
	)
	finishInit(ensureWorkspace, workspaceRoot, r)
}

/** Pick a detected project from the connector's list (no picker when exactly one). */
async function pickProject(projects: DetectedProject[]): Promise<DetectedProject | undefined> {
	if (projects.length === 1) return projects[0]
	const items = projects.map((p) => ({
		label: `${p.vendor === "twincat" ? "TwinCAT" : "CODESYS"} · ${p.displayName}${p.dirty ? " *" : ""}`,
		project: p,
	}))
	const pick = await vscode.window.showQuickPick(items, { placeHolder: "Pick the PLC project to initialize this workspace from" })
	return pick?.project
}

/** Re-point the bridge at the bound project (the "Reconnect" action) — reopening a bound workspace doesn't
 *  re-fire the connect, so this is how the user recovers when the bridge drifts to another/no project. */
async function doReconnect(statuses: Map<string, VoltStatus>, workspaceRoot: string): Promise<void> {
	const r = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: "Reconnecting to the IDE…" },
		() => reconnectBound(workspaceRoot),
	)
	await statuses.get(workspaceRoot)?.refresh(true) // reflect the new bridge selection
	if (r.ok) vscode.window.showInformationMessage("Reconnected to the IDE.")
	else vscode.window.showErrorMessage(r.message ?? "Reconnect failed.")
}

async function doBuild(workspaceRoot: string): Promise<void> {
	const r = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: "volt build" },
		(progress) => build(workspaceRoot, { onProgress: progressBridge(progress) }),
	)
	output().appendLine(r.stdout)
	if (r.stderr.length > 0) output().appendLine(r.stderr)
	output().show()
	if (r.code !== 0) vscode.window.showWarningMessage("Build reported errors — see the Volt output.")
}

// ── registration (IDs MUST match package.json contributions) ────────────
export function registerCommands(statuses: Map<string, VoltStatus>, ensureWorkspace: (folder: string) => void): vscode.Disposable[] {
	const ws = (): string | undefined => pickStatus(statuses)?.workspaceRoot
	const reg = vscode.commands.registerCommand

	return [
		reg("volt.init", async () => {
			const w = await initTarget()
			if (!w) return
			const projects = await detectedProjects()
			if (projects.length === 0) {
				vscode.window.showErrorMessage("No PLC project detected. Open a project in TwinCAT, or activate Volt in CODESYS from the Volt Connector (tray), then try again.")
				return
			}
			const project = await pickProject(projects)
			if (project) await doInitFromProject(ensureWorkspace, w, project)
		}),
		reg("volt.acceptProjectRename", async () => { const w = ws(); if (w) await doReinit(ensureWorkspace, w, readBridgeVendor(w) ?? "twincat") }),

		reg("volt.pull", async () => { const w = ws(); if (w) await doPull(statuses, w, false) }),
		reg("volt.push", async () => { const w = ws(); if (w) await doPush(statuses, w, false) }),
		reg("volt.forcePull", async () => { const w = ws(); if (w && (await vscodePresenter.confirm(FORCE_PULL))) await doPull(statuses, w, true) }),
		reg("volt.forcePush", async () => { const w = ws(); if (w && (await vscodePresenter.confirm(FORCE_PUSH))) await doPush(statuses, w, true) }),

		reg("volt.finishMerge", async () => { const w = ws(); if (w) await doFinishMerge(statuses, w) }),
		reg("volt.abortMerge", async () => { const w = ws(); if (w) await doAbortMerge(statuses, w) }),
		reg("volt.takeIdeVersion", async (node?: { merge?: { workspaceRoot: string; relPath: string } }) => doTakeSide(statuses, node, "ide")),
		reg("volt.takeMyVersion", async (node?: { merge?: { workspaceRoot: string; relPath: string } }) => doTakeSide(statuses, node, "mine")),

		reg("volt.connect", async () => { const w = ws(); if (w) await doReconnect(statuses, w) }),
		reg("volt.disconnect", async () => {
			await disconnect() // clear the active connection; every host stays live
			for (const s of statuses.values()) await s.refresh(true)
			vscode.window.showInformationMessage("Disconnected. Every IDE stays live — connect again to switch.")
		}),
		reg("volt.build", async () => { const w = ws(); if (w) await doBuild(w) }),
		reg("volt.status", async () => {
			const s = pickStatus(statuses)
			if (s === undefined) return
			await s.refresh()
			const c = s.cached
			output().appendLine("── volt status ──")
			if (c !== undefined) output().appendLine(c.summary)
			else if (s.statusError !== undefined) output().appendLine(`status unavailable: ${s.statusError}`)
			output().show()
		}),
		// A status refresh cold-spawns `volt status` per workspace (a couple seconds) — show a loading bar in the
		// Sync view's title so the refresh button gives feedback instead of appearing to do nothing.
		reg("volt.refresh", () =>
			vscode.window.withProgress({ location: { viewId: "volt.views.sync" } }, async () => {
				for (const s of statuses.values()) await s.refresh()
			}),
		),

		reg("volt.openConfig", () => {
			const w = ws(); if (!w) return
			void vscode.commands.executeCommand("vscode.open", vscode.Uri.file(join(w, ".git", "volt", "config.json")))
		}),
		reg("volt.openSettings", () => { void vscode.commands.executeCommand("workbench.action.openSettings", "volt") }),
		reg("volt.openReference", async () => {
			const w = ws(); if (!w) return
			// Init installs the ST language reference as a skill under .claude/skills/.
			for (const candidate of [join(w, ".claude", "skills", "st-reference", "SKILL.md")]) {
				try {
					const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(candidate))
					await vscode.window.showTextDocument(doc)
					return
				} catch { /* try next */ }
			}
			vscode.window.showInformationMessage("No language reference found — run `volt init` to scaffold it.")
		}),
		reg("volt.showOutput", () => { output().show() }),
	]
}
