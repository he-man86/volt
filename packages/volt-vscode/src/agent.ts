import * as vscode from "vscode"
import { existsSync, mkdirSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"

/**
 * Resolve the Volt agent binary (our opencode + the PLC dispatcher). It's ~130 MB — too large to ship in
 * the `.vsix` — so it's resolved at runtime, three ways in order:
 *   1. the Volt desktop install (same binary, already on disk),
 *   2. a previously-downloaded copy in the extension's global storage,
 *   3. a one-time download from the GitHub release, cached for next time.
 * Windows-only (Volt's only supported platform); the asset is volt-win-x64.exe (produced by dist.ts).
 */
const AGENT_VERSION = "0.1.0"
const ASSET = "volt-win-x64.exe"
const RELEASE = `https://github.com/he-man86/volt/releases/download/v${AGENT_VERSION}/${ASSET}`

export async function resolveAgent(ctx: vscode.ExtensionContext): Promise<string | undefined> {
	// 1. The Volt desktop install shares the same binary.
	const local = process.env.LOCALAPPDATA
	const installed = local ? join(local, "Programs", "Volt", "resources", "volt", "bin", "volt.exe") : undefined
	if (installed !== undefined && existsSync(installed)) return installed

	// 2. A copy downloaded on a previous run.
	const dir = ctx.globalStorageUri.fsPath
	const cached = join(dir, `volt-${AGENT_VERSION}.exe`)
	if (existsSync(cached)) return cached

	// 3. Download it once (large — show progress).
	return vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: "Downloading the Volt agent (one-time)…" },
		async () => {
			try {
				const res = await fetch(RELEASE)
				if (!res.ok) throw new Error(`HTTP ${res.status}`)
				mkdirSync(dir, { recursive: true })
				await writeFile(cached, Buffer.from(await res.arrayBuffer()))
				return cached
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e)
				vscode.window.showErrorMessage(
					`Couldn't download the Volt agent (${msg}). Install the Volt desktop app, or grab it from github.com/he-man86/volt/releases.`,
				)
				return undefined
			}
		},
	)
}
