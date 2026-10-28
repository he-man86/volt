/**
 * BUILT-IN HOVER — the one entry hover (`hover.ts`, ST and network bodies alike) and
 * completion ask for what the COMPILER provides: elementary types, operators, conversions, the standard functions that
 * are operators (MAX, SEL, TRUNC…), the implicits and the system names, and the pragma directives and `{attribute '…'}`
 * names (openspec lsp-same-standard 2.2; it was `reference/`). Hover text only — every fact it shows is read from the
 * front-end: a data-type entry's range DERIVES from `types/elementary`, a fixed result type from `types/builtins.ts`
 * `BUILTIN_RESULT`, a platform integer's width from the project's target (`types/platform`), so there is exactly one home
 * for a type's numbers.
 *
 * ONE PATH FOR BOTH VENDORS. A name hovers only where the project's dialect HAS it — `builtinName(name, dialect)` for a
 * built-in, `isKnownAttribute(word, dialect)` for an attribute — because the vendors are identical on the Volt layer and
 * their difference is data the front-end holds: `__POUNAME` or `BOOL_TO_LDATE` on TwinCAT is "not defined", and
 * `{attribute 'TcRetain'}` on CODESYS "unknown", so neither gets a tooltip there. There is no dialect-blind lookup, and
 * no name list leaves this file. The same holds for PLACE: `THIS` in a FUNCTION is "not allowed in this context"
 * (`symbols` `selfRefAllowed`, the rule the analysis reports by), so it is described only where it means something.
 *
 * A LIBRARY'S ELEMENTS ARE NEVER HERE — not Standard's LEN or TON, not StringUtils' StrConcatA. A library exists only
 * where a project references it, and the LSP knows it through what the bridge materializes under
 * `Library Manager/<library>/`. Listing one here made it resolve in a project that references no such library,
 * where CODESYS answers "Identifier not defined". (Their code, when something must run it, is the library repo's:
 * `libraries/`.) A library name the LSP cannot resolve in a project that DOES reference the library is a
 * materialization gap, and it is fixed in the bridge, not papered over here.
 */
import type { Hover } from "vscode-languageserver-protocol"
import { allUnits, isKnownAttribute, selfRefKind, type Dialect, type Target } from "../../frontend/syntax/index.js"
import { dialectOf, scopeForUnit, selfRefAllowed, targetOf, type Scope } from "../../frontend/symbols/index.js"
import {
  BUILTIN_OPERATOR_NAMES,
  BUILTIN_RESULT,
  builtinName,
  canonicalElem,
  conversionSides,
  ELEMENTARY_TYPES,
  elementaryType,
  isPlatformInteger,
} from "../../frontend/types/index.js"
import { rangeFromSpan, tokenAtOffset, type Document } from "../shared/index.js"

/**
 * The hover of the compiler-provided name under the cursor — ST and network text alike — or undefined where the project's
 * dialect has no such name (or it is a `__` name the compiler does not have: `builtinName` is open on `__`, the catalog
 * is not), or where it means nothing at that place (`THIS` in a FUNCTION).
 */
export function builtinHover(doc: Document, project: Scope, offset: number): Hover | undefined {
  const tok = tokenAtOffset(doc.parseResult.tokens, offset)
  if (tok === undefined || (tok.kind !== "identifier" && tok.kind !== "keyword")) return undefined
  if (builtinName(tok.text, dialectOf(project)) === undefined) return undefined
  const self = selfRefKind(tok.text)
  if (self !== undefined && !selfRefHere(self, doc, project, offset)) return undefined
  const entry = lookupReference(tok.text, targetOf(project))
  if (entry === undefined) return undefined
  return { contents: { kind: "markdown", value: renderReferenceHover(entry) }, range: rangeFromSpan(tok.span) }
}

/** `THIS`/`SUPER` at `offset` means something: the innermost unit holding it allows it. Outside any unit it means nothing. */
function selfRefHere(which: "THIS" | "SUPER", doc: Document, project: Scope, offset: number): boolean {
  let unit: ReturnType<typeof allUnits>[number] | undefined
  for (const u of allUnits(doc.parseResult.units))
    if (offset >= u.span.start && offset < u.span.end && (unit === undefined || u.span.end - u.span.start < unit.span.end - unit.span.start))
      unit = u
  return unit !== undefined && selfRefAllowed(which, unit, scopeForUnit(project, unit) ?? project)
}

/** A one-line description of a pragma directive (either dialect) or of an `{attribute '…'}` name THIS dialect knows —
 *  hover and completion. A name the compiler warns unknown gets none: CODESYS has never heard of `TcRetain`. */
