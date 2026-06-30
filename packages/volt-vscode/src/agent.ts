import { existsSync } from "node:fs"
import { join } from "node:path"

/**
 * The Volt agent binary is a PREREQUISITE — exactly like opencode's CLI, the extension neither bundles nor
 * downloads it. It comes from the Volt install (the app bundles `volt` + puts it on PATH). Resolves the
 * install's bundled binary if present, else falls back to `volt` on PATH; if neither exists the editor
 * terminal surfaces a clear "not found" so the user installs Volt.
 */
export function resolveAgentExe(): string {
	const local = process.env.LOCALAPPDATA
	const installed = local ? join(local, "Programs", "Volt", "resources", "volt", "bin", "volt.exe") : undefined
	return installed !== undefined && existsSync(installed) ? installed : "volt"
}
