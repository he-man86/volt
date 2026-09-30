/**
 * A LITERAL'S TYPE — what the compiler makes of an untyped integer, an untyped real, and the limits a literal is held to.
 */
import type { BinaryExpr, Expr, Literal } from "../syntax/index.js"
import { ELEMENTARY_TYPES, elementaryType, type ElementaryType } from "./elementary.js"
import { canonicalElem } from "./platform.js"
import { elementaryRef, elementaryTypeRef, UNKNOWN, type Type } from "./type.js"
import { integerOfWidth } from "./width.js"

/** The type an untyped real literal takes — `i := 1.5` is "Cannot convert type 'LREAL' to type 'INT'" (conformance
 *  `cc_init_real_into_int`), an enum member `(A := 2.5)` "Type 'LREAL' can not be converted". */
export const REAL_LITERAL_TYPE = "LREAL"

/** The widest range any IEC integer type holds, [LINT min .. ULINT max]: an untyped integer outside it has no type. */
const ANY_INT_RANGE: { readonly min: bigint; readonly max: bigint } = {
  min: ELEMENTARY_TYPES.get("LINT")!.range!.min,
  max: ELEMENTARY_TYPES.get("ULINT")!.range!.max,
}

/** Largest finite magnitude for the floating types (doc 06), for REAL/LREAL overflow of a constant. */
export const REAL_MAX_MAGNITUDE: ReadonlyMap<string, number> = new Map([
  ["REAL", 3.402823e38],
  ["LREAL", 1.7976931348623157e308],
])

/** The integer types a literal can take, narrowest first, a signed type before the unsigned one of its width. */
const LITERAL_INTEGER_ORDER = ["SINT", "USINT", "INT", "UINT", "DINT", "UDINT", "LINT", "ULINT"]

/**
 * The type CODESYS gives an untyped integer literal: the narrowest of SINT, USINT, INT, UINT, DINT, UDINT, LINT, ULINT
 * that holds the value — 127 is SINT, 128 USINT, 300 INT, 40000 UINT, 70000 DINT, -129 INT, 3000000000 UDINT (conformance
 * `overflow_*`, `cc_literal_*`). Undefined past ULINT. The one home of that order: checking and the transpiler both use it.
 */
export function integerLiteralType(value: bigint): ElementaryType | undefined {
  for (const name of LITERAL_INTEGER_ORDER) {
    const t = ELEMENTARY_TYPES.get(name)!
    if (value >= t.range!.min && value <= t.range!.max) return t
  }
  return undefined
}

/**
 * A literal's OWN exact type, where the value alone decides it: an untyped integer's narrowest type
 * (`integerLiteralType`). Undefined for every other literal.
 */
export function literalOwnType(lit: Literal): ElementaryType | undefined {
  return lit.literalKind === "int" && typeof lit.value === "bigint" ? integerLiteralType(lit.value) : undefined
}

/** The type a literal's value overflows — its typed prefix, `ANY_INT` or `ANY_REAL` for an untyped one — or undefined
 *  when the value is representable. */
export function literalCapacityType(lit: Literal): string | undefined {
  if (lit.literalKind === "typed" && lit.prefix !== undefined) {
    const et = elementaryType(lit.prefix)
    if (et?.range !== undefined && typeof lit.value === "bigint")
      return lit.value < et.range.min || lit.value > et.range.max ? et.name : undefined
    const mag = REAL_MAX_MAGNITUDE.get(lit.prefix) // REAL#/LREAL#
    if (mag !== undefined && typeof lit.value === "number")
      return !Number.isFinite(lit.value) || Math.abs(lit.value) > mag ? lit.prefix : undefined
    return undefined
  }
  if (lit.literalKind === "int" && typeof lit.value === "bigint")
    return lit.value < ANY_INT_RANGE.min || lit.value > ANY_INT_RANGE.max ? "ANY_INT" : undefined
  if (lit.literalKind === "real" && typeof lit.value === "number")
    return !Number.isFinite(lit.value) || Math.abs(lit.value) > REAL_MAX_MAGNITUDE.get("LREAL")! ? "ANY_REAL" : undefined
  return undefined
}

