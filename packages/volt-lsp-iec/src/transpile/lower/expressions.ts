/**
 * Expressions → IR: operators with their promotion rules, calendar arithmetic, and the dispatch to calls and places.
 */
import type { Expr, Span } from "../../syntax/index.js"
import {
  commonType,
  elementaryRef,
  elemOf,
  inferExprType,
  inTypeGroup,
  isIntegerType,
  promoteForRuntime,
  temporalResultType,
  type Type,
  UNKNOWN,
} from "../../types/index.js"
import type { IrBinOp, IrExpr } from "../ir/index.js"
import type { Lowering } from "./lowering.js"
import { adopt, convert, retype } from "./convert.js"
import {
  calendarOf,
  contextLiteralType,
  durationOf,
  enumConstant,
  stringLiteralText,
  typedRealOf,
} from "./constants.js"
import { lowerPlace } from "./places.js"
import { loadValue } from "./pointers.js"
import { adrDifference } from "./bytes.js"
import { lowerBuiltin } from "./builtins.js"
import { lowerPropertyGet } from "./calls.js"

/** ST binary operators → IR opcodes. A name a backend never has to interpret. `**` and `&` are absent on purpose: the
 *  parser accepts them (the LSP reports them), but neither is an operator in CODESYS, so they reach `binary-op`. */
