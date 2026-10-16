/**
 * ARGUMENT TYPES — an input argument whose type cannot feed its parameter, an output binding whose target cannot hold
 * the output, and the type a by-reference argument is compared by. A `_` helper of `call-arguments.ts` (openspec
 * lsp-same-standard design.md §2.2), its tests in `_argument-types.test.ts`.
 */
import { type Expr } from "../../../frontend/syntax/index.js"
import { type Scope } from "../../../frontend/symbols/index.js"
import {
  type Type,
  inferExprType,
  literalOwnType,
  elementaryTypeRef,
  resolveTypeExpr,
  isAssignable,
  renderType,
  type CalleeInfo,
  isIntLiteral,
} from "../../../frontend/types/index.js"
import { GENERIC_PARAMETER_TYPES, genericParameterAccepts } from "../../../frontend/types/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { type DiagnosticItem, SOURCE, withFixes } from "../../shared/diagnostic-item.js"
import { checkable, checkableType, conversionWarning, conversionWrapInto, isStrictEnum } from "../../shared/rules.js"

/**
 * The argument's type for the by-reference identity test. An untyped integer literal has no inferred type — its width
 * comes from its context — but a VAR_IN_OUT gives it none, so the compiler falls back to the literal's own NARROWEST
 * type and compares that: `F(value := 5)` where `value : INT` is "Type 'SINT' is not equal to type 'INT'"
 * (conformance `inout_plain_literal_4`, `cc2_in_out_not_assigned`, `inout_const_bound_forms_1`,
 * `inout_const_fb_literal_6`). Without this the identity test skipped every literal.
 */
export function argumentType(value: Expr, scope: Scope, ctx: CheckContext): Type {
  const inferred = inferExprType(value, scope, ctx.project)
  if (inferred.kind !== "unknown") return inferred
  if (value.kind !== "literal") return inferred
  const narrowest = literalOwnType(value)
  return narrowest === undefined ? inferred : elementaryTypeRef(narrowest)
}

/**
 * An output binding's target must be able to hold the output. Conservative in the same way `argTypeError` is: both
 * sides must be a checkable category, and it reuses the same wording and the same `isAssignable` engine, only with
 * source and destination the other way round. The conversion WARNING (`warn`) only on the routine path, where it is
 * measured (`tr_43_routine_output_word_to_int`); an FB's narrowing output binding has not been, and inventing one would be
 * a message the vendor may not print.
 */
export function outputTypeError(
  outputType: Parameters<typeof resolveTypeExpr>[0],
  target: Expr,
  scope: Scope,
  ctx: CheckContext,
  out: DiagnosticItem[],
  warn = false,
): void {
  const src = checkable(resolveTypeExpr(outputType, ctx.project, 0, ctx.project, ctx.uri))
  if (src === undefined) return
  const dst = checkableType(target, scope, ctx.project)
  if (dst === undefined) return
  if (isAssignable(dst, src)) {
    const w = warn ? conversionWarning(dst, src, target, ctx.messages) : undefined
    if (w !== undefined) out.push(w)
    return
  }
  out.push({
    severity: "error",
    span: target.span,
    source: SOURCE,
    code: "call-argument-type",
    message: ctx.messages.cannotConvert(renderType(src, { form: "compiler" }), renderType(dst, { form: "compiler" })),
  })
}

/** A literal argument, written plain or negated (`5`, `-1`, `TRUE`, `'abc'`, `INT#5`). */
const isLiteralArgument = (e: Expr): boolean => e.kind === "literal" || (e.kind === "unary" && e.op === "-" && e.operand.kind === "literal")

