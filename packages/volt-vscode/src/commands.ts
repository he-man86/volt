import * as vscode from "vscode"
import { join } from "node:path"
import { pull, push, build, init as voltInit, readBridgePort, probeVendors, isBridgeOnline, healthLabel } from "@opencode-ai/volt-control"
import { VoltStatus } from "./state/status.js"
import { startBridgeByPort, ensureConnectorRunning } from "./connector.js"

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

/** On-disk absolute path for a snapshot-tree-relative path (src/ is the tree root).
 *  Tolerates an already-src/-prefixed rel so we never produce src/src/…. */
function onDiskPath(workspaceRoot: string, rel: string): string {
	const treePath = rel.startsWith("src/") ? rel.slice(4) : rel
	return join(workspaceRoot, "src", treePath)
}

// ── pull / push with outcome-aware UX ───────────────────────────────────
async function doPull(statuses: Map<string, VoltStatus>, workspaceRoot: string, force: boolean): Promise<void> {
	// volt-control.pull takes the gate + parses the outcome; the spinner wraps only
	// the CLI run, and the outcome dialogs run after (so they never hold the gate).
	const outcome = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: force ? "volt pull --force" : "volt pull" },
		() => pull(workspaceRoot, { force }),
	)
	await refreshFor(statuses, workspaceRoot)
	if (outcome.kind === "error") {
		vscode.window.showErrorMessage(`volt pull failed: ${outcome.message}`)
		logln(`pull: ${outcome.message}`)
		return
	}
	if (outcome.kind === "ok") {
		vscode.window.showInformationMessage(`Pulled ${outcome.synced.length} file(s) from the IDE.`)
	} else if (outcome.kind === "refused") {
		const pick = await vscode.window.showWarningMessage(`volt: ${outcome.reason}`, "Force Pull")
		if (pick === "Force Pull") await confirmForcePull(statuses, workspaceRoot)
	} else {
		// conflict — a standard `git merge` state; the editor's built-in Git tools resolve it.
		const pick = await vscode.window.showWarningMessage(
			`Pull hit ${outcome.paths.length} conflict(s) with the IDE. Resolve them with your editor's merge tools, commit, then Pull again to finish.`,
			"Open Conflicts",
		)
		if (pick === "Open Conflicts") await openConflicts(workspaceRoot, outcome.paths)
	}
}

async function doPush(statuses: Map<string, VoltStatus>, workspaceRoot: string, force: boolean): Promise<void> {
	// volt-control.push takes the gate around the CLI run; outcome handling (which may
	// pop a dialog awaiting a click) runs AFTER push() returns — so a rejected push never
	// leaves the spinner stuck or holds the mutation gate (which would wedge the next push).
	const outcome = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: force ? "volt push --force" : "volt push" },
		() => push(workspaceRoot, { force }),
	)
	await refreshFor(statuses, workspaceRoot)
	if (outcome.kind === "error") {
		vscode.window.showErrorMessage(`volt push failed: ${outcome.message}`)
		logln(`push: ${outcome.message}`)
		return
	}
	if (outcome.kind === "ok") {
		vscode.window.showInformationMessage(`Pushed ${outcome.items.length} item(s) to the IDE.`)
	} else {
		// rejected (drift / policy / merge-in-progress / bridge error) — the reason is actionable.
		const pick = await vscode.window.showWarningMessage(`volt: ${outcome.reason}`, "Pull First", "Force Push")
		if (pick === "Pull First") await doPull(statuses, workspaceRoot, false)
		else if (pick === "Force Push") await confirmForcePush(statuses, workspaceRoot)
	}
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

/** Bridge port for a fresh init, from the per-vendor setting (defaults 8555/8556). */
function vendorPort(vendor: "twincat" | "codesys"): number {
	const cfg = vscode.workspace.getConfiguration("volt.bridge")
	return vendor === "codesys" ? cfg.get<number>("codesysPort", 8556) : cfg.get<number>("twincatPort", 8555)
}

