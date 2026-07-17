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

/** Options for {@link runVolt}. `onProgress` opts into machine-readable progress frames (VOLT_PROGRESS_JSON=1)
 *  parsed out of stderr; `binary` returns the exact stdout bytes instead of a UTF-8 string. */
export interface RunOpts {
	onProgress?: (p: ProgressUpdate) => void
	binary?: boolean
}

/** Run the volt CLI — the ONE spawn path. stderr is buffered (minus progress frames, which stream to
 *  `onProgress` so a GUI drives a real progress bar from the same op the CLI runs — no separate bridge poll).
 *  stdout is a UTF-8 string, or the raw Buffer when `binary` (the `volt show` content provider needs exact
 *  bytes of an opaque item's blob, not a round-trip). */
export function runVolt(workspaceRoot: string, args: string[], opts?: RunOpts & { binary?: false }): Promise<{ stdout: string; stderr: string; code: number }>
export function runVolt(workspaceRoot: string, args: string[], opts: RunOpts & { binary: true }): Promise<{ stdout: Buffer; stderr: string; code: number }>
export function runVolt(workspaceRoot: string, args: string[], opts: RunOpts = {}): Promise<{ stdout: string | Buffer; stderr: string; code: number }> {
	const { onProgress, binary } = opts
	return new Promise((resolve) => {
		const child = spawnCli(workspaceRoot, args, onProgress ? { VOLT_PROGRESS_JSON: "1" } : undefined)
		const chunks: Buffer[] = []
		let stderr = ""
		let pending = "" // stderr carry across chunk boundaries, only when parsing progress lines
		child.stdout.on("data", (d: Buffer) => chunks.push(d))
		// setEncoding installs a stateful StringDecoder, so a multibyte UTF-8 sequence split across two chunks
		// isn't corrupted into replacement chars (a non-ASCII item name in an error line would otherwise mojibake).
		child.stderr.setEncoding("utf-8")
		child.stderr.on("data", (d: string) => {
			if (!onProgress) {
				stderr += d
				return
			}
			pending += d
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
			const buf = Buffer.concat(chunks)
			resolve({ stdout: binary ? buf : buf.toString("utf-8"), stderr, code: code ?? 255 })
		})
		child.on("error", (err) => resolve({ stdout: binary ? Buffer.alloc(0) : "", stderr: err.message, code: 255 }))
	})
}
