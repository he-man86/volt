/**
 * Calls: an FB instance's body, a METHOD, ACTION, PROPERTY accessor or FUNCTION lowered once — and what a call may bind
 * as `&mut`.
 *
 * Inheritance, as recorded (conformance `inh_*`): calling a derived FB runs ONLY its own body; `SUPER^()` runs the base
 * body on the same instance, `SUPER^.M()` the base's method; and every METHOD call — written in a derived body, a base
 * body or a base method alike — resolves against the instance's own type, so an override wins. Each routine is therefore
 * lowered for the FB it runs ON (the frame, `THIS^`), once per such FB, while `SUPER^` is read from the FB whose code it
 * is (`codeOwner`).
 *
 * Routine state, as recorded (conformance `state_*`): a METHOD's VAR_INST is kept per instance, its VAR_STAT is one
 * variable shared by every instance, and a PROPERTY getter runs once per read with its own VAR started over.
 */

import { Lowering, type PendingBody } from "../lowering.js"
import { type Expr, isStBody, type Span, type TopLevel, type VarSection } from "../../../frontend/syntax/index.js"
import type { IrLayout, IrRoutine, IrStmt, Place } from "../../ir/index.js"
import { touchesOf } from "./reentrancy.js"
import { childScopesByName, findChildScope, lookup, type Scope } from "../../../frontend/symbols/index.js"
import type { FbType, RoutineSymbol } from "../core/lowering.js"
import { declareInOuts, declareOpenBounds, declareVars } from "../storage/declare.js"
import { inOutSections, positionalOf, positionalParameters, prefixed } from "./parameters.js"
import { ANY_FAMILIES, elementaryRef, type Type, typeZero } from "../../../frontend/types/index.js"
import { ANY_TARGET, anyArgumentTypes, anyInputsOf } from "../pointers/any.js"
import { CURSOR, type CursorArgument, cursorArgumentTypes, cursorInputsOf } from "../pointers/cursor.js"
import { typeKey } from "./variants.js"
import { libraryOf } from "../../../frontend/library/index.js"
import { execBodyStatements } from "../conditions.js"
import { storageOf } from "../storage/layout.js"
import { BORROWED, borrowedInputsOf, borrowedPointerSlots } from "../pointers/borrowed.js"
import { overridesCalled, reachedNames } from "../core/ast-walk.js"
import { chainNames, chainOf } from "../core/chain.js"
import { lowerBlock } from "../statements/statements.js"
import { tempResets } from "../init/temp-resets.js"

/**
 * A routine lowered once per POU under `name`: cached, or refused if it failed before — or if it is reached again while
 * its own body lowers, which is a routine calling itself and lowered it again without end (a RangeError out of lowering;
 * transpiler review 2026-09-15). Whether CODESYS allows a recursive call at all is not measured.
 */
export function once(lw: Lowering, name: string, span: Span, build: () => IrRoutine | undefined): IrRoutine | undefined {
  const key = name.toUpperCase()
  const cached = lw.routines.get(key)
  if (cached?.state === "failed") return lw.bail("call-body", `${name}'s body does not lower`, span)
  if (cached?.state === "lowering") return lw.bail("call-recursive", `${name} calls itself`, span)
  let routine = cached?.state === "lowered" ? cached.routine : undefined
  if (routine === undefined) {
    lw.routines.set(key, { state: "lowering" })
    routine = build()
    lw.routines.set(key, routine === undefined ? { state: "failed" } : { state: "lowered", routine })
  }
  // the program instances the routine reaches are reached by whoever calls it (`Lowering.touched`)
  for (const slot of touchesOf(lw).get(key) ?? []) lw.touched.add(slot)
  return routine
}

/** The lowering a routine body is lowered in: the frame's fields (when it runs on an instance) plus per-call locals. */
export function routineLowering(lw: Lowering, scope: Scope, frame: FbType | undefined, codeOwner: Scope | undefined, key: string, displayName = key): Lowering {
  const r = new Lowering(scope, lw.project, lw.shared)
  r.displayName = displayName
  touchesOf(lw).set(key, r.touched)
  lw.shared.routineLowerings.set(key, r)
  const layout = frame === undefined ? undefined : lw.layouts.get(frame.name.toUpperCase())
  if (layout !== undefined) r.inherit(layout.fields)
  // the FB's VAR_STAT, one global each, by their own names (`declareStatics`)
  for (const shared of layout?.statics ?? []) r.statics.set(shared.name.toUpperCase(), shared.global)
  r.selfType = frame
  r.codeOwner = codeOwner
  // a METHOD's plain slots are its FB's fields, so its pointers there share the FB's keys; its locals are its own
  r.frameContext = frame === undefined ? `FUNCTION:${key}` : `FB:${frame.name.toUpperCase()}`
  r.routineContext = `ROUTINE:${key}`
  r.routineMode = true
  return r
}

