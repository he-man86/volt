import * as vscode from "vscode"
import { join } from "node:path"
import {
	VoltStatus,
	pull, push, build, initFromProject, rebind, connectWorkspace, disconnectWorkspace, detectedProjects,
	mergeContinue, mergeAbort, mergeResolve,
	describePull, describePush, describeMerge, confirmInitMessage, confirmInitDetail, presentOutcome, settleOutcome, formatProgress, firstLine, FORCE_PULL, FORCE_PUSH,
	type ProgressUpdate, type OutcomePresenter, type PullOutcome, type PushOutcome, type MergeOutcome, type DetectedProject,
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
			// Nothing to decide → surface only problems. A plain success needs no toast (the views update; the
			// in-progress feedback was the notification spinner). Errors and warnings still show.
			if (view.tone === "error") void vscode.window.showErrorMessage(view.message)
			else if (view.tone === "warn") void vscode.window.showWarningMessage(view.message)
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
	// Same notification spinner as pull/push/merge — no bridge action should run without feedback.
	const outcome = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: "volt merge --abort" },
		() => mergeAbort(workspaceRoot),
	)
	await settleFor(statuses, workspaceRoot, outcome)
	if (outcome.kind === "error") logln(`merge --abort: ${outcome.message}`)
	await presentOutcome(describeMerge(outcome), vscodePresenter, async () => {})
}

/** Take one whole side of a single conflicted file, then leave the rest to the user + Finish Merge. */
async function doTakeSide(statuses: Map<string, VoltStatus>, node: { merge?: { workspaceRoot: string; relPath: string } } | undefined, side: "mine" | "ide"): Promise<void> {
	const m = node?.merge
	if (m === undefined) return
	const outcome = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: `Taking ${side === "ide" ? "the IDE's" : "your"} version` },
		() => mergeResolve(m.workspaceRoot, m.relPath, side),
	)
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
/** Pick WHERE to create the workspace — a PARENT folder; `volt init` makes <parent>/<project name>/ inside it
 *  (git-clone semantics, identical to the desktop). No open folder required. */
async function initTarget(): Promise<string | undefined> {
	const picked = await vscode.window.showOpenDialog({
		canSelectFolders: true,
		canSelectFiles: false,
		canSelectMany: false,
		openLabel: "Create workspace here",
		title: "Choose where to create the Volt workspace",
	})
	return picked?.[0]?.fsPath
}

/** Reports a failed init and returns true (so the caller bails). init needs a reachable bridge with a project
 *  loaded; bridge lifecycle is the connector's job (tray), so we point there rather than starting bridges here. */
function initFailed(r: { code: number; stderr: string }): boolean {
	if (r.code === 0) return false
	vscode.window.showErrorMessage(
		`volt init failed: ${firstLine(r.stderr) ?? `exit ${r.code}`}. Open your PLC project and start its bridge from the Volt Connector (tray), then try again.`,
	)
	return true
}

/** Init from a DETECTED PROJECT the user picked — the vendor is derived from it, never chosen.
 *
 *  Confirms MODALLY first, naming both sides. Init is not a preview: it makes the folder a git repo and pulls the
 *  whole PLC project into it. The Bridge view's detected-project rows are `TreeItem.command`s, which VS Code fires
 *  on a SINGLE CLICK — so a row that reads like a status line was one stray click away from initializing a folder,
 *  and with exactly one project detected (the common case) nothing asked first. This is that missing question. */
async function confirmInit(parent: string, project: DetectedProject): Promise<boolean> {
	const pick = await vscode.window.showInformationMessage(
		`Create a Volt workspace for “${project.displayName}”?`,
		{
			modal: true,
			detail: `A folder named after the project is created in:\n${parent}\n\nVolt makes it a git repository and pulls the PLC project's code into it, then opens it. Your IDE project is not modified.`,
		},
		"Create Workspace",
	)
	return pick === "Create Workspace"
}

async function doInitFromProject(parent: string, project: DetectedProject): Promise<void> {
	if (!(await confirmInit(parent, project))) return
	const r = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: "volt init" },
		(progress) => initFromProject(project, parent, { onProgress: progressBridge(progress) }),
	)
	if (initFailed(r)) return
	if (!r.workspace) {
		vscode.window.showErrorMessage("volt init succeeded but reported no workspace path — please retry.")
		return
	}
	// volt init created <parent>/<project name>/ — open it (reloads into the new workspace, like Git: Clone → Open).
	// The reactivation in that folder brings the IDE Sync view + status bar online; no ensureWorkspace needed here.
	await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(r.workspace), { forceReuseWindow: true })
}

/** Re-bind the workspace to a DIFFERENT detected project — the reconnect list's "rebind" (a rename in the IDE, or a
 *  wrong bind). Confirms modally, then initFromProject(force) re-points the binding and reconnects. Replaces the old
 *  accept-project-rename flow. */
