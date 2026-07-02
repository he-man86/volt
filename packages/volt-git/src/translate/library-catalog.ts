/**
 * The library catalog — Phase 1 of the library signature index.
 *
 * A referenced library exposes its symbols under a NAMESPACE (`PACK_ML.State`, `L_MC4P.MC_MoveAbsolute`).
 * Those symbols aren't in the mirrored `src/` tree, so a qualified reference's root resolves nowhere and the
 * LSP false-positives. `volt pull` writes the referenced libraries to a committed, read-only
 * `libs/libraries.json` at the repo root (sibling of `src/`) — the LSP loads it and resolves those roots.
 *
 * The catalog is a STRUCTURED per-library record — namespace + name + resolution (name, version, company) +
 * placeholder/system flags — the same info the `.library` reference manifests carry, in one clean, diffable
 * place. It's `{ libraries: [...] }` (not a bare list) so it stays future-proof: Phase 2 hangs each
 * library's element names / signatures off its entry (`elements`) without restructuring, and catalog-level
 * metadata (a hash for cache invalidation) can be added at the top level.
 *
 * The data is already on the wire: each `.library` item's body is its manifest. This derives the catalog
 * from the fetched items — no extra bridge call.
 */

/** Repo-root-relative path of the committed catalog (sibling of `src/`, never a push target). */
export const LIBRARY_CATALOG_PATH = "libs/libraries.json";

/** One referenced library. `elements` is reserved for Phase 2 (member names / signatures). */
export interface LibraryEntry {
	/** The default namespace source references it by (`PACK_ML`, `L_MC4P`). The LSP's resolution key. */
	namespace: string;
	/** The library's display name (the `.library` LIBRARY field). */
	name: string;
	/** The resolved reference — `Name, Version (Company)` — pinning the exact library version. */
	resolution: string;
	placeholder: boolean;
	system: boolean;
}

export interface LibraryCatalog {
	libraries: LibraryEntry[];
}

export interface RootFile {
	/** Repo-root-relative path (NOT under `src/`). */
	path: string;
	content: string;
}

/** Build the catalog from the fetched items: a structured entry per `.library` reference, sorted. */
export function buildLibraryCatalog(items: readonly { name: string; sourceText: string }[]): RootFile {
	const entries: LibraryEntry[] = [];
	for (const it of items) {
		if (!it.name.endsWith(".library")) continue;
		const field = (key: string) => (it.sourceText.match(new RegExp(`^${key} (.*)$`, "m"))?.[1] ?? "").trim();
		const namespace = field("NAMESPACE");
		if (namespace === "") continue; // no namespace ⇒ nothing to resolve against
		entries.push({
			namespace,
			name: field("LIBRARY"),
			resolution: field("RESOLUTION"),
			placeholder: field("PLACEHOLDER") === "true",
			system: field("SYSTEM") === "true",
		});
	}
	// Sort for a stable, diffable file (re-pull is a no-op when the library set is unchanged).
	entries.sort((a, b) => a.namespace.localeCompare(b.namespace) || a.resolution.localeCompare(b.resolution));
	const catalog: LibraryCatalog = { libraries: entries };
	return { path: LIBRARY_CATALOG_PATH, content: JSON.stringify(catalog, null, "\t") + "\n" };
}