/**
 * A METHOD's VAR_INST and VAR_STAT, declared where they live — before the routine's lowering copies its frame's fields
 * (conformance `state_var_inst_two_instances`, `state_var_stat_two_instances`). A VAR_INST is a field of the instance, a
 * VAR_STAT one global; each is named for the METHOD that declares it, so `inst.M()` and `SUPER^.M()` running one body
 * share it. Returns how the routine names them: its own name → the field or the global.
 */
function keptVariables(lw: Lowering, sym: RoutineSymbol, sections: readonly VarSection[], frame: FbType | undefined, span: Span): { inst: Map<string, string>; stat: Map<string, string> } | undefined {
  const kept = sections.filter((s) => s.sectionKind === "VAR_INST" || s.sectionKind === "VAR_STAT")
  const out = { inst: new Map<string, string>(), stat: new Map<string, string>() }
  if (kept.length === 0) return out
  const frameLowering = frame === undefined ? undefined : lw.bodies.get(frame.name.toUpperCase())?.lowering
  if (frameLowering === undefined) return lw.bail(`routine-${kept[0]!.sectionKind.toLowerCase()}`, `${sym.name} has ${kept[0]!.sectionKind} outside an FB lowering can lay out`, span)
  const prefix = `__${sym.owner.name}_${sym.name}_`
  const global = new Lowering(lw.project, lw.project, lw.shared)
  global.globalMode = true
  for (const section of kept) {
    const into = section.sectionKind === "VAR_INST" ? frameLowering : global
    const names = section.decls.flatMap((d) => d.names.map((n) => n.text))
    const declared = section.sectionKind === "VAR_INST" ? frameLowering.byName : lw.shared.globals.byName
    const before = into.diagnostics.length
    if (!names.every((n) => declared.has(`${prefix}${n}`.toUpperCase()))) declareVars(into, [prefixed(section, prefix)])
    if (into.diagnostics.length > before) {
      lw.diagnostics.push(...into.diagnostics.slice(before))
      return undefined
    }
    for (const n of names) (section.sectionKind === "VAR_INST" ? out.inst : out.stat).set(n.toUpperCase(), `${prefix}${n}`.toUpperCase())
  }
  return out
}

/**
 * A routine's VAR_OUTPUT as parameters beside its VAR_IN_OUT — each bound by the caller to the place `=>` names (or a temp,
 * left unconnected) — and the statements that start each over at its initial value when the routine is called: a
 * FUNCTION's and a METHOD's output begins every call anew and is read after it (conformance `state_routine_outputs`).
 * An output of a struct, FB or array type is refused, unmeasured.
 */
function declareOutputs(lw: Lowering, r: Lowering, sections: readonly VarSection[], span: Span): IrStmt[] | undefined {
  if (sections.length === 0) return []
  const scratch = new Lowering(r.scope, r.project, r.shared)
  scratch.routineMode = true
  declareVars(scratch, sections)
  if (scratch.diagnostics.length > 0) {
    lw.diagnostics.push(...scratch.diagnostics)
    return undefined
  }
  const resets: IrStmt[] = []
  for (const slot of scratch.localSlots) {
    if (slot.type.kind !== "elementary") return lw.bail("routine-var_output", `${slot.name} is a ${slot.type.kind} VAR_OUTPUT, not measured`, span)
    const at = r.inoutSlots.length
    r.inoutByName.set(slot.name.toUpperCase(), at)
    r.inoutSlots.push({ ...slot, section: "VAR_OUTPUT" })
    const target: Place = { slot: at, path: [], type: slot.type, span, root: "inout" }
    // an elementary output's initial value is a scalar (the check above), never an aggregate
    resets.push({ kind: "assign", target, value: { kind: "const", value: slot.init as bigint | number | boolean | string, type: slot.type, span }, span })
  }
  return resets
}

