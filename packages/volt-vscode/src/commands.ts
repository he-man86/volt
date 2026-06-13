import * as vscode from "vscode"
import { join } from "node:path"
import { writeFileSync } from "node:fs"
import { spawnVolt, spawnVoltBuffer } from "./cli.js"
import { withGate } from "./gate.js"
import { VoltStatus } from "./state/status.js"

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

// ── The pull/push --json outcome contract (mirror of the CLI) ───────────
type PullOutcome =
	| { kind: "ok"; synced: string[] }
	| { kind: "refused"; reason: string }
	| { kind: "conflict"; paths: string[] }
type PushOutcome =
	| { kind: "ok"; items: string[] }
	| { kind: "rejected"; reason: string }

function parseJson<T>(stdout: string): T | null {
	const trimmed = stdout.trim()
	if (trimmed.length === 0) return null
	try {
		return JSON.parse(trimmed) as T
	} catch {
		return null
	}
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
	if (s !== undefined) await s.refresh()
}

/** The tree element passed to view/item/context commands carries the bare,
 *  snapshot-tree-relative path in `rel` (e.g. "POUs/Foo.st"). */
function nodeRel(arg: unknown): string | undefined {
	if (typeof arg === "object" && arg !== null) {
		const rel = (arg as { rel?: unknown }).rel
		if (typeof rel === "string" && rel.length > 0) return rel
	}
	return undefined
}

/** On-disk absolute path for a snapshot-tree-relative path (src/ is the tree root). */
function onDiskPath(workspaceRoot: string, rel: string): string {
	return join(workspaceRoot, "src", rel)
}

// ── pull / push with outcome-aware UX ───────────────────────────────────
async function doPull(statuses: Map<string, VoltStatus>, workspaceRoot: string, force: boolean): Promise<void> {
	await withGate(workspaceRoot, async () =>
		await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: force ? "volt pull --force" : "volt pull" },
			async () => {
				const r = await spawnVolt(workspaceRoot, ["--workspace", workspaceRoot, "pull", ...(force ? ["--force"] : []), "--json"])
				const outcome = parseJson<PullOutcome>(r.stdout)
				if (outcome === null) {
					vscode.window.showErrorMessage(`volt pull failed: ${firstLine(r.stderr) ?? `exit ${r.code}`}`)
					logln(`pull: unparseable output (exit ${r.code}): ${r.stderr}`)
					return
				}
				if (outcome.kind === "ok") {
					vscode.window.showInformationMessage(`Pulled ${outcome.synced.length} file(s) from the IDE.`)
				} else if (outcome.kind === "refused") {
					const pick = await vscode.window.showWarningMessage(`volt: ${outcome.reason}`, "Force Pull")
					if (pick === "Force Pull") await confirmForcePull(statuses, workspaceRoot)
				} else {
					// conflict
					const pick = await vscode.window.showWarningMessage(
						`Pull produced ${outcome.paths.length} merge conflict(s). Resolve the markers, then continue.`,
						"Open Conflicts",
						"Abort Merge",
					)
					if (pick === "Open Conflicts") await openConflicts(workspaceRoot, outcome.paths)
					else if (pick === "Abort Merge") await runMerge(statuses, workspaceRoot, ["--abort"])
				}
			},
		),
	)
	await refreshFor(statuses, workspaceRoot)
}

async function doPush(statuses: Map<string, VoltStatus>, workspaceRoot: string, force: boolean): Promise<void> {
	await withGate(workspaceRoot, async () =>
		await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: force ? "volt push --force" : "volt push" },
			async () => {
				const r = await spawnVolt(workspaceRoot, ["--workspace", workspaceRoot, "push", ...(force ? ["--force"] : []), "--json"])
				const outcome = parseJson<PushOutcome>(r.stdout)
				if (outcome === null) {
					vscode.window.showErrorMessage(`volt push failed: ${firstLine(r.stderr) ?? `exit ${r.code}`}`)
					logln(`push: unparseable output (exit ${r.code}): ${r.stderr}`)
					return
				}
				if (outcome.kind === "ok") {
					vscode.window.showInformationMessage(`Pushed ${outcome.items.length} item(s) to the IDE.`)
				} else {
					// rejected (drift / policy / merge-in-progress) — the reason is actionable.
					const pick = await vscode.window.showWarningMessage(`volt: ${outcome.reason}`, "Pull First", "Force Push")
					if (pick === "Pull First") await doPull(statuses, workspaceRoot, false)
					else if (pick === "Force Push") await confirmForcePush(statuses, workspaceRoot)
				}
			},
		),
	)
	await refreshFor(statuses, workspaceRoot)
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

// ── merge ───────────────────────────────────────────────────────────────
async function runMerge(statuses: Map<string, VoltStatus>, workspaceRoot: string, mergeArgs: string[]): Promise<boolean> {
	const r = await spawnVolt(workspaceRoot, ["--workspace", workspaceRoot, "merge", ...mergeArgs])
	if (r.code !== 0) {
		vscode.window.showErrorMessage(`volt merge failed: ${firstLine(r.stderr) ?? `exit ${r.code}`}`)
		await refreshFor(statuses, workspaceRoot)
		return false
	}
	await refreshFor(statuses, workspaceRoot)
	return true
}

async function resolveOne(statuses: Map<string, VoltStatus>, workspaceRoot: string, rel: string, side: "ours" | "theirs"): Promise<void> {
	await runMerge(statuses, workspaceRoot, ["--resolve", rel, side === "ours" ? "--use-ours" : "--use-theirs"])
}

