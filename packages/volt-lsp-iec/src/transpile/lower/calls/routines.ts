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

import { type FbType, Lowering, type RoutineSymbol } from "../core/lowering.js"
import type { PendingBody } from "../core/shared.js"
import { type Expr, isStBody, type Span, type StatementList, type TopLevel, type VarSection } from "../../../frontend/syntax/index.js"
import type { IrLayout, IrRoutine, IrStmt, Place } from "../../ir/index.js"
import { programReentrant, touchedOf, touchesOf } from "./reentrancy.js"
import { childScopesByName, findChildScope, type Scope } from "../../../frontend/symbols/index.js"
import { declareGlobals, declareInOuts, declareVars } from "../storage/declare.js"
import { inOutSections, prefixed } from "./parameters.js"
import { type Type, typeZero } from "../../../frontend/types/index.js"
import { anyArgumentTypes } from "../pointers/any.js"
import { type CursorArgument, cursorArgumentTypes } from "../pointers/cursor.js"
import { typeKey } from "./variants.js"
import { libraryOf } from "../../../frontend/library/index.js"
import { execBodyStatements } from "../conditions.js"
import { storageOf } from "../storage/layout.js"
import { overridesCalled } from "../core/ast-walk.js"
import { chainOf } from "../core/chain.js"
import { lowerBlock } from "../statements/statements.js"
import { resetTemps } from "../init/temp-resets.js"
import { interfaceFrame } from "../interfaces/state.js"
import { drain, nested } from "../core/nested.js"
import { hiddenInOuts, instanceInOuts, routineInputs } from "./routine-frame.js"

/**
 * A routine lowered once per POU under `name` — THE ONE WRITER OF THE ROUTINE CACHE (`lw.routines`; transpile-restructure
 * 1.7.8): cached, or refused if it failed before — or if it is reached again while its own body lowers, which is a
 * routine calling itself and lowered it again without end (a RangeError out of lowering; transpiler review 2026-09-15).
 * Whether CODESYS allows a recursive call at all is not measured.
 *
 * `quiet`: a routine lowering BUILDS rather than one a call names — an FB type's `__INIT` (`init/instance-init.ts`), a
 * routine specialized on a path (`calls/specialize.ts`). Its failure was reported where it was built, so a later ask
 * answers undefined without a second refusal, and it is never `lowering` while it builds (no recursion guard): both
 * kept as they were before the cache had one writer.
 */
export function once(lw: Lowering, name: string, span: Span, build: () => IrRoutine | undefined, { quiet = false }: { quiet?: boolean } = {}): IrRoutine | undefined {
  const key = name.toUpperCase()
  const cached = lw.routines.get(key)
  if (cached?.state === "failed") return quiet ? undefined : lw.bail("call-body", `${name}'s body does not lower`, span)
  if (cached?.state === "lowering" && !quiet) return lw.bail("call-recursive", `${name} calls itself`, span)
  let routine = cached?.state === "lowered" ? cached.routine : undefined
  if (routine === undefined) {
    if (!quiet) lw.routines.set(key, { state: "lowering" })
    routine = build()
    lw.routines.set(key, routine === undefined ? { state: "failed" } : { state: "lowered", routine })
  }
  // the program instances the routine reaches are reached by whoever calls it (`touchedOf`)
  for (const slot of touchesOf(lw).get(key) ?? []) touchedOf(lw).add(slot)
  return routine
}

/** A body that cannot lower: marked failed — every later call refuses it by name (`call-body`) — and reported. */
function fail(lw: Lowering, pending: PendingBody, code: string, message: string, span: Span): undefined {
  pending.state = "failed"
  return lw.bail(code, message, span)
}

