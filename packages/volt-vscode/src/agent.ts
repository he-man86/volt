import { existsSync } from "node:fs"
import { spawn } from "node:child_process"

/**
 * The AI agent is opencode's CLI — a PREREQUISITE the extension neither bundles nor downloads. Volt makes the
 * user's opencode PLC-aware via OPENCODE_CONFIG_DIR (set by the Volt install); here we only locate/launch it.
 * Resolve an explicit OPENCODE_BIN, else `opencode` on PATH. If it's absent the caller prompts to install it
 * (see extension.ts) — exactly like the desktop app's agent view.
 */
export function resolveOpencodeExe(): string {
	return process.env.OPENCODE_BIN || "opencode"
}

/** True if the opencode CLI can be launched — an OPENCODE_BIN that exists, or `opencode` resolvable on PATH. */
export function hasOpencode(): Promise<boolean> {
	const bin = process.env.OPENCODE_BIN
	if (bin) return Promise.resolve(existsSync(bin))
	const finder = process.platform === "win32" ? "where" : "which"
	return new Promise((resolve) => {
		const p = spawn(finder, ["opencode"], { stdio: "ignore", shell: true })
		p.on("error", () => resolve(false))
		p.on("exit", (code) => resolve(code === 0))
	})
}
