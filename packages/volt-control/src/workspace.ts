import { statSync } from "node:fs"
import { join } from "node:path"

const EXTS = new Set(["st", "gvl", "struct", "enum", "union", "alias", "itf"])

export function isPouFile(path: string): boolean {
	const dot = path.lastIndexOf(".")
	if (dot < 0) return false
	return EXTS.has(path.slice(dot + 1).toLowerCase())
}

export function readStateMtime(workspaceRoot: string): number {
	try {
		return statSync(join(workspaceRoot, ".volt", "snapshot", "state.json")).mtimeMs
	} catch {
		return 0
	}
}
