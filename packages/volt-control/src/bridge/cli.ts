import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"

/** The CLI bundled inside the extension (dist/cli.js). Set once at activation.
 *  Shipping the CLI with the extension makes it self-contained: a PLC workspace
 *  needs no Node toolchain and no `node_modules/.bin/volt`. */
let bundledCli: string | undefined

export function setBundledCli(path: string): void {
	if (existsSync(path)) bundledCli = path
}

/** Resolve the volt CLI entry script. Prefer the bundled copy; fall back to the
 *  workspace's installed package (dev/monorepo setups). Always a real .js file so
 *  it can be run as a Node script — never the platform shell shim. */
export function cliScript(workspaceRoot: string): string {
	if (bundledCli !== undefined) return bundledCli
	const wsPkg = join(workspaceRoot, "node_modules", "@volt", "git", "dist", "bin.js")
	if (existsSync(wsPkg)) return wsPkg
	throw new Error("volt CLI not found (no bundled CLI, none installed in the workspace)")
}

/** Spawn the volt CLI. A `.js` entry runs via the editor's own runtime (ELECTRON_RUN_AS_NODE makes
 *  process.execPath behave as plain node — works in VS Code / Windsurf / Cursor, no external node). A compiled
 *  standalone (`.exe`, the desktop install) is spawned directly. */
function spawnCli(workspaceRoot: string, args: string[], extraEnv?: Record<string, string>) {
	const script = cliScript(workspaceRoot)
	const asNode = script.toLowerCase().endsWith(".js")
	return spawn(asNode ? process.execPath : script, asNode ? [script, ...args] : args, {
		cwd: workspaceRoot,
		env: asNode ? { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...extraEnv } : { ...process.env, ...extraEnv },
	})
}

/** One streamed progress frame the CLI emits on stderr (as `VOLT_PROGRESS <json>`) under VOLT_PROGRESS_JSON=1. */
export interface ProgressUpdate {
	operation: string
	done: number
	total?: number | null
	phase?: string | null
}

const PROGRESS_PREFIX = "VOLT_PROGRESS " // contract with volt-git's reporter (PROGRESS_JSON_PREFIX)

/** Like {@link spawnVolt}, but sets VOLT_PROGRESS_JSON=1 so the CLI emits machine-readable progress frames on
 *  stderr, parses them out to `onProgress`, and keeps the rest of stderr in the buffered result. Lets a GUI
 *  drive a real progress bar from the same op the CLI runs — no separate bridge polling. */
export function spawnVoltProgress(
	workspaceRoot: string,
	args: string[],
	onProgress: (p: ProgressUpdate) => void,
): Promise<{ stdout: string; stderr: string; code: number }> {
	return new Promise((resolve) => {
		const child = spawnCli(workspaceRoot, args, { VOLT_PROGRESS_JSON: "1" })
		let stdout = ""
		let stderr = ""
		let pending = ""
		child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf-8")))
		child.stderr.on("data", (d: Buffer) => {
			pending += d.toString("utf-8")
			let nl: number
			while ((nl = pending.indexOf("\n")) >= 0) {
				const line = pending.slice(0, nl)
				pending = pending.slice(nl + 1)
				if (line.startsWith(PROGRESS_PREFIX)) {
					try {
						onProgress(JSON.parse(line.slice(PROGRESS_PREFIX.length)) as ProgressUpdate)
					} catch {
						/* ignore a malformed frame */
					}
				} else {
					stderr += line + "\n"
				}
			}
		})
		child.on("close", (code) => {
			if (pending.length > 0) stderr += pending
			resolve({ stdout, stderr, code: code ?? 255 })
		})
		child.on("error", (err) => resolve({ stdout: "", stderr: err.message, code: 255 }))
	})
}

export function spawnVolt(workspaceRoot: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
	return new Promise((resolve) => {
		const child = spawnCli(workspaceRoot, args)
		let stdout = ""
		let stderr = ""
		child.stdout.on("data", (d: Buffer) => stdout += d.toString("utf-8"))
		child.stderr.on("data", (d: Buffer) => stderr += d.toString("utf-8"))
		child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 255 }))
		child.on("error", (err) => resolve({ stdout: "", stderr: err.message, code: 255 }))
	})
}

/** Like spawnVolt but returns raw stdout bytes — the `volt show <ref> <rel>` content provider needs the
 *  exact bytes (a binary/opaque item's blob), not a UTF-8 round-trip. */
export function spawnVoltBuffer(workspaceRoot: string, args: string[]): Promise<{ stdout: Buffer; stderr: string; code: number }> {
	return new Promise((resolve) => {
		const child = spawnCli(workspaceRoot, args)
		const chunks: Buffer[] = []
		let stderr = ""
		child.stdout.on("data", (d: Buffer) => chunks.push(d))
		child.stderr.on("data", (d: Buffer) => stderr += d.toString("utf-8"))
		child.on("close", (code) => resolve({ stdout: Buffer.concat(chunks), stderr, code: code ?? 255 }))
		child.on("error", (err) => resolve({ stdout: Buffer.alloc(0), stderr: err.message, code: 255 }))
	})
}
