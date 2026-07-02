/**
 * The library catalog — Phase 1 of the library signature index.
 *
 * A project's referenced libraries expose their symbols under a NAMESPACE (`PACK_ML.State`,
 * `L_MC4P.MC_MoveAbsolute`, `Stu.StrLenA`). Those symbols live in the library, not the mirrored `src/`
 * tree, so a qualified reference's root (`PACK_ML`) resolves nowhere in the project symbol table and would
 * false-positive as an unresolved identifier — the bulk of the library "floor".
 *
 * `volt pull` writes the referenced libraries into a committed, read-only `libs/libraries.json` — a
 * structured `{ libraries: [{ namespace, name, resolution, placeholder, system }] }` (the same info the
 * `.library` reference manifests carry). It's committed (not a runtime sidecar) so it's self-contained,
 * diffable when a library is added/upgraded, and available to the LSP, the AI, and the corpus ratchet
 * without a live bridge. The format is future-proof: Phase 2 hangs each library's element names /
 * signatures off its entry.
 *
 * This loads the file for a workspace root and returns the NAMESPACES lowercased (PLC identifiers are
 * case-insensitive) — all Phase 1 needs to resolve qualified references. The unresolved-identifier check
 * consults the set.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

export const LIBRARY_CATALOG_PATH = join("libs", "libraries.json")

interface LibraryCatalogFile {
	libraries?: { namespace?: unknown }[]
}

/** Load `<root>/libs/libraries.json` → a set of lowercased library namespaces. Empty (⇒ nothing known,
 *  every reference checked as before) if the file is absent or malformed. */
export function loadLibraryNamespaces(root: string): Set<string> {
	try {
		const raw = readFileSync(join(root, LIBRARY_CATALOG_PATH), "utf-8").replace(/^﻿/, "")
		const parsed = JSON.parse(raw) as LibraryCatalogFile
		if (!Array.isArray(parsed.libraries)) return new Set()
		return new Set(
			parsed.libraries
				.map((l) => l.namespace)
				.filter((ns): ns is string => typeof ns === "string" && ns.length > 0)
				.map((ns) => ns.toLowerCase()),
		)
	} catch {
		return new Set()
	}
}
