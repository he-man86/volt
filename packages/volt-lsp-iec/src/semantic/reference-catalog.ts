/**
 * The workspace reference-file catalogs. `volt pull` mirrors the CODESYS project structure, including
 * read-only reference files whose names are valid identifiers that resolve OUTSIDE the project symbol table
 * (so the unresolved-identifier check must skip them, not flag them):
 *
 *   - `.library` files (nested under a Library Manager) carry a `NAMESPACE <name>` line — the root of a
 *     qualified library reference (`PACK_ML.State`, `L_MC4P.Foo`).
 *   - `.device` files (mirroring the device tree) are named after a device-tree instance — an implicit
 *     global the source reads bare (`MagazineAxes`, `EtherCAT_Master`, the drives + axes).
 *
 * Each loader scans the workspace for its kind and returns the (lowercased — PLC identifiers are
 * case-insensitive) names. Empty when there are none / the tree is unreadable ⇒ nothing known, every
 * reference checked as before. Kept as two loaders on purpose: same shape today, but different sources, and
 * if devices ever gain real types they become project symbols while library namespaces stay skips.
 */
import { readFileSync } from "node:fs"
import { basename, extname } from "node:path"
import { walkFiles } from "../fs-walk.js"

/** Scan `<root>` for files with `ext`, map each to a name (undefined ⇒ skip), collect them lowercased. */
function collect(root: string, ext: string, nameOf: (path: string) => string | undefined): Set<string> {
	const out = new Set<string>()
	for (const file of walkFiles(root)) {
		if (extname(file).toLowerCase() !== ext) continue
		let name: string | undefined
		try {
			name = nameOf(file)
		} catch {
			continue // unreadable ref file — skip
		}
		if (name !== undefined && name.length > 0) out.add(name.toLowerCase())
	}
	return out
}

/** Referenced-library namespaces, from each `.library` file's `NAMESPACE` line. */
export function loadLibraryNamespaces(root: string): Set<string> {
	return collect(root, ".library", (file) => readFileSync(file, "utf-8").match(/^NAMESPACE (.+)$/m)?.[1]?.trim())
}

/** Device-tree instance names, from each `.device` file's stem (the instance name is the filename). */
export function loadDeviceInstances(root: string): Set<string> {
	return collect(root, ".device", (file) => basename(file, extname(file)))
}
