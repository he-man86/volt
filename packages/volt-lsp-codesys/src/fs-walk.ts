import { readdirSync } from "node:fs"
import { join } from "node:path"

/**
 * The one workspace file-walk the LSP shares: recursively yield every file path under `dir`, skipping
 * dot-entries and `node_modules`. Used by the ST-file scan (`dispatch`) and the reference-file catalogs
 * (`reference-catalog`). Silently skips unreadable directories.
 */
export function* walkFiles(dir: string): Generator<string> {
	let entries
	try {
		entries = readdirSync(dir, { withFileTypes: true })
	} catch {
		return
	}
	for (const entry of entries) {
		if (entry.name.startsWith(".") || entry.name === "node_modules") continue
		const full = join(dir, entry.name)
		if (entry.isDirectory()) yield* walkFiles(full)
		else if (entry.isFile()) yield full
	}
}
