/**
 * A CALL'S RESULT TYPE — a user callee's return type, and the built-in calls whose result depends on their arguments
 * (EXPT, the selections, the argument-typed operators). Split from `expr.ts` (openspec lsp-same-standard design.md
 * §2.2).
 */
import { isLibrarySymbol, type Scope, scopeUri, targetOf } from "../../symbols/index.js"
import { type CallExpr, type Expr, decodeStringLiteral } from "../../syntax/index.js"
import { checkedMeetType } from "../arith/checked.js"
import {
  type ExptArgument,
  exptCheckedType,
  selectionValueArguments,
  ARGUMENT_TYPED,
  clockCallResult,
  pointerTo,
  sizeofResultType,
  builtinCallResult,
  MATH_ARG_TYPED,
  mathResultType,
  twincatXaddResultType,
} from "../builtins.js"
import { DEFAULT_STRING_LENGTH } from "../defaults.js"
import { elementaryType, aliasElem } from "../elementary.js"
import { isUntypedNumber } from "../literal.js"
import { resolveNamedType, resolveTypeExpr } from "../resolve.js"
import { type Type, elementaryRef, UNKNOWN } from "../type.js"
import { inferExprType } from "./expr.js"
import { valueOperandType, sizedOperandType, structSizeBound, storageBytes } from "./sizeof.js"
import { resolveMemberChain, insideOwnBody } from "./member.js"

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
    return aliasElem(t.name) === "REAL" ? "real" : "not-real"
  })
  return exptCheckedType(kinds)
}

/**
 * A selection over STRINGs (or over WSTRINGs) — undefined for any other operands. Measured on both vendors 2026-10-11 by
 * storing each into an INT, which names the type (`sel_string_meet_type`, `limit_string_meet_type`, `_in`;
 * lsp-transpile-review-gaps 2.7): SEL and MUX answer the WIDEST value argument's type — a sizeless one is 80 units, a
 * literal is as wide as its text and is then named by it, `STRING(INT#20)`; LIMIT answers its IN's type whatever MN and
 * MX are; MIN and MAX a sizeless STRING (over WSTRINGs unmeasured, UNKNOWN). An operand whose capacity is no fact
 * leaves it UNKNOWN.
 */
function stringSelection(name: string, values: readonly (Expr | undefined)[], typeOf: (e: Expr | undefined) => Type): Type | undefined {
  const types = values.map(typeOf)
  const first = types[0]
  if (first?.kind !== "elementary" || first.elem.family !== "string") return undefined
  if (types.some((t) => t.kind !== "elementary" || t.name !== first.name)) return undefined
  if (name === "MIN" || name === "MAX") return first.name === "STRING" ? elementaryRef("STRING") : UNKNOWN
  if (name === "LIMIT") return values[1]?.kind === "literal" ? UNKNOWN : (types[1] ?? UNKNOWN)
  const capacities: (number | undefined)[] = values.map((v, i) => {
    if (v?.kind === "literal") return typeof v.value === "string" ? decodeStringLiteral(v.value, first.name === "WSTRING")?.length : undefined
    const t = types[i]
    return t?.kind !== "elementary" || t.unfoldedLength === true ? undefined : (t.length ?? DEFAULT_STRING_LENGTH)
  })
  const known = capacities.filter((c): c is number => c !== undefined)
  if (known.length !== capacities.length) return UNKNOWN
  const widest = Math.max(...known)
  const variable = values.findIndex((v, i) => v?.kind !== "literal" && capacities[i] === widest)
  return types[variable] ?? { ...first, length: widest, lengthText: `INT#${widest}` }
}

/**
 * A BUILT-IN WHOSE RESULT IS A FUNCTION OF ITS ARGUMENTS (`builtins.ts` holds each rule), or undefined for any other name.
 * The selection functions return the MEET of their value arguments — the one a binary operator's operands reach. They
 * are extensible and type-dependent, so the catalog models no fixed result, and inferring UNKNOWN left `MIN(anInt, aUint)`
 * invisible to every check downstream. An argument whose type is unknown — an untyped literal takes its type from the
 * context — leaves the result unknown.
 */
