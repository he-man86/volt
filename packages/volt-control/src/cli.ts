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
	const wsPkg = join(workspaceRoot, "node_modules", "@opencode-ai", "volt-git", "dist", "bin.js")
	if (existsSync(wsPkg)) return wsPkg
	throw new Error("volt CLI not found (no bundled CLI, none installed in the workspace)")
}

/** Run the CLI as a Node script via the editor's own runtime. ELECTRON_RUN_AS_NODE
 *  makes process.execPath behave as plain node, so this works whether the host is
 *  VS Code, Windsurf, or Cursor — no external node required. */
function spawnCli(workspaceRoot: string, args: string[]) {
	const script = cliScript(workspaceRoot)
	return spawn(process.execPath, [script, ...args], {
		cwd: workspaceRoot,
		env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
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
