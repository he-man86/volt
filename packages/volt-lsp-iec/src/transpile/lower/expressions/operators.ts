/**
 * The operators with their promotion rules: unary and binary, the null compares, the STRING compare, a duration
 * scaled by an integer, and an all-constant expression folded.
 */

import type { IrBinOp, IrExpr } from "../../ir/index.js"
import type { Lowering } from "../core/lowering.js"
import type { Expr } from "../../../frontend/syntax/index.js"
import {
  checkedNegationType,
  elementaryRef,
  elementaryTypeRef,
  elemOf,
  inferExprType,
  integerLiteralType,
  inTypeGroup,
  isIntegerType,
  narrowDateWideDuration,
  negativeLiteralComparisonTarget,
  promoteForRuntime,
  type Type,
  unparenthesised,
  untypedNumberValue,
} from "../../../frontend/types/index.js"
import { lowerExpr } from "./expressions.js"
import { convert } from "../values/convert.js"
import { adrDifference } from "../builtins/sizeof.js"
import { pointerCompare } from "../pointers/address.js"
import { calendarArithmetic } from "./calendar.js"
import { lowerPlace } from "../places/places.js"
import { foldConstant, foldsToConstant } from "../values/fold.js"
import { meet } from "../values/promote.js"
import { EXEC_ORACLE_DIALECT } from "../conditions.js"

/** ST binary operators → IR opcodes. A name a backend never has to interpret. `**` and `&` are absent: neither is an
 *  operator in CODESYS, and the parser refuses both (`parse/expression` `REFUSED_OPERATORS`), so no tree holds one. */
const BIN_OPS: Readonly<Record<string, IrBinOp>> = {
  "+": "add",
  "-": "sub",
  "*": "mul",
  "/": "div",
  MOD: "mod",
  "=": "eq",
  "<>": "ne",
  "<": "lt",
  "<=": "le",
  ">": "gt",
  ">=": "ge",
  AND: "and",
  OR: "or",
  XOR: "xor",
  AND_THEN: "and_then",
  OR_ELSE: "or_else",
}

export const COMPARISONS: ReadonlySet<IrBinOp> = new Set(["eq", "ne", "lt", "le", "gt", "ge"])

/** The operators whose operands are promoted (see `promoted`). Arithmetic is measured, and so are AND/OR/XOR:
 *  `minus1 AND 255` with `minus1 : SINT := -1` stored into an INT is 255 — the AND happens in DINT, after the -1
 *  sign-extends (conformance `bitwise_on_narrow_types`). A comparison is included because widening both sides can
 *  never change its answer, while a narrow compare against an out-of-range literal would. Unary NOT is NOT
 *  promoted — `NOT u255` with `u255 : USINT` stored into a DINT is 0 — and it is not a binary operator anyway.
 *  On BOOL operands `promoted` is the identity, so AND/OR/XOR on BOOLs are untouched. */
export const LIFTED: ReadonlySet<IrBinOp> = new Set([...COMPARISONS, "add", "sub", "mul", "div", "mod", "and", "or", "xor"])

