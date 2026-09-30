/**
 * infer — the ONE expression type-inference engine. `inferExprType` is the front-end's public entry point: bottom-up
 * and total, every arm returns a rich `Type`, collapsing to `UNKNOWN` on any unresolved sub-part so consumers act only
 * on fully-known types. The rich `Type` carries element/target/scope inline, so `index`/`deref`/`member` read the
 * sub-type off the node instead of re-resolving a `TypeExpr`.
 *
 * What a name or a member chain denotes is `member.ts`; a call's callee and its parameters `callee.ts`.
 */
import { lookup, resolveBareEnumMember, type Scope } from "../../symbols/index.js"
import type {
  BinaryExpr,
  CallExpr,
  Expr,
} from "../../syntax/index.js"
import { checkedMeetType, checkedNegationType } from "../arith/checked.js"
import { temporalResultType } from "../arith/temporal.js"
import {
  bareBuiltinType,
  builtinCallResult,
  exptCheckedType,
  MATH_ARG_TYPED,
  mathResultType,
  twincatXaddResultType,
  type ExptArgument,
} from "../builtins.js"
import { elementaryType } from "../elementary.js"
import { resolveTypeExpr } from "../resolve.js"
import { elementaryRef, UNKNOWN, type Type } from "../type.js"
import { canonicalElem } from "../platform.js"
import { literalType, typedLiteralSum } from "../literal.js"
import { BITWISE_OPERATORS, bitwiseResultType, COMPARISON_OPERATORS, notResultType } from "../arith/operators.js"
import { resolveMemberChain, enumValueType, staticScopeType, thisType } from "./member.js"

/** Infer the type of an ST expression. `unknown` on any unresolved sub-part (conservative). */
export function inferExprType(expr: Expr, scope: Scope, project: Scope): Type {
  switch (expr.kind) {
    case "literal":
      return literalType(expr)
    case "ident_expr": {
      // THIS denotes the enclosing FB instance — resolve to its member scope so `THIS^.field` navigates.
      if (expr.name.toUpperCase() === "THIS") return thisType(scope)
      // `__POSITION` has a value without its parentheses (`builtins.ts` `bareBuiltinType`).
      const bare = bareBuiltinType(expr.name, project.dialect)
      if (bare !== undefined) return bare
      const sym = lookup(scope, expr.name)?.symbol ?? resolveBareEnumMember(project, expr.name)
      // The declaring file is the asker: `v : ETRIG;` written inside CBML means CBML's ETRIG, no matter
      // which file is reading `v` now.
      if (sym?.typeExpr !== undefined) return resolveTypeExpr(sym.typeExpr, project, 0, project, sym.uri)
      const value = sym === undefined ? undefined : enumValueType(sym, project)
      if (value !== undefined) return value
      // Static base: the name denotes a GVL/enum/namespace/POU scope (`E_State.Idle`), not a typed var.
      return staticScopeType(project, expr.name) ?? UNKNOWN
    }
    case "member": {
      const sym = resolveMemberChain(expr, scope, project)
      if (sym?.typeExpr !== undefined) return resolveTypeExpr(sym.typeExpr, project, 0, project, sym.uri)
      return (sym === undefined ? undefined : enumValueType(sym, project)) ?? UNKNOWN
    }
    case "index": {
      const base = inferExprType(expr.base, scope, project)
      return base.kind === "array" ? base.element : UNKNOWN
    }
    case "deref": {
      const base = inferExprType(expr.base, scope, project)
      if (base.kind === "pointer" || base.kind === "reference") return base.target
      // `THIS^` / a ref already resolved to its target: dereffing a scoped value is identity.
      return base.kind === "function_block" || base.kind === "struct" || base.kind === "enum" ? base : UNKNOWN
    }
    case "call":
      return callReturnType(expr, scope, project)
    case "unary": {
      // `+` keeps the operand's type; unary MINUS does not (see `checkedNegationType`); and NOT keeps it EXCEPT on a
      // signed integer, where the result is the UNSIGNED type of the same width.
      //
      // That last part is the same fact the sign-change warning already states — "AND, OR, XOR and NOT meet in the
      // UNSIGNED integer of the width" (`checks/types/narrowing.ts`) — and it was applied to the OPERAND and not to
      // the RESULT, so only half of what CODESYS reports could be reproduced. Measured on `not_result_width`, with
      // `i5 : INT`: `NOT i5` into a DINT or an LREAL is silent (a UINT widens into either without a sign change),
      // and into an INT it warns "Implicit conversion from unsigned Type 'UINT' to signed Type 'INT'". Three
      // assignments of the same expression, two answers — which only makes sense if the expression is UINT.
      //
      // A BOOL operand is a logical NOT and keeps BOOL; an already-unsigned operand keeps its own type. Both fall out
      // of the guard rather than needing a case.
      const operand = inferExprType(expr.operand, scope, project)
      if (expr.op === "-") return checkedNegationType(operand)
      if (expr.op === "NOT") return notResultType(operand)
      return operand
    }
    case "binary":
      return binaryResultType(expr, scope, project)
    case "paren":
      return inferExprType(expr.inner, scope, project)
    case "assign_expr":
      return inferExprType(expr.value, scope, project)
  }
}