export function pragmaHelp(word: string, dialect: Dialect): string | undefined {
  const w = word.toLowerCase()
  // own keys only: a plain object's `constructor` or `__proto__` is no directive
  if (Object.hasOwn(DIRECTIVES, w)) return DIRECTIVES[w]
  if (isKnownAttribute(w, dialect)) return `Recognized \`{attribute '${word}'}\` compiler attribute.`
  return undefined
}

type ReferenceKind = "data-type" | "operator" | "standard-function" | "implicit" | "namespace"

interface ReferenceEntry {
  name: string
  kind: ReferenceKind
  oneLiner: string
  /** Extra detail rendered under the one-liner (e.g. a type's range/width). */
  details?: string
  /** Elementary result type of an operator with a FIXED return type — read from `types/builtins.ts` `BUILTIN_RESULT`
   *  (the one table; inference reads it there too), or a conversion's derived one. Only set where the type is
   *  unambiguous; a type-preserving operator (ABS, SEL) leaves it undefined. The hover shows it ("returns REAL"). */
  returnType?: string
}

// ─── operators + standard functions (curated) ────────────────────────────────

/** Terse entry builder — most catalog names need only name + one-liner (hover shows more when present). A built-in
 *  with a fixed result type carries it from `BUILTIN_RESULT`. */
function ref(name: string, kind: ReferenceKind, oneLiner: string): ReferenceEntry {
  const returnType = BUILTIN_RESULT.get(name)
  return { name, kind, oneLiner, ...(returnType === undefined ? {} : { returnType }) }
}

// The hover text of the compiler's own names — exactly `types/builtins.ts` `BUILTIN_OPERATOR_NAMES`, the set the
// search order asks (`types/names` `resolveBareName`); nothing a library provides. `builtin-hover.test.ts` holds them equal.
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
  // No fixed returnType: EXPT is REAL when BOTH arguments are REAL, LREAL otherwise (measured — `types/infer/`
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
  // `jmpc`) is refused as a plain name by the parser (`IL_OPERATOR_WORDS`); `calc` alone is parsed, so it belongs
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
  // `__POSITION`, `__COMPARE_AND_SWAP`, `__XADD` and `TEST_AND_SET` return a FIXED type, measured: `types/builtins.ts`.
  ref("__POSITION", "operator", "Source position intrinsic."),
  ref("__POUNAME", "operator", "Enclosing POU name intrinsic."),
  ref("__CURRENTTASK", "operator", "Currently executing task."),
  ref("__COMPARE_AND_SWAP", "operator", "Atomic compare-and-swap."),
  ref("__XADD", "operator", "Atomic exchange-and-add."),
  ref("__POOL", "operator", "Memory-pool intrinsic (CODESYS)."),
  ref("TEST_AND_SET", "operator", "Atomic test-and-set."),
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

/**
 * THE COMPILER'S OTHER NAMES — every one `builtinName` accepts that is no operator, standard function, elementary type or
 * conversion (openspec lsp-same-standard 2.3, design.md §1.6): the implicits (`types/builtins.ts` `COMPILER_IMPLICITS`),
 * CODESYS's vector type and the system namespace; the platform integers are `platformEntry`'s (their width the target's).
 * Each answered no hover before, although the analysis takes each as the compiler's own.
 */
const OTHER_NAMES: ReadonlyArray<ReferenceEntry> = [
  { name: "THIS", kind: "implicit", oneLiner: "The function block instance itself — a POINTER TO the enclosing function block." },
  { name: "SUPER", kind: "implicit", oneLiner: "The base function block — a POINTER TO the instance as its EXTENDS base." },
  { name: "IoConfig_Globals", kind: "implicit", oneLiner: "The global variable list the compiler generates for the I/O mapping." },
  { name: "TYPE_CLASS", kind: "implicit", oneLiner: "The system enumeration of type classes (`__SYSTEM.TYPE_CLASS`), as `__VARINFO` reports them." },
  { name: "__VECTOR", kind: "data-type", oneLiner: "Vector type (CODESYS). `__VECTOR[size] OF REAL` / `LREAL`." },
  { name: "__SYSTEM", kind: "namespace", oneLiner: "The system namespace: `__SYSTEM.TYPE_CLASS`, `__SYSTEM.AnyType`, `__SYSTEM.IQueryInterface` …" },
]

/** A platform integer on `target` — its width the target's (`types/platform` `canonicalElem`: 64-bit LINT, 32-bit DINT,
 *  both measured), and said to be unknown where nobody measured the target, never a guessed one. */