/** `-x`, `NOT x`, `+x`: a negative literal as the constant it is; otherwise the operator, on an operand it has a meaning for. */
export function lowerUnary(lw: Lowering, e: Extract<Expr, { kind: "unary" }>, expected: Type | undefined): IrExpr | undefined {
  if (e.op === "+") return lowerExpr(lw, e.operand, expected)
  if (e.op !== "-" && e.op !== "NOT") return lw.bail("unary-op", `unary ${e.op}`, e.span)
  // A NEGATIVE LITERAL IS A CONSTANT, typed as the literal it is — not a runtime negation of the positive one.
  // As a `neg` node it counted as a variable: `MAX(-5, 3000000000)` met in DINT and answered -5, and
  // `-2000000000 - 2000000000` computed in DINT instead of folding at LINT (conformance
  // `negative_literal_constant_fold`, LIVE: 3000000000 and -4000000000).
  const literal = e.operand
  if (e.op === "-" && literal.kind === "literal" && (literal.literalKind === "int" || literal.literalKind === "real")) {
    const v = literal.value
    if (typeof v === "bigint" || typeof v === "number") return lowerExpr(lw, { ...literal, value: -v, span: e.span }, expected)
  }
  const operand = lowerExpr(lw, e.operand, expected)
  if (operand === undefined) return undefined
  // THE OPERAND HAS TO BE A TYPE THE OPERATOR HAS A MEANING FOR. It was not checked, so `-s` on a STRING, `NOT s`
  // on a STRING and `-b` on a BOOL all lowered CLEANLY and then threw inside the interpreter ("expected a number,
  // got string") — where the rule for this component is that invalid input ends in a LowerDiagnostic and never a
  // throw. The emitted Rust would have been worse: no diagnostic, and a cast that means whatever it means.
  //
  // CODESYS rejects all three, so nothing legal is lost. `-` takes a number or a duration (negating a TIME is
  // arithmetic on its milliseconds); `NOT` takes a BOOL or a bit string, which is the set the branch below
  // already assumes when it picks a width.
  const family = elemOf(operand.type)?.family
  // A BITSTRING NEGATES. The recordings say so outright: `cc_neg_word_into_word` BUILDS (warning only, about the
  // implicit signed-to-unsigned store) and `cc_neg_byte_into_byte` fails on the STORE — "Cannot convert type
  // '''INT''' to type '''BYTE'''" — which means the negation itself was fine and produced an INT. Excluding bitstrings
  // here refused two fixtures the vendor compiles.
  // NOT a TIME. `unary_minus_on_time` asked CODESYS on 2026-09-18 and it does not compile: "Cannot convert type
  // 'DINT' to type 'TIME' | Cannot convert type 'TIME' to type 'DINT'". Negating a duration was admitted here on
  // the reasoning that a duration is arithmetic on its milliseconds, and the vendor simply does not allow it —
  // which is why the fixture was written rather than the reasoning trusted.
  const negatable = family === "int" || family === "real" || family === "bitstring"
  const invertible = family === "bool" || family === "bitstring" || family === "int"
  if (e.op === "-" && !negatable)
    return lw.bail("unary-op", `unary minus on a ${operand.type.kind === "elementary" ? operand.type.name : operand.type.kind}`, e.span)
  if (e.op === "NOT" && !invertible)
    return lw.bail("unary-op", `NOT on a ${operand.type.kind === "elementary" ? operand.type.name : operand.type.kind}`, e.span)
  // `NOT x` is not promoted — `NOT u255` with `u255 : USINT` into a DINT is 0 — and on a SIGNED integer it is the bit
  // string of its width: NOT of INT 5 into a DINT is 65530, of SINT 0 into an INT 255, of DINT 0 into a LINT
  // 4294967295, and back into an INT it is -6 (conformance `not_result_width`, `cc_not_int_into_dint`). It kept the
  // signed type, so the widening store sign-extended: 65535 read as -1. `-x` does promote, like the arithmetic it is
  // — `-sMin` with `sMin : SINT := -128` is 128, `-iMin` with `iMin : INT := -32768` into a DINT is 32768, and a DINT's
  // minimum still negates to itself even into a LINT (conformance `unary_minus_at_the_edge`).
  if (e.op === "NOT") {
    const signed = operand.type.kind === "elementary" && operand.type.elem.family === "int" && operand.type.elem.signed
    const bits = signed && operand.type.kind === "elementary" ? operand.type.elem.bits : 0
    const type = signed ? elementaryRef(({ 8: "BYTE", 16: "WORD", 32: "DWORD", 64: "LWORD" } as Record<number, string>)[bits]!) : operand.type
    return { kind: "unary", op: "not", operand: convert(operand, type), type, span: e.span }
  }
  // AND IT NEGATES SIGNED. `promoteForRuntime` never changes signedness at 32/64 bits, so `-u` on a UDINT computed in
  // UDINT: into a LINT it was 4294967291 and `-u < 0` FALSE. CODESYS negates in the signed integer of the operand's
  // width — DINT for UDINT/DWORD, LINT for ULINT/LWORD (`uop_neg_*`), and `-udMax` is 1 (conformance
  // `unary_minus_unsigned_widened`).
  const type = checkedNegationType(promoteForRuntime(operand.type))
  return { kind: "unary", op: "neg", operand: convert(operand, type), type, span: e.span }
}

/** A binary operator: a pointer or interface null compare, an ADR difference, a STRING compare, calendar arithmetic, or
 *  arithmetic and comparison in the operands' promoted meet. */
export function lowerBinary(lw: Lowering, e: Extract<Expr, { kind: "binary" }>): IrExpr | undefined {
  const nullCompare = pointerNullCompare(lw, e)
  if (nullCompare !== null) return nullCompare
  // two addresses compared or ordered (model 3, design.md §3.3 step 4d)
  const addresses = pointerCompare(lw, e)
  if (addresses !== null) return addresses
  if (e.op === "-") {
    const difference = adrDifference(lw, e)
    if (difference !== undefined) return difference ?? undefined
  }
  const op = BIN_OPS[e.op]
  if (op === undefined) return lw.bail("binary-op", `operator ${e.op}`, e.span)
  // Operands type EACH OTHER, never the surrounding context. `rate := n / 2` with `n : INT` divides in
  // INT and converts the RESULT — propagating REAL inward would quietly turn 3 into 3.5, which is a
  // different program. The context reaches a literal only when there is no typed operand to meet.
  const left = lowerExpr(lw, e.left)
  if (left === undefined) return undefined
  const right = lowerExpr(lw, e.right, left.kind === "const" ? undefined : left.type)
  if (right === undefined) return undefined
  const strings = stringCompare(lw, e, op, left, right)
  if (strings !== null) return strings
  // A 32-bit date ± an LTIME is ULINT arithmetic CODESYS refuses ("Cannot convert type 'LTIME' to type 'ULINT'",
  // `tr_40_*`); it used to narrow the duration into the date's 32 bits before scaling.
  if ((op === "add" || op === "sub") && narrowDateWideDuration(elemOf(left.type)?.name ?? "", elemOf(right.type)?.name ?? ""))
    return lw.bail("calendar-width", "a 32-bit date plus or minus an LTIME", e.span)
  // BEFORE the constant retyping below: `dt + T#1S` would otherwise stamp the 1000-ms literal as a DT — 1000 s.
  const calendar = calendarArithmetic(op, left, right, e.span)
  if (calendar !== undefined) return calendar
  return arithmetic(lw, e, op, left, right)
}

