/**
 * THE OPERATORS' TYPING RULES — which operand families an operator takes, the type each operand converts into on the
 * way in, and the type a bit operator hands back. One home (openspec frontend-conformance design.md P6): the checks
 * keep only their messages, and the network-text reader asks here which boxes are comparisons and bit operators.
 */
import type { Dialect } from "../../syntax/index.js"
import type { TypeFamily } from "../elementary.js"
import { isIntegerType, isNumericType } from "../predicates.js"
import { elementaryType, inTypeGroup } from "../elementary.js"
import { elementaryTypeRef, type Type } from "../type.js"
import { integerOfWidth } from "../width.js"
import { narrowDateWideDuration } from "./temporal.js"

/** The arithmetic operators — they meet their operands (`checked.ts` `checkedMeetType`). */
export const ARITHMETIC_OPERATORS: ReadonlySet<string> = new Set(["+", "-", "*", "/", "MOD"])
/** The bitwise operators on two operands. */
export const BITWISE_OPERATORS: ReadonlySet<string> = new Set(["AND", "OR", "XOR"])
/** The comparisons — BOOL whatever their operands. */
export const COMPARISON_OPERATORS: ReadonlySet<string> = new Set(["=", "<>", "<", ">", "<=", ">="])

/** The comparisons as function-form boxes (a network's `GT`, `EQ` …): BOOL whatever their operands. */
export const COMPARISON_FUNCTIONS: ReadonlySet<string> = new Set(["GT", "GE", "LT", "LE", "EQ", "NE"])
/** The bit operators as function-form boxes: their result has their operands' bit-string type. */
export const BIT_OPERATOR_FUNCTIONS: ReadonlySet<string> = new Set(["AND", "OR", "XOR", "NOT"])

/**
 * Which operand of a same-width signed/unsigned pair converts, per operator (measured on CODESYS SP21, conformance
 * `cc_add_*`, `cc_max_*`, `cc_bitwise_*`, `cc_not_*`, `cc_compare_*`, `same_width_*`, `signed_unsigned_comparison`):
 *   `signed`       arithmetic (and MAX/MIN) meet in the SIGNED operand's type: the unsigned operand converts;
 *   `unsigned`     AND, OR, XOR (and NOT) meet in the UNSIGNED integer of the width: the signed operand converts;
 *   `signed-wide`  the six comparisons convert like arithmetic, but only where `comparisonConverts` says so.
 * Undefined for an operator nobody measured (the shifts, EXPT …).
 */
export function operandConversion(op: string): "signed" | "unsigned" | "signed-wide" | undefined {
  return ARITHMETIC_OPERATORS.has(op)
    ? "signed"
    : BITWISE_OPERATORS.has(op)
      ? "unsigned"
      : COMPARISON_OPERATORS.has(op)
        ? "signed-wide"
        : undefined
}

/** Does a comparison of a same-width signed/unsigned pair convert an operand at `bits`? On CODESYS only at 32 and 64
 *  bits — narrower operands promote and stay silent; TwinCAT at every width. */
export function comparisonConverts(bits: number, dialect: Dialect | undefined): boolean {
  return !(bits < 32 && dialect !== "twincat")
}

/** The families `-` converts its operand from, loudly. Integers, bit strings and reals are already what it computes in. */
const MINUS_CONVERTS: ReadonlySet<TypeFamily> = new Set(["bool", "time", "date", "string"])
/** The families `NOT` converts loudly. BOOL is absent: `NOT BOOL` is BOOL, so there is no conversion to report. */
const NOT_CONVERTS: ReadonlySet<TypeFamily> = new Set(["real", "string", "time", "date"])
/** …and the two it cannot produce an integer FROM, which it names by the generic family instead. */
const NOT_NAMES_ANY_BIT: ReadonlySet<TypeFamily> = new Set(["real", "string"])

/**
 * What a unary operator does to an operand of `family` on the way in: `none` — it is already the type the operator
 * computes in; `result` — it converts into the operator's result type; `ANY_BIT` — `NOT` on a REAL or a STRING, which
 * has no integer to produce and names the generic family (measured one operand type at a time, `fixtures/unary-operand.ts`).
 */