/**
 * A LIBRARY CALLABLE DECLARED WITHOUT A BODY — refused, not lowered to a routine that does nothing.
 *
 * A project's libraries are materialized as DECLARATION files: signatures and VAR sections, no statements. The library
 * repo (`libraries/<library>/<version>/`) replaces them with ST bodies for the versions it has written; any other
 * library element is still only its declaration here. `execBodyStatements` answers an empty statement list for that, and an
 * empty routine lowers cleanly — so `t1(IN := TRUE)` would run nothing and `t1.Q` would read FALSE forever. That is an
 * INVENTED meaning rather than a missing one, and it is the same hazard `lowerUnit` already refuses for a graphical
 * body, for the same stated reason.
 *
 * An empty body is legal IEC, so emptiness alone is not the discriminator — PROVENANCE is (`LoweringProject.libraryUnits`).
 * A POU written in the project with no statements genuinely does nothing and must still lower; a library element with
 * no statements is one whose body nobody has written. A library with real source — the repo's — lowers like any POU.
 */
export function isBodylessLibrary(lw: Lowering, ast: object, statements: readonly unknown[]): boolean {
  return statements.length === 0 && lw.shared.libraryUnits.has(ast)
}

/**
 * A METHOD or ACTION run on an instance of `frame`, or a FUNCTION — lowered once per frame, in the instance's fields plus
 * per-call locals. `as` names a routine that is not the one the frame resolves by name (`SUPER^.M()`).
 */
