/**
 * Literals, enum values and folded constants — every value lowering knows before the program runs.
 */
import { decodeStringLiteral, type Expr, type TypeDecl } from "../../syntax/index.js"
import { findChildScope, lookup, lookupMember, resolveBareEnumMember } from "../../symbols/index.js"
import {
  constEval,
  elementaryRef,
  elementaryTypeRef,
  elemOf,
  integerLiteralType,
  literalType,
  parseConversionName,
  REAL_LITERAL_TYPE,
  type Type,
  UNKNOWN,
} from "../../types/index.js"
import type { IrExpr, IrValue } from "../ir/index.js"
import type { Lowering } from "./lowering.js"
import { stored } from "./convert.js"
import { withStringCapacity } from "./storage.js"
import { BUILTIN_ARITY } from "./builtins.js"

/**
 * An enum is stored as its base type: the one written after the value list (`) BYTE`), else INT — how a project enum
 * without one converts, as measured (conformance `cc_enum_into_*`). An inline enum (`state : (Idle, Running)`) holds INT.
 */
export function enumStorage(lw: Lowering, t: Extract<Type, { kind: "enum" }>): Type {
  const sym = t.name === "(implicit)" ? undefined : lookup(lw.project, t.name)?.symbol
  const body = sym?.kind === "type" ? (sym.ast as TypeDecl).body : undefined
  if (body?.kind === "enum" && body.baseType !== undefined) return withStringCapacity(lw.resolve(body.baseType, lw.project))
  return elementaryRef("INT")
}

/**
 * WHERE AN UNINITIALIZED VARIABLE OF AN ENUM STARTS — measured on CODESYS 3.5.21.40, 2026-09-18.
 *
 * **Zero if zero is one of the values; otherwise the FIRST enumerator.** Neither half was guessable:
 *
 *   (Forward := 1, Reverse := 2)              -> 1   `type_enum_default_first_nonzero`
 *   (Reverse := -1, Neutral := 0, Forward := 1) -> 0   `type_enum_default_first_negative`   (Neutral, NOT first)
 *   (High := 10, None := 0)                   -> 0   `type_enum_default_gap_then_zero`     (None, NOT first)
 *   (Idle, Busy)                              -> 0   `type_enum_default_first_implicit_zero`
 *
 * So the storage is zero-initialised like everything else, and the vendor only moves off zero when zero would not be
 * a value of the type at all. This was refused while unmeasured — rightly: lowering used to start EVERY enum at 0,
 * which for the middle two is correct and for the first is a value the type does not have. 446 corpus enum types
 * declare a non-zero first enumerator, 21 of them in project source.
 */
export function enumDefault(lw: Lowering, t: Type): bigint | undefined {
  if (t.kind !== "enum" || t.name === "(implicit)") return undefined
  const sym = lookup(lw.project, t.name)?.symbol
  const body = sym?.kind === "type" ? (sym.ast as TypeDecl).body : undefined
  return body?.kind === "enum" ? defaultOfValues(lw, body.values, body.init) : undefined
}

/**
 * The same rule for an INLINE enum — `e : (Forward := 1, Reverse := 2)` — whose values live on the DECLARATION and
 * never reach a named type, so `enumDefault` cannot see them. Measured the same way
 * (`type_enum_inline_default_first_nonzero`, recorded 1).
 */
export function inlineEnumDefault(lw: Lowering, type: { kind: string; values?: readonly { name: { text: string }; value?: Expr }[] }): bigint | undefined {
  return type.kind === "implicit_enum_type" && type.values !== undefined ? defaultOfValues(lw, type.values, undefined) : undefined
}