/** An integer literal, written plain or negated (`5`, `-5`) — an operand that takes its type from the other one. */
export const isIntLiteral = (e: Expr): boolean =>
  (e.kind === "literal" && e.literalKind === "int") ||
  (e.kind === "unary" && e.op === "-" && e.operand.kind === "literal" && e.operand.literalKind === "int")

/**
 * The type an untyped integer literal is CHECKED as against an integer or bit-string target — or undefined when there is
 * nothing to check: not such a literal, not such a target, or a value the target holds (`us := 5`, `b := 255`, `i := 200`
 * are silent). A value the target cannot hold takes `integerLiteralType` and converts like a variable of it (gap 13,
 * conformance `overflow_*`, `cc_literal_*`, `cc_fp_literal_*`): `b : BYTE := 300` is "Cannot convert type 'INT' to type
 * 'BYTE'", `si := 128` warns "unsigned Type 'USINT' to signed Type 'SINT'", `us := -1` warns "signed Type 'SINT' to
 * unsigned Type 'USINT'". Other targets (REAL, TIME, BOOL) are not measured, and stay unchecked.
 */
export function literalCheckType(value: Expr, target: Type): Type | undefined {
  const negated = value.kind === "unary" && value.op === "-"
  const lit = negated ? value.operand : value
  // A real literal beyond REAL's largest value is an LREAL: `rv : REAL := 3.4028235E38` warns LREAL → REAL, `1.5E8` and
  // `2.5E-10` do not (conformance `cc_real_init_max`, `_sci_fraction`, `_tiny`). A literal too small for a REAL is unmeasured.
  if (lit.kind === "literal" && typeof lit.value === "number" && target.kind === "elementary" && target.elem.family === "real")
    return target.elem.bits === 32 && Math.abs(lit.value) > 3.4028234663852886e38 ? elementaryRef("LREAL") : undefined
  if (lit.kind !== "literal" || lit.literalKind !== "int" || typeof lit.value !== "bigint") return undefined
  const family = target.kind === "elementary" ? target.elem.family : undefined
  const range = target.kind === "elementary" && (family === "int" || family === "bitstring") ? target.elem.range : undefined
  if (range === undefined) return undefined
  const v = negated ? -lit.value : lit.value
  if (v >= range.min && v <= range.max) return undefined
  const t = integerLiteralType(v)
  return t === undefined ? undefined : elementaryTypeRef(t)
}

/**
 * The type an untyped numeric literal is checked as for the "Cannot convert" ERROR when stored into `target` (an
 * assignment or a declaration's initial value) — or undefined when there is nothing to check. Recorded on CODESYS
 * (conformance `cc_init_*`, `cc_assign_*`, `cc_literal_*`, consolidate-lsp-structure A13):
 *   - an integer the target holds is silent — an integer or bit-string target in range, and a BOOL takes 0 and 1
 *     (`b := 1` is silent, `b := 2` is "Cannot convert type 'SINT' to type 'BOOL'");
 *   - any other integer is its narrowest type (`integerLiteralType`) — `t := 5` is "Cannot convert type 'SINT' to type 'TIME'";
 *   - a real literal is LREAL — `i := 1.5` is "Cannot convert type 'LREAL' to type 'INT'", and into REAL or LREAL it
 *     converts silently (a narrowing, never an error).
 * The WARNING checks keep `literalCheckType`: a literal's sign-change and loss warnings are measured only for integer
 * targets.
 */
export function literalErrorType(value: Expr, target: Type): Type | undefined {
  const negated = value.kind === "unary" && value.op === "-"
  const lit = negated ? value.operand : value
  if (lit.kind !== "literal") return undefined
  if (lit.literalKind === "real" && typeof lit.value === "number") return elementaryRef(REAL_LITERAL_TYPE)
  if (lit.literalKind !== "int" || typeof lit.value !== "bigint") return undefined
  const v = negated ? -lit.value : lit.value
  if (target.kind === "elementary" && target.elem.family === "bool") {
    if (v === 0n || v === 1n) return undefined
  } else {
    const range = target.kind === "elementary" && ["int", "bitstring"].includes(target.elem.family) ? target.elem.range : undefined
    if (range !== undefined && v >= range.min && v <= range.max) return undefined
  }
  const t = integerLiteralType(v)
  return t === undefined ? undefined : elementaryTypeRef(t)
}

