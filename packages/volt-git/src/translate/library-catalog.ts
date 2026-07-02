/**
 * The library namespace catalog — Phase 1 of the library signature index.
 *
 * A referenced library exposes its symbols under a NAMESPACE (`PACK_ML.State`, `L_MC4P.MC_MoveAbsolute`).
 * Those symbols aren't in the mirrored `src/` tree, so a qualified reference's root resolves nowhere and the
 * LSP false-positives. `volt pull` writes the referenced libraries' namespaces to a committed, read-only
 * `libs/namespaces.json` at the repo root (sibling of `src/`) — the LSP loads it and skips those roots.
 *
 * The namespace is already on the wire: each `.library` reference item's body is its manifest, whose
 * `NAMESPACE` line carries it. This derives the catalog from the fetched items — no extra bridge call. The
 * content is a sorted JSON array, so it's deterministic (re-pull is a no-op when the library set is
 * unchanged) and diffable when a library is added / upgraded. (Element names + signatures are Phase 2.)
 */
import type { FetchedItem } from "../bridge/types.js";

/** Repo-root-relative path of the committed catalog (sibling of `src/`, not a push target). */
export const LIBRARY_CATALOG_PATH = "libs/namespaces.json";

export interface RootFile {
	/** Repo-root-relative path (NOT under `src/`). */
	path: string;
	content: string;
}

/** Build the namespace catalog from the fetched items: the sorted NAMESPACE of every `.library` ref. */
export function libraryCatalog(items: readonly FetchedItem[]): RootFile {
	const namespaces = new Set<string>();
	for (const it of items) {
		if (!it.name.endsWith(".library")) continue;
		const m = it.sourceText.match(/^NAMESPACE (.+)$/m);
		if (m && m[1]!.trim()) namespaces.add(m[1]!.trim());
	}
	return { path: LIBRARY_CATALOG_PATH, content: JSON.stringify([...namespaces].sort(), null, "\t") + "\n" };
}
