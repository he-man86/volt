/**
 * infer — the ONE expression type-inference engine. `inferExprType` is the front-end's public entry point: bottom-up
 * and total, every arm returns a rich `Type`, collapsing to `UNKNOWN` on any unresolved sub-part so consumers act only
 * on fully-known types. The rich `Type` carries element/target/scope inline, so `index`/`deref`/`member` read the
 * sub-type off the node instead of re-resolving a `TypeExpr`.
 *
 * What a name or a member chain denotes is `member.ts`; a call's callee and its parameters `callee.ts`.
 */
import { bareEnumMember, isLibrarySymbol, lookup, type Scope } from "../../symbols/index.js"
import { selfRefKind, type BinaryExpr, type CallExpr, type Expr } from "../../syntax/index.js"
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
import { resolveMemberChain, enumValueType, memberScopeOf, staticScopeType, superType, thisType } from "./member.js"

/** A CODESYS partial access's member name (`%X0`, `%b3`), one token (`lex/lexer`): its width letter. */
const PARTIAL_ACCESS = /^%([XBWD])\d+$/i
const PARTIAL_ACCESS_TYPE: Readonly<Record<string, string>> = { X: "BOOL", B: "BYTE", W: "WORD", D: "DWORD" }

/** Infer the type of an ST expression. `unknown` on any unresolved sub-part (conservative). */
export function inferExprType(expr: Expr, scope: Scope, project: Scope): Type {
  switch (expr.kind) {
    case "literal":
      return literalType(expr)
    case "ident_expr": {
      // THIS denotes the enclosing FB instance — resolve to its member scope so `THIS^.field` navigates.
      if (expr.name.toUpperCase() === "THIS") return thisType(scope)
      // …and SUPER its base's, so `SUPER^.Get()` navigates (rule E27)
      if (expr.name.toUpperCase() === "SUPER") return superType(scope)
      // `__POSITION` has a value without its parentheses (`builtins.ts` `bareBuiltinType`).
      const bare = bareBuiltinType(expr.name, project.dialect)
      if (bare !== undefined) return bare
      const sym = lookup(scope, expr.name)?.symbol ?? bareEnumMember(scope, expr.name)
      // The declaring file is the asker: `v : ETRIG;` written inside CBML means CBML's ETRIG, no matter
      // which file is reading `v` now.
      if (sym?.typeExpr !== undefined) return resolveTypeExpr(sym.typeExpr, project, 0, project, sym.uri)
      const value = sym === undefined ? undefined : enumValueType(sym, project)
      if (value !== undefined) return value
      // Static base: the name denotes a GVL/enum/namespace/POU scope (`E_State.Idle`), not a typed var.
      return staticScopeType(project, expr.name) ?? UNKNOWN
    }
    case "global_expr": {
      // `.g` names the global past every local (rule E33): what the project scope holds under the name
      const sym = resolveMemberChain(expr, scope, project)
      if (sym?.typeExpr !== undefined) return resolveTypeExpr(sym.typeExpr, project, 0, project, sym.uri)
      return (sym === undefined ? undefined : enumValueType(sym, project)) ?? staticScopeType(project, expr.name.name) ?? UNKNOWN
    }
    case "member": {
      // CODESYS's PARTIAL ACCESS `d.%W0` is of the part it names: %X a BOOL, %B a BYTE, %W a WORD, %D a DWORD
      // (`operand_partial_*`, `accepts_partial_access`, `expr_partial_access_beside_undefined` build into those)
      const part = PARTIAL_ACCESS.exec(expr.member.name)?.[1]?.toUpperCase()
      if (part !== undefined) return elementaryRef(PARTIAL_ACCESS_TYPE[part]!)
      // THIS and SUPER without their `^` are the pointers, which have no members: `THIS.v` has no type
      // (`expr_this_member_without_deref`, `expr_super_without_deref`, both vendors)
      if (expr.base.kind === "ident_expr" && selfRefKind(expr.base.name) !== undefined) return UNKNOWN
      const sym = resolveMemberChain(expr, scope, project)
      if (sym?.typeExpr !== undefined) return resolveTypeExpr(sym.typeExpr, project, 0, project, sym.uri)
      const value = sym === undefined ? undefined : enumValueType(sym, project)
      if (value !== undefined) return value
      // `Ns.Dep` — the namespace of a library `Ns` depends on, which `Ns` holds (rule LB8: `DED.CommFB.IO_SYSTEM_TYPE.PROFINET_IO`
      // builds and runs 2, `Util.Standard.LEN('abcd')` runs 4, `lib_ns_transitive_qualification*`, CODESYS 2026-10-02): a
      // static base, as the bare `Ns` is
      if (sym?.kind === "namespace") return staticScopeType(project, sym.name) ?? UNKNOWN
      // `Ns.E` — an ENUM a namespace holds is a static base, as the bare `E` is (rule EN6: `Util.WEEKDAY.THURSDAY`,
      // `enum_library_namespace_qualified`, builds and runs 4). Only an enum: no recording asks `Ns.Func` or `Ns.FB.x`,
      // and `staticScopeType` would call a FUNCTION an FB instance
      const holder = memberScopeOf(inferExprType(expr.base, scope, project))
      const held = holder?.kind === "namespace" ? staticScopeType(holder, expr.member.name) : undefined
      return held?.kind === "enum" ? held : UNKNOWN
    }
    case "index": {
      // an index through a REFERENCE TO an array reads the array (`decl_reference_to_array`, both vendors run `rf[1]`)
      const written = inferExprType(expr.base, scope, project)
      const base = written.kind === "reference" ? written.target : written
      if (base.kind === "array") return base.element
      // …and a POINTER indexed once is its target, `i` elements on (rule M3: `p[2].x` over `p : POINTER TO S` runs 30 in
      // `mem_pointer_index_struct_array`, both vendors build it); a second index is the arity error C0126, untyped
      return base.kind === "pointer" && expr.indices.length === 1 ? base.target : UNKNOWN
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
    // an inline assignment is worth what its TARGET then holds: `(a := b + INT#1) * INT#2` runs a * 2
    // (`expr_inline_assign_value`), and an untyped literal stored there is the target's type (`(b := 3)`)
    case "assign_expr":
      return inferExprType(expr.target, scope, project)
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

/** The symbols that hold a value — a call of one calls what its type is. */
const VALUE_SYMBOLS: ReadonlySet<string> = new Set(["var", "gvl_var", "struct_field", "method_param"])
/** The types a value can have that are no call target. */
const NOT_CALLABLE: ReadonlySet<string> = new Set(["elementary", "enum", "struct", "array"])

function callReturnType(call: CallExpr, scope: Scope, project: Scope): Type {
  // A project function/method wins (user code can shadow a built-in name).
  const sym = resolveMemberChain(call.callee, scope, project)
  if (sym?.typeExpr !== undefined) {
    const declared = resolveTypeExpr(sym.typeExpr, project, 0, project, sym.uri)
    // a VALUE that is no call target has no result: `.gCall(1)` over an INT is "Unknown type: '.gCall(1)'" on both
    // vendors (`expr_global_namespace_call_non_callable`). A reference or pointer is judged by its target, as
    // `analysis/checks/calls/non-callable-call` judges it — a REFERENCE TO an FB is called (`xo_reference_to_fb_call`).
    // A CONSTANT is not asked: "called" in an aggregate it is a repeat count, `[L_UM1P_Internal.c_MaxTask(-1)]` (a
    // lenze library), which the parser reads as a call — its value is the element's, not nothing. Nor is a library's
    // value, whose declaration may be partial (that list's CONSTANT is not in its signature).
    const target = declared.kind === "pointer" || declared.kind === "reference" ? declared.target : declared
    if (VALUE_SYMBOLS.has(sym.kind) && sym.constant !== true && !isLibrarySymbol(sym) && NOT_CALLABLE.has(target.kind)) return UNKNOWN
    return declared
  }
  // An element of an array of instances, called (`inst[0]()`), is the instance `inst()` is — typed alike, by the type
  // the element has; it has no symbol of its own to carry one. So is a dereferenced instance: `SUPER^(…)`, `p^(…)`
  // (rule M3, `mem_super_call_unknown_param`, `callshape_super_own_fields`).
  if (call.callee.kind === "index" || call.callee.kind === "deref") {
    const element = inferExprType(call.callee, scope, project)
    if (element.kind === "function_block") return element
  }
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