// Probe both configured bridge ports and bind to a LIVE IDE — showing its project, so you pick the
// right one when both TwinCAT and CODESYS are connected. (You can only init what's actually live.)
async function setupWorkspace(statuses: Map<string, VoltStatus>, ensureWorkspace: (folder: string) => void): Promise<void> {
	const target = await initTarget()
	if (target === undefined) return

	const probed = await probeVendors(vendorPort("twincat"), vendorPort("codesys"), 2500)
	const live = probed.filter((p) => isBridgeOnline(p.state))
	if (live.length === 0) {
		vscode.window.showWarningMessage(
			`No live PLC IDE on the configured ports (TwinCAT ${vendorPort("twincat")}, CODESYS ${vendorPort("codesys")}). Open a project in TwinCAT or CODESYS, then try again.`,
		)
		return
	}

	const pick = await vscode.window.showQuickPick(
		live.map((p) => ({ label: `$(plug) ${healthLabel(p.state)}`, description: `${p.vendor} · port ${p.port}`, port: p.port })),
		{ placeHolder: "Bind this folder to which live PLC IDE?" },
	)
	if (pick === undefined) return
	await doInit(statuses, ensureWorkspace, target, pick.port, false)
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
		() => voltInit(workspaceRoot, port, { force }),
	)
	if (r.code !== 0) {
		// init needs a reachable bridge with a project loaded. Offer to bring it up.
		const pick = await vscode.window.showErrorMessage(
			`volt init failed: ${firstLine(r.stderr) ?? `exit ${r.code}`}`,
			"Start bridge",
		)
		if (pick === "Start bridge") {
			const ensured = await ensureConnectorRunning()
			if (ensured === "not-found") {
				vscode.window.showWarningMessage("Volt Connector isn't installed — set `volt.connector.path` or install it, then click Initialize again.")
				return
			}
			await startBridgeByPort(port)
			vscode.window.showInformationMessage("Starting the bridge — once your PLC project is open in the IDE, click Initialize again.")
		}
		return
	}
	vscode.window.showInformationMessage("Workspace initialized.")
	// The folder now has .git/volt/config.json — register it so the SCM view, status
	// bar and decorations come alive without a reload.
	ensureWorkspace(workspaceRoot)
	await refreshFor(statuses, workspaceRoot)
}

async function doBuild(workspaceRoot: string): Promise<void> {
	const r = await build(workspaceRoot)
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
		reg("volt.setup", async () => { await setupWorkspace(statuses, ensureWorkspace) }),
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

		// Start this workspace's bridge via the connector (restart worker / launch IDE).
		reg("volt.startBridge", async () => {
			const s = pickStatus(statuses)
			if (s === undefined) return
			const port = readBridgePort(s.workspaceRoot)
			if (port === undefined) { vscode.window.showWarningMessage("No bridge port is configured for this workspace."); return }
			const ensured = await ensureConnectorRunning()
			if (ensured === "not-found") {
				const pick = await vscode.window.showWarningMessage(
					"Volt Connector isn't installed — it manages the bridges from your system tray.", "Where do I get it?")
				if (pick === "Where do I get it?")
					vscode.window.showInformationMessage("Install the Volt Connector (VoltConnector.exe), or set `volt.connector.path` to its location. Then make sure your PLC IDE is open with a project.")
				return
			}
			const result = await startBridgeByPort(port)
			if (result === "no-connector") {
				vscode.window.showWarningMessage("Couldn't reach the Volt Connector even after launching it — give it a moment and try again.")
			} else if (result === "no-bridge") {
				vscode.window.showWarningMessage(`The connector has no bridge on port ${port} for this workspace.`)
			} else {
				vscode.window.showInformationMessage("Starting the bridge — give it a moment…")
				setTimeout(() => { void s.refresh() }, 3000)
			}
		}),

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
