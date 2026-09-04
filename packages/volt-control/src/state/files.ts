import { statSync } from "node:fs"
import { join } from "node:path"

// The kind-named writable-source extensions (POU/DUT/GVL/interface, textual or editable graphical) — every
// A DUT is one wire kind but FOUR files on disk, named by its declaration's subtype (`.dut` is the
// pre-split spelling, still recognized). Bare (no leading dot), matching how the CLI/bridge name
// wire files. volt-control can't cleanly depend on the LSP for this (wrong-direction coupling), so it keeps
// its own copy; `scripts/check-wiring.ts` cross-checks it against every other copy to prevent drift.
export const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  "fb",
  "prg",
  "fun",
  "itf",
  "gvl",
  "struct",
  "enum",
  "union",
  "alias",
  "dut",
])

export function isPouFile(path: string): boolean {
	const dot = path.lastIndexOf(".")
	if (dot < 0) return false
	return SOURCE_EXTENSIONS.has(path.slice(dot + 1).toLowerCase())
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
