/**
 * The type conversions `X_TO_Y` / `TO_Y` as explicit IR nodes.
 */

import type { Lowering } from "../core/lowering.js"
import { type Expr, hasFrontendAttribute, type Span, type TypeDecl } from "../../../frontend/syntax/index.js"
import {
  DEFAULT_STRING_LENGTH,
  elementaryRef,
  elemOf,
  inferExprType,
  isBoolValued,
  isReal,
  isTemporal,
  stringKind,
  type Type,
  UNKNOWN,
} from "../../../frontend/types/index.js"
import type { IrExpr } from "../../ir/index.js"
import { oneArgument } from "./arity.js"
import { lowerExpr } from "../expressions/expressions.js"
import { convert } from "../values/convert.js"
import { lookup } from "../../../frontend/symbols/index.js"

/**
 * `X_TO_Y(v)` / `TO_Y(v)` → an explicit `convert` node. The rules themselves live in that IR node (design §11), so
 * implicit and explicit conversions cannot drift apart. `X_TO_Y` first brings `v` to X the way the compiler
 * would; `TO_Y` converts from whatever `v` is. The explicit step is always a NODE, never a retyped constant:
 * `DINT_TO_SINT(300)` is 44, and a constant stamped SINT would print as Rust's out-of-range `300i8`.
 */
export function lowerConversion(lw: Lowering, e: Extract<Expr, { kind: "call" }>, from: Type | undefined, to: Type): IrExpr | undefined {
  if (isBoolValued(to) && (from === undefined || isBoolValued(from))) return boolConversion(lw, e)
  const text = textConversion(lw, e, from, to)
  return "lowered" in text ? text.lowered : numericConversion(lw, e, from, to, text.bare)
}

type Call = Extract<Expr, { kind: "call" }>

/** A conversion named with anything but one positional argument — refused, by every rule alike. */
const arityRefusal = (lw: Lowering, e: Call): undefined => lw.bail("call-arity", "a conversion takes exactly one positional argument", e.span)

/** The families the numeric rule converts between. */
const scalar = (t: Type): boolean => ["bool", "int", "bitstring", "real", "time", "date"].includes(elemOf(t)?.family ?? "")
const isInt = (t: Type | undefined, orBits = false): boolean =>
  t !== undefined && (elemOf(t)?.family === "int" || (orBits && elemOf(t)?.family === "bitstring"))
const isString = (t: Type | undefined): boolean => t !== undefined && stringKind(t) !== undefined
// DATE, DT and TOD print as their literal, zero-padded, a TOD's milliseconds only when non-zero (`temporal_conversions`)
// LTIME joins the list: its text is a TIME's with the `LTIME#` prefix and three units below a millisecond, and
// every component boundary is measured (`conversions/to-string-format.ts`). REAL and LREAL deliberately do NOT —
// see the note where the refusal is raised.
// the temporal half is `types/isTemporal` — the Rust emitter dispatches on the SAME predicate, so a type added
// to the table reaches both sites or neither. BOOL and LREAL are named because each has its own renderer.
const hasText = (t: Type | undefined): boolean => {
  const name = t === undefined ? undefined : elemOf(t)?.name
  return isInt(t, true) || (name !== undefined && (name === "BOOL" || name === "LREAL" || isTemporal(name)))
}
const parses = (t: Type): boolean => isInt(t) || isReal(t)

/**
 * `BOOL_TO_BIT` and `BIT_TO_BOOL` change nothing: a BIT holds a BOOLEAN and is one bit only in the LAYOUT (`isBit`,
 * design §9). Typed as the 1-bit bit string it is declared as, each printed a comparison against a Rust `bool`
 * (conformance `ct_bit_fields`).
 */
function boolConversion(lw: Lowering, e: Call): IrExpr | undefined {
  const only = oneArgument(e)
  if (only === undefined) return arityRefusal(lw, e)
  const arg = lowerExpr(lw, only, elementaryRef("BOOL"))
  if (arg === undefined) return undefined
  return isBoolValued(arg.type) ? arg : convert(arg, elementaryRef("BOOL"))
}