async function doRebindProject(ensureWorkspace: (folder: string) => void, workspaceRoot: string, project: DetectedProject): Promise<void> {
	const pick = await vscode.window.showWarningMessage(
		`Re-point this workspace to “${project.displayName}”?`,
		{ modal: true, detail: `${workspaceRoot}\n\nOnly the binding changes — your files, git history and the folder name are untouched. Run Pull afterward to bring in “${project.displayName}”'s code.` },
		"Rebind",
	)
	if (pick !== "Rebind") return
	const r = await rebind(workspaceRoot, project) // config-only re-point — instant, no progress
	if (!r.ok) { vscode.window.showErrorMessage(`Rebind failed: ${r.message ?? "unknown error"}.`); return }
	ensureWorkspace(workspaceRoot) // same folder — refresh the views in place
}

/** Pick a detected project from the connector's list. ALWAYS shown, even for a single project: init binds this
 *  folder to that project permanently, and the picker is the only place its NAME is stated — auto-selecting made
 *  the one-project case (the common one) bind silently to something the user never saw named. */
async function pickProject(projects: DetectedProject[]): Promise<DetectedProject | undefined> {
	const items = projects.map((p) => ({
		label: `${p.displayName}${p.dirty ? " *" : ""}`,
		description: p.ideVersion ?? undefined,
		project: p,
	}))
	const pick = await vscode.window.showQuickPick(items, { placeHolder: "Pick the PLC project to initialize this workspace from" })
	return pick?.project
}

/** Re-point the bridge at the bound project (the "Reconnect" action) — reopening a bound workspace doesn't
 *  re-fire the connect, so this is how the user recovers when the bridge drifts to another/no project. */
async function doReconnect(statuses: Map<string, VoltStatus>, workspaceRoot: string): Promise<void> {
	const st = statuses.get(workspaceRoot)
	if (st === undefined) return
	// The flow (declare interest → settle health → word the result) is @volt/control's connectWorkspace, shared with
	// the desktop; the toast stays open for it, so the Bridge view has already flipped when it closes.
	const view = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: "Reconnecting to the IDE…" },
		() => connectWorkspace(st),
	)
	// Success needs no toast — the Bridge view flips to Disconnect. Only report a failure.
	if (view.tone === "error") vscode.window.showErrorMessage(view.message)
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
				vscode.window.showErrorMessage("No PLC project detected. Open a PLC project in your IDE, or start it from the Volt Connector (tray), then try again.")
				return
			}
			const project = await pickProject(projects)
			if (project) await doInitFromProject(w, project)
		}),
		// Set up a SPECIFIC detected project — fired by its Bridge-view row, which passes the project. No
		// project-picker QuickPick (the click already chose it); just resolve the folder and confirm. This is what
		// the row's "click to set up" does; volt.init (above) is the palette path that still asks which project.
		reg("volt.initProject", async (project?: DetectedProject) => {
			if (!project) return
			const w = await initTarget()
			if (w) await doInitFromProject(w, project)
		}),
		// Rebind to a DIFFERENT detected project — fired by a reconnect-list "rebind" row (a rename, or wrong bind).
		reg("volt.rebindProject", async (project?: DetectedProject) => { const w = ws(); if (w && project) await doRebindProject(ensureWorkspace, w, project) }),

		reg("volt.pull", async () => { const w = ws(); if (w) await doPull(statuses, w, false) }),
		reg("volt.push", async () => { const w = ws(); if (w) await doPush(statuses, w, false) }),
		reg("volt.forcePull", async () => { const w = ws(); if (w && (await vscodePresenter.confirm(FORCE_PULL))) await doPull(statuses, w, true) }),
		reg("volt.forcePush", async () => { const w = ws(); if (w && (await vscodePresenter.confirm(FORCE_PUSH))) await doPush(statuses, w, true) }),

		reg("volt.finishMerge", async () => { const w = ws(); if (w) await doFinishMerge(statuses, w) }),
		reg("volt.abortMerge", async () => { const w = ws(); if (w) await doAbortMerge(statuses, w) }),
		reg("volt.takeIdeVersion", async (node?: { merge?: { workspaceRoot: string; relPath: string } }) => doTakeSide(statuses, node, "ide")),
		reg("volt.takeMyVersion", async (node?: { merge?: { workspaceRoot: string; relPath: string } }) => doTakeSide(statuses, node, "mine")),

		reg("volt.connect", async () => { const w = ws(); if (w) await doReconnect(statuses, w) }),
		// The Bridge view's counterpart to Reconnect. The bridge stops serving sync (the CLI's push/pull are refused)
		// but nothing is torn down — the IDE stays open and re-connectable, so this is a pause, not a shutdown.
		reg("volt.disconnect", async () => {
			const w = ws()
			if (!w) return
			const st = statuses.get(w)
			if (!st) return
			// Disconnect THIS workspace's project, not the tray's active connection. They are routinely different
			// (two IDEs open, two windows), and the global call gated the wrong project: the row the user clicked
			// stayed connected while another workspace silently stopped syncing. The flow + wording are
			// @volt/control's disconnectWorkspace, shared with the desktop, so the two can't drift.
			const view = await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: "volt disconnect" },
				() => disconnectWorkspace(st),
			)
			await presentOutcome(view, vscodePresenter, async () => {})
		}),
		reg("volt.build", async () => { const w = ws(); if (w) await doBuild(w) }),
		// A status refresh cold-spawns `volt status` per workspace (a couple seconds) — show a notification toast
		// (same indicator as push/pull) so the refresh button gives feedback instead of appearing to do nothing.
		reg("volt.refresh", () =>
			vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "volt refresh" }, async () => {
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