function builtinArgumentResult(name: string, call: CallExpr, scope: Scope, project: Scope): Type | undefined {
  const upper = name.toUpperCase()
  const values = call.args.map((a) => a.value)
  const typeOf = (e: Expr | undefined): Type => (e === undefined ? UNKNOWN : inferExprType(e, scope, project))
  const selected = selectionValueArguments(upper, values)
  if (selected !== undefined) {
    const strings = stringSelection(upper, selected, typeOf)
    if (strings !== undefined) return strings
    const types = selected.map(typeOf)
    if (types.length === 0 || types.some((t) => t.kind !== "elementary")) return UNKNOWN
    return types.reduce((acc, t) => checkedMeetType(acc, t) ?? UNKNOWN)
  }
  const argument = ARGUMENT_TYPED.get(upper)
  if (argument !== undefined) {
    const t = typeOf(values[argument])
    return t.kind === "elementary" ? t : UNKNOWN
  }
  const clock = clockCallResult(upper, call.args.length)
  if (clock !== undefined) return clock
  if (call.args.length !== 1 && upper !== "__NEW") return undefined
  const operand = values[0]
  if (upper === "ADR") return pointerTo(operand === undefined ? UNKNOWN : valueOperandType(operand, scope, project))
  if (upper === "__NEW") return pointerTo(operand?.kind === "ident_expr" ? resolveNamedType(operand.name, project, scopeUri(scope)) : UNKNOWN)
  if (upper === "SIZEOF") {
    if (operand === undefined) return UNKNOWN
    const sized = sizedOperandType(operand, scope, project)
    // SIZEOF of a STRUCT or a UNION is a UINT, where SIZEOF of an elementary type, an enum, an alias or an array is the
    // smallest unsigned integer holding the size: a one-byte STRUCT, a one-byte UNION and a four-byte one are UINT, a
    // four-byte DINT USINT (`dt_sizeof_derived_type`, `dt_union_sizeof_type`, `ar_sizeof_type`, both vendors 2026-10-03).
    // Asked only where the size certainly fits a UINT — a larger one is unmeasured.
    if (sized.kind === "struct") {
      const bound = structSizeBound(sized, project)
      return bound !== undefined && bound < 65536n ? elementaryRef("UINT") : UNKNOWN
    }
    const bytes = storageBytes(sized, project)
    // an enum whose storage is no fact here (a library enum's base is not materialized) is still at most an LWORD: USINT
    // (`dt_sizeof_derived_type` — every enum's SIZEOF is one)
    if (bytes === undefined && sized.kind === "enum") return elementaryRef("USINT")
    return bytes === undefined ? UNKNOWN : sizeofResultType(bytes)
  }
  return undefined
}

/** The symbols that hold a value — a call of one calls what its type is. */
export const VALUE_SYMBOLS: ReadonlySet<string> = new Set(["var", "gvl_var", "struct_field", "method_param"])
/** The types a value can have that are no call target. */
const NOT_CALLABLE: ReadonlySet<string> = new Set(["elementary", "enum", "struct", "array"])

export function callReturnType(call: CallExpr, scope: Scope, project: Scope): Type {
  // A project function/method wins (user code can shadow a built-in name).
  const sym = resolveMemberChain(call.callee, scope, project)
  // a FUNCTION called inside its own body calls its RESULT VARIABLE (rule Y20), which is no call target: the call has no
  // result — "Program name, function or function block instance expected instead of 'F_C2_loop'" and "Cannot convert
  // type 'Unknown type: 'F_C2_loop(depth := (depth - INT#1))'' to type 'INT'" (`cc2_call_recursion`, both vendors)
  if (sym?.kind === "function" && call.callee.kind === "ident_expr" && insideOwnBody(sym, scope)) return UNKNOWN
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
  if (call.callee.kind === "ident_expr") {
    const builtin = builtinArgumentResult(call.callee.name, call, scope, project)
    if (builtin !== undefined) return builtin
  }
  // TwinCAT's `__XADD` hands back what it was given (`builtins.ts` `twincatXaddResultType`).
  if (project.dialect === "twincat" && call.callee.kind === "ident_expr" && call.callee.name.toUpperCase() === "__XADD") {
    const first = call.args[0]?.value
    return twincatXaddResultType(first === undefined ? UNKNOWN : inferExprType(first, scope, project))
  }
  // A one-argument math function hands back the real it was given (`builtins.ts` `mathResultType`).
  if (call.callee.kind === "ident_expr" && MATH_ARG_TYPED.has(call.callee.name.toUpperCase()) && call.args.length === 1) {
    const arg = call.args[0]?.value
    // a literal however written — negated, parenthesised — as a bare one (`tr_a23_*`, 6.A.23: SIN(-1.5) is LREAL)
    const result = mathResultType(arg === undefined ? UNKNOWN : inferExprType(arg, scope, project), arg !== undefined && (arg.kind === "literal" || isUntypedNumber(arg)))
    if (result !== undefined) return result
  }
  // Otherwise a built-in call: a conversion, or an operator with a FIXED result (`builtins.ts` `builtinCallResult`).
  // Flows a built-in's result into downstream checks — e.g. `REAL_TO_DINT(EXPT(…))` needs EXPT's type to see an
  // implicit LREAL→REAL narrowing on the argument.
  if (call.callee.kind === "ident_expr") {
    const builtin = builtinCallResult(call.callee.name, project.dialect, targetOf(project))
    if (builtin !== undefined) return builtin
  }
  return UNKNOWN
}
