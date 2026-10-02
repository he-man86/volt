import { statSync } from "node:fs"
import { join } from "node:path"

// The kind-named writable-source extensions (POU/DUT/GVL/interface, textual or editable graphical).
// Every POU is `pou` and every DUT `dut` whatever their text says, and the file name IS the wire name. Bare (no leading dot), matching
// how the CLI/bridge name wire files. volt-control can't cleanly depend on the LSP for this
// (wrong-direction coupling), so it keeps its own copy; `scripts/check-wiring.ts` cross-checks it
// against every other copy to prevent drift.
export const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  "pou",
  "itf",
  "gvl",
  "dut",
])

// EXACT, never case-folded: a file name IS its item's wire name, and the CLI classifies an extension Ordinally,
// so `E_Mode.Dut` is a foreign file `volt push` refuses. Folded here it counted as a tracked source file — the
// watcher, `isTrackedFile` and the Diagnostics view all treated a file Volt will never push as Volt's.
export function isPouFile(path: string): boolean {
	const dot = path.lastIndexOf(".")
	if (dot < 0) return false
	return SOURCE_EXTENSIONS.has(path.slice(dot + 1))
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