/**
 * A literal's OWN type — the one its prefix or kind decides (`INT#5`, `LTIME#1S`, `LDT#…`, a string). An untyped
 * integer or real takes its type from context, so it is UNKNOWN here; lowering adopts the context, and the checks use
 * `literalCheckType`/`literalErrorType`. Shared with the transpiler, which had its own copy of the date/time prefixes.
 */
export function literalType(lit: Literal): Type {
  switch (lit.literalKind) {
    case "string":
      return elementaryRef("STRING")
    case "wstring":
      return elementaryRef("WSTRING")
    case "bool":
      return elementaryRef("BOOL")
    case "time":
      // The AST gives `T#` and `LTIME#` one literalKind; the prefix decides. Typed TIME, `lt := LTIME#1S` was a false
      // positive and `t := LTIME#1S` was silent (gap 8, conformance `cc_ltime_literal_into_time`).
      // (`LTIME#` only: the lexer reads `LT` as the less-than keyword, and an `LT#` prefix was never measured)
      return elementaryRef(/^LTIME#/i.test(lit.text) ? "LTIME" : "TIME")
    // An `L` prefix (`LDATE#`, `LTOD#`/`LTIME_OF_DAY#`, `LDT#`/`LDATE_AND_TIME#`) is the 64-bit type. These were typed
    // DATE/TOD/DT whatever the prefix, while lowering typed them right (consolidate-lsp-structure A2).
    case "date":
      return elementaryRef(lit.prefix?.startsWith("L") ? "LDATE" : "DATE")
    case "tod":
      return elementaryRef(lit.prefix?.startsWith("L") ? "LTOD" : "TOD")
    case "datetime":
      return elementaryRef(lit.prefix?.startsWith("L") ? "LDT" : "DT")
    case "typed": {
      // `BYTE#170` / `INT#5` → the type prefix. `16#FF` (numeric base) has no type prefix → skip.
      const prefix = lit.prefix ?? ""
      // A CHARACTER literal is the exception: `UCHAR#'A'` is a character CODE, and CODESYS types it UDINT rather
      // than by its prefix — `bChar : BYTE := UCHAR#'A'` is "Cannot convert type 'UDINT' to type 'BYTE'"
      // (conformance `operand_uchar_literal`). Only UCHAR is measured; another char prefix keeps its own name.
      if (/^UCHAR$/i.test(prefix)) return elementaryRef("UDINT")
      return /^[A-Za-z_]/.test(prefix) ? elementaryRef(prefix) : UNKNOWN
    }
    default:
      // int / real / address literals are context-dependent width — skip (conservative).
      return UNKNOWN
  }
}

/**
 * A `+` of two integer literals typed alike folds into the narrowest type of their signedness, from their width up, that
 * holds the sum (conformance `cc_typed_fold_*`, `typed_literal_constant_fold`): USINT#200 + USINT#100 is UINT (a change of
 * sign into INT), INT#30000 + INT#30000 is DINT ("Cannot convert type 'DINT' to type 'INT'"), SINT#100 + SINT#100 is INT
 * and USINT#1 + USINT#2 stays USINT. Other operators, bit strings and a typed-plus-untyped pair are unmeasured.
 */
export function typedLiteralSum(e: BinaryExpr, l: Type, r: Type): Type | undefined {
  const { left, right } = e
  if (left.kind !== "literal" || right.kind !== "literal" || left.literalKind !== "typed" || right.literalKind !== "typed") return undefined
  if (typeof left.value !== "bigint" || typeof right.value !== "bigint") return undefined
  if (l.kind !== "elementary" || r.kind !== "elementary" || l.elem.family !== "int" || canonicalElem(l.name) !== canonicalElem(r.name)) return undefined
  const sum = left.value + right.value
  const order = [8, 16, 32, 64].map((bits) => integerOfWidth(bits, l.elem.signed === true))
  const fits = order.find((t) => t.bits >= l.elem.bits && sum >= t.range!.min && sum <= t.range!.max)
  return fits === undefined ? undefined : elementaryRef(fits.name)
}
