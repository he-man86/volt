import * as vscode from "vscode"
import { join } from "node:path"
import { spawnVolt } from "./cli.js"
import { withGate } from "./gate.js"
import { VoltStatus } from "./state/status.js"
import { openMergeEditor, extractUri, extractPath } from "./merge.js"

const output = (() => {
	let ch: vscode.OutputChannel | undefined
	return () => { if (ch === undefined) ch = vscode.window.createOutputChannel("Volt"); return ch }
})()

function logln(msg: string): void {
	output().appendLine(`[${new Date().toISOString()}] ${msg}`)
}

function pickStatus(statuses: Map<string, VoltStatus>): VoltStatus | undefined {
	if (statuses.size === 1) return [...statuses.values()][0]
	const active = vscode.window.activeTextEditor?.document.uri
	if (active !== undefined) {
		const folder = vscode.workspace.getWorkspaceFolder(active)
		if (folder !== undefined) return statuses.get(folder.uri.fsPath)
	}
	return [...statuses.values()][0]
}

function resolveWorkspace(uri?: vscode.Uri): string | undefined {
	if (uri !== undefined) return vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath
	const s = pickStatus(new Map())
	return s?.workspaceRoot
}

async function quickOp(workspaceRoot: string, args: string[]): Promise<void> {
	const r = await spawnVolt(workspaceRoot, ["--workspace", workspaceRoot, ...args])
	if (r.code !== 0) {
		const lines = r.stderr.split(/\r?\n/).filter((l) => l.trim().length > 0)
		const msg = lines.length > 0 ? lines[0]! : `exit code ${r.code}`
		vscode.window.showErrorMessage(`volt: ${msg}`)
	}
}

async function mutatingOp(statuses: Map<string, VoltStatus>, workspaceRoot: string, args: string[]): Promise<void> {
	await withGate(workspaceRoot, () =>
		Promise.resolve(vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `volt ${args[0]}` }, async (progress) => {
			progress.report({ message: "running..." })
			const r = await spawnVolt(workspaceRoot, ["--workspace", workspaceRoot, ...args])
			if (r.code !== 0) {
				const lines = r.stderr.split(/\r?\n/).filter((l) => l.trim().length > 0)
				vscode.window.showErrorMessage(`volt ${args[0]} failed: ${lines[0] ?? `exit ${r.code}`}`)
				return
			}
			vscode.window.showInformationMessage(`volt ${args[0]} complete`)
		})),
	)

	for (const s of statuses.values()) {
		if (s.workspaceRoot === workspaceRoot) { await s.refresh(); break }
	}
}

export function registerCommands(statuses: Map<string, VoltStatus>): vscode.Disposable[] {
	return [
		vscode.commands.registerCommand("volt.init", async () => {
			const s = pickStatus(statuses)
			if (s === undefined) return
			await mutatingOp(statuses, s.workspaceRoot, ["init"])
		}),
		vscode.commands.registerCommand("volt.pull", async () => {
			const s = pickStatus(statuses)
			if (s === undefined) return
			await mutatingOp(statuses, s.workspaceRoot, ["pull"])
		}),
		vscode.commands.registerCommand("volt.pullForce", async () => {
			const s = pickStatus(statuses)
			if (s === undefined) return
			await mutatingOp(statuses, s.workspaceRoot, ["pull", "--force"])
		}),
		vscode.commands.registerCommand("volt.push", async () => {
			const s = pickStatus(statuses)
			if (s === undefined) return
			await mutatingOp(statuses, s.workspaceRoot, ["push"])
		}),
		vscode.commands.registerCommand("volt.pushForce", async () => {
			const s = pickStatus(statuses)
			if (s === undefined) return
			await mutatingOp(statuses, s.workspaceRoot, ["push", "--force"])
		}),
		vscode.commands.registerCommand("volt.build", async () => {
			const s = pickStatus(statuses)
			if (s === undefined) return
			await quickOp(s.workspaceRoot, ["build"])
		}),
		vscode.commands.registerCommand("volt.status", async () => {
			const s = pickStatus(statuses)
			if (s === undefined) return
			await s.refresh()
			output().show()
		}),
		vscode.commands.registerCommand("volt.refresh", async () => {
			for (const s of statuses.values()) await s.refresh()
		}),
		vscode.commands.registerCommand("volt.openConfig", () => {
			const s = pickStatus(statuses)
			if (s === undefined) return
			const path = join(s.workspaceRoot, ".volt", "config.json")
			void vscode.commands.executeCommand("vscode.open", vscode.Uri.file(path))
		}),
		vscode.commands.registerCommand("volt.showOutput", () => { output().show() }),
		vscode.commands.registerCommand("volt.mergeContinue", async () => {
			const s = pickStatus(statuses)
			if (s === undefined) return
			await quickOp(s.workspaceRoot, ["merge", "--continue"])
		}),
		vscode.commands.registerCommand("volt.mergeAbort", async () => {
			const s = pickStatus(statuses)
			if (s === undefined) return
			await quickOp(s.workspaceRoot, ["merge", "--abort"])
		}),
		vscode.commands.registerCommand("volt.useMine", (arg: unknown) => {
			const path = extractPath(arg, "") ?? ""
			if (path.length === 0) return
			void quickOp(resolveWorkspace(extractUri(arg)) ?? "", ["merge", "--resolve", path, "--use-ours"])
		}),
		vscode.commands.registerCommand("volt.useTheirs", (arg: unknown) => {
			const path = extractPath(arg, "") ?? ""
			if (path.length === 0) return
			void quickOp(resolveWorkspace(extractUri(arg)) ?? "", ["merge", "--resolve", path, "--use-theirs"])
		}),
		vscode.commands.registerCommand("volt.openMergeEditor", (arg: unknown) => {
			const ws = resolveWorkspace(extractUri(arg)) ?? ""
			const path = extractPath(arg, ws) ?? ""
			if (path.length === 0) return
			openMergeEditor(ws, path)
		}),
		vscode.commands.registerCommand("volt.acceptProjectRename", async () => {
			const s = pickStatus(statuses)
			if (s === undefined) return
			await mutatingOp(statuses, s.workspaceRoot, ["init", "--force"])
		}),
	]
}
