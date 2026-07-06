/**
 * reference (Layer F, F.1) — the language-data catalog for BUILT-INS the user didn't declare (elementary
 * types, operators, standard functions). One `ReferenceEntry` shape; `lookupReference` powers built-in
 * hover/completion. Per the architecture, type facts are NOT re-listed here — a data-type entry's range
 * DERIVES from `types/elementary` (the SSOT), so there is exactly one home for a type's numbers.
 *
 * ponytail: a curated core catalog, not an exhaustive doc port. The full keyword/pragma/standard-FB
 * catalogs + per-vendor equivalence are follow-on data; add entries as hover/lint needs surface them.
 */
import { ELEMENTARY_TYPES, elementaryType } from "../types/index.js"

export type ReferenceKind = "data-type" | "operator" | "standard-function"

export interface ReferenceEntry {
  name: string
  kind: ReferenceKind
  oneLiner: string
  /** Extra detail rendered under the one-liner (e.g. a type's range/width). */
  details?: string
}

// ─── operators + standard functions (curated) ────────────────────────────────

const OPERATORS: ReadonlyArray<ReferenceEntry> = [
  { name: "AND", kind: "operator", oneLiner: "Boolean / bitwise AND." },
  { name: "OR", kind: "operator", oneLiner: "Boolean / bitwise OR." },
  { name: "XOR", kind: "operator", oneLiner: "Boolean / bitwise exclusive-OR." },
  { name: "NOT", kind: "operator", oneLiner: "Boolean / bitwise complement." },
  { name: "MOD", kind: "operator", oneLiner: "Integer remainder (not defined for REAL)." },
]

const STANDARD_FUNCTIONS: ReadonlyArray<ReferenceEntry> = [
  { name: "ABS", kind: "standard-function", oneLiner: "Absolute value of a number." },
  { name: "SQRT", kind: "standard-function", oneLiner: "Square root (REAL/LREAL)." },
  { name: "SEL", kind: "standard-function", oneLiner: "Binary selection: SEL(G, in0, in1)." },
  { name: "MUX", kind: "standard-function", oneLiner: "Multiplexer: MUX(K, in0, …, inN)." },
  { name: "MIN", kind: "standard-function", oneLiner: "Minimum of its arguments." },
  { name: "MAX", kind: "standard-function", oneLiner: "Maximum of its arguments." },
  { name: "LIMIT", kind: "standard-function", oneLiner: "Clamp: LIMIT(min, in, max)." },
  { name: "ADR", kind: "standard-function", oneLiner: "Address-of operator (POINTER TO)." },
  { name: "SIZEOF", kind: "standard-function", oneLiner: "Size in bytes of a variable/type." },
]

/** A `data-type` entry for an elementary type — its range/width DERIVED from `types/elementary`. */
function dataTypeEntry(name: string): ReferenceEntry {
  const elem = elementaryType(name)
  const details =
    elem?.range !== undefined
      ? `${elem.bits}-bit ${elem.signed ? "signed" : "unsigned"} ${elem.family} · range ${elem.range.min}..${elem.range.max}`
      : elem !== undefined
        ? `${elem.bits}-bit ${elem.family}`
        : undefined
  return {
    name: elem?.name ?? name.toUpperCase(),
    kind: "data-type",
    oneLiner: `IEC 61131-3 elementary type.`,
    ...(details !== undefined ? { details } : {}),
  }
}

const CATALOG: ReadonlyMap<string, ReferenceEntry> = new Map(
  [...[...ELEMENTARY_TYPES.keys()].map((n) => dataTypeEntry(n)), ...OPERATORS, ...STANDARD_FUNCTIONS].map((e) => [
    e.name.toUpperCase(),
    e,
  ]),
)

/** Look up a built-in reference entry by name (case-insensitive, alias-aware for types). */
export function lookupReference(name: string): ReferenceEntry | undefined {
  const u = name.toUpperCase()
  return CATALOG.get(u) ?? (elementaryType(u) !== undefined ? dataTypeEntry(u) : undefined)
}

/** Markdown hover body for a reference entry. */
export function renderReferenceHover(entry: ReferenceEntry): string {
  const head = `\`\`\`iecst\n${entry.name}\n\`\`\`\n\n${entry.oneLiner}`
  return entry.details !== undefined ? `${head}\n\n_${entry.details}_` : head
}
