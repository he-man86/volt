import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"

export function cliPath(workspaceRoot: string): string {
	const bin = join(workspaceRoot, "node_modules", ".bin", "volt")
	if (!existsSync(bin)) throw new Error(`volt CLI not found at ${bin}`)
	return bin
}

export function spawnVolt(workspaceRoot: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
	const bin = cliPath(workspaceRoot)
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [bin, ...args], { cwd: workspaceRoot })
		let stdout = ""
		let stderr = ""
		child.stdout.on("data", (d: Buffer) => stdout += d.toString("utf-8"))
		child.stderr.on("data", (d: Buffer) => stderr += d.toString("utf-8"))
		child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 255 }))
		child.on("error", (err) => resolve({ stdout: "", stderr: err.message, code: 255 }))
	})
}

export function spawnVoltBuffer(workspaceRoot: string, args: string[]): Promise<{ stdout: Buffer; stderr: string; code: number }> {
	const bin = cliPath(workspaceRoot)
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [bin, ...args], { cwd: workspaceRoot })
		const chunks: Buffer[] = []
		let stderr = ""
		child.stdout.on("data", (d: Buffer) => chunks.push(d))
		child.stderr.on("data", (d: Buffer) => stderr += d.toString("utf-8"))
		child.on("close", (code) => resolve({ stdout: Buffer.concat(chunks), stderr, code: code ?? 255 }))
		child.on("error", (err) => resolve({ stdout: Buffer.alloc(0), stderr: err.message, code: 255 }))
	})
}
