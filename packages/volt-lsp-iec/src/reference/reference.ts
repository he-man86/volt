/**
 * reference (Layer F, F.1) — the language-data catalog for what the COMPILER provides: elementary types, operators,
 * and the standard functions that are operators (MAX, SEL, TRUNC…). One `ReferenceEntry` shape; `lookupReference`
 * powers built-in hover and the "is this a built-in?" oracle. Per the architecture, type facts are NOT re-listed here —
 * a data-type entry's range DERIVES from `types/elementary` (the SSOT), so there is exactly one home for a type's numbers.
 *
 * A LIBRARY'S ELEMENTS ARE NEVER HERE — not Standard's LEN or TON, not StringUtils' StrConcatA. A library exists only
 * where a project references it, and the LSP knows it through what the bridge materializes under
 * `Library Manager/<library>/`. Listing one here made it resolve in a project that references no such library,
 * where CODESYS answers "Identifier not defined". (Their code, when something must run it, is the library repo's:
 * `libraries/`.) A library name the LSP cannot resolve in a project that DOES reference the library is a
 * materialization gap, and it is fixed in the bridge, not papered over here.
 *
 * ponytail: a curated core catalog, not an exhaustive doc port; add operator entries as hover/lint needs surface them.
 */
import { ELEMENTARY_TYPES, elementaryType, parseConversionName } from "../types/index.js"

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
// So this list must cover every operator the compiler provides — and nothing a library provides.
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
  // No fixed returnType: EXPT is REAL when BOTH arguments are REAL, LREAL otherwise (measured — `types/infer.ts`
  // `exptType`). The "always LREAL" this used to carry made `real := EXPT(real, real)` warn falsely.
  ref("EXPT", "operator", "Power. `EXPT(base, exp)` — REAL when both arguments are REAL, otherwise LREAL."),
  ref("SIN", "operator", "Sine (radians)."),
  ref("COS", "operator", "Cosine (radians)."),
  ref("TAN", "operator", "Tangent (radians)."),
  ref("ASIN", "operator", "Arc sine."),
  ref("ACOS", "operator", "Arc cosine."),
  ref("ATAN", "operator", "Arc tangent."),
  // system operators (CODESYS `__`-prefixed intrinsics + friends)
  // The instruction-list CONDITIONAL CALL, which CODESYS's ST parser also knows — `calc : INT;` is not an
  // undefined name there, it is a `CALC` whose `(` is missing ("'(' expected instead of ':'", then "Second
  // parameter of conditional call must be a valid call statement"). Every sibling operator (`cal`, `calcn`,
  // `jmpc`) is refused as a plain name and `refused-name` covers those; `calc` alone is parsed, so it belongs
  // here instead — listing it stops the LSP calling it undefined, which was a false positive on all four
  // `ilc_calc_*` fixtures. It is NOT usable: even `CALC(cond, call)` fails to compile (`ilc_calc_called_properly`).
  ref("CALC", "operator", "Instruction-list conditional call. CODESYS parses it in ST but compiles no form of it."),
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
  // A STRING, and the CALL form is the only one that works: `here := __POSITION();` into a DINT is
  // "Cannot convert type 'STRING(INT#23)' to type 'DINT'" (`sysop_position_call_form`). The length is the
  // position text's own and cannot be known offline, so the plain STRING is what is claimed.
  { ...ref("__POSITION", "operator", "Source position intrinsic."), returnType: "STRING" },
  ref("__POUNAME", "operator", "Enclosing POU name intrinsic."),
  ref("__CURRENTTASK", "operator", "Currently executing task."),
  // RETURN TYPES, measured (`calls/atomic-operands.ts`, 2026-09-19). Without one each of these inferred UNKNOWN,
  // which is assignable to anything, so nothing downstream could see a wrong destination.
  { ...ref("__COMPARE_AND_SWAP", "operator", "Atomic compare-and-swap."), returnType: "BOOL" },
  // `__XADD(anInt, 5)` into an INT is "Cannot convert type 'DINT' to type 'INT'" — the result is a DINT whatever
  // the operand was.
  { ...ref("__XADD", "operator", "Atomic exchange-and-add."), returnType: "DINT" },
  ref("__POOL", "operator", "Memory-pool intrinsic (CODESYS)."),
  // A DWORD, and the operand does not change it: `TEST_AND_SET(aBool)` into a BOOL is still "Cannot convert type
  // 'DWORD' to type 'BOOL'". The one fixture that recorded this read as an OPERAND rule and is not one.
  { ...ref("TEST_AND_SET", "operator", "Atomic test-and-set."), returnType: "DWORD" },
  ref("INI", "operator", "Initialize an FB instance."),
]

/** The IEC standard functions the COMPILER provides — no library reference is needed to call one. */
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
  // IEC array-bound + memory
  ref("UPPER_BOUND", "standard-function", "Upper index bound of an array dimension."),
  ref("LOWER_BOUND", "standard-function", "Lower index bound of an array dimension."),
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

/**
 * The compiler's type-conversion operators — `INT_TO_REAL`, `TO_REAL`, `TRUNC_DINT`. They are BUILT-INS, not
 * library functions: no reference is needed to call one, and the corpus calls them 504 times.
 *
 * Synthesized rather than listed. There are ~30 elementary types, so enumerating the pairs would be ~900
 * rows — a second, hand-maintained copy of `ELEMENTARY_TYPES` that could disagree with it. Deriving means the
 * entry describes exactly what the name says, and a new elementary type gets its conversions for free.
 *
 * The name is read by `types/parseConversionName`, the one parser identifier resolution, inference and the checks share —
 * this used to keep its own, and `nameResolves` a looser one that let `TIME_OF_DAY_TO_UDINT` (not defined in CODESYS) pass.
 */
function conversionEntry(upper: string): ReferenceEntry | undefined {
  const conv = parseConversionName(upper)
  if (conv === undefined) return undefined
  const dst = conv.to
  return {
    name: upper,
    kind: "operator",
    oneLiner: `Convert ${conv.from?.name ?? "the operand"} to ${dst.name}.`,
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
