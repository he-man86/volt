/**
 * CODESYS Structured Text language reference — structured, machine-
 * readable facts derived from the markdown corpus under
 * `docs/codesys-reference/`.
 *
 * **Pure data.** This module knows nothing about LSP, the parser, or
 * the semantic resolver. Consumers (hover, diagnostics, completion,
 * future codegen) import facts and decide what to do with them.
 *
 * Mirrors rust-analyzer's `hir` crate boundary: a stable, queryable
 * public API over the internal data sets in this directory.
 *
 * ## Lookup model
 *
 * `lookup(name)` returns at most one `ReferenceEntry` per name. Names
 * are case-insensitive (CODESYS ST identifiers are case-insensitive).
 * Multiple categories may match — e.g. `LOG` is both an IEC operator
 * and a CODESYS-reserved keyword. The lookup returns the highest-
 * priority match (operator > pragma > type > keyword > lifecycle).
 *
 * For exhaustive matches (used by completion), call `lookupAll(name)`.
 *
 * ## Adding a new category
 *
 * 1. Add a new module in `src/reference/<category>.ts` exporting a
 *    `Map<lowercase-name, ReferenceEntry>`.
 * 2. Register it in `LOOKUP_ORDER` below (in priority order).
 * 3. Each entry's `source.url` should cite the CODESYS doc URL.
 */

import { KEYWORDS } from "./keywords.js";
import { DATA_TYPES } from "./data-types.js";
import { OPERATORS } from "./operators.js";
import { TYPE_CONVERSIONS } from "./type-conversion.js";
import { PRAGMAS } from "./pragmas.js";
import { LIFECYCLE_METHODS } from "./lifecycle.js";

export type ReferenceKind =
	| "keyword"
	| "data-type"
	| "operator"
	| "type-conversion"
	| "pragma"
	| "lifecycle-method";

/**
 * Which vendor's ST dialect this entry belongs to.
 *   - "shared" — works in CODESYS AND TwinCAT (the IEC core + most of
 *     what CODESYS V3 defined before TwinCAT forked)
 *   - "codesys" — CODESYS-specific extension; using it in a TwinCAT
 *     project triggers the wrong-vendor-pragma diagnostic
 *   - "twincat" — TwinCAT-specific extension; inverse case
 *
 * The LSP's `vendor` config option (codesys / twincat / auto) selects
 * the active vendor. Hover/completion filter to `shared + activeVendor`.
 */
export type Vendor = "shared" | "codesys" | "twincat";

export interface ReferenceSource {
	/** Live documentation URL (CODESYS Online Help or Beckhoff InfoSys). */
	url: string;
	/** Local mirror file under `docs/codesys-reference/` or `docs/twincat-reference/`. */
	localFile: string;
	/** Retrieval date for the entry. */
	retrievedAt: string;
}

export interface ReferenceEntry {
	/** Canonical (uppercase) name as written in source docs. */
	name: string;
	kind: ReferenceKind;
	source: ReferenceSource;
	/** Vendor this entry applies to. Default "shared". */
	vendor: Vendor;
	/** One-line summary suitable for an editor's status bar. */
	oneLiner: string;
	/** Optional markdown body for hover. May be multiple paragraphs. */
	details?: string;
	/** Optional short list of pitfalls/quirks. Rendered as bullets in hover. */
	gotchas?: string[];
	/** Optional example snippets (rendered as code blocks). */
	examples?: string[];
	/** Optional alternate spellings (e.g. `noinit`/`no_init`/`no-init`). */
	aliases?: string[];
	/**
	 * Cross-vendor equivalents — used by the wrong-vendor-pragma
	 * diagnostic to suggest the right name for the active project.
	 * `note` explains how exact the equivalence is.
	 */
	equivalentIn?: {
		codesys?: { name: string; note?: string };
		twincat?: { name: string; note?: string };
	};
}

/**
 * Lookup priority. Entries earlier in this list win when a name
 * resolves to multiple categories. Operators come first because the
 * lexer already filters them — anything reaching the semantic layer
 * is more likely to be a user identifier or a type/pragma than an
 * operator name being mis-used.
 */
const LOOKUP_ORDER: ReadonlyArray<Map<string, ReferenceEntry>> = [
	LIFECYCLE_METHODS, // FB_Init / FB_Reinit / FB_Exit — narrow, specific
	OPERATORS, // ADD, SIN, __NEW, etc.
	TYPE_CONVERSIONS, // BOOL_TO_INT, TRUNC, etc.
	DATA_TYPES, // BOOL, INT, REAL, ARRAY OF, etc.
	PRAGMAS, // {attribute 'X'} catalog
	KEYWORDS, // last resort — broadest set
];