/** Flag an argument whose checkable type is not assignment-compatible with its parameter's declared type. */
export function argTypeError(
  value: Expr,
  param: CalleeInfo["params"][number],
  callee: string,
  scope: Scope,
  ctx: CheckContext,
  out: DiagnosticItem[],
): void {
  const paramType = param.type
  // A GENERIC PARAMETER (rule TY14): ANY and the ANY_* groups take an argument by its family, and refuse one outside it
  // in the group's own name — "Cannot convert type 'STRING' to type 'ANY_NUM'"; and they take a VARIABLE — a literal is
  // "ANY parameter 'x' of 'F' needs variable with write access as input" (`ty_any_*`, `lt_literal_any_int_argument`, both
  // vendors 2026-10-03). Its type resolves to nothing, so the elementary check below never reached it.
  // Only those two shapes are measured: a VARIABLE (`ty_any_*`) and an untyped integer literal into ANY_INT
  // (`lt_literal_any_int_argument`). Any other literal into a generic input — 5 into ANY_STRING, TRUE into ANY_BIT,
  // 'abc', 1.5 — is unrecorded and stays silent (step 4a review).
  if (paramType.kind === "named_type" && paramType.qualifiers === undefined && GENERIC_PARAMETER_TYPES.has(paramType.name.text.toUpperCase())) {
    const group = paramType.name.text
    if (isLiteralArgument(value)) {
      if (isIntLiteral(value) && group.toUpperCase() === "ANY_INT")
        out.push({ severity: "error", span: value.span, source: SOURCE, code: "in-out-needs-writable", message: ctx.messages.anyNeedsWritable(param.name.text, callee) })
      return
    }
    const argType = checkableType(value, scope, ctx.project)
    if (argType !== undefined && genericParameterAccepts(group, argType, ctx.project.dialect) === false) {
      out.push({
        severity: "error",
        span: value.span,
        source: SOURCE,
        code: "call-argument-type",
        message: ctx.messages.cannotConvert(renderType(argType, { form: "compiler" }), group.toUpperCase()),
      })
      return
    }
  }
  const target = checkable(resolveTypeExpr(paramType, ctx.project, 0, ctx.project, ctx.uri))
  if (target === undefined) return
  // An argument into a `{attribute 'strict'}` enum input is unmeasured: P14 was recorded on stores only, where the vendor
  // refuses any value but the enum's own by its text, never with a conversion warning — so the plain-enum rules
  // (another enum's value WARNS, a scalar converts as the base) would put words in its mouth here. Missing, never wrong.
  if (isStrictEnum(target, ctx.project)) return
  const arg = checkableType(value, scope, ctx.project)
  if (arg === undefined) return
  if (isAssignable(target, arg)) {
    // ASSIGNABLE IS NOT THE SAME AS CLEAN. A narrowing (`LREAL`→`REAL`) and a sign crossing (`INT`→`UINT`) are
    // both assignable, so this returned early and a call site never produced the warning an identical plain
    // assignment does — measured on the lenze-mid corpus, where the build's one "change of sign" warning had no
    // counterpart from us. Same relation, same wording, same codes: `narrowing.ts` owns the mapping.
    // …ON CODESYS. TwinCAT warns about a sign crossing in every ASSIGNMENT and in none of these: six cells,
    // two different sources and five target types — `cc_enum_arg_into_{uint,udint,word,dword}` (an enum into
    // an unsigned input) and `atomic_xadd_{dword,lword}` (a DINT into one) — all silent there while CODESYS
    // warns, with its recording of the same fixtures to compare against (2026-09-20). A NARROWING at an
    // argument is not covered by that measurement and keeps firing for both.
    const warning = conversionWarning(target, arg, value, ctx.messages)
    // its fix: wrap the argument in the conversion the compiler makes anyway (`qf_c0197_wrap_argument`)
    if (warning !== undefined && !(ctx.config.vendor === "twincat" && warning.code === "sign-change-conversion"))
      out.push(withFixes(warning, [conversionWrapInto(target, value, scope, ctx.project, ctx.source, true)]))
    return
  }
  // its fix: wrap the argument in `TO_<parameter type>(…)` (`qf_callarg_wrap`, design.md §4 F1) — offered, not preferred
  // and not fix-all: an ERROR's argument may be the wrong variable rather than a missing conversion, exactly as C0032's
  // value at an assignment (design.md §2 As built: `preferred` only on a warning's wrap)
  out.push(
    withFixes(
      {
        severity: "error",
        span: value.span,
        source: SOURCE,
        code: "call-argument-type",
        message: ctx.messages.cannotConvert(renderType(arg, { form: "compiler" }), renderType(target, { form: "compiler" })),
      },
      [conversionWrapInto(target, value, scope, ctx.project, ctx.source, false)],
    ),
  )
}