/** `p = 0` / `p <> 0` on a POINTER or an interface — null is 0; `null` when `e` is no such compare. */
function pointerNullCompare(lw: Lowering, written: Extract<Expr, { kind: "binary" }>): IrExpr | undefined | null {
  // `p = 0` / `p <> 0` on a POINTER — null is 0 (conformance `keyword_null_pointer_init`). A REFERENCE is read through
  // like any other use, so `r = 0` compares its target: this took references too and tested the stored index, where
  // `r = m - 5` (the same comparison) dereferenced — measured only for a pointer (transpiler review 2026-09-15).
  // `0 = p` / `0 <> p` is the same compare, the zero normalized to the right (conformance `pointer_zero_on_left_compare`,
  // `_local`: both read as CODESYS answers them; refused `pointer-value` before transpile-restructure 4.13 (c)).
  const zeroLeft = written.left.kind === "literal" && written.left.value === 0n && written.right.kind !== "literal"
  const e = zeroLeft ? { ...written, left: written.right, right: written.left } : written
  if ((e.op !== "=" && e.op !== "<>") || e.right.kind !== "literal" || e.right.value !== 0n) return null
  const kind = inferExprType(e.left, lw.scope, lw.project).kind
  // an interface is null the same way (conformance `itf_call_dispatches_on_instance`)
  if (kind !== "pointer" && kind !== "interface") return null
  const place = lowerPlace(lw, e.left)
  if (place === undefined) return undefined
  const zero: IrExpr = { kind: "const", value: 0n, type: place.type, span: e.right.span }
  const loaded: IrExpr = { kind: "load", place, type: place.type, span: e.left.span }
  return { kind: "binary", op: e.op === "=" ? "eq" : "ne", left: loaded, right: zero, type: elementaryRef("BOOL"), span: e.span }
}

/** A value of a string type. */
const isStringValue = (x: IrExpr): boolean => {
  const t = elemOf(x.type)
  return t !== undefined && inTypeGroup("ANY_STRING", t)
}

/** Two STRINGs compared as they are, byte by byte; anything else on a STRING refused; `null` when neither side is one. */
function stringCompare(lw: Lowering, e: Extract<Expr, { kind: "binary" }>, op: IrBinOp, left: IrExpr, right: IrExpr): IrExpr | undefined | null {
  // Two STRINGs compare as they are, byte by byte — never converted to one capacity first, which would cut the
  // longer one and make 'abc' = 'abcd' TRUE. Measured: 'abc' < 'b' and 'A' < 'a' (conformance `string_compare`).
  if (!isStringValue(left) && !isStringValue(right)) return null
  // Anything else on a STRING does not compile — `'x' + 'y'` is "Cannot convert type 'STRING' to type 'ANY_NUM'"
  // (`string_arithmetic_rejected`) — so this refusal only keeps lowering total.
  if (!COMPARISONS.has(op) || !isStringValue(left) || !isStringValue(right))
    return lw.bail("string-op", `operator ${e.op} on a STRING`, e.span)
  // A STRING and a WSTRING do not compare — "Cannot compare type 'STRING' with type 'WSTRING'"
  // (`string_wstring_mixing`, transpile-review 38): neither converts into the other implicitly.
  if (elemOf(left.type)!.name !== elemOf(right.type)!.name)
    return lw.bail("string-op", `a ${elemOf(left.type)!.name} compared with a ${elemOf(right.type)!.name}`, e.span)
  return { kind: "binary", op, left, right, type: elementaryRef("BOOL"), span: e.span }
}

/** Arithmetic and comparison: a duration scaled by an integer in its own type; a literal beside a variable in the
 *  promoted type; an all-constant integer expression folded at full width; a REAL expression over constants folded. */
