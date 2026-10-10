/**
 * THE LOWERING'S CONSTANT FOLD — what lowering decides before the program runs: an expression folded over the front-end's
 * AST fold (`types/const`), an enumerator's value, a conversion of a constant, and the width an all-constant integer
 * expression folds at.
 */

import type { Lowering } from "../core/lowering.js"
import type { Expr } from "../../../frontend/syntax/index.js"
import type { IrExpr, IrPou, IrStmt, IrValue, Place } from "../../ir/index.js"
import { mapExprs } from "../../ir/walk.js"
import { constantValue, constValue, selectedArg } from "../../semantics/index.js"
import { enumConstant } from "./enums.js"
import {
  constEval,
  elementaryRef,
  type ElementaryType,
  elementaryTypeRef,
  isIntegral,
  parseConversionName,
  stringKind,
  type Type,
} from "../../../frontend/types/index.js"
import { isConstantCallee, oneArgument } from "../builtins/arity.js"
import { holdsEvery, sameType, stored, unchained } from "./convert.js"
import { targetOf } from "../../../frontend/symbols/index.js"

/** `asConstant`: `e` is a CONSTANT's own initializer; `declared`: the type of the declaration `e` initializes — see `constEval`. */
export function foldConstant(lw: Lowering, e: Expr, asConstant = false, declared?: ElementaryType): IrValue | undefined {
  // an enum value is a constant too — a CASE label `E_Mode.Busy:` or `Busy:`
  const enumValue = (e.kind === "ident_expr" && lw.holds(e.name)) || (e.kind !== "ident_expr" && e.kind !== "member") ? undefined : enumConstant(lw, e)
  if (enumValue?.kind === "const") return enumValue.value
  return constEval(e, lw.scope, asConstant, declared)
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
      if (e.callee.kind !== "ident_expr" || !isConstantCallee(e.callee.name, targetOf(lw.project))) return false
      return e.args.every((a) => !a.output && a.param === undefined && a.value !== undefined && foldsToConstant(lw, a.value))
    }
    default:
      return false
  }
}

/** `TO_USINT(x)` / `INT_TO_BYTE(x)` over a constant — the value stored at the target's width, as measured (design §11). */
function convertedConstant(lw: Lowering, e: Expr, depth: number): bigint | undefined {
  if (e.kind !== "call" || e.callee.kind !== "ident_expr") return undefined
  const written = oneArgument(e, { named: true, output: true })
  // THE ONE PARSER, not a seventh. This read the name with its own `/^(?:[A-Za-z]+_)?TO_([A-Za-z]+)$/` — in a
  // file that imports `parseConversionName` and uses it two functions below — and disagreed with it twice: no
  // `i` flag, so a lower-case `int_to_byte(5)` was not a conversion at all where ST is case-insensitive; and no
  // check on the SOURCE, so a project function named `FOO_TO_INT(5)` folded as though it converted, silently
  // yielding its argument. `parseConversionName` rejects both (`GO_TO_START` is the case its own doc names).
  // on the project's target, as the body reads the name (`lower/builtins/builtins.ts`): an initializer and a body answer a
  // platform conversion alike (`tr_b5_platform_conversion_initializers`, transpile-restructure 6.B.5)
  const conversion = parseConversionName(e.callee.name, targetOf(lw.project))
  if (written === undefined || conversion === undefined) return undefined
  const elem = conversion.to
  if (!(elem.family === "int" || elem.family === "bitstring")) return undefined
  const target = elementaryTypeRef(elem)
  const value = enumValueOf(lw, written, depth + 1)
  return typeof value === "bigint" ? (stored(value, target) as bigint) : undefined
}