export function calledRoutine(lw: Lowering, sym: RoutineSymbol, frame: FbType | undefined, span: Span, as = sym.name, call?: Extract<Expr, { kind: "call" }>): IrRoutine | undefined {
  // An ANY input is only a size until a call names a VARIABLE for it: then the routine also takes that variable as a
  // hidden VAR_IN_OUT, which is what `pValue` reads (conformance `state_any_int_pointer_increment`). Its type is the
  // argument's, so the routine is lowered once per argument type — the variant in its name.
  const targets = call === undefined ? new Map<string, Type>() : anyArgumentTypes(lw, sym, call)
  const cursors = call === undefined ? new Map<string, CursorArgument>() : cursorArgumentTypes(lw, sym, call)
  const variant = [
    ...[...targets].map(([n, t]) => `${n}=${typeKey(t)}`),
    ...[...cursors].map(([n, c]) => `${n}^=${c.offset ? "@" : ""}${c.shares === undefined ? typeKey(c.type) : `${c.shares}^`}`),
  ].join(",")
  // A FUNCTION is named by its SYMBOL, not its bare name: a project FUNCTION and a library's element of the same name are
  // two routines (transpile-review 21, `tr_21_namespace_*`), so a library's carries its library's folder.
  const library = frame === undefined ? libraryOf(sym) : undefined
  const name = `${frame === undefined ? `${library === undefined ? "" : `${library}.`}${sym.name}` : `${frame.name}.${as}`}${variant === "" ? "" : `#${variant}`}`
  return once(lw, name, span, () => {
    if (frame !== undefined && !lw.layouts.has(frame.name.toUpperCase())) return lw.bail("call-target", `${frame.name} has no layout`, span)
    const ast = sym.ast as Extract<TopLevel, { kind: "method" | "action" | "function" }>
    const scope = frame === undefined ? childScopesByName(lw.project, sym.name).find((s) => s.defUri === sym.uri) : findChildScope(sym.owner, sym.name)
    if (scope === undefined) return lw.bail("call-target", `${name} did not bind`, span)
    const sections = ast.kind === "action" ? [] : ast.varSections
    if (!isStBody(ast.body)) return lw.bail("graphical-body", `${name} has no ST body`, span)
    const parsed = execBodyStatements(lw.project, ast, ast.body)
    if (!parsed.ok) return lw.bail("parse", parsed.firstError ?? `${name}'s body did not parse`, span)
    if (isBodylessLibrary(lw, ast, parsed.statements))
      return lw.bail("call-library", `${name} is a library declaration without a body`, span)
    const kept = keptVariables(lw, sym, sections, frame, span)
    if (kept === undefined) return undefined

    const key = name.toUpperCase()
    const r = routineLowering(lw, scope, frame, frame === undefined ? undefined : sym.owner, key, name)
    for (const [own, field] of kept.inst) r.byName.set(own, r.byName.get(field)!)
    for (const [own, global] of kept.stat) r.statics.set(own, lw.shared.globals.byName.get(global)!)
    let result: number | undefined
    if (ast.kind !== "action" && ast.returnType !== undefined) {
      const type = storageOf(r, r.resolve(ast.returnType), ast.returnType.span)
      r.localByName.set(sym.name.toUpperCase(), 0)
      r.localSlots.push({ name: sym.name, type, section: "VAR", init: typeZero(type) })
      result = 0
    }
    const firstInput = r.localSlots.length
    // an ANY / ANY_* input is a hidden DINT the call fills with its argument's size (conformance `state_any_input_sizes`)
    for (const section of sections.filter((s) => s.sectionKind === "VAR_INPUT"))
      for (const decl of section.decls) {
        if (decl.type.kind !== "named_type" || !ANY_FAMILIES.has(decl.type.name.text.toUpperCase())) {
          declareVars(r, [{ ...section, decls: [decl] }])
          continue
        }
        for (const n of decl.names) {
          r.anyInputs.add(n.text.toUpperCase())
          r.localByName.set(n.text.toUpperCase(), r.localSlots.length)
          r.localSlots.push({ name: n.text, type: elementaryRef("DINT"), section: "VAR_INPUT", init: 0n })
        }
      }
    // an `ARRAY[*]` in-out's bounds: hidden inputs every call fills from the array it binds (design §26)
    declareOpenBounds(r, sections.filter((s) => s.sectionKind === "VAR_IN_OUT"), "VAR_INPUT")
    const inputs = Array.from({ length: r.localSlots.length - firstInput }, (_, i) => firstInput + i)
    anyInputsOf(lw).set(key, new Set(inputs.filter((i) => r.anyInputs.has(r.localSlots[i]!.name.toUpperCase()))))
    positionalOf(lw).set(
      key,
      positionalParameters(sections).map(({ name, output }) => ({ name, output })),
    )
    declareVars(r, sections.filter((s) => s.sectionKind === "VAR" || s.sectionKind === "VAR_TEMP"))
    declareInOuts(r, sections.filter((s) => s.sectionKind === "VAR_IN_OUT"))
    // the ANY inputs this variant was given a variable for: one hidden VAR_IN_OUT each, which `pValue` names
    for (const [input, type] of targets) {
      r.anyTargets.set(input, r.inoutSlots.length)
      r.inoutSlots.push({ name: `${ANY_TARGET}${input}`, type, section: "VAR_IN_OUT", init: typeZero(type) })
    }
    // FORM 2: a `POINTER TO T` parameter this body only dereferences becomes a hidden VAR_IN_OUT of T, and every
    // `p^` becomes the place the CALL binds to it. One lowering serves every call site — which is the whole point,
    // since `ptrparam_two_targets` calls one routine with two different `ADR` arguments and gets two answers.
    // A STRING CURSOR: a character pointer this call fills with a string's address walks that string — one hidden
    // VAR_IN_OUT of the caller's exact string type, and the pointer keeps its byte offset (`Lowering.cursors`)
    const cursorByInput = new Map<number, number>()
    for (const [input, { type: text, shares, offset }] of cursors) {
      const local = r.localByName.get(input)!
      const inout = shares === undefined ? r.inoutSlots.length : r.cursors.get(shares)!.inout
      r.cursors.set(input, { inout, unit: (r.localSlots[local]!.type as Extract<Type, { kind: "pointer" }>).target, offset })
      r.inoutByName.set(`${input}^`, inout)
      cursorByInput.set(local, inout)
      if (shares === undefined)
        r.inoutSlots.push({ name: `${CURSOR}${r.localSlots[local]!.name}`, type: text, section: "VAR_IN_OUT", init: typeZero(text) })
    }
    cursorInputsOf(lw).set(key, cursorByInput)
    const borrowedByInput = new Map<number, number>()
    for (const [name, slot] of borrowedPointerSlots(r, parsed.statements)) {
      if (r.cursors.has(name)) continue
      const pointee = (slot.type as Extract<Type, { kind: "pointer" }>).target
      r.borrowedPointers.set(name, r.inoutSlots.length)
      borrowedByInput.set(r.localSlots.indexOf(slot), r.inoutSlots.length)
      r.inoutSlots.push({ name: `${BORROWED}${slot.name}`, type: pointee, section: "VAR_IN_OUT", init: typeZero(pointee) })
    }
    borrowedInputsOf(lw).set(key, borrowedByInput)
    const resets = declareOutputs(lw, r, sections.filter((s) => s.sectionKind === "VAR_OUTPUT"), span)
    if (resets === undefined) return undefined
    // The FB's own VAR_IN_OUT a METHOD or ACTION reaches — each a parameter the call binds (`lowerInvoke`). Taken from the
    // FB's declaration, in its scope, and only those the routine can reach: they were every in-out of the FB's LOWERED body,
    // so a METHOD that never names one was refused from outside, and which POU lowered first decided (review of batch 3a).
    if (frame !== undefined) {
      const reached = reachedNames(r, parsed.statements)
      // The owner's EXTENDS chain, base first: a base's in-out is the derived FB's too, reached through the base's METHODs
      // (`callshape_inout_base_method_from_derived_method`: 11, `callshape_inout_super_method_from_override`: 11). They were
      // the owner's own only, so a derived METHOD calling such a base METHOD was `call-fb-inout` (pro2193's ConveyorFB).
      const sections: VarSection[] = []
      const seen = new Set<string>()
      // Below the owner's chain, the FRAME's — the instance's type — when the routine calls a METHOD overridden there: a base
      // METHOD run on a derived instance then reaches the derived FB's own in-outs (`callshape_inout_override_from_outside_base_method`).
      // Not otherwise: one calling no override took them all, and faulted unbound (review).
      const ownerChain = chainNames(lw, sym.owner.name)
      const overridden = overridesCalled(frame, ownerChain, parsed.statements)
      for (let unit = lookup(lw.project, frame.name)?.symbol.ast as TopLevel | undefined; unit !== undefined && (unit.kind === "function_block" || unit.kind === "program") && !seen.has(unit.name.text.toUpperCase()); ) {
        seen.add(unit.name.text.toUpperCase())
        if (overridden || ownerChain.has(unit.name.text.toUpperCase())) sections.unshift(...unit.varSections.filter((s) => s.sectionKind === "VAR_IN_OUT"))
        const base = unit.kind === "function_block" ? unit.extends : undefined
        unit = base === undefined ? undefined : (lookup(lw.project, base.text)?.symbol.ast as TopLevel | undefined)
      }
      const declared = new Lowering(sym.owner, r.project, r.shared)
      declareInOuts(declared, sections)
      r.diagnostics.push(...declared.diagnostics)
      for (const slot of declared.inoutSlots) {
        const own = slot.name.toUpperCase()
        if (reached !== "all" && !reached.has(own)) continue
        // a parameter or local of the routine by that name hides the FB's in-out: a call that would take it is refused (review)
        if (r.inoutByName.has(own) || r.localByName.has(own)) {
          r.shadowedInOuts.add(own)
          continue
        }
        r.inoutByName.set(own, r.inoutSlots.length)
        r.inoutSlots.push({ ...slot, ofInstance: true })
      }
    }
    const body = [...resets, ...lowerBlock(r, parsed.statements)]
    if (r.diagnostics.length > 0) {
      lw.diagnostics.push(...r.diagnostics)
      return undefined
    }
    return { name, key, kind: ast.kind, uri: sym.uri, ...(frame === undefined ? {} : { fb: frame.name }), locals: r.localSlots, inputs, inouts: r.inoutSlots, ...(result === undefined ? {} : { result }), body, lent: r.lends }
  })
}

