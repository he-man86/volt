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
 *   - `in-out-string-too-short` — a STRING bound to a VAR_IN_OUT that declares more units than it holds.
 *
 * Conservative (zero-FP): skips whenever the callee can't be resolved to a callable, and only type-checks
 * a side that is a checkable category (elementary or enum — a struct/FB/array/library type never fires).
 * Positional TYPE-checking runs only on all-positional calls (a mixed named+positional call can't bind
 * positionals by index — the mapping is ambiguous). Too-FEW is intentionally not diagnosed: FB inputs are
 * optional (retained between calls) and function optional/EN-ENO inputs would false-positive.
 * ponytail: no too-few check — the only spec requirement about omission is the negative "don't flag it".
 */
import {
  walkAllExprs,
  type CallArg,
  type Span,
  type TopLevel,
  type TypeExpr,
  type VarSection,
} from "../../../frontend/syntax/index.js"
import { bodies, isLibrarySymbol, lookupMember, scopeForUnit, type Scope } from "../../../frontend/symbols/index.js"
import {
  type CalleeInfo,
  constancyOf,
  resolveCallee,
  takesNoPositionalArguments,
} from "../../../frontend/types/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"
import { bindableMember } from "../../shared/resolution.js"
import { argTypeError, outputTypeError } from "./_argument-types.js"
import { checkInOutBindings, checkMissingInOuts, countsInOuts } from "./_in-out-arguments.js"

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

/** One call's arguments against its resolved callee, concern by concern — in the order the findings are reported. */
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
  checkPositionalCount(positional, callee, ctx, out)

  // (2) positional type-check — only on all-positional calls (mixed calls can't bind by index), and only
  // when every positional slot is a VAR_INPUT (`positionalArity === params.length`). If VAR_IN_OUT params
  // interleave, positional[i] does NOT align with the VAR_INPUT-only `params[i]`, so index-checking would
  // false-positive; skip those calls (count is still handled above).
  if (callee.complete && named.length === 0 && callee.positionalArity === callee.params.length) {
    positional.forEach((arg, i) => {
      const param = callee.params[i]
      if (param !== undefined && arg.value !== undefined) argTypeError(arg.value, param, callee.sym.name, scope, ctx, out)
    })
  }

  const { overCount, namedUnknown } = checkNamedArguments(callSpan, positional, named, callee, scope, ctx, out)
  checkInOutBindings(positional, named, callee, scope, ctx, out)
  if (callee.complete && !overCount && !namedUnknown && countsInOuts(callee)) checkRequiredInputs(callSpan, positional, named, callee, ctx, out)
  checkMissingInOuts(callSpan, positional, named, callee, ctx, out)
}

/**
 * (1) too many positional arguments vs positionally-bindable parameters — flag the first excess argument.
 * Vendor-mirrored wording: a FUNCTION/METHOD reports the exact input count it requires (C0040); an FB reports
 * the 1-based position of the arg that has no input to bind to (C0044).
 */