/**
 * One enum value's written `:= …`. Beyond a plain constant it may name ANOTHER enum's value, and may convert it —
 * pro2193's `enumErrorSeverity` is `TO_USINT(L_IE1P.L_IE1P_SeverityLevel.No_Response)` throughout, which folded to
 * nothing while the namespace resolved to nothing and `constEval` folds no call. The conversion is folded here rather
 * than in `constEval`, whose consumers are the LSP's checks: this one knows the measured store (`stored` wraps at the
 * target's width), and only for an integer or bit-string target, which is all an enum value can be.
 */
export function enumValueOf(lw: Lowering, e: Expr, depth: number): bigint | number | boolean | undefined {
  if (depth > 8) return undefined
  const member = e.kind === "member" ? enumConstant(lw, e, depth + 1) : undefined
  if (member?.kind === "const") return member.value as bigint
  const converted = convertedConstant(lw, e, depth)
  if (converted !== undefined) return converted
  return constEval(e, lw.project)
}

const LINT_MAX = (1n << 63n) - 1n

/**
 * The type an ALL-constant integer expression folds at: LINT — wide enough that `2000000000 + 2000000000` is 4000000000
 * (conformance `constant_arithmetic_width`) — unless an operand holds a value only ULINT can: `18446744073709551615 > 5`
 * is TRUE and `16#FFFFFFFFFFFFFFFF / 16` is 16#0FFFFFFFFFFFFFFF (`const_literal_wider_than_lint`, LIVE). Folding
 * those at LINT wrapped them negative.
 */
export function integerFoldType(operands: readonly IrExpr[]): Type {
  const needsUlint = operands.some((o) => o.kind === "const" && typeof o.value === "bigint" && o.value > LINT_MAX)
  return elementaryRef(needsUlint ? "ULINT" : "LINT")
}

/** The builtins a fold may answer: pure value functions whose two backends compute alike. Not the math functions —
 *  the Rust takes the platform's libm there, which the interpreter does not reproduce (the edge layer's `not-run`) —
 *  nor the string or image ones. */
const FOLDED_BUILTINS: ReadonlySet<string> = new Set(["max", "min", "limit", "sel", "mux", "trunc", "shl", "shr", "rol", "ror", "abs"])

/**
 * AN ALL-CONSTANT EXPRESSION IS ITS VALUE (lean 2, transpile-restructure 7.2.2): a unary, binary, conversion or pure
 * builtin over constants becomes the constant it evaluates to — through the interpreter's own functions
 * (`semantics/fold.constantValue`), so both backends read the one answer they computed alike. Kept as it is: one that
 * FAULTS (`1 / 0` stops the task, and must still at run time), one whose value is no finite number or boolean (a NaN, an
 * infinity, a string), and one of a type a literal does not spell (an address).
 */
function foldedExpr(e: IrExpr): IrExpr {
  const selection = selected(e)
  if (selection !== e) return selection
  if (e.kind === "binary" && (e.op === "div" || e.op === "mod") && e.left.kind !== "const" && harmlessDivisor(e.op, e.right)) return { ...e, nonzeroDivisor: true }
  if (e.kind !== "unary" && e.kind !== "binary" && e.kind !== "convert" && !(e.kind === "builtin" && FOLDED_BUILTINS.has(e.name))) return e
  const operands = e.kind === "unary" ? [e.operand] : e.kind === "binary" ? [e.left, e.right] : e.kind === "convert" ? [e.value] : e.args
  if (!operands.every((o) => o.kind === "const")) return e
  // an ADDRESS of a constant: ADR(arr[2]) is a constant handle (`self.p = 2;`, lean 2.3) — a non-negative one, as a usize
  if (e.kind === "convert" && e.type.kind === "pointer") {
    const handle = constantValue(e)
    return typeof handle === "bigint" && handle >= 0n ? { kind: "const", value: handle, type: e.type, span: e.span } : e
  }
  if (e.type.kind !== "elementary" || stringKind(e.type) !== undefined) return e
  const value = constantValue(e)
  if (typeof value === "bigint" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)))
    return { kind: "const", value, type: e.type, span: e.span }
  return e
}