/** Zero when zero is one of the values, else the FIRST — or the member a type-level `:= Name` default names. */
function defaultOfValues(lw: Lowering, values: readonly { name: { text: string }; value?: Expr }[], init: { kind: string; name?: string } | undefined): bigint | undefined {
  let next = 0n
  let first: bigint | undefined
  let hasZero = false
  const byName = new Map<string, bigint>()
  for (const v of values) {
    const written = v.value === undefined ? undefined : enumValueOf(lw, v.value, 0)
    if (v.value !== undefined && typeof written !== "bigint") return undefined // a value that does not fold
    const value = typeof written === "bigint" ? written : next
    if (first === undefined) first = value
    if (value === 0n) hasZero = true
    byName.set(v.name.text.toUpperCase(), value)
    next = value + 1n
  }
  // A TYPE-LEVEL default names one of its own members: `TYPE E : (Idle, Busy) := Busy` starts every E at Busy
  // (`type_enum_type_level_default`, recorded 1). Read from the value list rather than resolved as an expression —
  // the name is a member of THIS enum, and a bare one does not resolve in the declaring scope.
  if (init !== undefined) return init.kind === "ident_expr" && init.name !== undefined ? byName.get(init.name.toUpperCase()) : undefined
  return hasZero ? 0n : first
}

/**
 * An enum value — `E_Mode.Busy`, or a bare `Busy` when its enum is not qualified_only — as the constant it is: its written
 * `:= n`, else one more than the value before it, starting at 0 (conformance `type_dut_enum_simple`: `Running` is 1;
 * `type_dut_enum_explicit_values`), typed as its enum's storage. Undefined for anything that is not one.
 */
export function enumConstant(lw: Lowering, e: Expr, depth = 0): IrExpr | undefined {
  let sym: ReturnType<typeof resolveBareEnumMember>
  if (e.kind === "member" && e.base.kind === "ident_expr") {
    const owner = lookup(lw.scope, e.base.name)?.symbol
    const scope = owner?.kind === "type" ? findChildScope(lw.project, owner.name) : undefined
    sym = scope === undefined ? undefined : lookupMember(scope, e.member.name)
  } else if (e.kind === "member" && e.base.kind === "member" && e.base.base.kind === "ident_expr") {
    // `Ns.Enum.Value` — a referenced library's namespace over the units it materialized (`bindLibraryNamespaces`):
    // pro2193's `enumErrorSeverity` takes every one of its values from `L_IE1P.L_IE1P_SeverityLevel`
    const ns = lookup(lw.scope, e.base.base.name)?.symbol
    const nsScope = ns?.kind === "namespace" ? findChildScope(lw.project, ns.name) : undefined
    const owner = nsScope === undefined ? undefined : lookupMember(nsScope, e.base.member.name)
    const scope = owner?.kind === "type" && nsScope !== undefined ? findChildScope(nsScope, owner.name) : undefined
    sym = scope === undefined ? undefined : lookupMember(scope, e.member.name)
  } else if (e.kind === "ident_expr") {
    const found = lookup(lw.scope, e.name)?.symbol
    sym = found?.kind === "enum_value" ? found : found === undefined ? resolveBareEnumMember(lw.project, e.name) : undefined
  }
  if (sym?.kind !== "enum_value") return undefined
  // an implicit enumeration's value (`eState : (Idle, Running)`) lives in the POU's scope, its declaration the variable's;
  // it is numbered as a TYPE enum's is and held as an INT (conformance `type_implicit_enum_inline`, `var_inline_enum_decl`)
  const declared = sym.ast as { type?: { kind: string; values?: readonly { name: { text: string }; value?: Expr }[] } }
  const implicit = sym.owner.kind !== "enum" && declared.type?.kind === "implicit_enum_type" ? declared.type.values : undefined
  const decl = sym.owner.kind === "enum" ? lookup(lw.project, sym.owner.name)?.symbol : undefined
  const body = decl?.kind === "type" ? (decl.ast as TypeDecl).body : undefined
  const values = implicit ?? (body?.kind === "enum" ? body.values : undefined)
  if (values === undefined) return undefined
  const type = implicit !== undefined ? enumStorage(lw, { kind: "enum", name: "(implicit)" }) : enumStorage(lw, { kind: "enum", name: sym.owner.name, scope: sym.owner })
  let next = 0n
  for (const v of values) {
    const written = v.value === undefined ? undefined : enumValueOf(lw, v.value, depth)
    if (v.value !== undefined && typeof written !== "bigint") return lw.bail("enum-value", `${v.name.text}'s value does not fold`, e.span)
    const value = typeof written === "bigint" ? written : next
    if (v.name.text.toUpperCase() === sym.name.toUpperCase()) return { kind: "const", value: stored(value, type), type, span: e.span }
    next = value + 1n
  }
  return undefined
}