function arithmetic(lw: Lowering, e: Extract<Expr, { kind: "binary" }>, op: IrBinOp, l: IrExpr, r: IrExpr): IrExpr | undefined {
  let left = l
  let right = r
  // A duration × or ÷ an integer (and an integer × a duration) computes in the duration's type: `T#1S * 3` is
  // T#3S and `T#1S / 4` is T#250MS (conformance `time_multiply_divide`). A duration has no widening rank, so
  // without this `commonType` would find no common type.
  //
  // BEFORE THE CONSTANT RETYPING BELOW, for the same reason `calendarArithmetic` is: when the DURATION is the
  // constant and the integer is a variable, `beside` had already stamped the TIME constant with the promoted
  // INTEGER type, so `isDuration(left.type)` was false and the expression computed in signed DINT.
  // `t := T#49D17H2M47S295MS / n` with `n : INT := 2` gave 0 in both backends where CODESYS answers
  // 2147483647, and `(T#1S * n) > t` was refused `type-unknown` while the identical expression with the
  // duration in a VARIABLE lowered. The two backends agreed with each other and both differed from the
  // vendor — which is why only a measurement could find it.
  const isDuration = (t: Type): boolean => elemOf(t)?.family === "time"
  const isIntegral = (t: Type): boolean => isIntegerType(elemOf(t)?.name ?? "")
  if ((op === "mul" || op === "div") && isDuration(left.type) && isIntegral(right.type)) right = convert(right, left.type)
  else if (op === "mul" && isIntegral(left.type) && isDuration(right.type)) left = convert(left, right.type)

  if (COMPARISONS.has(op))
    [left, right] = [negativeBesideUnsigned(e.left, left, right), negativeBesideUnsigned(e.right, right, left)]
  const met = meet(lw, [left, right], { kind: "binary", lift: LIFTED.has(op), operator: e.op }, e.span)
  if (met === undefined) return undefined
  ;[left, right] = met.operands as [IrExpr, IrExpr]
  const operands = met.type
  const type = COMPARISONS.has(op) ? elementaryRef("BOOL") : operands
  // A REAL expression over constants is FOLDED — wide, rounded once at its end — not computed step by step in
  // float32: `(CBig + 1) - CBig` with CBig : REAL := 16777216 is 1, the value its initializer twin folds to
  // (conformance `real_constant_fold_width`, LIVE).
  const real = elemOf(type)
  if (real?.family === "real" && foldsToConstant(lw, e)) {
    const folded = foldConstant(lw, e)
    if (typeof folded === "number") return { kind: "const", value: real.bits === 32 ? Math.fround(folded) : folded, type, span: e.span }
  }
  return { kind: "binary", op, left: convert(left, operands), right: convert(right, operands), type, span: e.span }
}

/**
 * An untyped NEGATIVE integer literal compared with a narrower UNSIGNED operand converts INTO the type
 * `negativeLiteralComparisonTarget` names (rule LT12) on the exec oracle's dialect (`EXEC_ORACLE_DIALECT`, CODESYS — the
 * one whose run is recorded): the unsigned type of the literal's own width or 32 bits, so `ui > -1` with `ui : UINT := 3`
 * is FALSE — the -1 is 4294967295 (`lt_literal_negative_in_comparison_unsigned`, recorded 2026-10-03, the build warning
 * "signed Type 'SINT' to unsigned Type 'UDINT'"); -200, -40000 (UDINT) and -3000000000 (ULINT) compare FALSE as well, and so
 * does a parenthesised -1, while the constant expression 0 - 1 compares as a number (`tr_6_negative_*_beside_unsigned`,
 * 2026-10-09). Compared as numbers it was TRUE. `written` is the operand's source, `lowered` its IR, `other` the other
 * operand's IR; anything else comes back as it was.
 *
 * An explicit `convert` node, not the constant retyped: the literal stays the -1 it is written as (the IR fold and the AST
 * fold agree on it, `fold-agreement.test.ts`), the conversion is the vendor's, and the pair then meets in UDINT — retyped,
 * `beside` widened the 4294967295 past the UDINT the vendor compares in.
 */
function negativeBesideUnsigned(written: Expr, lowered: IrExpr, other: IrExpr): IrExpr {
  const value = untypedNumberValue(unparenthesised(written))
  if (typeof value !== "bigint" || value >= 0n || lowered.kind !== "const" || other.kind === "const") return lowered
  const operand = elemOf(other.type)
  if (operand === undefined) return lowered
  const into = negativeLiteralComparisonTarget(operand, value, EXEC_ORACLE_DIALECT)
  const own = integerLiteralType(value)
  if (into === undefined || own === undefined) return lowered
  // the literal as its own type (SINT for -1), not the neighbour's it was lowered beside
  const literal: IrExpr = { ...lowered, type: elementaryTypeRef(own) }
  return { kind: "convert", value: literal, type: elementaryTypeRef(into), span: lowered.span }
}
