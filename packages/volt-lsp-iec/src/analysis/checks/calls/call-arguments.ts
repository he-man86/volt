/**
 * call-argument checks (D.2 · calls/). Validates a call against its resolved callee's declared parameters:
 *   - `call-argument-count` — more POSITIONAL arguments than the callee declares inputs.
 *   - `call-argument-type`  — an argument whose type can't feed its parameter (reuses `cannotConvert`,
 *                             the same wording + `isAssignable` engine as `assignment.ts`).
 *   - `unknown-named-argument` — a `name := value` naming no declared parameter of the callee.
 *
 * Conservative (zero-FP): skips whenever the callee can't be resolved to a callable, and only type-checks
 * a side that is a checkable category (elementary or enum — a struct/FB/array/library type never fires).
 * Positional TYPE-checking runs only on all-positional calls (a mixed named+positional call can't bind
 * positionals by index — the mapping is ambiguous). Too-FEW is intentionally not diagnosed: FB inputs are
 * optional (retained between calls) and function optional/EN-ENO inputs would false-positive.
 * ponytail: no too-few check — the only spec requirement about omission is the negative "don't flag it".
 */
import { walkAllExprs, type CallArg, type Expr } from "../../../syntax/index.js"
import { bodies, lookup, lookupMember, resolveBareEnumMember, type Scope, type Symbol } from "../../../symbols/index.js"
import {
  inferExprType,
  isAssignable,
  renderType,
  resolveCallee,
  resolveMemberChain,
  resolveTypeExpr,
  type CalleeInfo,
  type Type,
} from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { isLibrarySymbol, SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkCallArguments(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkAllExprs(statements, (e) => {
      if (e.kind !== "call") return
      const callee = resolveCallee(e, scope, ctx.project)
      if (callee === undefined) return // unresolved callee → skip (zero-FP)
      // Library signatures flatten var sections (inputs may vanish), so any arg check on them is unreliable.
      if (isLibrarySymbol(callee.sym)) return
      checkCall(e.args, callee, scope, ctx, out)
    })
  }
}

function checkCall(
  args: readonly CallArg[],
  callee: CalleeInfo,
  scope: Scope,
  ctx: CheckContext,
  out: DiagnosticItem[],
): void {
  const positional = args.filter((a) => a.param === undefined)
  const named = args.filter((a) => a.param !== undefined)
  // Count / unknown-name run only when the callee's parameter set is COMPLETE (its whole EXTENDS chain
  // resolved to project FBs). An unresolved or library base could contribute inherited params we can't see,
  // so flagging too-many or an unknown name there would false-positive; the type checks below still run
  // (they only fire on a param we DID resolve).

  // (1) too many positional arguments vs positionally-bindable parameters — flag the first excess argument.
  if (callee.complete && positional.length > callee.positionalArity) {
    const excess = positional[callee.positionalArity]
    out.push({
      severity: "error",
      span: excess.span,
      source: SOURCE,
      code: "call-argument-count",
      message: ctx.messages.tooManyArguments(callee.sym.name, callee.positionalArity),
    })
  }

  // (2) positional type-check — only on all-positional calls (mixed calls can't bind by index), and only
  // when every positional slot is a VAR_INPUT (`positionalArity === params.length`). If VAR_IN_OUT params
  // interleave, positional[i] does NOT align with the VAR_INPUT-only `params[i]`, so index-checking would
  // false-positive; skip those calls (count is still handled above).
  if (callee.complete && named.length === 0 && callee.positionalArity === callee.params.length) {
    positional.forEach((arg, i) => {
      const param = callee.params[i]
      if (param !== undefined && arg.value !== undefined) argTypeError(arg.value, param.type, scope, ctx, out)
    })
  }

  // (3) named arguments — an unknown name is flagged (complete callees only); a known VAR_INPUT name's value
  // is type-checked. A name is known if it's a declared param OR (FB instance) a member reached through the
  // scope + EXTENDS chain — that also covers a PROPERTY, a valid named-arg target that isn't a var section.
  // `p => out` binds an output, not an input value, so it is never type-checked here.
  for (const arg of named) {
    const name = arg.param!.name.toLowerCase()
    const known =
      callee.paramNames.has(name) || (callee.scope !== undefined && lookupMember(callee.scope, name) !== undefined)
    if (callee.complete && !known) {
      out.push({
        severity: "error",
        span: arg.param!.span,
        source: SOURCE,
        code: "unknown-named-argument",
        message: ctx.messages.unknownNamedArgument(arg.param!.name, callee.sym.name),
      })
      continue
    }
    if (!arg.output && arg.value !== undefined) {
      const param = callee.params.find((p) => p.name.text.toLowerCase() === name)
      if (param !== undefined) argTypeError(arg.value, param.type, scope, ctx, out)
    }
  }
}

/** Flag an argument whose checkable type is not assignment-compatible with its parameter's declared type. */
function argTypeError(
  value: Expr,
  paramType: Parameters<typeof resolveTypeExpr>[0],
  scope: Scope,
  ctx: CheckContext,
  out: DiagnosticItem[],
): void {
  const target = checkable(resolveTypeExpr(paramType, ctx.project))
  if (target === undefined) return
  const arg = argCheckableType(value, scope, ctx.project)
  if (arg === undefined) return
  if (isAssignable(target, arg)) return
  out.push({
    severity: "error",
    span: value.span,
    source: SOURCE,
    code: "call-argument-type",
    message: ctx.messages.cannotConvert(renderType(arg), renderType(target)),
  })
}

/** A resolved param type only when it's a checkable category (elementary or enum), else undefined. */
function checkable(t: Type): Type | undefined {
  return t.kind === "elementary" || t.kind === "enum" ? t : undefined
}

/** The checkable type of an argument expression: enum-value reference or an elementary/enum inferred type.
 *  Mirrors assignment.ts's private helper — checks stay isolated (the layering rule forbids a check
 *  importing a sibling check), so this small resolver is deliberately duplicated rather than shared. */
function argCheckableType(expr: Expr, scope: Scope, project: Scope): Type | undefined {
  const sym = enumValueRef(expr, scope, project)
  if (sym !== undefined) return { kind: "enum", name: sym.owner.name, scope: sym.owner }
  return checkable(inferExprType(expr, scope, project))
}

/** The enum-value symbol a bare (`Red`) or qualified (`Color.Red`) reference denotes, else undefined. */
function enumValueRef(expr: Expr, scope: Scope, project: Scope): Symbol | undefined {
  const sym =
    expr.kind === "ident_expr"
      ? (lookup(scope, expr.name)?.symbol ?? resolveBareEnumMember(project, expr.name))
      : expr.kind === "member"
        ? resolveMemberChain(expr, scope, project)
        : undefined
  return sym?.kind === "enum_value" && sym.owner.kind === "enum" ? sym : undefined
}