export function unaryOperandConversion(op: "-" | "NOT", family: TypeFamily): "none" | "result" | "ANY_BIT" {
  if (!(op === "-" ? MINUS_CONVERTS : NOT_CONVERTS).has(family)) return "none"
  return op === "NOT" && NOT_NAMES_ANY_BIT.has(family) ? "ANY_BIT" : "result"
}

/**
 * `NOT x`'s type: THE UNSIGNED INTEGER OF THE OPERAND'S WIDTH — for a bit string and a duration too, not only a signed
 * integer. Measured one type at a time (`uop_not_*`): `NOT BYTE` is USINT, `NOT WORD` is UINT, `NOT DWORD` and
 * `NOT TIME` and `NOT DATE` are UDINT, `NOT LWORD` is ULINT. BOOL is a logical NOT and stays BOOL; a REAL or a STRING
 * passes through (and is reported against ANY_BIT instead).
 */
export function notResultType(operand: Type): Type {
  const e = operand.kind === "elementary" ? operand.elem : undefined
  const widthed = e !== undefined && e.family !== "bool" && e.family !== "real" && e.family !== "string"
  return widthed && e.bits !== undefined ? elementaryTypeRef(integerOfWidth(e.bits, false)) : operand
}

/**
 * AND/OR/XOR COMPUTE IN THE UNSIGNED INTEGER OF THE OPERANDS' WIDTH. `out := a AND b` with LINT operands is three
 * warnings on CODESYS — one per operand going in, and one for the result coming back out into a signed destination
 * (`bit_{and,or,xor}_{sint,int,dint,lint}`). The unsigned integer both operands convert to, or undefined when the pair
 * is not two same-width integers with a signed one among them (BOOL operands are boolean logic and keep their type; a
 * bit string is already unsigned).
 */
export function bitwiseResultType(l: Type, r: Type): Type | undefined {
  const a = l.kind === "elementary" ? l.elem : undefined
  const b = r.kind === "elementary" ? r.elem : undefined
  if (a === undefined || b === undefined || a.bits !== b.bits) return undefined
  if (a.family !== "int" || b.family !== "int") return undefined
  if (a.signed !== true && b.signed !== true) return undefined
  // an integer is 8, 16, 32 or 64 bits wide, so the ladder answers every pair that reaches here
  return elementaryTypeRef(integerOfWidth(a.bits, false))
}

/** A string type by name — the table's ANY_STRING group. */
function isStringType(name: string): boolean {
  const facts = elementaryType(name)
  return facts !== undefined && inTypeGroup("ANY_STRING", facts)
}

/**
 * The operand-family rule of `+ - * / MOD` for two elementary operands (by name): what the compiler converts and
 * refuses, or undefined when the pair is fine or no rule was measured.
 *
 *   A BOOL OPERAND IS THE SAME ANSWER FOR ALL FIVE OPERATORS, MOD INCLUDED — the conversion of the BOOL into the other
 *   operand's type (`meet_bool_{plus,minus,times,div,mod}_int`, identical on both recordings 2026-09-20);
 *   a 32-bit date ± an LTIME, either order, is ULINT arithmetic CODESYS refuses (`tr_40_*`);
 *   MOD is integer-only, and names the offending operand — `REAL` for every floating one, either width;
 *   a string on the LEFT must become ANY_NUM; on the RIGHT of a number, that number's type (`cc_string_*`).
 */
export function operandFamilyRule(
  op: string,
  a: string,
  b: string,
): { kind: "convert"; from: string; to: string } | { kind: "mod-undefined"; type: string } | undefined {
  if (!ARITHMETIC_OPERATORS.has(op)) return undefined
  if (a === "BOOL" || b === "BOOL") return { kind: "convert", from: "BOOL", to: a === "BOOL" ? b : a }
  if ((op === "+" || op === "-") && narrowDateWideDuration(a, b)) return { kind: "convert", from: "LTIME", to: "ULINT" }
  if (op === "MOD") {
    if (isIntegerType(a) && isIntegerType(b)) return undefined
    const offending = !isIntegerType(a) ? a : b
    return { kind: "mod-undefined", type: offending === "LREAL" ? "REAL" : offending }
  }
  if (isNumericType(a) && isNumericType(b)) return undefined
  if (isStringType(a)) return { kind: "convert", from: a, to: "ANY_NUM" }
  if (isStringType(b) && isNumericType(a)) return { kind: "convert", from: b, to: a }
  return undefined
}
