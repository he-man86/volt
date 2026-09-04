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
  /** Elementary result type for an operator/function with a FIXED return type (`EXPT`→`LREAL`), so type
   *  inference can flow a built-in's result into downstream checks (e.g. narrowing a conversion argument).
   *  Only set where the type is unambiguous; a type-preserving operator (ABS, SEL) leaves it undefined. */
  returnType?: string
}

// ─── operators + standard functions (curated) ────────────────────────────────

/** Terse entry builder — most catalog names need only name + one-liner (hover shows more when present). */
function ref(name: string, kind: ReferenceKind, oneLiner: string): ReferenceEntry {
  return { name, kind, oneLiner }
}

// The catalog doubles as the unresolved-identifier check's "is this a compiler-provided global?" oracle:
// a body identifier that resolves nowhere in project scope but appears here is a valid built-in, not an error.
// So this list must cover every operator / standard function / standard FB that source calls by bare name.
const OPERATORS: ReadonlyArray<ReferenceEntry> = [
  // boolean / bitwise (word form; the symbol form is lexed as its own token)
  ref("AND", "operator", "Boolean / bitwise AND."),
  ref("OR", "operator", "Boolean / bitwise OR."),
  ref("XOR", "operator", "Boolean / bitwise exclusive-OR."),
  ref("NOT", "operator", "Boolean / bitwise complement."),
  ref("AND_THEN", "operator", "Short-circuit AND (right side evaluated only if left is TRUE)."),
  ref("OR_ELSE", "operator", "Short-circuit OR (right side evaluated only if left is FALSE)."),
  // arithmetic
  ref("ADD", "operator", "Addition. `ADD(a, b)` / `a + b`."),
  ref("SUB", "operator", "Subtraction. `SUB(a, b)` / `a - b`."),
  ref("MUL", "operator", "Multiplication. `MUL(a, b)` / `a * b`."),
  ref("DIV", "operator", "Division. `DIV(a, b)` / `a / b`."),
  ref("MOD", "operator", "Integer remainder (not defined for REAL)."),
  ref("MOVE", "operator", "Assignment in expression form. `MOVE(src)`."),
  ref("INDEXOF", "operator", "Index of a POU. `INDEXOF(MyFB)`."),
  ref("SIZEOF", "operator", "Size in bytes of a variable/type."),
  ref("XSIZEOF", "operator", "Extended size operator (CODESYS)."),
  // bit shift / rotate
  ref("SHL", "operator", "Shift left. `SHL(value, n)`."),
  ref("SHR", "operator", "Shift right. `SHR(value, n)`."),
  ref("ROL", "operator", "Rotate left. `ROL(value, n)`."),
  ref("ROR", "operator", "Rotate right. `ROR(value, n)`."),
  // comparison (function form)
  ref("GT", "operator", "Greater-than. `GT(a, b)` / `a > b`."),
  ref("LT", "operator", "Less-than. `LT(a, b)` / `a < b`."),
  ref("GE", "operator", "Greater-or-equal. `GE(a, b)` / `a >= b`."),
  ref("LE", "operator", "Less-or-equal. `LE(a, b)` / `a <= b`."),
  ref("EQ", "operator", "Equal. `EQ(a, b)` / `a = b`."),
  ref("NE", "operator", "Not-equal. `NE(a, b)` / `a <> b`."),
  // address / math
  ref("ADR", "operator", "Address-of (POINTER TO). `ADR(var)`."),
  ref("BITADR", "operator", "Bit address of a variable."),
  ref("LN", "operator", "Natural logarithm."),
  ref("LOG", "operator", "Base-10 logarithm."),
  ref("EXP", "operator", "e raised to a power."),
  { ...ref("EXPT", "operator", "Power. `EXPT(base, exp)`."), returnType: "LREAL" }, // CODESYS: always LREAL
  ref("SIN", "operator", "Sine (radians)."),
  ref("COS", "operator", "Cosine (radians)."),
  ref("TAN", "operator", "Tangent (radians)."),
  ref("ASIN", "operator", "Arc sine."),
  ref("ACOS", "operator", "Arc cosine."),
  ref("ATAN", "operator", "Arc tangent."),
  // system operators (CODESYS `__`-prefixed intrinsics + friends)
  ref("__NEW", "operator", "Dynamic allocation. `__NEW(TYPE)`."),
  ref("__DELETE", "operator", "Free a `__NEW` allocation."),
  ref("__ISVALIDREF", "operator", "True if a REFERENCE TO is bound."),
  ref("__QUERYINTERFACE", "operator", "Dynamic interface query."),
  ref("__QUERYPOINTER", "operator", "Dynamic pointer query."),
  ref("__TRY", "operator", "Exception-handling block start."),
  ref("__CATCH", "operator", "Exception-handling catch."),
  ref("__FINALLY", "operator", "Exception-handling finally."),
  ref("__ENDTRY", "operator", "Exception-handling block end."),
  ref("__VARINFO", "operator", "Reflection info for a variable."),
  ref("__POSITION", "operator", "Source position intrinsic."),
  ref("__POUNAME", "operator", "Enclosing POU name intrinsic."),
  ref("__CURRENTTASK", "operator", "Currently executing task."),
  ref("__COMPARE_AND_SWAP", "operator", "Atomic compare-and-swap."),
  ref("__XADD", "operator", "Atomic exchange-and-add."),
  ref("__POOL", "operator", "Memory-pool intrinsic (CODESYS)."),
  ref("TEST_AND_SET", "operator", "Atomic test-and-set."),
  ref("INI", "operator", "Initialize an FB instance."),
]

