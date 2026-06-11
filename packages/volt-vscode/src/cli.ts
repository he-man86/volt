/**
 * CLI spawn helpers. No shell, no platform branching — spawn `node`
 * directly with the cli bin resolved from the workspace's node_modules.
 */
import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

let cachedBin: string | undefined

export function cliBin(workspaceRoot: string): string {
	if (cachedBin !== undefined && existsSync(cachedBin)) return cachedBin
	const candidate = join(workspaceRoot, "node_modules", ".bin", "volt")
	if (!existsSync(candidate)) throw new Error(`volt CLI not found at ${candidate} — run bun install`)
	cachedBin = candidate
	return candidate
}

export interface SpawnResult { stdout: string; stderr: string; code: number }

export function spawnCapture(workspaceRoot: string, args: string[], cwd?: string): Promise<SpawnResult> {
	const bin = cliBin(workspaceRoot)
	return new Promise((resolve) => {
		const child = spawn("node", [bin, ...args], { cwd: cwd ?? workspaceRoot })
		let stdout = ""
		let stderr = ""
		child.stdout.on("data", (d: Buffer) => stdout += d.toString("utf-8"))
		child.stderr.on("data", (d: Buffer) => stderr += d.toString("utf-8"))
		child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 255 }))
		child.on("error", (err) => resolve({ stdout: "", stderr: err.message, code: 255 }))
	})
}

export function spawnCaptureBuffer(workspaceRoot: string, args: string[], cwd?: string): Promise<{ stdout: Buffer; stderr: string; code: number }> {
	const bin = cliBin(workspaceRoot)
	return new Promise((resolve) => {
		const child = spawn("node", [bin, ...args], { cwd: cwd ?? workspaceRoot })
		const chunks: Buffer[] = []
		let stderr = ""
		child.stdout.on("data", (d: Buffer) => chunks.push(d))
		child.stderr.on("data", (d: Buffer) => stderr += d.toString("utf-8"))
		child.on("close", (code) => resolve({ stdout: Buffer.concat(chunks), stderr, code: code ?? 255 }))
		child.on("error", (err) => resolve({ stdout: Buffer.alloc(0), stderr: err.message, code: 255 }))
	})
}

export function readBridgePort(workspaceRoot: string): number | undefined {
	try {
		const raw = readFileSync(join(workspaceRoot, ".volt", "config.json"), "utf-8")
		const parsed = JSON.parse(raw) as { bridge?: { port?: unknown } }
		const port = parsed.bridge?.port
		if (typeof port === "number" && Number.isFinite(port)) return port
		return undefined
	} catch {
		return undefined
	}
}
