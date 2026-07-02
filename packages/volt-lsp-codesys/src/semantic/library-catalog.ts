/**
 * The library namespace catalog — Phase 1 of the library signature index.
 *
 * A project's referenced libraries expose their symbols under a NAMESPACE (`PACK_ML.State`,
 * `L_MC4P.MC_MoveAbsolute`, `Stu.StrLenA`). Those symbols live in the library, not the mirrored `src/`
 * tree, so a qualified reference's root (`PACK_ML`) resolves nowhere in the project symbol table and would
 * false-positive as an unresolved identifier — the bulk of the library "floor".
 *
 * `volt pull` materializes the referenced libraries' namespaces (from the bridge's library refs) into a
 * committed, read-only `libs/namespaces.json` — a plain sorted JSON array of namespace strings. It's
 * committed (not a runtime sidecar) so it's self-contained, diffable when a library is added/upgraded, and
 * available to the LSP, the AI, and the corpus ratchet without a live bridge.
 *
 * This loads that file for a workspace root and returns the namespaces LOWERCASED (PLC identifiers are
 * case-insensitive). The unresolved-identifier check consults the set. (Element names and full signatures
 * are Phase 2.)
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

export const LIBRARY_CATALOG_PATH = join("libs", "namespaces.json")

/** Load `<root>/libs/namespaces.json` → a set of lowercased library namespaces. Empty (⇒ nothing known,
 *  every reference checked as before) if the file is absent or malformed. */
export function loadLibraryNamespaces(root: string): Set<string> {
	try {
		const raw = readFileSync(join(root, LIBRARY_CATALOG_PATH), "utf-8").replace(/^﻿/, "")
		const parsed = JSON.parse(raw) as unknown
		if (!Array.isArray(parsed)) return new Set()
		return new Set(parsed.filter((s): s is string => typeof s === "string").map((s) => s.toLowerCase()))
	} catch {
		return new Set()
	}
}
