/**
 * VAR_IN_OUT ARGUMENTS — what a by-reference parameter is bound to (a writable variable of the identical type, a STRING
 * long enough) and the in-outs a call left unbound. A `_` helper of `call-arguments.ts` (openspec lsp-same-standard
 * design.md §2.2), its tests in `_in-out-arguments.test.ts`.
 */
import type { CallArg, CalleeInfo, Expr, Scope, Span } from "../../../frontend/index.js"
import {
  constancyOf,
  DEFAULT_STRING_LENGTH,
  elementaryType,
  elementaryTypeRef,
  inferExprType,
  isSameType,
  resolveMemberChain,
  resolveTypeExpr,
  takesNoPositionalArguments,
} from "../../../frontend/types/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { type DiagnosticItem, SOURCE } from "../../shared/diagnostic-item.js"
import { argumentType } from "./_argument-types.js"

/**
 * (4) VAR_IN_OUT writability (C0041): a VAR_IN_OUT parameter must receive a writable variable, not a
 * literal/constant. Positional args bind by index (all-positional, complete chains only — a mixed or
 * incomplete call can't align indices); named args bind by name. Only a PROVABLY constant argument
 * (literal / CONSTANT var / enum value) fires — a member/index/deref lvalue is "unknown" and skips (zero-FP).
 */
export function checkInOutBindings(
  positional: readonly CallArg[],
  named: readonly CallArg[],
  callee: CalleeInfo,
  scope: Scope,
  ctx: CheckContext,
  out: DiagnosticItem[],
): void {
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
}

/**
 * (5) missing VAR_IN_OUT (C0039): a VAR_IN_OUT has no storage, so it MUST be bound at every call. Compute
 * which params the args cover — positional args cover `positional[i]` by index (all-positional only), named
 * args cover by name — and flag any VAR_IN_OUT left uncovered. Complete chains only; a MIXED named+positional
 * call can't map coverage unambiguously, so it skips (zero-FP).
 * A FUNCTION's or METHOD's is its count, above. An FB's positional arguments bind nothing (`input-assignment-missing`), so
 * they cover no VAR_IN_OUT either (`cg_fb_positional`, both vendors).
 */