const STANDARD_FUNCTIONS: ReadonlyArray<ReferenceEntry> = [
  ref("ABS", "standard-function", "Absolute value of a number."),
  ref("SQRT", "standard-function", "Square root (REAL/LREAL)."),
  ref("SEL", "standard-function", "Binary selection: SEL(G, in0, in1)."),
  ref("MUX", "standard-function", "Multiplexer: MUX(K, in0, …, inN)."),
  ref("MIN", "standard-function", "Minimum of its arguments."),
  ref("MAX", "standard-function", "Maximum of its arguments."),
  ref("LIMIT", "standard-function", "Clamp: LIMIT(min, in, max)."),
  ref("TRUNC", "standard-function", "Truncate a REAL/LREAL toward zero to DINT."),
  ref("TRUNC_INT", "standard-function", "Truncate a REAL/LREAL toward zero to INT."),
  // IEC string functions
  ref("LEN", "standard-function", "Length of a string. `LEN(str)`."),
  ref("LEFT", "standard-function", "Leftmost N chars. `LEFT(str, n)`."),
  ref("RIGHT", "standard-function", "Rightmost N chars. `RIGHT(str, n)`."),
  ref("MID", "standard-function", "N chars from position p. `MID(str, n, p)`."),
  ref("CONCAT", "standard-function", "Concatenate strings. `CONCAT(a, b)`."),
  ref("INSERT", "standard-function", "Insert into a string at position p."),
  ref("DELETE", "standard-function", "Delete N chars from position p."),
  ref("REPLACE", "standard-function", "Replace N chars at position p."),
  ref("FIND", "standard-function", "1-based position of `b` in `a`, or 0."),
  // IEC array-bound + memory
  ref("UPPER_BOUND", "standard-function", "Upper index bound of an array dimension."),
  ref("LOWER_BOUND", "standard-function", "Lower index bound of an array dimension."),
  // CODESYS standard-library string functions (global, ubiquitous)
  ref("STRCONCATA", "standard-function", "CODESYS ASCII string concat."),
  ref("STRCONCATW", "standard-function", "CODESYS wide-string concat."),
  ref("STRLENA", "standard-function", "CODESYS ASCII string length."),
  ref("STRLENW", "standard-function", "CODESYS wide-string length."),
  ref("STRFINDA", "standard-function", "CODESYS ASCII substring search."),
  ref("STRFINDW", "standard-function", "CODESYS wide-string search."),
  ref("STRMIDA", "standard-function", "CODESYS ASCII substring extract."),
  ref("STRMIDW", "standard-function", "CODESYS wide-string substring."),
  ref("STRTRIMA", "standard-function", "CODESYS ASCII string trim."),
  ref("STRTRIMW", "standard-function", "CODESYS wide-string trim."),
  ref("STRCPYA", "standard-function", "CODESYS ASCII string copy."),
  ref("STRCPYW", "standard-function", "CODESYS wide-string copy."),
  ref("STRCMPA", "standard-function", "CODESYS ASCII string compare."),
  ref("STRCMPW", "standard-function", "CODESYS wide-string compare."),
]