function binaryResultType(e: BinaryExpr, scope: Scope, project: Scope): Type {
  if (COMPARISON_OPERATORS.has(e.op)) return elementaryRef("BOOL")
  const l = inferExprType(e.left, scope, project)
  const r = inferExprType(e.right, scope, project)
  if (l.kind === "elementary" && r.kind === "elementary") {
    const temporal = e.op === "+" || e.op === "-" ? temporalResultType(e.op, l.name, r.name) : undefined
    if (temporal !== undefined) return elementaryRef(temporal)
    const folded = e.op === "+" ? typedLiteralSum(e, l, r) : undefined
    if (folded !== undefined) return folded
    // THE MEASURED MEET, not "same type or nothing". This committed only when both operands were the SAME elementary
    // type, so every mixed expression inferred UNKNOWN — and an UNKNOWN source is assignable to anything, which meant
    // no check downstream could see it. `out := a + b` with `out : STRING` was silent for all seventy pairs in
    // `fixtures/operators/mixed-type.ts` while `out := a` was reported. `checkedMeetType` is the vendor's own answer
    // and still returns undefined for the pairs nothing recorded, which keeps the silence exactly where it was earned.
    // AND/OR/XOR COMPUTE IN THE UNSIGNED INTEGER OF THE OPERANDS' WIDTH. `out := a AND b` with LINT operands
    // is three warnings on CODESYS — one per operand going in, and one for the result coming back out into a
    // signed destination (`bit_{and,or,xor}_{sint,int,dint,lint}`). The result type is what carries the third:
    // typing it LINT made the assignment look clean. BOOL operands are boolean logic and keep their type; a bit
    // string is already unsigned and answers the same either way.
    const bitwise = BITWISE_OPERATORS.has(e.op) ? bitwiseResultType(l, r) : undefined
    if (bitwise !== undefined) return bitwise
    const meet = checkedMeetType(l, r)
    if (meet !== undefined) return meet
    if (canonicalElem(l.name) === canonicalElem(r.name)) return l
  }
  return UNKNOWN
}

/**
 * EXPT's checked type (`builtins.ts` `exptCheckedType`) over its arguments as inferred here. The reference catalog used
 * to say "always LREAL", from recollection — which made the narrowing check warn on `real := EXPT(real, real)`, code the
 * compiler accepts silently.
 */