export function checkMissingInOuts(
  callSpan: Span,
  positional: readonly CallArg[],
  named: readonly CallArg[],
  callee: CalleeInfo,
  ctx: CheckContext,
  out: DiagnosticItem[],
): void {
  if (!(callee.complete && !countsInOuts(callee) && !(positional.length > 0 && named.length > 0))) return
  const covered = new Set<string>()
  if (!takesNoPositionalArguments(callee.sym)) positional.forEach((_, i) => {
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

/** Both VAR_IN_OUT operand rules for one bound argument: writability (C0041) and exact-type identity (C0201). */
function inOutChecks(
  value: Expr,
  param: { name: { text: string }; type: Parameters<typeof resolveTypeExpr>[0]; constant: boolean },
  callee: string,
  scope: Scope,
  ctx: CheckContext,
  out: DiagnosticItem[],
): void {
  // VAR_IN_OUT CONSTANT (conformance `inout_const_*`): a STRING literal or STRING constant binds; an integer literal or
  // constant does not, in the section's own wording. It was reported in the plain VAR_IN_OUT wording — a false positive on
  // the STRING forms, the wrong message on the rest. Other types are not measured and stay silent (zero-FP).
  // An EXPRESSION is not an lvalue at all, whatever the parameter's constancy: `F(value := plainVar + 1)` is
  // "needs variable with write access as input" even for a VAR_IN_OUT CONSTANT, where a LITERAL gets that
  // section's own wording instead (conformance `inout_const_expression_2` against `inout_const_*`).
  // …nor is a CALL's result (`calls_inout_bound_to_call_result`) or a BIT access (`refuse_inout_bound_to_bit`, beside its
  // type identity below) — both vendors 2026-10-06. A PROPERTY is CODESYS's own sentence, TwinCAT's this one
  // (`calls_inout_bound_to_property`).
  const property = resolveMemberChain(value, scope, ctx.project)?.kind === "property"
  const propertyMessage = property ? ctx.messages.propertyBoundToInOut() : undefined
  if (propertyMessage !== undefined) {
    out.push({ severity: "error", span: value.span, source: SOURCE, code: "in-out-needs-writable", message: propertyMessage })
  } else if (value.kind === "binary" || value.kind === "unary" || value.kind === "paren" || value.kind === "call" || property || isBitAccess(value)) {
    out.push({
      severity: "error",
      span: value.span,
      source: SOURCE,
      code: "in-out-needs-writable",
      message: ctx.messages.inOutNeedsWritable(param.name.text, callee),
    })
  } else if (param.constant) {
    const argType = constancyOf(value, scope) === "constant" ? inferExprType(value, scope, ctx.project) : undefined
    // an untyped integer literal infers no type (its width is its context's), so it is recognised by its kind
    // …a VAR CONSTANT of an integer type on CODESYS only: TwinCAT refuses the literal and binds the constant
    // (`inout_const_bound_forms_1`'s TwinCAT recording, read in analysis-conformance 3.8)
    const integer =
      (value.kind === "literal" && value.literalKind === "int") ||
      (ctx.config.vendor === "codesys" && value.kind !== "literal" && argType?.kind === "elementary" && argType.elem.family === "int")
    if (integer) out.push({ severity: "error", span: value.span, source: SOURCE, code: "in-out-constant-needs-variable", message: ctx.messages.inOutConstantNeedsVariable(param.name.text, callee) })
  } else if (constancyOf(value, scope) === "constant") {
    // C0041 — a VAR_IN_OUT needs a writable variable, not a literal/constant.
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
  const pt = resolveTypeExpr(param.type, ctx.project, 0, ctx.project, ctx.uri)
  // A BIT ACCESS BOUND BY REFERENCE IS A `BIT`, and the vendor names it: `k(io := w.3)` against a
  // `VAR_IN_OUT io : BOOL` is "Type 'BIT' is not equal to type 'BOOL' of VAR_IN_OUT respectively REFERENCE 'io'"
  // (`refuse_inout_bound_to_bit`, measured). A numeric member is always a bit access (`checks/types/bit-number.ts`).
  //
  // ONLY HERE, and that is not timidity. Inferring BIT for every bit access was tried and the corpus gate refused
  // it on four real projects: a bit access is a perfectly good assignment TARGET and a perfectly good BOOL source,
  // and typing it BIT made both of those errors. What is special about a VAR_IN_OUT is that it binds by REFERENCE,
  // where no conversion is allowed and the storage's own type is what counts.
  const at = isBitAccess(value) ? elementaryTypeRef(elementaryType("BIT")!) : argumentType(value, scope, ctx)
  if (pt.kind === "elementary" && at.kind === "elementary" && !isSameType(pt, at)) {
    out.push({
      severity: "error",
      span: value.span,
      source: SOURCE,
      code: "in-out-type-mismatch",
      message: ctx.messages.inOutTypeMismatch(at.name, pt.name, param.name.text),
    })
  } else if (!param.constant && value.kind === "ident_expr" && pt.kind === "elementary" && at.kind === "elementary" && pt.elem.family === "string") {
    // A STRING bound to a VAR_IN_OUT that declares MORE units than the variable holds is "String variable 'v' too short for
    // the VAR_IN_OUT parameter 'io' of 'F'" (`string_inout_narrower`, `wstring_inout_narrower`, both vendors 2026-10-11;
    // lsp-transpile-review-gaps 2.5). Bound wider it builds (`string_inout_wider_*`), and a VAR_IN_OUT CONSTANT bound
    // narrower builds (`xo4_inout_constant_chain`). A capacity that does not fold is not judged.
    const capacity = (t: typeof pt): number | undefined => (t.kind !== "elementary" || t.unfoldedLength === true ? undefined : (t.length ?? DEFAULT_STRING_LENGTH))
    const [declared, held] = [capacity(pt), capacity(at)]
    if (declared !== undefined && held !== undefined && held < declared)
      out.push({ severity: "error", span: value.span, source: SOURCE, code: "in-out-string-too-short", message: ctx.messages.stringTooShortForInOut(value.name, param.name.text, callee) })
  }
}

/** `w.3` — a numeric member is always a bit access, never a field. */
function isBitAccess(e: Expr): boolean {
  return e.kind === "member" && /^\d+$/.test(e.member.name)
}

/** A callee whose in-outs are counted among its inputs — a FUNCTION, a METHOD, an INTERFACE method (section 4b) — where an
 *  FB's missing in-out is its own sentence (section 5). */
export function countsInOuts(callee: CalleeInfo): boolean {
  return callee.sym.kind === "function" || callee.sym.kind === "method" || callee.sym.kind === "interface_method"
}