/**
 * Look up a reference entry by name. Case-insensitive. Returns the
 * highest-priority match across all categories, or `undefined` if no
 * category has the name.
 *
 * When `activeVendor` is provided, prefers entries matching the
 * vendor (or `"shared"`) over entries from the other vendor. If only
 * a wrong-vendor entry exists, returns it anyway — callers (like the
 * wrong-vendor-pragma diagnostic) need it to suggest equivalents.
 */
export function lookup(name: string, activeVendor?: Vendor): ReferenceEntry | undefined {
	const key = name.toLowerCase();
	let wrongVendor: ReferenceEntry | undefined;
	for (const category of LOOKUP_ORDER) {
		const hit = category.get(key);
		if (hit === undefined) continue;
		if (
			activeVendor === undefined ||
			hit.vendor === "shared" ||
			hit.vendor === activeVendor
		) {
			return hit;
		}
		wrongVendor = wrongVendor ?? hit;
	}
	return wrongVendor;
}

/**
 * Return every reference entry that matches `name` across all
 * categories. Used by completion ranking when multiple entries could
 * be relevant (rare in practice).
 */
export function lookupAll(name: string): ReferenceEntry[] {
	const key = name.toLowerCase();
	const out: ReferenceEntry[] = [];
	for (const category of LOOKUP_ORDER) {
		const hit = category.get(key);
		if (hit !== undefined) out.push(hit);
	}
	return out;
}

/**
 * Iterator over every reference entry across all categories. Used by
 * completion to seed static items. Filters by vendor when supplied —
 * passing `activeVendor` excludes other-vendor entries from
 * completion (so a CODESYS project doesn't suggest `TcRpcEnable`).
 */
export function* allEntries(activeVendor?: Vendor): IterableIterator<ReferenceEntry> {
	for (const category of LOOKUP_ORDER) {
		for (const entry of category.values()) {
			if (
				activeVendor === undefined ||
				entry.vendor === "shared" ||
				entry.vendor === activeVendor
			) {
				yield entry;
			}
		}
	}
}

/**
 * Return `true` iff the entry is incompatible with the active vendor
 * (i.e. it's vendor-specific to the *other* vendor). Used by the
 * wrong-vendor-pragma diagnostic.
 */
export function isWrongVendor(entry: ReferenceEntry, activeVendor: Vendor): boolean {
	return entry.vendor !== "shared" && entry.vendor !== activeVendor;
}

/**
 * Render a hover-friendly markdown string from a reference entry.
 * Consumed by `src/lsp/queries/hover.ts`.
 */
export function renderHover(
	entry: ReferenceEntry,
	opts?: { showSource?: boolean; activeVendor?: Vendor },
): string {
	const lines: string[] = [];
	const vendorBadge =
		entry.vendor === "shared" ? "" : ` _(${entry.vendor})_`;
	lines.push(`**${entry.name}** — _${entry.kind}_${vendorBadge}`);
	lines.push("");
	if (opts?.activeVendor !== undefined && isWrongVendor(entry, opts.activeVendor)) {
		lines.push(
			`⚠ This is ${entry.vendor}-specific. Active project: ${opts.activeVendor}.`,
		);
		const eq =
			opts.activeVendor === "codesys"
				? entry.equivalentIn?.codesys
				: opts.activeVendor === "twincat"
					? entry.equivalentIn?.twincat
					: undefined;
		if (eq !== undefined) {
			lines.push(
				`Suggested equivalent: \`${eq.name}\`${eq.note !== undefined ? ` — ${eq.note}` : ""}`,
			);
		}
		lines.push("");
	}
	lines.push(entry.oneLiner);
	if (entry.details !== undefined && entry.details.length > 0) {
		lines.push("");
		lines.push(entry.details);
	}
	if (entry.examples !== undefined && entry.examples.length > 0) {
		for (const ex of entry.examples) {
			lines.push("");
			lines.push("```iec61131");
			lines.push(ex);
			lines.push("```");
		}
	}
	if (entry.gotchas !== undefined && entry.gotchas.length > 0) {
		lines.push("");
		lines.push("**Gotchas**");
		for (const g of entry.gotchas) {
			lines.push(`- ${g}`);
		}
	}
	if (opts?.showSource !== false) {
		lines.push("");
		lines.push(`_Source: [${entry.source.localFile}](${entry.source.url})_`);
	}
	return lines.join("\n");
}
