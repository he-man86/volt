import * as vscode from "vscode"
import { join } from "node:path"
import {
	VoltStatus,
	pull, push, build, init as voltInit, readBridgePort, vendorPort,
	describePull, describePush,
	type ProgressUpdate, type OutcomeView, type OutcomeActionTag, type PullOutcome, type PushOutcome,
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

async function refreshFor(statuses: Map<string, VoltStatus>, workspaceRoot: string): Promise<void> {
	const s = statuses.get(workspaceRoot)
	// Force past the 1s debounce: an explicit action just changed state, so the
	// tree must update now (otherwise the item lingers in the diff list).
	if (s !== undefined) await s.refresh(true)
}

// After a pull/push: adopt the status the action already returned (ONE bridge call, no follow-up `volt status`
// /refs); only re-fetch when it didn't succeed (state uncertain). ok-without-status (nothing to push) is a no-op.
async function settleFor(statuses: Map<string, VoltStatus>, workspaceRoot: string, outcome: PullOutcome | PushOutcome): Promise<void> {
	const s = statuses.get(workspaceRoot)
	if (s === undefined) return
	if (outcome.kind === "ok") {
		if (outcome.status) s.adopt(outcome.status)
	} else await s.refresh(true)
}

/** On-disk absolute path for a snapshot-tree-relative path (src/ is the tree root).
 *  Tolerates an already-src/-prefixed rel so we never produce src/src/…. */
function onDiskPath(workspaceRoot: string, rel: string): string {
	const treePath = rel.startsWith("src/") ? rel.slice(4) : rel
	return join(workspaceRoot, "src", treePath)
}

// Map the CLI's streamed progress frames to VS Code's notification bar (increment is a delta 0-100).
type VsProgress = vscode.Progress<{ increment?: number; message?: string }>
function progressBridge(progress: VsProgress): (p: ProgressUpdate) => void {
	let lastPct = 0
	return (p) => {
		const pct = p.total && p.total > 0 ? Math.floor((p.done / p.total) * 100) : undefined
		const message = p.phase ?? (pct !== undefined ? `${p.done}/${p.total}` : undefined)
		if (pct !== undefined) {
			progress.report({ increment: Math.max(0, pct - lastPct), message })
			lastPct = pct
		} else {
			progress.report({ message })
		}
	}
}

// ── pull / push with outcome-aware UX ───────────────────────────────────
// The outcome → actions decision lives once in volt-control (describePull/describePush). Here we only render
// that neutral descriptor as native VS Code dialogs and dispatch the chosen action tag to its handler.
async function presentOutcome(view: OutcomeView, run: (tag: OutcomeActionTag) => Promise<void>): Promise<void> {
	if (view.actions.length === 0) {
		if (view.tone === "error") vscode.window.showErrorMessage(view.message)
		else vscode.window.showInformationMessage(view.message)
		return
	}
	const labels = view.actions.map((a) => a.label)
	const picked =
		view.tone === "error"
			? await vscode.window.showErrorMessage(view.message, ...labels)
			: await vscode.window.showWarningMessage(view.message, ...labels)
	const action = view.actions.find((a) => a.label === picked)
	if (action !== undefined) await run(action.tag)
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
	await presentOutcome(describePull(outcome), async (tag) => {
		if (tag === "open-conflicts" && outcome.kind === "conflict") await openConflicts(workspaceRoot, outcome.paths)
		else if (tag === "force-pull") await confirmForcePull(statuses, workspaceRoot)
	})
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
	await presentOutcome(describePush(outcome), async (tag) => {
		if (tag === "pull-first") await doPull(statuses, workspaceRoot, false)
		else if (tag === "force-push") await confirmForcePush(statuses, workspaceRoot)
	})
}

async function confirmForcePull(statuses: Map<string, VoltStatus>, workspaceRoot: string): Promise<void> {
	const pick = await vscode.window.showWarningMessage(
		"Force pull discards your local workspace edits and overwrites them with the IDE's state. This cannot be undone.",
		{ modal: true },
		"Discard & Pull",
	)
	if (pick === "Discard & Pull") await doPull(statuses, workspaceRoot, true)
}

async function confirmForcePush(statuses: Map<string, VoltStatus>, workspaceRoot: string): Promise<void> {
	const pick = await vscode.window.showWarningMessage(
		"Force push overwrites the IDE with your workspace, ignoring changes the engineer made since your last pull.",
		{ modal: true },
		"Force Push",
	)
	if (pick === "Force Push") await doPush(statuses, workspaceRoot, true)
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

async function doInit(
	statuses: Map<string, VoltStatus>,
	ensureWorkspace: (folder: string) => void,
	workspaceRoot: string,
	port: number,
	force: boolean,
): Promise<void> {
	const r = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: "volt init" },
		(progress) => voltInit(workspaceRoot, port, { force, onProgress: progressBridge(progress) }),
	)
	if (r.code !== 0) {
		// init needs a reachable bridge with a project loaded. Bridge lifecycle is the connector's job (tray),
		// not the editor's — so we report and point there rather than starting bridges from here.
		vscode.window.showErrorMessage(
			`volt init failed: ${firstLine(r.stderr) ?? `exit ${r.code}`}. Open your PLC project and start its bridge from the Volt Connector (tray), then click Initialize again.`,
		)
		return
	}
	vscode.window.showInformationMessage("Workspace initialized.")
	// The folder now has .git/volt/config.json — register it so the IDE Sync view, status
	// bar and decorations come alive without a reload.
	ensureWorkspace(workspaceRoot)
	await refreshFor(statuses, workspaceRoot)
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

function firstLine(s: string): string | undefined {
	const line = s.split(/\r?\n/).find((l) => l.trim().length > 0)
	return line?.trim()
}

// ── registration (IDs MUST match package.json contributions) ────────────
export function registerCommands(statuses: Map<string, VoltStatus>, ensureWorkspace: (folder: string) => void): vscode.Disposable[] {
	const ws = (): string | undefined => pickStatus(statuses)?.workspaceRoot
	const reg = vscode.commands.registerCommand

	return [
		reg("volt.initTwincat", async () => { const w = await initTarget(); if (w) await doInit(statuses, ensureWorkspace, w, vendorPort("twincat"), false) }),
		reg("volt.initCodesys", async () => { const w = await initTarget(); if (w) await doInit(statuses, ensureWorkspace, w, vendorPort("codesys"), false) }),
		reg("volt.acceptProjectRename", async () => { const w = ws(); if (w) await doInit(statuses, ensureWorkspace, w, readBridgePort(w) ?? vendorPort("twincat"), true) }),

		reg("volt.pull", async () => { const w = ws(); if (w) await doPull(statuses, w, false) }),
		reg("volt.push", async () => { const w = ws(); if (w) await doPush(statuses, w, false) }),
		reg("volt.forcePull", async () => { const w = ws(); if (w) await confirmForcePull(statuses, w) }),
		reg("volt.forcePush", async () => { const w = ws(); if (w) await confirmForcePush(statuses, w) }),

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
		reg("volt.refresh", async () => { for (const s of statuses.values()) await s.refresh() }),

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