/** A string literal's decoded text, or null (reported) when it holds an escape not measured yet. */
export function stringLiteralText(lw: Lowering, e: Extract<Expr, { kind: "literal" }>): string | null {
  const wide = e.literalKind === "wstring"
  const decoded = decodeStringLiteral(e.value as string, wide)
  if (decoded === undefined) {
    lw.bail("string-escape", `${e.text} holds a \`$\` escape that is not measured yet`, e.span)
    return null
  }
  // A WSTRING holds UTF-16 code units, one per character: "héllo" into a WSTRING(3) is "hél" and "ü!" fits a
  // WSTRING(2) (conformance `wstring_code_units`). A character beyond the BMP (two units) is not measured; nor is which
  // byte a non-ASCII character TYPED into a STRING becomes — both refused.
  if (wide ? [...decoded].some((ch) => ch.length > 1) : /[^\x00-\x7f]/.test(e.value as string)) {
    lw.bail(wide ? "wstring-surrogate" : "string-non-ascii", `${e.text} holds a character not measured yet`, e.span)
    return null
  }
  return decoded
}

/**
 * One enum value's written `:= …`. Beyond a plain constant it may name ANOTHER enum's value, and may convert it —
 * pro2193's `enumErrorSeverity` is `TO_USINT(L_IE1P.L_IE1P_SeverityLevel.No_Response)` throughout, which folded to
 * nothing while the namespace resolved to nothing and `constEval` folds no call. The conversion is folded here rather
 * than in `constEval`, whose consumers are the LSP's checks: this one knows the measured store (`stored` wraps at the
 * target's width), and only for an integer or bit-string target, which is all an enum value can be.
 */
function enumValueOf(lw: Lowering, e: Expr, depth: number): bigint | number | boolean | undefined {
  if (depth > 8) return undefined
  const member = e.kind === "member" ? enumConstant(lw, e, depth + 1) : undefined
  if (member?.kind === "const") return member.value as bigint
  const converted = convertedConstant(lw, e, depth)
  if (converted !== undefined) return converted
  return constEval(e, lw.project)
}

/** `TO_USINT(x)` / `INT_TO_BYTE(x)` over a constant — the value stored at the target's width, as measured (design §11). */
function convertedConstant(lw: Lowering, e: Expr, depth: number): bigint | undefined {
  if (e.kind !== "call" || e.callee.kind !== "ident_expr" || e.args.length !== 1) return undefined
  const written = e.args[0]?.value
  // THE ONE PARSER, not a seventh. This read the name with its own `/^(?:[A-Za-z]+_)?TO_([A-Za-z]+)$/` — in a
  // file that imports `parseConversionName` and uses it two functions below — and disagreed with it twice: no
  // `i` flag, so a lower-case `int_to_byte(5)` was not a conversion at all where ST is case-insensitive; and no
  // check on the SOURCE, so a project function named `FOO_TO_INT(5)` folded as though it converted, silently
  // yielding its argument. `parseConversionName` rejects both (`GO_TO_START` is the case its own doc names).
  const conversion = parseConversionName(e.callee.name)
  if (written === undefined || conversion === undefined) return undefined
  const elem = conversion.to
  if (!(elem.family === "int" || elem.family === "bitstring")) return undefined
  const target = elementaryTypeRef(elem)
  const value = enumValueOf(lw, written, depth + 1)
  return typeof value === "bigint" ? (stored(value, target) as bigint) : undefined
}

/**
 * IS THIS EXPRESSION A COMPILE-TIME CONSTANT? Answered from the AST and the scope — no lowering, nothing built.
 *
 * It exists because the first version of this asked the question by LOWERING the expression and seeing whether a
 * constant came out, which meant lowering speculatively and throwing the diagnostics away. That is unsound, and
 * not in a way a caller can defend against: lowering MEMOIZES — a layout into `shared.layouts`, a global into
 * `shared.globals` — so discarding the diagnostic left the half-built entity in place, and the next reference hit
 * the cache and never re-reported. A POU lowered CLEAN with a global silently at 0 instead of 41.
 *
 * So the speculation is gone rather than guarded. Every caller now knows BEFORE it starts whether to fold or to
 * defer, and whatever lowering then says is reported.
 *
 * A call is constant only when the callee is a CONVERSION or one of the pure value functions — measured to fold on
 * SP21, all of them (`declarations/constant-folding.ts`). `ADR`, `THIS` and a user FUNCTION are not: CODESYS runs
 * those, in declaration order, which is the init step's business (`init-sequence.ts`).
 */
