/**
 * Literals, enum values and folded constants — every value lowering knows before the program runs.
 */
import { decodeStringLiteral, type Expr, type TypeDecl } from "../../syntax/index.js"
import { findChildScope, lookup, lookupMember, resolveBareEnumMember } from "../../symbols/index.js"
import {
  constEval,
  elementaryRef,
  elemOf,
  integerLiteralType,
  literalType,
  REAL_LITERAL_TYPE,
  type Type,
  UNKNOWN,
} from "../../types/index.js"
import type { IrExpr, IrValue } from "../ir/index.js"
import type { Lowering } from "./lowering.js"
import { stored } from "./convert.js"
import { withStringCapacity } from "./storage.js"

/**
 * An enum is stored as its base type: the one written after the value list (`) BYTE`), else INT — how a project enum
 * without one converts, as measured (conformance `cc_enum_into_*`). An inline enum (`state : (Idle, Running)`) holds INT.
 */
export function enumStorage(lw: Lowering, t: Extract<Type, { kind: "enum" }>): Type {
  const sym = t.name === "(implicit)" ? undefined : lookup(lw.project, t.name)?.symbol
  const body = sym?.kind === "type" ? (sym.ast as TypeDecl).body : undefined
  // `TYPE E : (A, B) := B` starts every E at B; a variable started at 0 regardless (transpiler review 2026-09-15). The
  // type's default is not measured, so such an enum is refused rather than started at a guess.
  if (body?.kind === "enum" && body.init !== undefined) lw.bail("enum-default", `${t.name} declares a default value, not modelled yet`, sym!.span)
  if (body?.kind === "enum" && body.baseType !== undefined) return withStringCapacity(lw.resolve(body.baseType, lw.project))
  return elementaryRef("INT")
}

/**
 * An enum value — `E_Mode.Busy`, or a bare `Busy` when its enum is not qualified_only — as the constant it is: its written
 * `:= n`, else one more than the value before it, starting at 0 (conformance `type_dut_enum_simple`: `Running` is 1;
 * `type_dut_enum_explicit_values`), typed as its enum's storage. Undefined for anything that is not one.
 */
export function enumConstant(lw: Lowering, e: Expr): IrExpr | undefined {
  let sym: ReturnType<typeof resolveBareEnumMember>
  if (e.kind === "member" && e.base.kind === "ident_expr") {
    const owner = lookup(lw.scope, e.base.name)?.symbol
    const scope = owner?.kind === "type" ? findChildScope(lw.project, owner.name) : undefined
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
    const written = v.value === undefined ? undefined : constEval(v.value, lw.project)
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

export function foldConstant(lw: Lowering, e: Expr): IrValue | undefined {
  // an enum value is a constant too — a CASE label `E_Mode.Busy:` or `Busy:`
  const enumValue = (e.kind === "ident_expr" && lw.holds(e.name)) || (e.kind !== "ident_expr" && e.kind !== "member") ? undefined : enumConstant(lw, e)
  if (enumValue?.kind === "const") return enumValue.value
  const v = constEval(e, lw.scope)
  return v === undefined ? undefined : v
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
  const days = BigInt(Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3])) / 86_400_000)
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