/**
 * STRING conversions (design §18): to STRING from an integer, a bit string, BOOL or TIME; from STRING to an integer,
 * REAL or LREAL. REAL_TO_STRING has no single digit rule and stays refused; parsing into a bit string is unmeasured.
 * A number's text is a sizeless STRING (80) — no text these produce is longer. A STRING or WSTRING operand keeps its
 * OWN capacity, and a string result is sized by it: CODESYS converts the whole operand (transpile-review 11,
 * `tr_11_string_conversion_beyond_80`: 90 spaces then '5' is 5, a WSTRING of 100 narrows to 100 characters).
 *
 * The answer (`lowered`) for a conversion to or from text; for any other, the argument a bare `TO_Y(v)` lowered while
 * finding out (`bare`), which the numeric rule converts rather than lowering it a second time.
 */
function textConversion(lw: Lowering, e: Call, from: Type | undefined, to: Type): { lowered: IrExpr | undefined } | { bare: IrExpr | undefined } {
  if (refusesEnumToString(lw, e, to)) return { lowered: undefined }
  // STRING <-> WSTRING: one code unit per code unit, truncated at the target's capacity (conformance
  // `xo3_string_wide_conversions`: a WSTRING(10) into a STRING(4) is 'abcd', a STRING(6) into a WSTRING(2) is "he").
  // Measured on ASCII only. A STRING can hold bytes past 0x7F (a `$C3` escape, a `s[i]` store), and what the vendor
  // makes of one crossing to a WSTRING is not recorded — both backends cast it as its value; a recording decides it.
  const wideConversion = isString(to) && isString(from) && elemOf(to)?.name !== elemOf(from ?? UNKNOWN)?.name
  // `TO_STRING(v)` names no source, so `from` is undefined and the text rules below had nothing to test — the catalog
  // only ever wrote `X_TO_STRING`, while the corpus writes the bare form 132 times. The argument's own type is the
  // source (conformance `ct_bare_to_conversions`). `TO_INT(s)` of a STRING or WSTRING is the same: the named rule below.
  const positional = oneArgument(e)
  const single = positional !== undefined
  const bare = from === undefined && positional !== undefined ? lowerExpr(lw, positional) : undefined
  if (from === undefined && single && bare === undefined) return { lowered: undefined }
  if (from === undefined && isString(to)) {
    if (bare === undefined) return { lowered: arityRefusal(lw, e) }
    return { lowered: lowerConversion(lw, e, bare.type, to) }
  }
  if (bare !== undefined && isString(bare.type)) return { lowered: lowerConversion(lw, e, bare.type, to) }
  // WSTRING -> a number is the STRING rule on the narrowed text (`tr_11_string_conversion_beyond_80`: 85 spaces then
  // '12345' is 12345 through WSTRING_TO_INT and TO_INT).
  const wideParse = isString(from) && elemOf(from ?? UNKNOWN)?.name === "WSTRING" && parses(to)
  if (wideConversion || wideParse || (isString(to) && elemOf(to)?.name === "STRING" && hasText(from)) || (isString(from) && elemOf(from ?? UNKNOWN)?.name === "STRING" && parses(to)))
    return { lowered: stringConversion(lw, e, from!, to, wideParse) }
  if (isString(to) && elemOf(to)?.name === "STRING" && elemOf(from ?? UNKNOWN)?.name === "REAL")
    return { lowered: lw.bail("conversion-type", "REAL_TO_STRING prints seven digits except where it prints eight — 70 cells and no rule", e.span) }
  return { bare }
}

/**
 * `{attribute 'to_string'}` ON AN ENUM makes its STRING conversions print the MEMBER'S NAME — TO_STRING, INT_TO_STRING
 * and TO_WSTRING of `On` are 'On' (P15, conformance `prag_to_string_*`, CODESYS 2026-10-02), where the same enum without
 * the attribute prints '1'. Printed as the number it was a silent wrong answer; there is no member-name table yet
 * (task 4.5.1 reads `to_string` from the AST), so the conversion is refused by name — true when it was.
 */
