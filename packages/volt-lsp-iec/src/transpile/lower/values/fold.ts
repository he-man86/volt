/**
 * THE LOWERING'S CONSTANT FOLD — what lowering decides before the program runs: an expression folded over the front-end's
 * AST fold (`types/const`), an enumerator's value, a conversion of a constant, and the width an all-constant integer
 * expression folds at.
 */

import type { Lowering } from "../lowering.js"
import type { Expr } from "../../../frontend/syntax/index.js"
import type { IrExpr, IrValue } from "../../ir/index.js"
import { enumConstant } from "./enums.js"
import {
  constEval,
  elementaryRef,
  elementaryTypeRef,
  parseConversionName,
  type Type,
} from "../../../frontend/types/index.js"
import { isConstantCallee } from "../builtins/arity.js"
import { stored } from "./convert.js"
import { exprHoldsCall } from "../core/ast-walk.js"
import { constantValue } from "../../semantics/index.js"
import { lowerExpr } from "../expressions/expressions.js"

/** `asConstant`: `e` is a CONSTANT's own initializer — see `constEval`. */
export function foldConstant(lw: Lowering, e: Expr, asConstant = false): IrValue | undefined {
  // an enum value is a constant too — a CASE label `E_Mode.Busy:` or `Busy:`
  const enumValue = (e.kind === "ident_expr" && lw.holds(e.name)) || (e.kind !== "ident_expr" && e.kind !== "member") ? undefined : enumConstant(lw, e)
  if (enumValue?.kind === "const") return enumValue.value
  return constEval(e, lw.scope, asConstant)
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

/** `TO_USINT(x)` / `INT_TO_BYTE(x)` over a constant — the value stored at the target's width, as measured (design §11). */
function convertedConstant(lw: Lowering, e: Expr, depth: number): bigint | undefined {
  if (e.kind !== "call" || e.callee.kind !== "ident_expr" || e.args.length !== 1) return undefined
  const written = e.args[0]?.value
  // THE ONE PARSER, not a seventh. This read the name with its own `/^(?:[A-Za-z]+_)?TO_([A-Za-z]+)$/` — in a
  // file that imports `parseConversionName` and uses it two functions below — and disagreed with it twice: no
  // `i` flag, so a lower-case `int_to_byte(5)` was not a conversion at all where ST is case-insensitive; and no
  // check on the SOURCE, so a project function named `FOO_TO_INT(5)` folded as though it converted, silently
  // yielding its argument. `parseConversionName` rejects both (`GO_TO_START` is the case its own doc names).
  // no target: the platform-alias names are lowered together with the body's (`lower/builtins/conversions.ts`), task 6.B.5 (H4);
  // folding them here alone lowered an initializer the body refuses (`fold.test.ts`)
  const conversion = parseConversionName(e.callee.name, undefined)
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

/**
 * AN INITIAL VALUE THAT IS A CALL — the shape the corpus writes 1084 times and the highest-reach refusal there was.
 *
 * `constEval` folds a literal, a name, an enum member, a unary and a binary, and returns undefined for a CALL. Five
 * real projects write `ANY_TO_DINT(16#80000000)`, `(SHL(UINT_TO_DWORD(x), 16) OR 16#1)`, `SIZEOF(T)` and their
 * neighbours in a declaration, so `init-not-constant` stopped 200 of the 304 POUs that have a body.
 *
 * Measured before implementing (`declarations/constant-folding.ts`, 29 probes): CODESYS folds EVERY one of them —
 * the conversions, the shifts and rotates, MIN/MAX/LIMIT/SEL/MUX, ABS, TRUNC, EXPT, SQRT, SIZEOF, nested and
 * parenthesised — and folds them to exactly what the same expression computes at RUN TIME. `ANY_TO_DINT(16#80000000)`
 * is -2147483648, `INT_TO_BYTE(300)` is 44, `REAL_TO_DINT(3.0E9)` is -1294967296, `REAL_TO_INT(2.5)` is 3.
 *
 * So the value is not folded a second way here: the expression is LOWERED, and `semantics/fold.ts` answers it with
 * the same three switches the interpreter runs. A tree that needs storage — a name, a call to a user FUNCTION, a
 * dereference — is not constant and is rejected there rather than guessed at.
 *
 * WHAT STAYS REFUSED, AND IS NOT A CONSTANT AT ALL. Two more probes show CODESYS's initializers are an
 * initialisation SEQUENCE rather than a fold: `other : INT := -7; i : INT := ABS(other);` gives i = 7, the same
 * pair written the other way round gives 0, and a user FUNCTION reading a global returns 42 for a global that
 * starts at 41 — so they run in DECLARATION ORDER, after the globals, with arbitrary code. Modelling that is a
 * different change; this one takes the half that really is constant.
 */
export function foldedCall(lw: Lowering, e: Expr, type: Type): IrValue | undefined {
  if (!exprHoldsCall(e)) return undefined
  const lowered = lowerExpr(lw, e, type)
  return lowered === undefined ? undefined : (constantValue(lowered) as IrValue | undefined)
}