export const BIN_OPS: Readonly<Record<string, IrBinOp>> = {
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

/**
 * Lower one expression to a node with a DEFINITE type.
 *
 * `inferExprType` answers the LSP's question — "what can I safely say this is?" — and returns `UNKNOWN`
 * wherever a wrong answer would be a false positive (`REAL + INT` among them). A backend cannot emit
 * `UNKNOWN`, so the operator types are computed here from the operand types, over the SAME widening lattice
 * `types/elementary` owns (family + rank). Inference still answers the leaves. An expression that lands on
 * `UNKNOWN` anyway is a reported gap, never untyped IR.
 */
export function lowerExpr(lw: Lowering, e: Expr, expected?: Type): IrExpr | undefined {
  switch (e.kind) {
    case "literal": {
      const v = e.value
      if (v === undefined) return lw.bail("bad-literal", `malformed literal ${e.text}`, e.span)
      const typed = durationOf(e) ?? calendarOf(e) ?? typedRealOf(e)
      if (typed !== undefined) return { kind: "const", value: typed.value, type: typed.type, span: e.span }
      if (typeof v === "string") {
        const text = stringLiteralText(lw, e)
        if (text === null) return undefined
        const base = elementaryRef(e.literalKind === "wstring" ? "WSTRING" : "STRING")
        return { kind: "const", value: text, type: { ...base, length: text.length } as Type, span: e.span }
      }
      // An IEC integer literal has NO intrinsic type — it takes the one the context requires, which is
      // exactly why `inferExprType` returns UNKNOWN for it. Context first; the narrowest type that holds
      // the value otherwise, so a bare literal still meets its neighbour cleanly.
      const type = contextLiteralType(e, expected)
      if (type === UNKNOWN) return lw.bail("type-unknown", `the type of ${e.text} is not resolvable`, e.span)
      return retype({ kind: "const", value: typeof v === "object" ? v.ns : v, type, span: e.span }, type)
    }
    case "ident_expr": {
      // `P` bare inside an FB, when P is its PROPERTY: the getter (conformance `state_property_get_set`)
      const property = lowerPropertyGet(lw, e)
      if (property !== null) return property
      const enumValue = lw.holds(e.name) ? undefined : enumConstant(lw, e)
      if (enumValue !== undefined) return enumValue
      const place = lowerPlace(lw, e)
      if (place === undefined) return undefined
      if (place.type === UNKNOWN) return lw.bail("type-unknown", `the type of ${e.name} is not resolvable`, e.span)
      return loadValue(lw, place, e.span)
    }
    case "deref": {
      const place = lowerPlace(lw, e)
      return place && loadValue(lw, place, e.span)
    }
    case "paren":
      return lowerExpr(lw, e.inner, expected)
    case "unary": {
      if (e.op === "+") return lowerExpr(lw, e.operand, expected)
      if (e.op !== "-" && e.op !== "NOT") return lw.bail("unary-op", `unary ${e.op}`, e.span)
      const operand = lowerExpr(lw, e.operand, expected)
      if (operand === undefined) return undefined
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
      const type = promoteForRuntime(operand.type)
      return { kind: "unary", op: "neg", operand: convert(operand, type), type, span: e.span }
    }
    case "binary": {
      // `p = 0` / `p <> 0` on a POINTER — null is 0 (conformance `keyword_null_pointer_init`). A REFERENCE is read through
      // like any other use, so `r = 0` compares its target: this took references too and tested the stored index, where
      // `r = m - 5` (the same comparison) dereferenced — measured only for a pointer (transpiler review 2026-09-15).
      if ((e.op === "=" || e.op === "<>") && e.right.kind === "literal" && e.right.value === 0n) {
        const kind = inferExprType(e.left, lw.scope, lw.project).kind
        if (kind === "pointer") {
          const place = lowerPlace(lw, e.left)
          if (place === undefined) return undefined
          const zero: IrExpr = { kind: "const", value: 0n, type: place.type, span: e.right.span }
          const loaded: IrExpr = { kind: "load", place, type: place.type, span: e.left.span }
          return { kind: "binary", op: e.op === "=" ? "eq" : "ne", left: loaded, right: zero, type: elementaryRef("BOOL"), span: e.span }
        }
      }
      if (e.op === "-") {
        const difference = adrDifference(lw, e)
        if (difference !== undefined) return difference ?? undefined
      }
      const op = BIN_OPS[e.op]
      if (op === undefined) return lw.bail("binary-op", `operator ${e.op}`, e.span)
      // Operands type EACH OTHER, never the surrounding context. `rate := n / 2` with `n : INT` divides in
      // INT and converts the RESULT — propagating REAL inward would quietly turn 3 into 3.5, which is a
      // different program. The context reaches a literal only when there is no typed operand to meet.
      let left = lowerExpr(lw, e.left)
      if (left === undefined) return undefined
      let right = lowerExpr(lw, e.right, left.kind === "const" ? undefined : left.type)
      if (right === undefined) return undefined
      // Two STRINGs compare as they are, byte by byte — never converted to one capacity first, which would cut the
      // longer one and make 'abc' = 'abcd' TRUE. Measured: 'abc' < 'b' and 'A' < 'a' (conformance `string_compare`).
      const isString = (x: IrExpr): boolean => {
        const t = elemOf(x.type)
        return t !== undefined && inTypeGroup("ANY_STRING", t)
      }
      if (isString(left) || isString(right)) {
        // Anything else on a STRING does not compile — `'x' + 'y'` is "Cannot convert type 'STRING' to type 'ANY_NUM'"
        // (`string_arithmetic_rejected`) — so this refusal only keeps lowering total.
        if (!COMPARISONS.has(op) || !isString(left) || !isString(right))
          return lw.bail("string-op", `operator ${e.op} on a STRING`, e.span)
        return { kind: "binary", op, left, right, type: elementaryRef("BOOL"), span: e.span }
      }
      // BEFORE the constant retyping below: `dt + T#1S` would otherwise stamp the 1000-ms literal as a DT — 1000 s.
      const calendar = calendarArithmetic(op, left, right, e.span)
      if (calendar !== undefined) return calendar
      // Arithmetic and comparison happen in the PROMOTED type (see `promoteForRuntime`), so a literal beside a narrow
      // variable takes that type too — else `si + 1000` would wrap the 1000 into SINT before promoting.
      const lift = LIFTED.has(op) ? promoteForRuntime : (t: Type): Type => t
      if (left.kind === "const" && right.kind !== "const") left = adopt(left, lift(right.type))
      else if (right.kind === "const" && left.kind !== "const") right = adopt(right, lift(left.type))
      else if (left.kind === "const" && right.kind === "const") {
        // An ALL-constant integer expression folds at FULL width and then converts: `i := 100 + 100` is 200 and
        // `li := 2000000000 + 2000000000` is 4000000000 (conformance `constant_arithmetic_width`). It does not take
        // the context's type either — `x : REAL := 7 / 2` is 3, not 3.5 (`all_constant_division_in_real_context`);
        // this used to retype both sides to the context. LINT is the widest the IR can type.
        if (elemOf(left.type)?.family === "int") left = retype(left, elementaryRef("LINT"))
        if (elemOf(right.type)?.family === "int") right = retype(right, elementaryRef("LINT"))
      }
      // A duration × or ÷ an integer (and an integer × a duration) computes in the duration's type: `T#1S * 3` is
      // T#3S and `T#1S / 4` is T#250MS (conformance `time_multiply_divide`). A duration has no widening rank, so
      // without this `commonType` would find no common type.
      const isDuration = (t: Type): boolean => elemOf(t)?.family === "time"
      const isIntegral = (t: Type): boolean => isIntegerType(elemOf(t)?.name ?? "")
      if ((op === "mul" || op === "div") && isDuration(left.type) && isIntegral(right.type)) right = convert(right, left.type)
      else if (op === "mul" && isIntegral(left.type) && isDuration(right.type)) left = convert(left, right.type)
      const meet = commonType(left.type, right.type)
      if (meet === UNKNOWN) return lw.bail("type-unknown", `the operands of ${e.op} have no common type`, e.span)
      const operands = lift(meet)
      const type = COMPARISONS.has(op) ? elementaryRef("BOOL") : operands
      return { kind: "binary", op, left: convert(left, operands), right: convert(right, operands), type, span: e.span }
    }
    case "call":
      return lowerBuiltin(lw, e)
    case "member":
    case "index": {
      // `anyArg.diSize` — an ANY input's size, which the call handed in as a hidden DINT (conformance `state_any_input_sizes`)
      if (e.kind === "member" && e.base.kind === "ident_expr" && lw.anyInputs.has(e.base.name.toUpperCase())) {
        const slot = lw.localByName.get(e.base.name.toUpperCase())
        if (e.member.name.toUpperCase() !== "DISIZE" || slot === undefined)
          return lw.bail("any-input", `${e.base.name}.${e.member.name} of an ANY input is not measured`, e.span)
        const type = lw.localSlots[slot]!.type
        return { kind: "load", place: { slot, path: [], type, span: e.span, root: "local" }, type, span: e.span }
      }
      const enumValue = e.kind === "member" ? enumConstant(lw, e) : undefined
      if (enumValue !== undefined) return enumValue
      // `x.%B3` / `.%W1` / `.%D0` — partial access, a byte, word or double word of an unsigned integer counted from the
      // low end: DWORD 16#DEADBEEF has %W1 16#DEAD and %B3 16#DE (conformance `operand_partial_word_in_dword`). The slice
      // is the value shifted down and narrowed. `.%X` (a bit), a signed source and a store into a slice are not measured.
      const partial = e.kind === "member" ? /^%([XBWD])(\d+)$/i.exec(e.member.name) : null
      if (e.kind === "member" && partial !== null) {
        const source = lowerExpr(lw, e.base)
        if (source === undefined) return undefined
        const elem = source.type.kind === "elementary" ? source.type.elem : undefined
        const width = ({ B: 8, W: 16, D: 32 } as Record<string, number>)[partial[1]!.toUpperCase()]
        const at = Number(partial[2])
        const unsigned = elem !== undefined && (elem.family === "bitstring" || (elem.family === "int" && !elem.signed))
        if (width === undefined || !unsigned || (at + 1) * width > elem.bits)
          return lw.bail("partial-access", `${e.member.name} of a ${source.type.kind === "elementary" ? source.type.name : source.type.kind} is not measured`, e.span)
        const slice = elementaryRef(({ 8: "BYTE", 16: "WORD", 32: "DWORD" } as Record<number, string>)[width]!)
        const count: IrExpr = { kind: "const", value: BigInt(at * width), type: elementaryRef("INT"), span: e.span }
        return convert({ kind: "builtin", name: "shr", args: [source, count], type: source.type, span: e.span }, slice)
      }
      // `inst.P` / `THIS^.P` on a PROPERTY: its getter, run on the instance
      const property = e.kind === "member" ? lowerPropertyGet(lw, e) : null
      if (property !== null) return property
      const place = lowerPlace(lw, e, e.kind === "member" ? "expr-member" : "expr-index")
      if (place === undefined) return undefined
      if (place.type === UNKNOWN) return lw.bail("type-unknown", "the type of a member is not resolvable", e.span)
      return loadValue(lw, place, e.span)
    }
    default:
      return lw.bail(`expr-${e.kind}`, `${e.kind} is not lowered yet`, e.span)
  }
}

/**
 * Date/time arithmetic, scaled between the units each type counts. Measured (conformance `date_*`, `dt_*`, `tod_*`):
 *   - a date ± a duration, or a duration + a date, converts the duration into the DATE'S unit by truncating division —
 *     `DT#1970-01-01-00:00:00 + T#1500MS` is one second — and computes in the date's width: `DT max + T#1S` wraps to the
 *     epoch, `D#2024-02-28 + T#1D` is D#2024-02-29, `DT - T#1S` steps back across a leap day;
 *   - a date - a date of the same type is the difference scaled into TIME (LTIME for the L variants):
 *     `D#2024-03-01 - D#2024-02-28` is T#2D, and the reverse wraps as a UDINT (4122167296 ms);
 *   - TOD is NOT reduced modulo a day: TOD#12:30:15.5 + T#12H stores 88215500 ms (the IDE only DISPLAYS 0:30:15.500).
 * A duration finer than its date (a TIME on an LDT) was not measured: undefined, so lowering reports it.
 */
export function calendarArithmetic(op: IrBinOp, left: IrExpr, right: IrExpr, span: Span): IrExpr | undefined {
  if (op !== "add" && op !== "sub") return undefined
  const [l, r] = [elemOf(left.type), elemOf(right.type)]
  const result = l && r && temporalResultType(op === "add" ? "+" : "-", l.name, r.name)
  if (result === undefined) return undefined
  const unit = (x: IrExpr): bigint | undefined => elemOf(x.type)?.tickNs
  const scale = (x: IrExpr, by: bigint, as: Type, how: "div" | "mul"): IrExpr =>
    by === 1n ? x : { kind: "binary", op: how, left: x, right: { kind: "const", value: by, type: as, span }, type: as, span }

  const type = elementaryRef(result)
  // a date ± a duration: the result is the date's type, and the date is whichever operand has it
  if (l?.name !== r?.name) {
    const [date, duration] = l?.name === result ? [left, right] : [right, left]
    const [dateUnit, durationUnit] = [unit(date), unit(duration)]
    if (dateUnit === undefined || durationUnit === undefined || dateUnit % durationUnit !== 0n) return undefined
    const step = scale(convert(duration, date.type), dateUnit / durationUnit, date.type, "div")
    return { kind: "binary", op, left: date, right: step, type: date.type, span }
  }
  // a date − the same date: the difference, scaled into its duration's unit
  const [leftUnit, durationUnit] = [unit(left), elemOf(type)?.tickNs]
  if (leftUnit === undefined || durationUnit === undefined) return undefined
  const difference: IrExpr = { kind: "binary", op: "sub", left, right, type: left.type, span }
  return scale(convert(difference, type), leftUnit / durationUnit, type, "mul")
}