/** The lowering a routine body is lowered in: the frame's fields (when it runs on an instance) plus per-call locals. */
export function routineLowering(lw: Lowering, scope: Scope, frame: FbType | undefined, codeOwner: Scope | undefined, key: string, displayName = key): Lowering {
  const r = new Lowering(scope, lw.project, lw.shared)
  r.displayName = displayName
  touchesOf(lw).set(key, touchedOf(r))
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
  for (const section of kept) {
    const names = section.decls.flatMap((d) => d.names.map((n) => n.text))
    const inst = section.sectionKind === "VAR_INST"
    const declared = inst ? frameLowering.byName : lw.shared.globals.byName
    if (!names.every((n) => declared.has(`${prefix}${n}`.toUpperCase()))) {
      // a VAR_INST is a field of the FB's own frame; a VAR_STAT one global (`declareGlobals`)
      const before = frameLowering.diagnostics.length
      if (inst) declareVars(frameLowering, [prefixed(section, prefix)])
      if (inst ? drain(lw, frameLowering, before) : !declareGlobals(lw, lw.project, prefixed(section, prefix))) return undefined
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
  const { value: scratch, drained } = nested(lw, r.scope, { routineMode: true }, (s) => (declareVars(s, sections), s))
  if (drained) return undefined
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
function isBodylessLibrary(lw: Lowering, ast: object, statements: readonly unknown[]): boolean {
  return statements.length === 0 && lw.shared.libraryUnits.has(ast)
}

/** Why a body cannot be lowered: not ST, not parsed, or a library's declaration with no body written. */
export interface BodyRefusal {
  code: "graphical-body" | "parse" | "call-library"
  message: string
}

/**
 * THE ONE BODY PIPELINE (transpile-restructure 1.7.7): a unit's ST body as the statements lowering lowers — or why it
 * cannot be. Every body comes through here: a METHOD's, ACTION's and FUNCTION's (`calledRoutine`), a PROPERTY
 * accessor's (`calls/property.ts`), a base body run by `SUPER^()` (`baseBody`), an FB's body at its first call
 * (`calledLayout`), and the POU's own (`entry/lower-unit.ts`). The site reports the refusal its way — a diagnostic, the
 * pending body marked failed, a POU with no IR. `name` names the body in the message; the POU's own body is unnamed
 * (its messages say "body"), and is the one a library's empty declaration is not asked of (`library: false` — a POU is
 * lowered from the project).
 */
export function bodyOf(
  lw: Lowering,
  unit: Parameters<typeof execBodyStatements>[1],
  body: Parameters<typeof isStBody>[0],
  name: string | undefined,
  { library = true }: { library?: boolean } = {},
): { statements: StatementList } | BodyRefusal {
  if (!isStBody(body)) return { code: "graphical-body", message: name === undefined ? "a body that is not ST is not lowered here" : `${name} has no ST body` }
  const parsed = execBodyStatements(lw.project, unit, body)
  if (!parsed.ok) return { code: "parse", message: parsed.firstError ?? (name === undefined ? "body did not parse" : `${name}'s body did not parse`) }
  if (library && isBodylessLibrary(lw, unit, parsed.statements))
    return { code: "call-library", message: `${name ?? "the body"} is a library declaration without a body` }
  return { statements: parsed.statements }
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
    const parsed = bodyOf(lw, ast, ast.body, name)
    if ("code" in parsed) return lw.bail(parsed.code, parsed.message, span)
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
    const inputs = routineInputs(lw, r, sections, key)
    declareVars(r, sections.filter((s) => s.sectionKind === "VAR" || s.sectionKind === "VAR_TEMP"))
    declareInOuts(r, sections.filter((s) => s.sectionKind === "VAR_IN_OUT"))
    hiddenInOuts(lw, r, targets, cursors, parsed.statements, key)
    const resets = declareOutputs(lw, r, sections.filter((s) => s.sectionKind === "VAR_OUTPUT"), span)
    if (resets === undefined) return undefined
    if (frame !== undefined) instanceInOuts(lw, r, sym, frame, parsed.statements)
    const body = [...resets, ...lowerBlock(r, parsed.statements)]
    if (drain(lw, r)) return undefined
    return { name, key, kind: ast.kind, uri: sym.uri, ...(frame === undefined ? {} : { fb: frame.name }), locals: r.localSlots, inputs, inouts: r.inoutSlots, ...(result === undefined ? {} : { result }), body, lent: interfaceFrame(r).lends }
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
    const parsed = bodyOf(lw, unit, unit.body, unit.name.text)
    if ("code" in parsed) return lw.bail(parsed.code, parsed.message, span)
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
    const body = [...resetTemps(r, unit), ...lowerBlock(r, parsed.statements)]
    if (drain(lw, r)) return undefined
    return { name, key, kind: "action", fb: frame.name, locals: r.localSlots, inputs: [], inouts: r.inoutSlots, body, lent: interfaceFrame(r).lends }
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
    for (const slot of touchedOf(pending.lowering)) touchedOf(lw).add(slot)
    return layout
  }
  if (pending.state === "failed") return lw.bail("call-body", `${name}'s body does not lower`, span)
  if (pending.state === "lowering") return lw.bail("call-recursive", `${name} is reached again while its own body lowers`, span)
  const unit = pending.unit
  const chain = chainOf(lw, unit)
  if (chain === undefined) return fail(lw, pending, "call-base", `a base of ${name} has no body lowering can reach`, span)
  const parsed = bodyOf(lw, unit, unit.body, name)
  if ("code" in parsed) return fail(lw, pending, parsed.code, parsed.message, span)
  const frame = pending.lowering
  const before = frame.diagnostics.length
  declareInOuts(frame, inOutSections(chain))
  pending.state = "lowering"
  // its own VAR_TEMP starts over on every call (a base's, when `SUPER^()` runs that body)
  const body = [...resetTemps(frame, unit), ...lowerBlock(frame, parsed.statements)]
  // A PROGRAM runs moved out of `Programs` in Rust (the call moves its instance out and back), so a program whose run
  // reaches its own instance — reading `P.x` from an FB it calls — would read a stand-in there. Refused.
  const own = unit.kind === "program" ? lw.shared.globals.byName.get(unit.name.text.toUpperCase()) : undefined
  const reentrant = own === undefined ? undefined : programReentrant(lw, { touched: touchedOf(frame), body: [] }, { slot: own, inside: false }, { touched: "always", dispatch: "never" })
  if (reentrant !== undefined && frame.diagnostics.length === before)
    frame.bail("call-program-reentrant", `${name} reaches its own instance while it runs`, span)
  if (drain(lw, frame, before)) {
    pending.state = "failed"
    return undefined
  }
  pending.state = "lowered"
  for (const slot of touchedOf(frame)) touchedOf(lw).add(slot)
  // the file this body was written in travels with it, so the emitter can name it on every mapping
  const called: IrLayout = { ...layout, body, inouts: frame.inoutSlots, lent: interfaceFrame(frame).lends, ...(pending.uri === undefined ? {} : { bodyUri: pending.uri }) }
  lw.layouts.set(key, called)
  return called
}