/**
 * The base FB's body as a routine of the derived FB that runs it through `SUPER^()` — lowered in the derived frame, so
 * the calls in it reach the derived overrides, with the in-outs of the base's chain as its parameters.
 */
export function baseBody(lw: Lowering, frame: FbType, base: PendingBody, span: Span): IrRoutine | undefined {
  const unit = base.unit
  const name = `${frame.name}.SUPER_${unit.name.text}`
  return once(lw, name, span, () => {
    const chain = chainOf(lw, unit)
    if (chain === undefined) return lw.bail("call-base", `a base of ${unit.name.text} has no body lowering can reach`, span)
    if (!isStBody(unit.body)) return lw.bail("graphical-body", `${unit.name.text} has no ST body`, span)
    const parsed = execBodyStatements(lw.project, unit, unit.body)
    if (!parsed.ok) return lw.bail("parse", parsed.firstError ?? `${unit.name.text}'s body did not parse`, span)
    if (isBodylessLibrary(lw, unit, parsed.statements))
      return lw.bail("call-library", `${unit.name.text} is a library declaration without a body`, span)
    const key = name.toUpperCase()
    const r = routineLowering(lw, base.lowering.scope, frame, base.lowering.codeOwner, key)
    declareInOuts(r, inOutSections(chain))
    // The derived frame's own in-outs too, marked `ofInstance`: the base body calls METHODs the derived FB overrides, which
    // reach them (`callshape_inout_override_from_base_body`) — `lowerSuperCall` passes each on as itself.
    // Only when it calls one: a base body calling none took them all, and `SUPER^(io := profile)` lent `profile` twice (review).
    const frameUnit = lw.bodies.get(frame.name.toUpperCase())?.unit
    const frameChain = frameUnit === undefined ? undefined : chainOf(lw, frameUnit)
    const taken = new Set(r.inoutSlots.map((s) => s.name.toUpperCase()))
    const first = r.inoutSlots.length
    if (frameChain !== undefined && overridesCalled(frame, new Set(chain.map((u) => u.name.text.toUpperCase())), parsed.statements))
      declareInOuts(r, inOutSections(frameChain).map((s) => ({ ...s, decls: s.decls.map((d) => ({ ...d, names: d.names.filter((n) => !taken.has(n.text.toUpperCase())) })).filter((d) => d.names.length > 0) })))
    for (let i = first; i < r.inoutSlots.length; i++) r.inoutSlots[i] = { ...r.inoutSlots[i]!, ofInstance: true }
    // the base's own VAR_TEMP starts over each time `SUPER^()` runs it
    const body = [...(tempResets(r, unit.varSections, unit.span) ?? []), ...lowerBlock(r, parsed.statements)]
    if (r.diagnostics.length > 0) {
      lw.diagnostics.push(...r.diagnostics)
      return undefined
    }
    return { name, key, kind: "action", fb: frame.name, locals: r.localSlots, inputs: [], inouts: r.inoutSlots, body, lent: r.lends }
  })
}

