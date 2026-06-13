import * as vscode from "vscode"
import { join } from "node:path"
import { writeFileSync } from "node:fs"
import { spawnVolt, spawnVoltBuffer } from "./cli.js"
import { withGate } from "./gate.js"
import { VoltStatus } from "./state/status.js"
import { readBridgePort } from "./state/health.js"
import { startBridgeByPort, ensureConnectorRunning, getConnectorBridges } from "./connector.js"
import { buildUri } from "./providers/content.js"

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
	// Force past the 1s debounce: an explicit action just changed state, so the
	// tree must update now (otherwise the item lingers in the diff list).
	if (s !== undefined) await s.refresh(true)
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

/** On-disk absolute path for a snapshot-tree-relative path (src/ is the tree root).
 *  Tolerates an already-src/-prefixed rel so we never produce src/src/…. */
function onDiskPath(workspaceRoot: string, rel: string): string {
	const treePath = rel.startsWith("src/") ? rel.slice(4) : rel
	return join(workspaceRoot, "src", treePath)
}

// ── pull / push with outcome-aware UX ───────────────────────────────────
async function doPull(statuses: Map<string, VoltStatus>, workspaceRoot: string, force: boolean): Promise<void> {
	await withGate(workspaceRoot, async () =>
		await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: force ? "volt pull --force" : "volt pull" },
			async () => {
				const r = await spawnVolt(workspaceRoot, ["pull", ...(force ? ["--force"] : []), "--json", "--workspace", workspaceRoot])
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
				const r = await spawnVolt(workspaceRoot, ["push", ...(force ? ["--force"] : []), "--json", "--workspace", workspaceRoot])
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
	const r = await spawnVolt(workspaceRoot, ["merge", ...mergeArgs, "--workspace", workspaceRoot])
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

/** Open VS Code's native 3-way merge editor for one conflict: base = last-synced,
 *  the two inputs = your workspace edits vs. the IDE's incoming version, output =
 *  the file on disk. When the resolved result is saved, mark the path resolved so
 *  `merge --continue` succeeds. Falls back to the marker file if the (internal)
 *  merge-editor command is unavailable. */
async function openMergeEditor(statuses: Map<string, VoltStatus>, workspaceRoot: string, rel: string): Promise<void> {
	const output = vscode.Uri.file(onDiskPath(workspaceRoot, rel))
	const name = rel.split("/").pop() ?? rel
	try {
		await vscode.commands.executeCommand("_open.mergeEditor", {
			base: buildUri(workspaceRoot, "MERGE_BASE", rel),
			input1: { uri: buildUri(workspaceRoot, "MERGE_OURS", rel), title: `${name} — Yours`, detail: "your workspace edits" },
			input2: { uri: buildUri(workspaceRoot, "MERGE_THEIRS", rel), title: `${name} — IDE`, detail: "incoming from the PLC IDE" },
			output,
		})
		// Mark resolved once the merged result is saved (continue reads the live
		// workspace bytes, so later edits are still picked up). Time-boxed so an
		// abandoned merge doesn't leak the listener.
		const sub = vscode.workspace.onDidSaveTextDocument(async (doc) => {
			if (doc.uri.fsPath !== output.fsPath) return
			sub.dispose()
			await runMerge(statuses, workspaceRoot, ["--resolve", rel])
		})
		setTimeout(() => sub.dispose(), 15 * 60 * 1000)
	} catch {
		// Fallback: the conflict file already carries <<<<<<< markers.
		try {
			const doc = await vscode.workspace.openTextDocument(output)
			await vscode.window.showTextDocument(doc, { preview: false })
		} catch (err) {
			vscode.window.showErrorMessage(`Couldn't open ${rel}: ${err instanceof Error ? err.message : String(err)}`)
		}
	}
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
	const r = await spawnVoltBuffer(workspaceRoot, ["show", "HEAD", rel, "--workspace", workspaceRoot])
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

/** Smart onboarding: detect the running IDE/project via the connector and bind to
 *  it directly — no "which vendor?" guessing. Falls back to an explicit pick when
 *  nothing is detected. */
async function setupWorkspace(statuses: Map<string, VoltStatus>, ensureWorkspace: (folder: string) => void): Promise<void> {
	const target = await initTarget()
	if (target === undefined) return

	const ensured = await ensureConnectorRunning()
	const bridges = ensured === "not-found" ? undefined : await getConnectorBridges()
	const ready = (bridges ?? []).filter((b) => b.status === "connected") // a project is loaded

	if (ready.length === 1) {
		await doInit(statuses, ensureWorkspace, target, ready[0]!.port, false)
		return
	}
	if (ready.length > 1) {
		const pick = await vscode.window.showQuickPick(
			ready.map((b) => ({ label: b.displayName, description: `port ${b.port}`, port: b.port })),
			{ placeHolder: "Initialize for which running IDE?" },
		)
		if (pick === undefined) return
		await doInit(statuses, ensureWorkspace, target, pick.port, false)
		return
	}

	// Nothing detected — guide, but still let them pick a target explicitly.
	const choice = await vscode.window.showInformationMessage(
		"No PLC project detected. Open a project in your IDE (and make sure the bridge is running), then try again — or choose a target:",
		"Start bridge", "TwinCAT", "CODESYS",
	)
	if (choice === "Start bridge") {
		if (ensured === "not-found") {
			vscode.window.showWarningMessage("Volt Connector isn't installed — set `volt.connector.path` or install it, then try again.")
			return
		}
		await startBridgeByPort(vendorPort("twincat"))
		vscode.window.showInformationMessage("Starting the bridge — once your project is open in the IDE, run Set Up again.")
	} else if (choice === "TwinCAT") {
		await doInit(statuses, ensureWorkspace, target, vendorPort("twincat"), false)
	} else if (choice === "CODESYS") {
		await doInit(statuses, ensureWorkspace, target, vendorPort("codesys"), false)
	}
}

async function doInit(
	statuses: Map<string, VoltStatus>,
	ensureWorkspace: (folder: string) => void,
	workspaceRoot: string,
	port: number,
	force: boolean,
): Promise<void> {
	const r = await withGate(workspaceRoot, async () =>
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "volt init" }, async () =>
			await spawnVolt(workspaceRoot, ["init", "--port", String(port), ...(force ? ["--force"] : []), "--workspace", workspaceRoot]),
		),
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
	// The folder now has .volt/config.json — register it so the SCM view, status
	// bar and decorations come alive without a reload.
	ensureWorkspace(workspaceRoot)
	await refreshFor(statuses, workspaceRoot)
}

async function doBuild(workspaceRoot: string): Promise<void> {
	const r = await spawnVolt(workspaceRoot, ["build", "--workspace", workspaceRoot])
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
		reg("volt.init", async () => { const w = await initTarget(); if (w) await doInit(statuses, ensureWorkspace, w, vendorPort("twincat"), false) }),
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
			await openMergeEditor(statuses, w, rel)
		}),
		reg("volt.merge.useMine", async (arg: unknown) => { const w = ws(); const rel = nodeRel(arg); if (w && rel) await resolveOne(statuses, w, rel, "ours") }),
		reg("volt.merge.useTheirs", async (arg: unknown) => { const w = ws(); const rel = nodeRel(arg); if (w && rel) await resolveOne(statuses, w, rel, "theirs") }),
		reg("volt.merge.useAllMine", async () => { const w = ws(); if (w) await resolveAll(statuses, w, "ours") }),
		reg("volt.merge.useAllTheirs", async () => { const w = ws(); if (w) await resolveAll(statuses, w, "theirs") }),

		// ── discard a single outgoing change ──
		reg("volt.discardOutgoing", async (arg: unknown) => { const w = ws(); const rel = nodeRel(arg); if (w && rel) await discardOutgoing(statuses, w, rel) }),
	]
}