function checkPositionalCount(positional: readonly CallArg[], callee: CalleeInfo, ctx: CheckContext, out: DiagnosticItem[]): void {
  if (!(callee.complete && positional.length > callee.positionalArity)) return
  // an FB and a PROGRAM (rule DT9, `dt_program_called_positionally`)
  if (takesNoPositionalArguments(callee.sym)) {
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

/**
 * (3) named arguments — an unknown name is flagged (complete callees only); a known VAR_INPUT name's value
 * is type-checked. A name is known if it's a declared param OR (FB instance) a member a call may BIND —
 * an input, an output, an in-out or a property. `p => out` binds an OUTPUT, and it is checked in the opposite
 * direction — see `checkNamedArgument`.
 *
 * This asked `lookupMember` unfiltered, so ANY member counted and `inst(loc := 5)` on a plain `VAR loc : INT`
 * was accepted in silence — while the network-text check beside it already restricted to the pin sections.
 * One question, two answers in one package; `bindableMember` is now the one home, and both vendors say the
 * ST side was the wrong one (`cc_named_arg_non_input`).
 *
 * A FUNCTION's or METHOD's named arguments are COUNTED first: more `name := value` arguments than it has inputs is
 * "Function 'M1' requires exactly '1' inputs" (the declared case), once, and no name is then said to be no input or
 * output of it — an unknown one is only "Identifier not defined" (`mem_method_unknown_param_beside_known`,
 * `_no_input`, `mem_function_unknown_param_no_input`, and `expr_en_eno_call`'s `ENO => ok`, both vendors 2026-10-02).
 * Within the count a name is named (`_one_input`: "'zz' is no input of 'M1'"). An FB is never counted so.
 * Asked only of the recorded shape (step 3 review, 2026-10-03): plain VAR_INPUTs — no default, whose count CODESYS words
 * as a range (4b), and no VAR_IN_OUT, which `positionalArity` counts and 4b does not — distinct names, and an unknown
 * INPUT name among them (every recorded over-count has one: `zz`, `EN`). A repeated known name, a defaulted or in-out
 * signature are unasked and keep their old answers.
 *
 * `namedUnknown`: whether a name was said to be no input or output — the call is then refused for it, and the inputs it
 * left out are not counted on top (`mem_method_unknown_param_one_input`: "'zz' is no input of 'M1'" and no "requires"
 * for `a`).
 */
function checkNamedArguments(
  callSpan: Span,
  positional: readonly CallArg[],
  named: readonly CallArg[],
  callee: CalleeInfo,
  scope: Scope,
  ctx: CheckContext,
  out: DiagnosticItem[],
): { overCount: boolean; namedUnknown: boolean } {
  const isKnown = (name: string): boolean =>
    callee.paramNames.has(name) || (callee.scope !== undefined && bindableMember(callee.scope, name) !== undefined)
  const namedInputs = named.filter((a) => !a.output).map((a) => a.param!.name.toLowerCase())
  const overCount =
    callee.complete &&
    (callee.sym.kind === "function" || callee.sym.kind === "method") &&
    positional.length === 0 &&
    callee.positionalArity === callee.params.length &&
    callee.params.every((p) => !p.hasDefault) &&
    new Set(namedInputs).size === namedInputs.length &&
    namedInputs.some((n) => !isKnown(n)) &&
    namedInputs.length > callee.positionalArity
  if (overCount)
    out.push({
      severity: "error",
      span: callSpan,
      source: SOURCE,
      code: "function-argument-count",
      message: ctx.messages.functionRequiresInputs(callee.sym.name, callee.positionalArity),
    })
  let namedUnknown = false
  for (const arg of named) {
    const name = arg.param!.name.toLowerCase()
    // an OUTPUT binding naming one of the callee's INPUTS binds nothing: "'i' is no output of 'FB'"
    // (`calls_output_names_input`, both vendors 2026-10-06)
    const known = isKnown(name) && !(arg.output && inputSection(callee, name))
    if (overCount && !known) {
      if (!declaresAnything(callee, name))
        out.push({ severity: "error", span: arg.param!.span, source: SOURCE, code: "unresolved-identifier", message: ctx.messages.undefinedIdentifier(arg.param!.name) })
      continue
    }
    if (callee.complete && !known) {
      // an unknown INPUT name only (`mem_method_unknown_param_one_input`); an unknown output binding is unasked
      if (!arg.output) namedUnknown = true
      unknownNamedArgument(arg, name, callee, ctx, out)
      continue
    }
    checkNamedArgument(arg, name, callee, scope, ctx, out)
  }
  return { overCount, namedUnknown }
}

/** A named argument the callee has no input (or, `=>`, no output) of. */
function unknownNamedArgument(arg: CallArg, name: string, callee: CalleeInfo, ctx: CheckContext, out: DiagnosticItem[]): void {
  // An output binding (`name => target`) that names no output → C0038; an input `name := value` → C0037.
  out.push({
    severity: "error",
    span: arg.param!.span,
    source: SOURCE,
    code: arg.output ? "unknown-named-output" : "unknown-named-argument",
    // UPPER-CASED, as every recorded message from a CALL site is: `'loc' is no input of
    // 'FB_LANG_NAMED_ARG_HOLDER'` (`cc_named_arg_non_input`, `cc_vg_unknown_pin`, and the FUNCTION case in
    // `network_unnamed_target_of_valued_call`). A member WRITE from outside keeps the declared case —
    // `'iSecret' is no input of 'FB_LANG_hide_var'` — which is `external-write`'s `noInput`, not this. Same
    // sentence, two sites, and the vendors case them differently; the network check already knew.
    message: arg.output
      ? ctx.messages.unknownNamedOutput(arg.param!.name, callee.sym.name.toUpperCase())
      : ctx.messages.unknownNamedArgument(arg.param!.name, callee.sym.name.toUpperCase()),
  })
  // …and a name the callee declares NOTHING of is then looked up as an ordinary identifier, and not found either:
  // `itfRef.M(zz := 5)` is "Identifier 'zz' not defined" besides (`inh_interface_method_unknown_param`, both
  // vendors 2026-10-02), as a network box's unknown pin is (`cc_vg_unknown_pin`); a member that is no input is not
  // (`cc_named_arg_non_input`: `inst(loc := 5)` says only the first)
  // …an output binding's name too (`calls_unknown_output_fb`, `_function`, `_method`, both vendors 2026-10-06)
  if (!declaresAnything(callee, name))
    out.push({
      severity: "error",
      span: arg.param!.span,
      source: SOURCE,
      code: "unresolved-identifier", // C0046's sentence, under C0046's code — not the C0037 of the one above
      message: ctx.messages.undefinedIdentifier(arg.param!.name),
    })
}

/** A named argument the callee knows: an input's value, or (`=>`) the target an output flows into, type-checked. */
function checkNamedArgument(arg: CallArg, name: string, callee: CalleeInfo, scope: Scope, ctx: CheckContext, out: DiagnosticItem[]): void {
  if (arg.output) {
    // `w(o => text)` — the OUTPUT flows INTO the target, so the direction is the reverse of an input's: the
    // output's declared type is the source and the bound variable is the destination. CODESYS reports it as a
    // plain conversion, "Cannot convert type 'INT' to type 'STRING'" (conformance
    // `accepts_output_into_other_type`); the transpiler already refuses the same shape (`call-output-type`).
    // A FUNCTION's or METHOD's output is read from its own sections — it has no member scope — and judged alike, with
    // the conversion warning an assignment earns: a DINT output into an INT is "Cannot convert type 'DINT' to type
    // 'INT'", a WORD one "Implicit conversion from unsigned Type 'WORD' to signed Type 'INT'" (`tr_43_routine_output_*`,
    // both vendors 2026-10-09; lsp-transpile-review-gaps 2.4). The FB path's warning is unmeasured.
    if (callee.scope === undefined) {
      const type = directOutputType(callee, name)
      if (arg.value !== undefined && type !== undefined) outputTypeError(type, arg.value, scope, ctx, out, true)
    } else {
      const sym = lookupMember(callee.scope, name)
      if (arg.value !== undefined && sym?.varSection === "VAR_OUTPUT" && sym.typeExpr !== undefined)
        outputTypeError(sym.typeExpr, arg.value, scope, ctx, out)
    }
    return
  }
  if (arg.value !== undefined) {
    const param = callee.params.find((p) => p.name.text.toLowerCase() === name)
    if (param !== undefined) argTypeError(arg.value, param, callee.sym.name, scope, ctx, out)
  }
}

/**
 * (4b) a FUNCTION's inputs WITHOUT a default are REQUIRED. Too-few is not diagnosed in general — an FB's inputs
 * are retained between calls, so leaving one out is normal — but a function has no instance to retain anything,
 * and CODESYS says so with the count as a RANGE when defaults exist: "requires at least '1' and maximum '2'
 * inputs" (conformance `callshape_function_input_no_default`). The trigger is the missing REQUIRED input, not the
 * count: that fixture passes one argument, which is inside the range, and is still an error because the one it
 * passed is the defaulted one.
 * …AND A METHOD'S, identically. This was gated to `function` and the METHOD form had never been asked on its
 * own; `callshape_method_input_no_default` asks it and both vendors answer with the FUNCTION message, naming the
 * method: "Function 'Blend' requires at least '1' and maximum '2' inputs" on CODESYS, "exactly '2'" on TwinCAT.
 * …AND AN INTERFACE METHOD'S through a reference (`calls_inout_unbound_interface_method`, gate 3.7+3.9).
 */
function checkRequiredInputs(
  callSpan: Span,
  positional: readonly CallArg[],
  named: readonly CallArg[],
  callee: CalleeInfo,
  ctx: CheckContext,
  out: DiagnosticItem[],
): void {
  const mixed = positional.length > 0 && named.length > 0
  const bound = new Set<string>(named.map((a) => a.param!.name.toLowerCase()))
  positional.forEach((_, i) => {
    const p = callee.positional[i]
    if (p !== undefined) bound.add(p.name.text.toLowerCase())
  })
  // A DEFAULT DOES NOT MAKE AN INPUT OPTIONAL ON TWINCAT — the question the wording note below called "a
  // different question and not measured". `callshape_input_left_out` measures it: leaving out the DEFAULTED
  // input alone is silent on CODESYS and "requires exactly '2' inputs" there, for a METHOD and a FUNCTION both.
  // …and on CODESYS a default that is a VARIABLE is none: "Default value is not constant", and the input is required
  // (`callarg_no_argument_variable_default`, CODESYS 2026-10-06)
  // …read in the CALLEE's own scope, where its VAR CONSTANT shadows a global VARIABLE of the name
  // (`calls_default_local_constant_shadows_global` builds, CODESYS gate 3.7+3.9); a callee with no scope of its own (a
  // library's) has its defaults unjudged, as they were before 3.8
  const ownScope = callee.scope ?? scopeForUnit(ctx.project, callee.sym.ast as TopLevel)
  const variableDefault = (p: CalleeInfo["params"][number]) =>
    p.default !== undefined && p.default.kind !== "aggregate_init" && ownScope !== undefined && constancyOf(p.default, ownScope) === "variable"
  const required = ctx.config.vendor === "twincat" ? callee.params : callee.params.filter((p) => !p.hasDefault || variableDefault(p))
  // A FUNCTION'S OR METHOD'S IN-OUTS ARE COUNTED AMONG ITS INPUTS, whichever argument is missing: "Function 'F' requires
  // exactly '2' inputs" for one input and one in-out, given the input alone or the in-out alone (`calls_inout_unbound_function`,
  // `_method`, both vendors 2026-10-06; `calls_inout_given_input_missing`, gate 3.7+3.9), where an FB's says "VAR_IN_OUT
  // 'io' must be assigned". An in-out left out of a MIXED positional+named call is the count too (`calls_inout_unbound_mixed`:
  // "exactly '3'"); a mixed call's missing input alone is unasked and stays silent. With defaults beside an in-out the
  // range is unasked: its bounds count the in-outs alike.
  const inOuts = callee.positional.filter((p) => p.inOut)
  const inOutLeftOut = inOuts.some((p) => !bound.has(p.name.text.toLowerCase()))
  const inputLeftOut = !mixed && required.some((p) => !bound.has(p.name.text.toLowerCase()))
  if (!inputLeftOut && !inOutLeftOut) return
  const [min, max] = [required.length + inOuts.length, callee.params.length + inOuts.length]
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
      min === max || inOutLeftOut || ctx.config.vendor === "twincat"
        ? ctx.messages.functionRequiresInputs(callee.sym.name, max)
        : ctx.messages.functionRequiresInputRange(callee.sym.name, min, max),
  })
}

