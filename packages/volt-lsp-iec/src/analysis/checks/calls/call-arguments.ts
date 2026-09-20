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
import { bodies, isLibrarySymbol, lookupMember, type Scope } from "../../../symbols/index.js"
import {
  constancyOf,
  elementaryType,
  elementaryTypeRef,
  inferExprType,
  integerLiteralType,
  isAssignable,
  isSameType,
  resolveCallee,
  resolveTypeExpr,
  type CalleeInfo,
  type Type,
} from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { compilerTypeName } from "../../messages.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"
import { checkable, checkableType, conversionWarning } from "../../rules.js"

export function checkCallArguments(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkAllExprs(statements, (e) => {
      if (e.kind !== "call") return
      const callee = resolveCallee(e, scope, ctx.project)
      if (callee === undefined) return // unresolved callee → skip (zero-FP)
      // A library FB's or method's materialized signature is lossy — inheritance is flattened, inputs may vanish — so its
      // arguments are not checked. A library FUNCTION has no inheritance and keeps its VAR_INPUT: it is checked like any
      // other. Skipping it too hid "Cannot convert type 'WSTRING' to type 'STRING(255)'" for Standard's LEN (gap 9).
      if (isLibrarySymbol(callee.sym) && callee.sym.kind !== "function") return
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
    const isFb = callee.sym.kind === "function_block"
    if (isFb) {
      // ONE MESSAGE PER POSITIONAL ARGUMENT, each naming THAT ARGUMENT'S SOURCE TEXT, and the callee UPPER-CASED.
      // All three were wrong and the third is the vendor's own inconsistency, not ours: this message upper-cases the
      // FB's name where the VAR_IN_OUT one two hundred lines below keeps the declared case — `refuse_inout_not_given`
      // records 'FB_LANG_inoutmissing_target' in the same breath.
      //
      // Measured on `calls/call-grid.ts` (2026-09-19): `target(1, 2, mark)` on an FB is three errors naming '1',
      // '2' and 'mark' — so the parameter is the argument as WRITTEN, not its position, which was only ever right
      // by coincidence when somebody passed the number 1 first. `refuse_fb_called_positionally` passes `5` in the
      // first slot and the vendor says '5'.
      for (const arg of positional)
        out.push({
          severity: "error",
          span: arg.span,
          source: SOURCE,
          code: "input-assignment-missing",
          message: ctx.messages.inputAssignmentMissing(
            ctx.source.slice(arg.span.start, arg.span.end).trim(),
            callee.sym.name.toUpperCase(),
          ),
        })
    } else {
      const excess = positional[callee.positionalArity]!
      out.push({
        severity: "error",
        span: excess.span,
        source: SOURCE,
        code: "function-argument-count",
        message: ctx.messages.functionRequiresInputs(callee.sym.name, callee.positionalArity),
      })
    }
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
  // `p => out` binds an OUTPUT, and it is checked in the opposite direction — see the `arg.output` branch below.
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
    if (arg.output) {
      // `w(o => text)` — the OUTPUT flows INTO the target, so the direction is the reverse of an input's: the
      // output's declared type is the source and the bound variable is the destination. CODESYS reports it as a
      // plain conversion, "Cannot convert type 'INT' to type 'STRING'" (conformance
      // `accepts_output_into_other_type`); the transpiler already refuses the same shape (`call-output-type`).
      const sym = callee.scope === undefined ? undefined : lookupMember(callee.scope, name)
      if (arg.value !== undefined && sym?.varSection === "VAR_OUTPUT" && sym.typeExpr !== undefined)
        outputTypeError(sym.typeExpr, arg.value, scope, ctx, out)
      continue
    }
    if (arg.value !== undefined) {
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

  // (4b) a FUNCTION's inputs WITHOUT a default are REQUIRED. Too-few is not diagnosed in general — an FB's inputs
  // are retained between calls, so leaving one out is normal — but a function has no instance to retain anything,
  // and CODESYS says so with the count as a RANGE when defaults exist: "requires at least '1' and maximum '2'
  // inputs" (conformance `callshape_function_input_no_default`). The trigger is the missing REQUIRED input, not the
  // count: that fixture passes one argument, which is inside the range, and is still an error because the one it
  // passed is the defaulted one.
  if (callee.complete && callee.sym.kind === "function" && !(positional.length > 0 && named.length > 0)) {
    const bound = new Set<string>(named.map((a) => a.param!.name.toLowerCase()))
    positional.forEach((_, i) => {
      const p = callee.positional[i]
      if (p !== undefined) bound.add(p.name.text.toLowerCase())
    })
    const required = callee.params.filter((p) => !p.hasDefault)
    if (required.some((p) => !bound.has(p.name.text.toLowerCase()))) {
      const max = callee.params.length
      out.push({
        severity: "error",
        span: callSpan,
        source: SOURCE,
        code: "function-argument-count",
        // TWINCAT NEVER WORDS IT AS A RANGE: it says "requires exactly '2' inputs" where CODESYS says "at
        // least '1' and maximum '2'", counting ALL the inputs either way (`callshape_function_input_no_default`
        // and `callshape_input_left_out`, its recording 2026-09-20). Whether a default also stops being
        // OPTIONAL there is a different question and not measured: this changes the wording, not the trigger.
        message:
          required.length === max || ctx.config.vendor === "twincat"
            ? ctx.messages.functionRequiresInputs(callee.sym.name, max)
            : ctx.messages.functionRequiresInputRange(callee.sym.name, required.length, max),
      })
    }
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
  if (value.kind === "binary" || value.kind === "unary" || value.kind === "paren") {
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
    const integer = (value.kind === "literal" && value.literalKind === "int") || (argType?.kind === "elementary" && argType.elem.family === "int")
    const message = integer ? ctx.messages.inOutConstantNeedsVariable(param.name.text, callee) : undefined
    if (message !== undefined) out.push({ severity: "error", span: value.span, source: SOURCE, code: "in-out-constant-needs-variable", message })
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
  const pt = resolveTypeExpr(param.type, ctx.project)
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
  }
}

/** `w.3` — a numeric member is always a bit access, never a field. */
function isBitAccess(e: Expr): boolean {
  return e.kind === "member" && /^\d+$/.test(e.member.name)
}

/**
 * The argument's type for the by-reference identity test. An untyped integer literal has no inferred type — its width
 * comes from its context — but a VAR_IN_OUT gives it none, so the compiler falls back to the literal's own NARROWEST
 * type and compares that: `F(value := 5)` where `value : INT` is "Type 'SINT' is not equal to type 'INT'"
 * (conformance `inout_plain_literal_4`, `cc2_in_out_not_assigned`, `inout_const_bound_forms_1`,
 * `inout_const_fb_literal_6`). Without this the identity test skipped every literal.
 */
function argumentType(value: Expr, scope: Scope, ctx: CheckContext): Type {
  const inferred = inferExprType(value, scope, ctx.project)
  if (inferred.kind !== "unknown") return inferred
  if (value.kind !== "literal" || value.literalKind !== "int" || typeof value.value !== "bigint") return inferred
  const narrowest = integerLiteralType(value.value)
  return narrowest === undefined ? inferred : elementaryTypeRef(narrowest)
}

/**
 * An output binding's target must be able to hold the output. Conservative in the same way `argTypeError` is: both
 * sides must be a checkable category, and it reuses the same wording and the same `isAssignable` engine, only with
 * source and destination the other way round. No conversion WARNING here — a narrowing output binding has not been
 * measured, and inventing one would be a message the vendor may not print.
 */
function outputTypeError(
  outputType: Parameters<typeof resolveTypeExpr>[0],
  target: Expr,
  scope: Scope,
  ctx: CheckContext,
  out: DiagnosticItem[],
): void {
  const src = checkable(resolveTypeExpr(outputType, ctx.project))
  if (src === undefined) return
  const dst = checkableType(target, scope, ctx.project)
  if (dst === undefined || isAssignable(dst, src)) return
  out.push({
    severity: "error",
    span: target.span,
    source: SOURCE,
    code: "call-argument-type",
    message: ctx.messages.cannotConvert(compilerTypeName(src), compilerTypeName(dst)),
  })
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
    if (warning !== undefined && !(ctx.config.vendor === "twincat" && warning.code === "sign-change-conversion"))
      out.push(warning)
    return
  }
  out.push({
    severity: "error",
    span: value.span,
    source: SOURCE,
    code: "call-argument-type",
    message: ctx.messages.cannotConvert(compilerTypeName(arg), compilerTypeName(target)),
  })
}
