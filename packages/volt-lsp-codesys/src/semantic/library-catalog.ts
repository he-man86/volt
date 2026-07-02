/**
 * The referenced-library namespaces — Phase 1 of the library signature index.
 *
 * A project's referenced libraries expose their symbols under a NAMESPACE (`PACK_ML.State`,
 * `L_MC4P.MC_MoveAbsolute`, `Stu.StrLenA`). Those symbols live in the library, not the mirrored `src/`
 * tree, so a qualified reference's root (`PACK_ML`) resolves nowhere in the project symbol table and would
 * false-positive as an unresolved identifier — the bulk of the library "floor".
 *
 * `volt pull` mirrors the CODESYS project structure: each referenced library is a read-only `.library`
 * reference file nested under its Library Manager (`…/Library Manager/PACK_ML.library`), whose body is the
 * reference manifest — a `NAMESPACE <name>` line among others. We read that structure directly (no separate
 * generated catalog) so the workspace mirrors what the engineer sees in CODESYS.
 *
 * This scans a workspace root for `.library` files and returns their namespaces LOWERCASED (PLC identifiers
 * are case-insensitive) — all Phase 1 needs to resolve qualified references. The unresolved-identifier
 * check consults the set. (Element names and full signatures are Phase 2.)
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { extname, join } from "node:path"

/** Scan `<root>` for `.library` reference files and collect their (lowercased) namespaces. Empty (⇒
 *  nothing known, every reference checked as before) when there are none / the tree is unreadable. */
export function loadLibraryNamespaces(root: string): Set<string> {
	const out = new Set<string>()
	scan(root, out)
	return out
}

function scan(dir: string, out: Set<string>): void {
	let entries: string[]
	try {
		entries = readdirSync(dir)
	} catch {
		return
	}
	for (const entry of entries) {
		if (entry.startsWith(".") || entry === "node_modules") continue
		const full = join(dir, entry)
		let isDir: boolean
		try {
			isDir = statSync(full).isDirectory()
		} catch {
			continue
		}
		if (isDir) {
			scan(full, out)
		} else if (extname(entry).toLowerCase() === ".library") {
			try {
				const ns = readFileSync(full, "utf-8").match(/^NAMESPACE (.+)$/m)?.[1]?.trim()
				if (ns !== undefined && ns.length > 0) out.add(ns.toLowerCase())
			} catch {
				/* unreadable ref file — skip */
			}
		}
	}
}