/** Does the callee declare `name` as a VAR_INPUT? */
function inputSection(callee: CalleeInfo, name: string): boolean {
  if (callee.scope !== undefined) return lookupMember(callee.scope, name)?.varSection === "VAR_INPUT"
  return callee.params.some((p) => p.name.text.toLowerCase() === name)
}

/** A direct callable's (a FUNCTION's, a METHOD's) VAR_OUTPUT `name`'s declared type, from its own sections. */
function directOutputType(callee: CalleeInfo, name: string): TypeExpr | undefined {
  const sections = (callee.sym.ast as { varSections?: readonly VarSection[] }).varSections ?? []
  return sections
    .filter((s) => s.sectionKind === "VAR_OUTPUT")
    .flatMap((s) => s.decls)
    .find((d) => d.names.some((n) => n.text.toLowerCase() === name))?.type
}

/** Does the callee declare `name` at all — a member of the instance's FB (its chain's), or any variable of a direct
 *  callable's sections (a local too, which is no parameter)? */
function declaresAnything(callee: CalleeInfo, name: string): boolean {
  if (callee.scope !== undefined) return lookupMember(callee.scope, name) !== undefined
  const sections = (callee.sym.ast as { varSections?: readonly { decls: readonly { names: readonly { text: string }[] }[] }[] }).varSections ?? []
  return sections.some((s) => s.decls.some((d) => d.names.some((n) => n.text.toLowerCase() === name)))
}
