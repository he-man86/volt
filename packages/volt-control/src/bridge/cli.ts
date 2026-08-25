import { spawn } from "node:child_process"
import { existsSync } from "node:fs"

/** The CLI bundled inside the extension (dist/cli.js). Set once at activation.
 *  Shipping the CLI with the extension makes it self-contained: a PLC workspace
 *  needs no Node toolchain and no `node_modules/.bin/volt`. */
let bundledCli: string | undefined

export function setBundledCli(path: string): void {
	if (existsSync(path)) bundledCli = path
}

/** Resolve the volt CLI: prefer the bundled copy set at activation, else fall back to bare `volt` on PATH — the
 *  installer adds the shipped `volt.exe` to PATH, so an installed machine always resolves it. Returns either a real
 *  path (a bundled `.exe`/`.js`) or the bare command name for PATH resolution. */
export function cliScript(_workspaceRoot: string): string {
	return bundledCli ?? "volt"
}

/** Spawn the volt CLI. A `.js` entry runs via the editor's own runtime (ELECTRON_RUN_AS_NODE makes
 *  process.execPath behave as plain node — works in VS Code / Windsurf / Cursor, no external node). The compiled
 *  standalone (`volt.exe`, the shipped CLI) — or a bare `volt` on PATH — is spawned directly. */
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
	// Multi-phase op (pull/init): fold (phaseIndex + done/total) / phaseCount into one overall bar. Null = single phase.
	phaseIndex?: number | null
	phaseCount?: number | null
}

const PROGRESS_PREFIX = "VOLT_PROGRESS " // contract with volt-git's reporter (PROGRESS_JSON_PREFIX)

/** Options for {@link runVolt}. `onProgress` opts into machine-readable progress frames (VOLT_PROGRESS_JSON=1)
 *  parsed out of stderr; `binary` returns the exact stdout bytes instead of a UTF-8 string. */
export interface RunOpts {
	onProgress?: (p: ProgressUpdate) => void
	binary?: boolean
	/** Extra env for the CLI process — e.g. VOLT_PIPE to target a specific bridge instance (init has no binding
	 *  yet, so the shell names the picked CODESYS instance's pipe). */
	env?: Record<string, string>
}

/** Run the volt CLI — the ONE spawn path. stderr is buffered (minus progress frames, which stream to
 *  `onProgress` so a GUI drives a real progress bar from the same op the CLI runs — no separate bridge poll).
 *  stdout is a UTF-8 string, or the raw Buffer when `binary` (the `volt show` content provider needs exact
 *  bytes of an opaque item's blob, not a round-trip). */
export function runVolt(workspaceRoot: string, args: string[], opts?: RunOpts & { binary?: false }): Promise<{ stdout: string; stderr: string; code: number }>
export function runVolt(workspaceRoot: string, args: string[], opts: RunOpts & { binary: true }): Promise<{ stdout: Buffer; stderr: string; code: number }>
export function runVolt(workspaceRoot: string, args: string[], opts: RunOpts = {}): Promise<{ stdout: string | Buffer; stderr: string; code: number }> {
	const { onProgress, binary, env } = opts
	return new Promise((resolve) => {
		// VOLT_PROGRESS_JSON is set ALWAYS, not only when a caller wants progress. The CLI streams progress on
		// stderr either way; under the flag it is prefixed frames this strips, without it it is human text that
		// stays MIXED IN with real diagnostics. Every error path here then reads `firstLine(stderr)` — which is a
		// progress label, always, because progress is emitted before anything can go wrong. That is how a failed
		// pull reached the desktop, the extension and the e2e suite alike as the message "Fetching from IDE…".
		// One channel discipline: frames are machine-readable and stripped, so stderr carries diagnostics ONLY.
		const child = spawnCli(workspaceRoot, args, { VOLT_PROGRESS_JSON: "1", ...env })
		const chunks: Buffer[] = []
		let stderr = ""
		let pending = "" // stderr carry across chunk boundaries
		child.stdout.on("data", (d: Buffer) => chunks.push(d))
		// setEncoding installs a stateful StringDecoder, so a multibyte UTF-8 sequence split across two chunks
		// isn't corrupted into replacement chars (a non-ASCII item name in an error line would otherwise mojibake).
		child.stderr.setEncoding("utf-8")
		child.stderr.on("data", (d: string) => {
			pending += d
			let nl: number
			while ((nl = pending.indexOf("\n")) >= 0) {
				const line = pending.slice(0, nl)
				pending = pending.slice(nl + 1)
				if (!line.startsWith(PROGRESS_PREFIX)) {
					stderr += line + "\n"
					continue
				}
				if (onProgress === undefined) continue // a frame nobody asked for: dropped, never left in stderr
				try {
					onProgress(JSON.parse(line.slice(PROGRESS_PREFIX.length)) as ProgressUpdate)
				} catch {
					/* ignore a malformed frame */
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