export function foldsToConstant(lw: Lowering, e: Expr): boolean {
  switch (e.kind) {
    case "literal":
      return true
    case "paren":
      return foldsToConstant(lw, e.inner)
    case "unary":
      return foldsToConstant(lw, e.operand)
    case "binary":
      return foldsToConstant(lw, e.left) && foldsToConstant(lw, e.right)
    // a named CONSTANT or an enum member — `foldConstant` is itself pure (symbol lookups and `constEval`)
    case "ident_expr":
    case "member":
      return foldConstant(lw, e) !== undefined
    case "call": {
      if (e.callee.kind !== "ident_expr" || !isConstantCallee(e.callee.name)) return false
      return e.args.every((a) => !a.output && a.param === undefined && a.value !== undefined && foldsToConstant(lw, a.value))
    }
    default:
      return false
  }
}

/** The callees whose result is decided at compile time: a conversion, `SIZEOF`, and the pure value functions. */
function isConstantCallee(name: string): boolean {
  const upper = name.toUpperCase()
  return upper === "SIZEOF" || upper === "XSIZEOF" || BUILTIN_ARITY[upper] !== undefined || parseConversionName(upper) !== undefined
}

export function foldConstant(lw: Lowering, e: Expr): IrValue | undefined {
  // an enum value is a constant too — a CASE label `E_Mode.Busy:` or `Busy:`
  const enumValue = (e.kind === "ident_expr" && lw.holds(e.name)) || (e.kind !== "ident_expr" && e.kind !== "member") ? undefined : enumConstant(lw, e)
  if (enumValue?.kind === "const") return enumValue.value
  return constEval(e, lw.scope)
}

/**
 * A duration literal's value in its type's UNIT. Measured (conformance `time_*`, `ltime_basic`): TIME is 32-bit
 * MILLISECONDS — T#49D17H2M47S295MS plus 1 ms wraps to 0 — and LTIME 64-bit NANOSECONDS. The AST normalizes both to
 * nanoseconds under one `literalKind: "time"`, so the prefix decides which. This used to type every duration TIME
 * and hold it in nanoseconds: a recalled design note, while `types/elementary` already said TIME is 32 bits.
 */
export function durationOf(e: Extract<Expr, { kind: "literal" }>): { value: bigint; type: Type } | undefined {
  const v = e.value
  if (e.literalKind !== "time" || typeof v !== "object" || v === null || !("ns" in v)) return undefined
  return inTicks(v.ns, literalType(e))
}

/**
 * A date, date-and-time or time-of-day literal's value in its type's UNIT. Measured (conformance `date_*`,
 * `ldate_ltod_ldt`): DATE and DT count SECONDS since 1970-01-01 in 32 bits (DATE_TO_UDINT(D#1970-01-02) is 86400, not
 * 1; DT#2106-02-07-06:28:15 plus a second wraps to the epoch), TOD counts MILLISECONDS since midnight in 32 bits, and
 * LDATE / LDT / LTOD count NANOSECONDS in 64. The AST keeps the text (`"1970-01-02"`) and the prefix decides the type.
 */
/** The literal kinds `durationOf` / `calendarOf` / `typedRealOf` are responsible for.
 *
 *  A literal of one of these kinds whose conversion returns `undefined` must be REPORTED, never handed on: the
 *  next branch in both call sites tests `typeof value === "string"`, and a date literal's AST value IS the
 *  string `"300000-01-01"`, so a failed conversion silently became a STRING constant. That is the other half of
 *  the totality contract — "never a throw AND never an invented meaning" — and it is the half that does not
 *  announce itself. */
export const TEMPORAL_LITERAL_KINDS: ReadonlySet<string> = new Set(["date", "datetime", "tod", "duration"])

export function calendarOf(e: Extract<Expr, { kind: "literal" }>): { value: bigint; type: Type } | undefined {
  const text = e.value
  if (typeof text !== "string" || !["date", "datetime", "tod"].includes(e.literalKind)) return undefined
  const ns = calendarNanoseconds(e.literalKind as "date" | "datetime" | "tod", text)
  return ns === undefined ? undefined : inTicks(ns, literalType(e))
}

