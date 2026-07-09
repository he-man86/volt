/**
 * call-argument checks (D.2 · calls/). Validates a call against its resolved callee's declared parameters:
 *   - too-many positional args — `function-argument-count` (C0040, function/method) or `input-assignment-missing`
 *     (C0044, FB), split by callee kind for vendor-mirrored wording.
 *   - `call-argument-type`  — an argument whose type can't feed its parameter (reuses `cannotConvert`,
 *                             the same wording + `isAssignable` engine as `assignment.ts`).
 *   - `unknown-named-argument` — a `name := value` naming no input of the callee (C0037).
 *   - `unknown-named-output`   — a `name => target` binding naming no output of the callee (C0038).
 *   - `in-out-needs-writable`  — a VAR_IN_OUT parameter passed a literal/constant argument (C0041).
 *   - `in-out-type-mismatch`   — a VAR_IN_OUT parameter bound to an argument of a non-identical type (C0201).
 *   - `in-out-not-assigned`    — a VAR_IN_OUT parameter left unbound in a call (C0039).
 *
 * Conservative (zero-FP): skips whenever the callee can't be resolved to a callable, and only type-checks
 * a side that is a checkable category (elementary or enum — a struct/FB/array/library type never fires).
 * Positional TYPE-checking runs only on all-positional calls (a mixed named+positional call can't bind
 * positionals by index — the mapping is ambiguous). Too-FEW is intentionally not diagnosed: FB inputs are
 * optional (retained between calls) and function optional/EN-ENO inputs would false-positive.
 * ponytail: no too-few check — the only spec requirement about omission is the negative "don't flag it".
 */
import { walkAllExprs, type CallArg, type Expr, type Span } from "../../../syntax/index.js"
import { bodies, lookup, lookupMember, resolveBareEnumMember, type Scope, type Symbol } from "../../../symbols/index.js"
import {
  constancyOf,
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
      checkCall(e.args, e.callee.span, callee, scope, ctx, out)
    })
  }
}

function checkCall(
  args: readonly CallArg[],
  callSpan: Span,
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
  // Vendor-mirrored wording: a FUNCTION/METHOD reports the exact input count it requires (C0040); an FB reports
  // the 1-based position of the arg that has no input to bind to (C0044).
  if (callee.complete && positional.length > callee.positionalArity) {
    const excess = positional[callee.positionalArity]
    const isFb = callee.sym.kind === "function_block"
    out.push({
      severity: "error",
      span: excess.span,
      source: SOURCE,
      code: isFb ? "input-assignment-missing" : "function-argument-count",
      message: isFb
        ? ctx.messages.inputAssignmentMissing(String(callee.positionalArity + 1), callee.sym.name)
        : ctx.messages.functionRequiresInputs(callee.sym.name, callee.positionalArity),
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
      // An output binding (`name => target`) that names no output → C0038; an input `name := value` → C0037.
      out.push({
        severity: "error",
        span: arg.param!.span,
        source: SOURCE,
        code: arg.output ? "unknown-named-output" : "unknown-named-argument",
        message: arg.output
          ? ctx.messages.unknownNamedOutput(arg.param!.name, callee.sym.name)
          : ctx.messages.unknownNamedArgument(arg.param!.name, callee.sym.name),
      })
      continue
    }
    if (!arg.output && arg.value !== undefined) {
      const param = callee.params.find((p) => p.name.text.toLowerCase() === name)
      if (param !== undefined) argTypeError(arg.value, param.type, scope, ctx, out)
    }
  }

  // (4) VAR_IN_OUT writability (C0041): a VAR_IN_OUT parameter must receive a writable variable, not a
  // literal/constant. Positional args bind by index (all-positional, complete chains only — a mixed or
  // incomplete call can't align indices); named args bind by name. Only a PROVABLY constant argument
  // (literal / CONSTANT var / enum value) fires — a member/index/deref lvalue is "unknown" and skips (zero-FP).
  if (callee.complete && named.length === 0) {
    positional.forEach((arg, i) => {
      const param = callee.positional[i]
      if (param?.inOut && arg.value !== undefined) inOutChecks(arg.value, param, callee.sym.name, scope, ctx, out)
    })
  }
  for (const arg of named) {
    if (arg.output || arg.value === undefined) continue
    const lname = arg.param!.name.toLowerCase()
    const param = callee.positional.find((p) => p.inOut && p.name.text.toLowerCase() === lname)
    if (param !== undefined) inOutChecks(arg.value, param, callee.sym.name, scope, ctx, out)
  }

  // (5) missing VAR_IN_OUT (C0039): a VAR_IN_OUT has no storage, so it MUST be bound at every call. Compute
  // which params the args cover — positional args cover `positional[i]` by index (all-positional only), named
  // args cover by name — and flag any VAR_IN_OUT left uncovered. Complete chains only; a MIXED named+positional
  // call can't map coverage unambiguously, so it skips (zero-FP).
  if (callee.complete && !(positional.length > 0 && named.length > 0)) {
    const covered = new Set<string>()
    positional.forEach((_, i) => {
      const p = callee.positional[i]
      if (p !== undefined) covered.add(p.name.text.toLowerCase())
    })
    for (const arg of named) covered.add(arg.param!.name.toLowerCase())
    for (const p of callee.positional) {
      if (p.inOut && !covered.has(p.name.text.toLowerCase()))
        out.push({
          severity: "error",
          span: callSpan,
          source: SOURCE,
          code: "in-out-not-assigned",
          message: ctx.messages.inOutMustBeAssigned(p.name.text, callee.sym.name),
        })
    }
  }
}

/** Both VAR_IN_OUT operand rules for one bound argument: writability (C0041) and exact-type identity (C0201). */
function inOutChecks(
  value: Expr,
  param: { name: { text: string }; type: Parameters<typeof resolveTypeExpr>[0] },
  callee: string,
  scope: Scope,
  ctx: CheckContext,
  out: DiagnosticItem[],
): void {
  // C0041 — a VAR_IN_OUT needs a writable variable, not a literal/constant.
  if (constancyOf(value, scope) === "constant") {
    out.push({
      severity: "error",
      span: value.span,
      source: SOURCE,
      code: "in-out-needs-writable",
      message: ctx.messages.inOutNeedsWritable(param.name.text, callee),
    })
  }
  // C0201 — a VAR_IN_OUT is by-reference, so the argument's type must be IDENTICAL (not merely assignable).
  // Conservative: both sides KNOWN elementary and differently-named (aliases resolve, so INT≡an INT alias).
  const pt = resolveTypeExpr(param.type, ctx.project)
  const at = inferExprType(value, scope, ctx.project)
  if (pt.kind === "elementary" && at.kind === "elementary" && pt.name !== at.name) {
    out.push({
      severity: "error",
      span: value.span,
      source: SOURCE,
      code: "in-out-type-mismatch",
      message: ctx.messages.inOutTypeMismatch(at.name, pt.name, param.name.text),
    })
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
