import { statSync } from "node:fs"
import { join } from "node:path"

const EXTS = new Set(["st", "gvl", "struct", "enum", "union", "alias", "itf"])

export function isPouFile(path: string): boolean {
	const dot = path.lastIndexOf(".")
	if (dot < 0) return false
	return EXTS.has(path.slice(dot + 1).toLowerCase())
}

/** Last sync activity = mtime of the git-native IDE baseline (.git/volt/ide-refs.json), bumped on every
 *  pull/push. 0 when the workspace has never synced. */
export function readStateMtime(workspaceRoot: string): number {
	try {
		return statSync(join(workspaceRoot, ".git", "volt", "ide-refs.json")).mtimeMs
	} catch {
		return 0
	}
}