/**
 * A REAL- or LREAL-prefixed literal's value in its prefix type. The prefix decides, not the context: `lr := REAL#0.1`
 * stores float32's 0.1 (0.10000000149011612), where `LREAL#0.1` and an untyped `0.1` store float64's (conformance
 * `typed_literal_real_prefix`). Lowering used to type every real literal by its context. An INTEGER prefix changed
 * nothing measured — `INT#30000 + INT#30000` still folds at full width (`typed_literal_constant_fold`) — so it keeps the
 * untyped path.
 */
export function typedRealOf(e: Extract<Expr, { kind: "literal" }>): { value: number; type: Type } | undefined {
  if (e.literalKind !== "typed" || typeof e.value !== "number") return undefined
  const type = elementaryRef(e.prefix ?? "")
  const real = elemOf(type)
  if (real?.family !== "real") return undefined
  return { value: real.bits === 32 ? Math.fround(e.value) : e.value, type }
}

/** A nanosecond count in its type's ticks (`types/elementary` `tickNs`), with that type — the literal's own
 *  (`types/literalType`: its prefix decides). */
export function inTicks(ns: bigint, type: Type): { value: bigint; type: Type } | undefined {
  const tick = elemOf(type)?.tickNs
  return tick === undefined ? undefined : { value: ns / tick, type }
}

/** Nanoseconds since the epoch (DATE/DT) or since midnight (TOD) for a literal's text, or undefined when malformed. */
export function calendarNanoseconds(kind: "date" | "datetime" | "tod", text: string): bigint | undefined {
  const clock = (h: string, m: string, s: string, frac = ""): bigint =>
    ((BigInt(h) * 60n + BigInt(m)) * 60n + BigInt(s)) * 1_000_000_000n + BigInt(frac.padEnd(9, "0").slice(0, 9) || "0")
  if (kind === "tod") {
    const t = /^(\d+):(\d+):(\d+)(?:\.(\d+))?$/.exec(text)
    return t === null ? undefined : clock(t[1]!, t[2]!, t[3]!, t[4])
  }
  const d = /^(\d+)-(\d+)-(\d+)(?:-(\d+):(\d+):(\d+)(?:\.(\d+))?)?$/.exec(text)
  if (d === null) return undefined
  // `Date.UTC` answers NaN past its own range (about year 275760), and `BigInt(NaN)` THROWS — which broke the
  // totality contract that everything downstream rests on: `D#300000-01-01` came out of `lowerSource` as a bare
  // `RangeError: Not an integer`, with no diagnostic and no position. Answering `undefined` is all that is
  // needed, because this function already returns it for a malformed literal and the caller already reports
  // that — the machinery was there, the NaN just walked past it.
  const utc = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]))
  if (!Number.isFinite(utc)) return undefined
  const days = BigInt(utc / 86_400_000)
  const midnight = days * 86_400n * 1_000_000_000n
  return kind === "date" || d[4] === undefined ? midnight : midnight + clock(d[4], d[5]!, d[6]!, d[7])
}

/** An untyped literal's type: the context's, or the narrowest that holds the value (its OWN type is `types/literalType`). */
export function contextLiteralType(e: Extract<Expr, { kind: "literal" }>, expected?: Type): Type {
  const want = elemOf(expected ?? UNKNOWN)
  const v = e.value
  if (v === undefined) return UNKNOWN
  if (typeof v === "boolean") return elementaryRef("BOOL")
  // (strings and durations never reach here: `expr` lowers both before asking for a literal's type)
  if (typeof v === "string" || typeof v === "object") return UNKNOWN
  if (typeof v === "number") return want?.family === "real" ? expected! : elementaryRef(REAL_LITERAL_TYPE)
  // An integer literal: honour a numeric context (REAL included — `x : REAL := 1;` is legal), else narrowest.
  if (want !== undefined && want.rank !== undefined) return expected!
  // the narrowest type CODESYS gives the literal — `types/`'s, not a second list here (this one used to skip the unsigned)
  const t = integerLiteralType(v)
  return t === undefined ? UNKNOWN : elementaryRef(t.name)
}