function refusesEnumToString(lw: Lowering, e: Call, to: Type): boolean {
  const operand = oneArgument(e, { named: true, output: true })
  if (!isString(to) || operand === undefined) return false
  const t = inferExprType(operand, lw.scope, lw.project)
  const sym = t.kind === "enum" && t.name !== "(implicit)" ? lookup(lw.project, t.name)?.symbol : undefined
  if (sym?.kind !== "type" || !hasFrontendAttribute(sym.ast as TypeDecl, "to_string")) return false
  lw.bail("conversion-type", "a STRING conversion of an enum under {attribute 'to_string'} prints the member's name, which lowering does not model yet", e.span)
  return true
}

/** A conversion's NAMED string type (`STRING_TO_…`, `…_TO_WSTRING`) — built from the name, so sizeless — at the default
 *  capacity; any other type as it is. */
const defaultCapacity = (t: Type): Type => (isString(t) && t.kind === "elementary" && t.length === undefined ? { ...t, length: DEFAULT_STRING_LENGTH } : t)

/** A conversion whose source or target is a STRING or WSTRING, the operand keeping its own capacity. */
function stringConversion(lw: Lowering, e: Call, from: Type, to: Type, wideParse: boolean): IrExpr | undefined {
  const only = oneArgument(e)
  if (only === undefined) return arityRefusal(lw, e)
  const arg = lowerExpr(lw, only, from)
  if (arg === undefined) return undefined
  // the operand keeps its own capacity when it already is a string of the named width; only a sizeless one is 80
  const sameWidth = isString(arg.type) && elemOf(arg.type)?.name === elemOf(from)?.name
  const source = sameWidth ? arg : convert(arg, defaultCapacity(from))
  const capacity = source.type.kind === "elementary" ? source.type.length : undefined
  const sized = (t: Type): Type => (t.kind === "elementary" && t.length === undefined && capacity !== undefined ? { ...t, length: capacity } : defaultCapacity(t))
  if (wideParse) return { kind: "convert", value: convert(source, sized(elementaryRef("STRING"))), type: to, span: e.span }
  const type = isString(to) && isString(source.type) ? sized(to) : defaultCapacity(to)
  return { kind: "convert", value: source, type, span: e.span }
}

// LREAL_TO_STRING IS IMPLEMENTED AND REAL_TO_STRING IS NOT (`textConversion` refuses it), and the sweep that separated
// them is the reason. Both were refused on eleven cells each; 68 more (`conversions/to-string-format.ts`, 2026-09-19)
// determine one formatter completely and leave the other with two cells no rule explains.
//
//   LREAL  fifteen significant digits, trailing zeros stripped, FIXED while the decimal exponent is 0..13 and
//          exponential otherwise, lowercase `e`, no sign and no padding. 26 of 26 cells follow it, including
//          the boundaries either side (1E13 is '10000000000000.0', 1E14 is '1.0e14', 0.1 is '1.0e-1').
//
//   REAL   seven significant digits, UPPERCASE E, exponent padded to two digits, no '.0' on an exponential
//          mantissa, fixed from 1E-4 up to just below 1E8 — and then two cells that print EIGHT digits
//          (`1.2345679E08`, `1.2345679E-08`) beside four that print seven at the same magnitudes, and four
//          fractions whose seventh digit is not what rounding the value to seven gives (1/3 is '0.3333334',
//          1/7 is '0.1428572', while 1/9 and 1/11 print eight digits and stop). Those are not a rounding mode;
//          they are a formatter doing something the outputs do not reveal.
//
// CANDIDATES MEASURED AGAINST THE 38 RECORDED REAL CELLS, 2026-09-24 — so the next reader does not re-run them:
//
//     33/38  seven significant digits, trailing zeros stripped
//     30/38  shortest representation that round-trips to the same f32
//     30/38  seven digits, then eight when seven does not round-trip
//     28/38  seven digits computed through an f32 scale (x * 10^(6-e), rounded)
//     22/38  eight significant digits · 12/38 nine
//
// Seven digits is the closest and the five it misses are the five the paragraph above names. Round-tripping is
// NOT the discriminator: `3.141593` and `1234.568` keep seven digits although neither round-trips, while
// `1.2345679E08` takes eight. Nor is double rounding — it explains 1/7 (0.14285714|924 → 0.14285715 → 0.1428572)
// and not 1/3 (0.33333334|326 → 0.33333334 → 0.3333333, where CODESYS says 0.3333334).
//
// So the LREAL side is lowered and the REAL side stays refused. The prelude mirrors the interpreter line for
// line, so a guess here would be a silent divergence between the two backends, not a rough edge in one — and a
// rule that is right 33 times in 38 is a rule that is WRONG five times, in a function whose whole output is text.