function platformEntry(name: string, target: Target | undefined): ReferenceEntry {
  const details =
    target === undefined
      ? "width unknown: the project's target is not measured"
      : `${canonicalElem(name, target)} on this target (${target.pointerBits}-bit pointers)`
  return { name, kind: "data-type", oneLiner: "Platform-width integer: the compiler resolves it by the target's pointer width.", details }
}

// the curated operator entries are exactly the front-end's built-in names: one outside that set is refused at load
// (the other direction, every name hovering as one, is `builtin-hover.test.ts`)
const UNKNOWN_TO_FRONTEND = [...OPERATORS, ...STANDARD_FUNCTIONS].filter((e) => !BUILTIN_OPERATOR_NAMES.has(e.name.toUpperCase()))
if (UNKNOWN_TO_FRONTEND.length > 0)
  throw new Error(`builtin-hover: not front-end built-ins (types/builtins.ts BUILTIN_OPERATOR_NAMES): ${UNKNOWN_TO_FRONTEND.map((e) => e.name).join(", ")}`)

const CATALOG: ReadonlyMap<string, ReferenceEntry> = new Map(
  [...[...ELEMENTARY_TYPES.keys()].map((n) => dataTypeEntry(n)), ...OPERATORS, ...STANDARD_FUNCTIONS, ...OTHER_NAMES].map((e) => [
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
  const sides = conversionSides(upper)
  if (sides === undefined) return undefined
  // a platform side's range is the target's, which a hover has no project to ask (`isPlatformInteger`)
  const dst = elementaryType(sides.to)
  return {
    name: upper,
    kind: "operator",
    oneLiner: `Convert ${sides.from ?? "the operand"} to ${sides.to}.`,
    returnType: sides.to,
    ...(dst?.range === undefined ? {} : { details: `result range ${dst.range.min}..${dst.range.max}` }),
  }
}

/** Look up a built-in reference entry by name (case-insensitive, alias-aware for types) on `target` — whether or not the
 *  dialect has it: the one caller is `builtinHover`, which asks `builtinName` first. */
function lookupReference(name: string, target: Target | undefined): ReferenceEntry | undefined {
  const u = name.toUpperCase()
  if (isPlatformInteger(u)) return platformEntry(u, target)
  return CATALOG.get(u) ?? (elementaryType(u) !== undefined ? dataTypeEntry(u) : undefined) ?? conversionEntry(u)
}

const KIND_LABEL: Readonly<Record<ReferenceKind, string>> = {
  "data-type": "data type",
  operator: "operator",
  "standard-function": "standard function",
  implicit: "implicit",
  namespace: "namespace",
}

/** Markdown hover body for a reference entry: the name, its one-liner, then what it is — its kind, its fixed result type
 *  where it has one, and its details (a range, a width). */
function renderReferenceHover(entry: ReferenceEntry): string {
  const facts = [KIND_LABEL[entry.kind]]
  if (entry.returnType !== undefined) facts.push(`returns ${entry.returnType}`)
  if (entry.details !== undefined) facts.push(entry.details)
  return `\`\`\`iecst\n${entry.name}\n\`\`\`\n\n${entry.oneLiner}\n\n_${facts.join(" · ")}_`
}

/**
 * Pragma DIRECTIVES — the first word of a `{…}` pragma (as opposed to the attribute NAME that follows
 * `{attribute '…'}`). One-liners power hover and completion's detail; nothing reports a directive missing from here.
 * Source: CODESYS `07-pragmas.md` (conditional-compilation, message, region, attribute) + the corpus.
 * `end_region`/`endregion` are both accepted spellings. Directive-arg operators (`defined`, `hasvalue`,
 * `hastype`, `hasattribute`) live INSIDE `{IF …}`, so they are never a leading directive — not listed.
 */
const DIRECTIVES: Readonly<Record<string, string>> = {
  attribute: "Attaches a compiler attribute to the following declaration.",
  if: "Conditional-compilation start — the block compiles only when the expression is true.",
  elsif: "Conditional-compilation alternative branch (`{IF}` … `{ELSIF}` … `{END_IF}`).",
  else: "Conditional-compilation fallback branch.",
  end_if: "Closes a conditional-compilation `{IF}` block.",
  define: "Defines a conditional-compilation symbol (used by `{IF defined(…)}`).",
  undefine: "Removes a conditional-compilation symbol.",
  region: "Starts a named, foldable source region (editor-only).",
  end_region: "Closes a `{region}` block.",
  endregion: "Closes a `{region}` block (alias of `end_region`).",
  warning: "Emits an author-defined compiler warning where reached.",
  error: "Emits an author-defined compiler error where reached.",
  info: "Emits an author-defined compiler info message.",
  text: "Author-defined compile-time text (hint-level).",
}