/** IEC 61131-3 standard function blocks — instantiated as types, but listed so hover/completion know them. */
const STANDARD_FBS: ReadonlyArray<ReferenceEntry> = [
  ref("TON", "standard-function", "On-delay timer."),
  ref("TOF", "standard-function", "Off-delay timer."),
  ref("TP", "standard-function", "Pulse timer."),
  ref("R_TRIG", "standard-function", "Rising-edge trigger."),
  ref("F_TRIG", "standard-function", "Falling-edge trigger."),
  ref("CTU", "standard-function", "Up counter."),
  ref("CTD", "standard-function", "Down counter."),
  ref("CTUD", "standard-function", "Up/down counter."),
  ref("SR", "standard-function", "Set-dominant bistable."),
  ref("RS", "standard-function", "Reset-dominant bistable."),
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
  [...[...ELEMENTARY_TYPES.keys()].map((n) => dataTypeEntry(n)), ...OPERATORS, ...STANDARD_FUNCTIONS, ...STANDARD_FBS].map((e) => [
    e.name.toUpperCase(),
    e,
  ]),
)

/**
 * The compiler's type-conversion operators — `INT_TO_REAL`, `TO_REAL`, `TRUNC_DINT`. They are BUILT-INS, not
 * library functions: no reference is needed to call one, and the corpus calls them 504 times.
 *
 * Synthesized rather than listed. There are ~30 elementary types, so enumerating the pairs would be ~900
 * rows — a second, hand-maintained copy of `ELEMENTARY_TYPES` that could disagree with it. Deriving means the
 * entry describes exactly what the name says, and a new elementary type gets its conversions for free.
 *
 * Deliberately stricter than `nameResolves`' `CONVERSION_RE`, and NOT shared with it: that predicate answers
 * "may I flag this?" and stays loose so an unusual conversion is never a false positive; this one answers
 * "can I describe this?" and must not invent a target type it cannot name.
 */
const CONVERSION = /^(?:([A-Z0-9]+)_TO_([A-Z0-9]+)|TO_([A-Z0-9]+))$/

function conversionEntry(upper: string): ReferenceEntry | undefined {
  const m = CONVERSION.exec(upper)
  if (m === null) return undefined
  const [, from, to, bare] = m
  const dst = elementaryType(to ?? bare!)
  if (dst === undefined) return undefined
  if (from !== undefined && elementaryType(from) === undefined) return undefined
  return {
    name: upper,
    kind: "operator",
    oneLiner: `Convert ${from ?? "the operand"} to ${dst.name}.`,
    returnType: dst.name,
    ...(dst.range === undefined ? {} : { details: `result range ${dst.range.min}..${dst.range.max}` }),
  }
}

/** Look up a built-in reference entry by name (case-insensitive, alias-aware for types). */
export function lookupReference(name: string): ReferenceEntry | undefined {
  const u = name.toUpperCase()
  return (
    CATALOG.get(u) ??
    (elementaryType(u) !== undefined ? dataTypeEntry(u) : undefined) ??
    conversionEntry(u)
  )
}

/** Markdown hover body for a reference entry. */
export function renderReferenceHover(entry: ReferenceEntry): string {
  const head = `\`\`\`iecst\n${entry.name}\n\`\`\`\n\n${entry.oneLiner}`
  return entry.details !== undefined ? `${head}\n\n_${entry.details}_` : head
}