/**
 * A conversion between scalars. A duration or date converts to and from INTEGERS, in its own unit —
 * TIME_TO_DINT(T#1S500MS) is 1500, DATE_TO_UDINT(D#1970-01-02) is 86400 seconds, TOD_TO_UDINT(TOD#00:00:01) is 1000 ms
 * (conformance `time_conversions`, `date_representation`). Measured beyond that (`temporal_conversions`): DT→DATE keeps
 * the day and DT→TOD the time of day; DATE→DT, TOD→TIME and TIME→TOD keep the count, as the units agree; TIME and DATE →
 * REAL/LREAL are their count; REAL/LREAL→TIME rounds half away from zero (2.5 is 3ms). Any other pair — BOOL, DT/TOD →
 * REAL, DATE→TOD — is refused.
 */
function numericConversion(lw: Lowering, e: Call, from: Type | undefined, to: Type, bare: IrExpr | undefined): IrExpr | undefined {
  if (!scalar(to) || (from !== undefined && !scalar(from)))
    return lw.bail("conversion-type", "this STRING conversion is not measured yet", e.span)
  const only = oneArgument(e)
  if (only === undefined) return arityRefusal(lw, e)
  const arg = bare ?? lowerExpr(lw, only)
  if (arg === undefined) return undefined
  const source = from === undefined ? arg : convert(arg, from)
  const fromName = elemOf(source.type)?.name ?? ""
  const toName = elemOf(to)?.name ?? ""
  const real = (name: string) => name === "REAL" || name === "LREAL"
  const pair = `${fromName}>${toName}`
  const ticks = tickConversion(source, to, e.span)
  if (ticks !== undefined) return ticks
  const temporal = (t: Type): boolean => ["time", "date"].includes(elemOf(t)?.family ?? "")
  const fromTemporal = temporal(source.type)
  const toTemporal = temporal(to)
  const integral = (name: string): boolean => !real(name) && name !== "BOOL"
  const measured =
    (fromTemporal !== toTemporal && integral(fromName) && integral(toName)) ||
    ["DATE>DT", "TOD>TIME", "TIME>TOD"].includes(pair) ||
    ((fromName === "TIME" || fromName === "DATE") && real(toName)) ||
    (real(fromName) && toName === "TIME")
  if ((fromTemporal || toTemporal) && fromName !== toName && !measured)
    return lw.bail("conversion-type", `${fromName}_TO_${toName} is not measured yet`, e.span)
  return fromName === toName ? source : { kind: "convert", value: source, type: to, span: e.span }
}