/**
 * An FB's layout with its body lowered — once, at the first call that reaches it. A derived FB runs ONLY its own body
 * (conformance `inh_call_runs_derived_body`, `inh_empty_derived_body`), and takes the VAR_IN_OUT of its whole chain, the
 * bases' first, as its fields are. Refused, until recorded: an FB with VAR_TEMP (whether it starts over per call).
 */
export function calledLayout(lw: Lowering, name: string, span: Span): IrLayout | undefined {
  const key = name.toUpperCase()
  const pending = lw.bodies.get(key)
  const layout = lw.layouts.get(key)
  if (pending === undefined || layout === undefined) return lw.bail("call-target", `${name} has no body lowering can call`, span)
  if (pending.state === "lowered") {
    // the program instances its body reaches are reached by this caller too
    for (const slot of pending.lowering.touched) lw.touched.add(slot)
    return layout
  }
  if (pending.state === "failed") return lw.bail("call-body", `${name}'s body does not lower`, span)
  if (pending.state === "lowering") return lw.bail("call-recursive", `${name} is reached again while its own body lowers`, span)
  const unit = pending.unit
  const chain = chainOf(lw, unit)
  if (chain === undefined) return lw.fail(pending, "call-base", `a base of ${name} has no body lowering can reach`, span)
  if (!isStBody(unit.body)) return lw.fail(pending, "graphical-body", `${name} has no ST body`, span)
  const parsed = execBodyStatements(lw.project, unit, unit.body)
  if (!parsed.ok) return lw.fail(pending, "parse", parsed.firstError ?? `${name}'s body did not parse`, span)
  if (isBodylessLibrary(lw, unit, parsed.statements))
    return lw.fail(pending, "call-library", `${name} is a library declaration without a body`, span)
  const nested = pending.lowering
  const before = nested.diagnostics.length
  declareInOuts(nested, inOutSections(chain))
  pending.state = "lowering"
  // its own VAR_TEMP starts over on every call (a base's, when `SUPER^()` runs that body)
  const body = [...(tempResets(nested, unit.varSections, unit.span) ?? []), ...lowerBlock(nested, parsed.statements)]
  // A PROGRAM runs moved out of `Programs` in Rust (the call moves its instance out and back), so a program whose run
  // reaches its own instance — reading `P.x` from an FB it calls — would read a stand-in there. Refused.
  const own = unit.kind === "program" ? lw.shared.globals.byName.get(unit.name.text.toUpperCase()) : undefined
  if (own !== undefined && nested.touched.has(own) && nested.diagnostics.length === before)
    nested.bail("call-program-reentrant", `${name} reaches its own instance while it runs`, span)
  if (nested.diagnostics.length > before) {
    lw.diagnostics.push(...nested.diagnostics.slice(before))
    pending.state = "failed"
    return undefined
  }
  pending.state = "lowered"
  for (const slot of nested.touched) lw.touched.add(slot)
  // the file this body was written in travels with it, so the emitter can name it on every mapping
  const called: IrLayout = { ...layout, body, inouts: nested.inoutSlots, lent: nested.lends, ...(pending.uri === undefined ? {} : { bodyUri: pending.uri }) }
  lw.layouts.set(key, called)
  return called
}