/**
 * A SELECTION TYPED AT ITS RESULT (lean 2.6, 7.2.7): SEL or MUX over a constant selector is the arm it picks (only that
 * arm is ever evaluated); a conversion of a SEL or MUX whose arms are constants, or values widened from the conversion's
 * own type, converts each arm instead — `(if g { 10i64 } else { 20i64 }) as i16` is `if g { 10i16 } else { 20i16 }`;
 * and a value widened and narrowed straight back is itself. Each holds because a selection only picks: the arm it
 * answers is the arm, converted the same either way.
 */
function selected(e: IrExpr): IrExpr {
  if (e.kind === "builtin" && (e.name === "sel" || e.name === "mux") && e.args[0]!.kind === "const") {
    const chosen = e.args[selectedArg(e.name, constValue(e.args[0]!.value, e.args[0]!.type), e.args.length)]!
    return sameType(chosen.type, e.type) ? chosen : e
  }
  if (e.kind !== "convert") return e
  const inner = e.value
  if (inner.kind === "convert") return unchained(e)
  if (inner.kind !== "builtin" || (inner.name !== "sel" && inner.name !== "mux") || e.type.kind !== "elementary") return e
  const arms = inner.args.slice(1)
  const narrowable = (a: IrExpr): boolean => a.kind === "const" || (a.kind === "convert" && sameType(a.value.type, e.type) && holdsEvery(a.type, e.type))
  if (!arms.every((a) => sameType(a.type, inner.type) && narrowable(a))) return e
  return { ...inner, type: e.type, args: [inner.args[0]!, ...arms.map((a) => foldedExpr({ kind: "convert", value: a, type: e.type, span: a.span }))] }
}

/** A divisor no zero check need guard (7.2.6): a constant other than 0 — and, for MOD, other than -1 — by the value its
 *  TYPE holds (`constValue`, as the interpreter reads it): an untyped `1.0E-46` beside a REAL is 0 there, and faults. */
function harmlessDivisor(op: "div" | "mod", divisor: IrExpr): boolean {
  if (divisor.kind !== "const") return false
  const v = constValue(divisor.value, divisor.type)
  if (typeof v === "bigint") return v !== 0n && (op === "div" || v !== -1n)
  return typeof v === "number" && Number.isFinite(v) && v !== 0
}

/**
 * A CONSTANT INDEX IS ITS ELEMENT (7.2.3): an index step whose index folded to a constant inside the array is that
 * element's 0-based position — the lower bound subtracted here, once — so the Rust indexes `[3]`. One outside the
 * array is kept as written: it stops the task at run time, as it does today.
 */
function foldedPlace(p: Place): Place {
  if (!p.path.some((s) => s.kind === "index" && s.index.kind === "const")) return p
  const path = p.path.map((s) => {
    if (s.kind !== "index" || s.index.kind !== "const" || typeof s.index.value !== "bigint" || s.length === undefined) return s
    const at = s.index.value - s.lower
    return at < 0n || at >= BigInt(s.length) ? s : { ...s, index: { ...s.index, value: at, type: elementaryRef("LINT") }, lower: 0n }
  })
  return { ...p, path }
}

/** Every body of a lowered POU with its all-constant expressions folded (`foldedExpr`) and its constant indices made
 *  positions (`foldedPlace`) — the last thing lowering does, so every rule above it saw the expression as written. */
export function foldPou(pou: IrPou): IrPou {
  const block = (body: readonly IrStmt[]): IrStmt[] => body.map((s) => mapExprs(s, foldedExpr, foldedPlace))
  return {
    ...pou,
    body: block(pou.body),
    ...(pou.init === undefined ? {} : { init: block(pou.init) }),
    layouts: pou.layouts.map((l) => (l.body === undefined ? l : { ...l, body: block(l.body) })),
    routines: pou.routines.map((r) => ({ ...r, body: block(r.body) })),
  }
}