/**
 * THE WHOLE DATE FAMILY CONVERTS THROUGH AN ABSOLUTE INSTANT. `DT>DATE` and `DT>TOD` were special-cased here and
 * the other 28 pairs were refused as "not measured yet"; `conversions/cross-family.ts` measured all thirty on
 * 2026-09-19 and they are one rule:
 *
 *   the source's count is an instant in ITS tick unit -> re-express in the DESTINATION's tick
 *   -> keep the part the destination HAS: whole days for DATE/LDATE, the part within the day for TOD/LTOD,
 *      the entire instant for DT/LDT
 *
 *   DATE 2026-05-09 -> TOD   is 0:0:0          midnight has no time of day
 *   TOD  07:05:03.250 -> DT  is 1970-1-1-7:5:3 the epoch day, and DT counts SECONDS so the .250 is gone
 *   TOD  07:05:03.250 -> LDT is …7:5:3.250000000   LDT counts nanoseconds, so it survives
 *
 * The ticks are the table's own (`elementary.ts` `tickNs`), and because every pair is a power-of-ten ratio the
 * instant never has to be materialized in nanoseconds — which matters, since seconds-since-epoch times 1e9
 * overflows 32 bits.
 *
 * A DURATION CONVERTS THE SAME WAY, minus the day part — a TIME has no calendar, so there is nothing to mask.
 * `TIME_TO_LTIME(T#1S500MS)` is LTIME#1s500ms and `LTIME_TO_TIME` the reverse: milliseconds and nanoseconds are
 * the same instant in different units, not a reinterpretation of the same number.
 *
 * Undefined for any pair that is not two different types of one tick family.
 */
function tickConversion(source: IrExpr, to: Type, span: Span): IrExpr | undefined {
  const fromElem = elemOf(source.type)
  const toElem = elemOf(to)
  const fromName = fromElem?.name ?? ""
  const toName = toElem?.name ?? ""
  const tickFamily = fromElem?.family === "date" || fromElem?.family === "time"
  if (fromElem === undefined || toElem === undefined || !tickFamily || fromElem.family !== toElem.family || fromName === toName) return undefined
  const fromTick = fromElem.tickNs!
  const toTick = toElem.tickNs!
  // ALWAYS 64 BITS, even for two 32-bit types. `DT_TO_TOD` re-expresses seconds-since-epoch as milliseconds
  // before taking the part within the day, and that intermediate is 1.78e12 — four hundred times what a UDINT
  // holds. The old special case dodged it by masking in SECONDS first, which only works because those two ticks
  // are a factor of 1000 apart; at 64 bits the rule needs no such ordering.
  const work = elementaryRef("ULINT")
  const w = (value: bigint): IrExpr => ({ kind: "const", value, type: work, span })
  let count: IrExpr = convert(source, work)
  if (fromTick > toTick) count = { kind: "binary", op: "mul", left: count, right: w(fromTick / toTick), type: work, span }
  else if (toTick > fromTick) count = { kind: "binary", op: "div", left: count, right: w(toTick / fromTick), type: work, span }
  const dayTicks = 86_400_000_000_000n / toTick
  const part = DATE_PART[toName] ?? "all" // a duration has no calendar part to keep
  // `x - x MOD day` reads the source TWICE, and so does CODESYS for a DT/LDT/TOD/LTOD source (a call runs twice —
  // conformance `xf_dt_to_date_call_once` and siblings). A DATE/LDATE source is already whole days: CODESYS reads it
  // ONCE (`xf_ldate_to_date_call_once`, `xf_date_to_ldate_call_once`), so there is nothing to mask.
  if (part !== "all" && !(part === "day" && DATE_PART[fromName] === "day")) {
    const inDay: IrExpr = { kind: "binary", op: "mod", left: count, right: w(dayTicks), type: work, span }
    count = part === "inDay" ? inDay : { kind: "binary", op: "sub", left: count, right: inDay, type: work, span }
  }
  return { kind: "convert", value: count, type: to, span }
}

/** Which part of an instant each date type CARRIES — measured, see the conversion rule above. */
const DATE_PART: Readonly<Record<string, "day" | "inDay" | "all">> = {
  DATE: "day",
  LDATE: "day",
  TOD: "inDay",
  TIME_OF_DAY: "inDay",
  LTOD: "inDay",
  LTIME_OF_DAY: "inDay",
  DT: "all",
  DATE_AND_TIME: "all",
  LDT: "all",
  LDATE_AND_TIME: "all",
}