async function resolveAll(statuses: Map<string, VoltStatus>, workspaceRoot: string, side: "ours" | "theirs"): Promise<void> {
	const s = statuses.get(workspaceRoot)
	const conflicts = s?.cached?.merging?.conflicts ?? []
	if (conflicts.length === 0) return
	for (const c of conflicts) {
		await runMerge(statuses, workspaceRoot, ["--resolve", c.path, side === "ours" ? "--use-ours" : "--use-theirs"])
	}
}

// ── discard a single outgoing edit (restore the snapshot/HEAD version) ──
async function discardOutgoing(statuses: Map<string, VoltStatus>, workspaceRoot: string, rel: string): Promise<void> {
	const pick = await vscode.window.showWarningMessage(
		`Discard your local change to ${rel} and restore the last-synced version?`,
		{ modal: true },
		"Discard",
	)
	if (pick !== "Discard") return
	const r = await spawnVoltBuffer(workspaceRoot, ["--workspace", workspaceRoot, "show", "HEAD", rel])
	if (r.code !== 0) {
		vscode.window.showErrorMessage(`Couldn't restore ${rel}: ${firstLine(r.stderr) ?? `exit ${r.code}`}`)
		return
	}
	try {
		writeFileSync(onDiskPath(workspaceRoot, rel), r.stdout)
		await refreshFor(statuses, workspaceRoot)
	} catch (err) {
		vscode.window.showErrorMessage(`Couldn't write ${rel}: ${err instanceof Error ? err.message : String(err)}`)
	}
}

// ── init / build (still simple shell-outs) ──────────────────────────────
async function doInit(statuses: Map<string, VoltStatus>, workspaceRoot: string, force: boolean): Promise<void> {
	await withGate(workspaceRoot, async () =>
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "volt init" }, async () => {
			const r = await spawnVolt(workspaceRoot, ["--workspace", workspaceRoot, "init", ...(force ? ["--force"] : [])])
			if (r.code !== 0) {
				vscode.window.showErrorMessage(`volt init failed: ${firstLine(r.stderr) ?? `exit ${r.code}`}`)
				return
			}
			vscode.window.showInformationMessage("Workspace initialized.")
		}),
	)
	await refreshFor(statuses, workspaceRoot)
}

async function doBuild(workspaceRoot: string): Promise<void> {
	const r = await spawnVolt(workspaceRoot, ["--workspace", workspaceRoot, "build"])
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
export function registerCommands(statuses: Map<string, VoltStatus>): vscode.Disposable[] {
	const ws = (): string | undefined => pickStatus(statuses)?.workspaceRoot
	const reg = vscode.commands.registerCommand

	return [
		reg("volt.init", async () => { const w = ws(); if (w) await doInit(statuses, w, false) }),
		reg("volt.initTwincat", async () => { const w = ws(); if (w) await doInit(statuses, w, false) }),
		reg("volt.initCodesys", async () => { const w = ws(); if (w) await doInit(statuses, w, false) }),
		reg("volt.acceptProjectRename", async () => { const w = ws(); if (w) await doInit(statuses, w, true) }),

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
			void vscode.commands.executeCommand("vscode.open", vscode.Uri.file(join(w, ".volt", "config.json")))
		}),
		reg("volt.openSettings", () => { void vscode.commands.executeCommand("workbench.action.openSettings", "volt") }),
		reg("volt.openReference", async () => {
			const w = ws(); if (!w) return
			// Init scaffolds the language reference + SKILL.md under .volt/.
			for (const candidate of [join(w, ".volt", "reference", "SKILL.md"), join(w, ".volt", "SKILL.md")]) {
				try {
					const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(candidate))
					await vscode.window.showTextDocument(doc)
					return
				} catch { /* try next */ }
			}
			vscode.window.showInformationMessage("No language reference found — run `volt init` to scaffold it.")
		}),
		reg("volt.showOutput", () => { output().show() }),

		// ── merge ──
		reg("volt.merge.continue", async () => { const w = ws(); if (w) await runMerge(statuses, w, ["--continue"]) }),
		reg("volt.merge.abort", async () => { const w = ws(); if (w) await runMerge(statuses, w, ["--abort"]) }),
		reg("volt.merge.openEditor", async (arg: unknown) => {
			const w = ws(); const rel = nodeRel(arg); if (!w || !rel) return
			// The conflict file already carries <<<<<<< markers; open it for inline resolution.
			try {
				const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(onDiskPath(w, rel)))
				await vscode.window.showTextDocument(doc, { preview: false })
			} catch (err) {
				vscode.window.showErrorMessage(`Couldn't open ${rel}: ${err instanceof Error ? err.message : String(err)}`)
			}
		}),
		reg("volt.merge.useMine", async (arg: unknown) => { const w = ws(); const rel = nodeRel(arg); if (w && rel) await resolveOne(statuses, w, rel, "ours") }),
		reg("volt.merge.useTheirs", async (arg: unknown) => { const w = ws(); const rel = nodeRel(arg); if (w && rel) await resolveOne(statuses, w, rel, "theirs") }),
		reg("volt.merge.useAllMine", async () => { const w = ws(); if (w) await resolveAll(statuses, w, "ours") }),
		reg("volt.merge.useAllTheirs", async () => { const w = ws(); if (w) await resolveAll(statuses, w, "theirs") }),

		// ── discard a single outgoing change ──
		reg("volt.discardOutgoing", async (arg: unknown) => { const w = ws(); const rel = nodeRel(arg); if (w && rel) await discardOutgoing(statuses, w, rel) }),
	]
}