function exptType(call: CallExpr, scope: Scope, project: Scope): Type {
  // Each argument is REAL, NOT REAL, or unknown. An integer LITERAL has no width but can never be a REAL, so it counts
  // as not-REAL: `REAL_TO_DINT(EXPT(10, n))` warns LREAL → REAL in a real project (build conformance). A REAL literal
  // can take either width, so it stays unknown.
  const kinds = call.args.map((a): ExptArgument => {
    if (a.value === undefined) return "unknown"
    if (a.value.kind === "literal") return typeof a.value.value === "bigint" ? "int-literal" : "unknown"
    const t = inferExprType(a.value, scope, project)
    if (t.kind !== "elementary" || elementaryType(t.name)?.rank === undefined) return "unknown"
    return canonicalElem(t.name) === "REAL" ? "real" : "not-real"
  })
  return exptCheckedType(kinds)
}

/** The value functions whose result is the meet of their arguments — measured for these two only. */
const SELECTS_BY_MEET: ReadonlySet<string> = new Set(["MIN", "MAX"])

function callReturnType(call: CallExpr, scope: Scope, project: Scope): Type {
  // A project function/method wins (user code can shadow a built-in name).
  const sym = resolveMemberChain(call.callee, scope, project)
  if (sym?.typeExpr !== undefined) return resolveTypeExpr(sym.typeExpr, project, 0, project, sym.uri)
  if (call.callee.kind === "ident_expr" && call.callee.name.toUpperCase() === "EXPT") return exptType(call, scope, project)
  // MIN AND MAX RETURN THE MEET OF THEIR ARGUMENTS, the same one a binary operator's operands reach. They are
  // extensible and type-dependent, so the reference catalog models no return type for them and they inferred
  // UNKNOWN — which is assignable to anything, so no check downstream could see a `MIN(anInt, aUint)` at all.
  // Measured on all six mixed pairs (`operators/selection.ts`, 2026-09-19): MIN(INT, UINT) is INT, MIN(DINT, UDINT)
  // is DINT, MIN(BYTE, SINT) is SINT, MIN(LINT, REAL) is REAL — `checkedMeetType` exactly.
  //
  // LIMIT, SEL and MUX are deliberately NOT here. They plainly meet their value arguments too, and nothing has
  // recorded them across two types, so they keep the silence they have earned.
  if (call.callee.kind === "ident_expr" && SELECTS_BY_MEET.has(call.callee.name.toUpperCase())) {
    const types = call.args.map((a) => (a.value === undefined ? UNKNOWN : inferExprType(a.value, scope, project)))
    if (types.length === 0 || types.some((t) => t.kind !== "elementary")) return UNKNOWN
    return types.reduce((acc, t) => checkedMeetType(acc, t) ?? UNKNOWN)
  }
  // TwinCAT's `__XADD` hands back what it was given (`builtins.ts` `twincatXaddResultType`).
  if (project.dialect === "twincat" && call.callee.kind === "ident_expr" && call.callee.name.toUpperCase() === "__XADD") {
    const first = call.args[0]?.value
    return twincatXaddResultType(first === undefined ? UNKNOWN : inferExprType(first, scope, project))
  }
  // A one-argument math function hands back the real it was given (`builtins.ts` `mathResultType`).
  if (call.callee.kind === "ident_expr" && MATH_ARG_TYPED.has(call.callee.name.toUpperCase()) && call.args.length === 1) {
    const arg = call.args[0]?.value
    const result = mathResultType(arg === undefined ? UNKNOWN : inferExprType(arg, scope, project), arg?.kind === "literal")
    if (result !== undefined) return result
  }
  // Otherwise a built-in call: a conversion, or an operator with a FIXED result (`builtins.ts` `builtinCallResult`).
  // Flows a built-in's result into downstream checks — e.g. `REAL_TO_DINT(EXPT(…))` needs EXPT's type to see an
  // implicit LREAL→REAL narrowing on the argument.
  if (call.callee.kind === "ident_expr") {
    const builtin = builtinCallResult(call.callee.name, project.dialect)
    if (builtin !== undefined) return builtin
  }
  return UNKNOWN
}
