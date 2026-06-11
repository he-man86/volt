import { statSync } from "node:fs"
import { join } from "node:path"

const POU_EXTENSIONS = new Set(["st", "gvl", "struct", "enum", "union", "alias", "itf"])

export function isPouFile(fileName: string): boolean {
	const idx = fileName.lastIndexOf(".")
	if (idx < 0) return false
	return POU_EXTENSIONS.has(fileName.slice(idx + 1).toLowerCase())
}

export function readStateMtime(workspaceRoot: string): number {
	try {
		return statSync(join(workspaceRoot, ".volt", "snapshot", "state.json")).mtimeMs
	} catch {
		return 0
	}
}
