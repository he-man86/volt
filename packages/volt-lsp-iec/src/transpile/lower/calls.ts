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
import {
  type CallArg,
  type Expr,
  isGraphicalBody,
  parseActive,
  type Property,
  type Span,
  type Statement,
  type TopLevel,
  type VarSection,
} from "../../syntax/index.js"
import { childScopesByName, findChildScope, libraryOf, lookup, lookupMember, type Scope } from "../../symbols/index.js"
import { inferExprType, type Type, UNKNOWN } from "../../types/index.js"
import {
  defaultValueOf,
  type IrExpr,
  type IrInvoke,
  type IrLayout,
  type IrRoutine,
  type IrSlot,
  type IrStmt,
  type Place,
} from "../ir/index.js"
import { baseOf, Lowering, type PendingBody } from "./lowering.js"
import { convert } from "./convert.js"
import { declareInOuts, declareVars, storageOf } from "./storage.js"
import { lowerPlace } from "./places.js"
import { through } from "./pointers.js"
import { lowerExpr } from "./expressions.js"
import { lowerBlock } from "./statements.js"

type FbType = Extract<Type, { kind: "function_block" }>
type RoutineSymbol = NonNullable<ReturnType<typeof lookup>>["symbol"]

/** The FB a body runs on — what `THIS^` names — when it runs on one. */
const selfFb = (lw: Lowering): FbType | undefined => (lw.selfType?.kind === "function_block" ? lw.selfType : undefined)

const thisPlace = (type: FbType, span: Span): Place => ({ slot: 0, path: [], type, span, root: "this" })

const isSuper = (e: Expr): boolean => e.kind === "deref" && e.base.kind === "ident_expr" && e.base.name.toUpperCase() === "SUPER"

/** A METHOD or ACTION a bare name inside an FB names — `M()` is `THIS^.M()` (conformance `fbcall_bare_method_call`). */
function ownMember(lw: Lowering, name: string): RoutineSymbol | undefined {
  const frame = selfFb(lw)
  if (frame?.scope === undefined || lookup(lw.scope, name)?.symbol.kind === "function") return undefined
  const member = lookupMember(frame.scope, name)
  return member?.kind === "method" || member?.kind === "action" ? member : undefined
}

/** An FB unit and its bases, the root of the EXTENDS chain first — undefined when a base has no body to lower. */
function chainOf(lw: Lowering, unit: PendingBody["unit"]): PendingBody["unit"][] | undefined {
  const chain = [unit]
  for (let base = baseOf(unit); base !== undefined; ) {
    const pending = lw.bodies.get(base.text.toUpperCase())
    if (pending === undefined || chain.includes(pending.unit)) return undefined
    chain.unshift(pending.unit)
    base = baseOf(pending.unit)
  }
  return chain
}

const inOutSections = (chain: readonly PendingBody["unit"][]) => chain.flatMap((u) => u.varSections.filter((s) => s.sectionKind === "VAR_IN_OUT"))

/** A section whose every name carries `prefix` — how a routine's kept variables get a name of their own in the frame. */
const prefixed = (section: VarSection, prefix: string): VarSection => ({
  ...section,
  decls: section.decls.map((d) => ({ ...d, names: d.names.map((n) => ({ ...n, text: `${prefix}${n.text}` })) })),
})

/**
 * A routine lowered once per POU under `name`: cached, or refused if it failed before — or if it is reached again while
 * its own body lowers, which is a routine calling itself and lowered it again without end (a RangeError out of lowering;
 * transpiler review 2026-09-15). Whether CODESYS allows a recursive call at all is not measured.
 */
function once(lw: Lowering, name: string, span: Span, build: () => IrRoutine | undefined): IrRoutine | undefined {
  const key = name.toUpperCase()
  const cached = lw.routines.get(key)
  if (cached?.state === "lowered") return cached.routine
  if (cached?.state === "failed") return lw.bail("call-body", `${name}'s body does not lower`, span)
  if (cached?.state === "lowering") return lw.bail("call-recursive", `${name} calls itself`, span)
  lw.routines.set(key, { state: "lowering" })
  const routine = build()
  lw.routines.set(key, routine === undefined ? { state: "failed" } : { state: "lowered", routine })
  return routine
}

/** The lowering a routine body is lowered in: the frame's fields (when it runs on an instance) plus per-call locals. */
function routineLowering(lw: Lowering, scope: Scope, frame: FbType | undefined, codeOwner: Scope | undefined, key: string): Lowering {
  const r = new Lowering(scope, lw.project, lw.shared)
  const layout = frame === undefined ? undefined : lw.layouts.get(frame.name.toUpperCase())
  if (layout !== undefined) r.inherit(layout.fields)
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
 * A METHOD or ACTION run on an instance of `frame`, or a FUNCTION — lowered once per frame, in the instance's fields plus
 * per-call locals. `as` names a routine that is not the one the frame resolves by name (`SUPER^.M()`). Refused, until
 * measured: a VAR_OUTPUT (how `=>` reads it back).
 */
export function calledRoutine(lw: Lowering, sym: RoutineSymbol, frame: FbType | undefined, span: Span, as = sym.name): IrRoutine | undefined {
  const name = frame === undefined ? sym.name : `${frame.name}.${as}`
  return once(lw, name, span, () => {
    if (frame !== undefined && !lw.layouts.has(frame.name.toUpperCase())) return lw.bail("call-target", `${frame.name} has no layout`, span)
    const ast = sym.ast as Extract<TopLevel, { kind: "method" | "action" | "function" }>
    const scope = findChildScope(frame === undefined ? lw.project : sym.owner, sym.name)
    if (scope === undefined) return lw.bail("call-target", `${name} did not bind`, span)
    const sections = ast.kind === "action" ? [] : ast.varSections
    if (sections.some((s) => s.sectionKind === "VAR_OUTPUT")) return lw.bail("routine-var_output", `${name} has VAR_OUTPUT, not measured yet`, span)
    if (isGraphicalBody(ast.body)) return lw.bail("graphical-body", `${name} has a graphical body`, span)
    const parsed = parseActive(ast.body)
    if (!parsed.ok) return lw.bail("parse", parsed.firstError ?? `${name}'s body did not parse`, span)
    const kept = keptVariables(lw, sym, sections, frame, span)
    if (kept === undefined) return undefined

    const key = name.toUpperCase()
    const r = routineLowering(lw, scope, frame, frame === undefined ? undefined : sym.owner, key)
    for (const [own, field] of kept.inst) r.byName.set(own, r.byName.get(field)!)
    for (const [own, global] of kept.stat) r.statics.set(own, lw.shared.globals.byName.get(global)!)
    let result: number | undefined
    if (ast.kind !== "action" && ast.returnType !== undefined) {
      const type = storageOf(r, r.resolve(ast.returnType))
      r.localByName.set(sym.name.toUpperCase(), 0)
      r.localSlots.push({ name: sym.name, type, section: "VAR", init: defaultValueOf(type) })
      result = 0
    }
    const firstInput = r.localSlots.length
    declareVars(r, sections.filter((s) => s.sectionKind === "VAR_INPUT"))
    const inputs = Array.from({ length: r.localSlots.length - firstInput }, (_, i) => firstInput + i)
    declareVars(r, sections.filter((s) => s.sectionKind === "VAR" || s.sectionKind === "VAR_TEMP"))
    declareInOuts(r, sections.filter((s) => s.sectionKind === "VAR_IN_OUT"))
    const body = lowerBlock(r, parsed.statements)
    if (r.diagnostics.length > 0) {
      lw.diagnostics.push(...r.diagnostics)
      return undefined
    }
    return { name, key, kind: ast.kind, ...(frame === undefined ? {} : { fb: frame.name }), locals: r.localSlots, inputs, inouts: r.inoutSlots, ...(result === undefined ? {} : { result }), body }
  })
}

/** A METHOD or ACTION called on an instance of `frame` — by the instance's own type, so an override wins wherever the
 *  call is written (conformance `inh_base_body_reaches_override`, `inh_inherited_method_reaches_override`). */
function methodOf(lw: Lowering, frame: FbType, name: string, span: Span): IrRoutine | undefined {
  const sym = frame.scope === undefined ? undefined : lookupMember(frame.scope, name)
  if (sym?.kind !== "method" && sym?.kind !== "action") return lw.bail("call-method", `${name} is not a METHOD or ACTION lowering can call`, span)
  return calledRoutine(lw, sym, frame, span)
}

/**
 * A PROPERTY's GET or SET as a routine of the FB it runs on: the getter's result, or the setter's one input, is a local
 * named as the property, and its VAR starts over on every call (conformance `state_property_get_set`).
 */
function propertyRoutine(lw: Lowering, frame: FbType, sym: RoutineSymbol, accessor: "get" | "set", span: Span): IrRoutine | undefined {
  const name = `${frame.name}.${sym.name}__${accessor}`
  return once(lw, name, span, () => {
    const ast = sym.ast as Property
    const part = accessor === "get" ? ast.getter : ast.setter
    if (part === undefined) return lw.bail("property-accessor", `${sym.name} has no ${accessor.toUpperCase()}`, span)
    const scope = childScopesByName(sym.owner, sym.name).find((s) => s.span === ast.span)?.children.find((c) => c.span === part.body.span)
    if (scope === undefined) return lw.bail("call-target", `${name} did not bind`, span)
    const unmeasured = part.varSections.find((s) => s.sectionKind !== "VAR" && s.sectionKind !== "VAR_TEMP")
    if (unmeasured !== undefined) return lw.bail(`routine-${unmeasured.sectionKind.toLowerCase()}`, `${name} has ${unmeasured.sectionKind}, not measured yet`, span)
    if (isGraphicalBody(part.body)) return lw.bail("graphical-body", `${name} has a graphical body`, span)
    const parsed = parseActive(part.body)
    if (!parsed.ok) return lw.bail("parse", parsed.firstError ?? `${name}'s body did not parse`, span)
    const key = name.toUpperCase()
    const r = routineLowering(lw, scope, frame, sym.owner, key)
    const type = storageOf(r, r.resolve(ast.dataType))
    r.localByName.set(sym.name.toUpperCase(), 0)
    r.localSlots.push({ name: sym.name, type, section: accessor === "get" ? "VAR" : "VAR_INPUT", init: defaultValueOf(type) })
    declareVars(r, part.varSections)
    const body = lowerBlock(r, parsed.statements)
    if (r.diagnostics.length > 0) {
      lw.diagnostics.push(...r.diagnostics)
      return undefined
    }
    const shape = accessor === "get" ? { inputs: [], result: 0 } : { inputs: [0] }
    return { name, key, kind: "method", fb: frame.name, locals: r.localSlots, inouts: [], ...shape, body }
  })
}

/**
 * The instance and PROPERTY an expression names — `inst.P`, `THIS^.P`, or `P` bare inside the FB — resolved by the
 * instance's own type, as a METHOD is. `null` when it names no property; `undefined` when it does and was refused.
 */
function propertyAccess(lw: Lowering, e: Expr): { instance: Place; frame: FbType; sym: RoutineSymbol } | undefined | null {
  if (e.kind === "ident_expr") {
    const frame = selfFb(lw)
    if (frame?.scope === undefined || lw.holds(e.name)) return null
    const sym = lookupMember(frame.scope, e.name)
    return sym?.kind === "property" ? { instance: thisPlace(frame, e.span), frame, sym } : null
  }
  if (e.kind !== "member" || /^\d+$/.test(e.member.name)) return null
  const seen = inferExprType(e.base, lw.scope, lw.project)
  if (seen.kind !== "function_block" || seen.scope === undefined || lookupMember(seen.scope, e.member.name)?.kind !== "property") return null
  const instance = lowerPlace(lw, e.base)
  if (instance === undefined) return undefined
  if (instance.type.kind !== "function_block" || instance.type.scope === undefined) return null
  if (inGlobals(lw, instance)) return lw.bail("call-global-instance", `${e.member.name} is read or written on an instance declared in a GVL`, e.span)
  const sym = lookupMember(instance.type.scope, e.member.name)
  return sym?.kind === "property" ? { instance, frame: instance.type, sym } : null
}

/** A PROPERTY read → its getter, run on the instance. `null` when the expression reads no property. */
export function lowerPropertyGet(lw: Lowering, e: Expr): IrInvoke | undefined | null {
  const access = propertyAccess(lw, e)
  if (access === null || access === undefined) return access
  if (lw.arguments > 0) return lw.bail("call-nested", "a PROPERTY read inside a call's arguments", e.span)
  const routine = propertyRoutine(lw, access.frame, access.sym, "get", e.span)
  if (routine === undefined) return undefined
  return { kind: "invoke", routine: routine.key, instance: access.instance, inputs: [], inouts: [], type: routine.locals[0]!.type, span: e.span }
}

/**
 * `P := value` on a PROPERTY → the value into a temp, then the setter with it. The value is computed first, as a store's
 * right side is; handed straight to the setter, a getter inside it (`THIS^.L := THIS^.L + 5`, measured) would be a call
 * inside the setter's arguments — two `&mut` of one instance in Rust. `null` when the target is no property.
 */
export function lowerPropertySet(lw: Lowering, s: Extract<Statement, { kind: "assign" }>): IrStmt[] | undefined | null {
  const access = propertyAccess(lw, s.target)
  if (access === null || access === undefined) return access
  if (s.op !== undefined || s.chained !== undefined) return lw.bail("property-store", `${access.sym.name} set by ${s.op ?? "a chain"}`, s.span)
  const routine = propertyRoutine(lw, access.frame, access.sym, "set", s.span)
  if (routine === undefined) return undefined
  const type = routine.locals[0]!.type
  const value = lowerExpr(lw, s.value, type)
  if (value === undefined) return undefined
  const temp = lw.tempPlace("property", type, s.span)
  const set: IrInvoke = { kind: "invoke", routine: routine.key, instance: access.instance, inputs: [{ kind: "load", place: temp, type, span: s.span }], inouts: [], type: UNKNOWN, span: s.span }
  return [{ kind: "assign", target: temp, value: convert(value, type), span: s.span }, { kind: "eval", value: set, span: s.span }]
}

/**
 * The base FB's body as a routine of the derived FB that runs it through `SUPER^()` — lowered in the derived frame, so
 * the calls in it reach the derived overrides, with the in-outs of the base's chain as its parameters.
 */
function baseBody(lw: Lowering, frame: FbType, base: PendingBody, span: Span): IrRoutine | undefined {
  const unit = base.unit
  const name = `${frame.name}.SUPER_${unit.name.text}`
  return once(lw, name, span, () => {
    const chain = chainOf(lw, unit)
    if (chain === undefined) return lw.bail("call-base", `a base of ${unit.name.text} has no body lowering can reach`, span)
    if (chain.some((u) => u.varSections.some((s) => s.sectionKind === "VAR_TEMP")))
      return lw.bail("fb-var-temp", `${unit.name.text} has VAR_TEMP — whether it starts over per call is not measured yet`, span)
    if (isGraphicalBody(unit.body)) return lw.bail("graphical-body", `${unit.name.text} has a graphical body`, span)
    const parsed = parseActive(unit.body)
    if (!parsed.ok) return lw.bail("parse", parsed.firstError ?? `${unit.name.text}'s body did not parse`, span)
    const key = name.toUpperCase()
    const r = routineLowering(lw, base.lowering.scope, frame, base.lowering.codeOwner, key)
    declareInOuts(r, inOutSections(chain))
    const body = lowerBlock(r, parsed.statements)
    if (r.diagnostics.length > 0) {
      lw.diagnostics.push(...r.diagnostics)
      return undefined
    }
    return { name, key, kind: "action", fb: frame.name, locals: r.localSlots, inputs: [], inouts: r.inoutSlots, body }
  })
}

/**
 * The place a VAR_IN_OUT argument binds. Refused: two `&mut` into one place (they do not exist in Rust — the handle form,
 * design §9 form 3, is for later), a bit, a global (every body holds the globals as one `&mut`), and a derived instance
 * or struct standing in for its base type — the parameter would dispatch on the base, which is not modelled.
 */
function bindInOut(lw: Lowering, arg: CallArg, param: IrSlot, held: readonly Place[]): Place | undefined {
  const written = lw.inArgument(() => lowerPlace(lw, arg.value!))
  const target = written === undefined ? undefined : through(lw, written, arg.span)
  if (target === undefined) return undefined
  if (held.some((p) => aliases(target, p))) return lw.bail("call-inout-alias", `${param.name} is bound to a variable the call already holds`, arg.span)
  if (target.path.some((s) => s.kind === "bit")) return lw.bail("call-inout-bit", `${param.name} is bound to a bit`, arg.span)
  if (target.root === "global") return lw.bail("call-inout-global", `${param.name} is bound to a global variable`, arg.span)
  const composite = (t: Type): string | undefined => (t.kind === "function_block" || t.kind === "struct" ? t.name.toUpperCase() : undefined)
  if (composite(param.type) !== undefined && composite(param.type) !== composite(target.type))
    return lw.bail("call-inout-derived", `${param.name} is bound to a ${target.type.kind === "function_block" || target.type.kind === "struct" ? target.type.name : target.type.kind}, not its own type`, arg.span)
  return target
}

/**
 * `inst.M(a := x)`, `M()` inside an FB, `SUPER^.M()`, `inst.A()` or `F(x)` → an `IrInvoke`. Arguments bind by name;
 * positionally only to a routine with no VAR_IN_OUT (measured for a FUNCTION's input, `fbcall_function_locals`). An
 * input left out is refused — whether it takes its initial value is not measured.
 */
export function lowerInvoke(lw: Lowering, call: Extract<Expr, { kind: "call" }>): IrInvoke | undefined {
  // `a.M(k := b.M(k := 1))` prints the inner call as an argument of the outer one: two `&mut g` at once, or two of `a`
  // for `a.M(k := a.M(…))` — E0499 (transpiler review 2026-09-15, compiled). Hoisting the inner call would move it ahead
  // of the operands read before it, an evaluation order not measured — so it is refused.
  if (lw.arguments > 0) return lw.bail("call-nested", "a METHOD, ACTION or FUNCTION called inside another call's arguments", call.span)
  const callee = call.callee
  let routine: IrRoutine | undefined
  let instance: Place | undefined
  if (callee.kind === "member" && isSuper(callee.base)) {
    // the BASE's method, not the override (conformance `inh_super_method_from_body`) — a routine of its own on this frame
    const frame = selfFb(lw)
    const base = lw.codeOwner?.baseScope
    const sym = base === undefined ? undefined : lookupMember(base, callee.member.name)
    if (frame === undefined || (sym?.kind !== "method" && sym?.kind !== "action"))
      return lw.bail("call-super", `SUPER^.${callee.member.name} names no METHOD of a base FB`, call.span)
    routine = calledRoutine(lw, sym, frame, call.span, `SUPER_${sym.owner.name}_${sym.name}`)
    instance = thisPlace(frame, callee.base.span)
  } else if (callee.kind === "member") {
    const base = lowerPlace(lw, callee.base)
    if (base === undefined) return undefined
    if (inGlobals(lw, base)) return lw.bail("call-global-instance", `${callee.member.name} is called on an instance declared in a GVL`, call.span)
    if (base.type.kind !== "function_block") return lw.bail("call-method", `${callee.member.name} is not a METHOD or ACTION lowering can call`, call.span)
    routine = methodOf(lw, base.type, callee.member.name, call.span)
    instance = base
  } else if (callee.kind === "ident_expr" && ownMember(lw, callee.name) !== undefined) {
    const frame = selfFb(lw)!
    routine = methodOf(lw, frame, callee.name, call.span)
    instance = thisPlace(frame, callee.span)
  } else if (callee.kind === "ident_expr") {
    const sym = lookup(lw.scope, callee.name)?.symbol
    if (sym?.kind !== "function" || libraryOf(sym) !== undefined) return lw.bail("expr-call", `${callee.name} is not a project FUNCTION`, call.span)
    routine = calledRoutine(lw, sym, undefined, call.span)
  } else return lw.bail("expr-call", "a call of an expression", call.span)
  if (routine === undefined) return undefined

  const inputs: (IrExpr | undefined)[] = routine.inputs.map(() => undefined)
  const inouts: (Place | undefined)[] = routine.inouts.map(() => undefined)
  for (const [position, arg] of call.args.entries()) {
    if (arg.value === undefined || arg.output) return lw.bail("call-output", `${routine.name} called with an output or empty argument`, arg.span)
    let k: number
    if (arg.param === undefined) {
      if (routine.inouts.length > 0 || position >= routine.inputs.length)
        return lw.bail("call-positional", `${routine.name} called with a positional argument`, arg.span)
      k = position
    } else {
      const name = arg.param.name.toUpperCase()
      const inout = routine.inouts.findIndex((p) => p.name.toUpperCase() === name)
      if (inout >= 0) {
        const held = [...(instance === undefined ? [] : [instance]), ...inouts.filter((p): p is Place => p !== undefined)]
        const target = bindInOut(lw, arg, routine.inouts[inout]!, held)
        if (target === undefined) return undefined
        inouts[inout] = target
        continue
      }
      k = routine.inputs.findIndex((i) => routine!.locals[i]!.name.toUpperCase() === name)
      if (k < 0) return lw.bail("call-param", `${arg.param.name} is not an input of ${routine.name}`, arg.span)
    }
    const slot = routine.locals[routine.inputs[k]!]!
    const value = lw.inArgument(() => lowerExpr(lw, arg.value!, slot.type))
    if (value === undefined) return undefined
    inputs[k] = convert(value, slot.type)
  }
  if (inputs.includes(undefined)) return lw.bail("call-input-missing", `${routine.name} called without every input — its default is not measured yet`, call.span)
  if (inouts.includes(undefined)) return lw.bail("call-inout-missing", `${routine.name} called without every VAR_IN_OUT`, call.span)
  const type = routine.result === undefined ? UNKNOWN : routine.locals[routine.result]!.type
  return { kind: "invoke", routine: routine.key, ...(instance === undefined ? {} : { instance }), inputs: inputs as IrExpr[], inouts: inouts as Place[], type, span: call.span }
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
  if (pending.state === "lowered") return layout
  if (pending.state === "failed") return lw.bail("call-body", `${name}'s body does not lower`, span)
  const unit = pending.unit
  const chain = chainOf(lw, unit)
  if (chain === undefined) return lw.fail(pending, "call-base", `a base of ${name} has no body lowering can reach`, span)
  if (chain.some((u) => u.varSections.some((s) => s.sectionKind === "VAR_TEMP")))
    return lw.fail(pending, "fb-var-temp", `${name} has VAR_TEMP — whether it starts over per call is not measured yet`, span)
  if (isGraphicalBody(unit.body)) return lw.fail(pending, "graphical-body", `${name} has a graphical body`, span)
  const parsed = parseActive(unit.body)
  if (!parsed.ok) return lw.fail(pending, "parse", parsed.firstError ?? `${name}'s body did not parse`, span)
  const nested = pending.lowering
  const before = nested.diagnostics.length
  declareInOuts(nested, inOutSections(chain))
  const body = lowerBlock(nested, parsed.statements)
  if (nested.diagnostics.length > before) {
    lw.diagnostics.push(...nested.diagnostics.slice(before))
    pending.state = "failed"
    return undefined
  }
  pending.state = "lowered"
  const called: IrLayout = { ...layout, body, inouts: nested.inoutSlots }
  lw.layouts.set(key, called)
  return called
}

/**
 * An FB instance held in the GVL storage. Every body is handed that storage as one `&mut g`, so calling the instance —
 * `g.inst.call(g)` — borrows it twice (E0499; transpiler review 2026-09-15). A PROGRAM's instance lives apart, in `prg`.
 */
export function inGlobals(lw: Lowering, place: Place): boolean {
  return place.root === "global" && lw.shared.globals.slots[place.slot]!.section !== "program"
}

/**
 * `SUPER^(in := x, io := y)` — the base FB's body, run on this instance (conformance `inh_super_call_runs_base_body`,
 * `inh_super_call_with_arguments`): each input is assigned to the instance's own field, and stays assigned; each in-out
 * is bound; then the base body runs (`baseBody`). An argument left empty assigns nothing; an output argument is refused.
 */
function lowerSuperCall(lw: Lowering, call: Extract<Statement, { kind: "call_stmt" }>["call"]): IrStmt[] | undefined {
  const frame = selfFb(lw)
  const baseScope = lw.codeOwner?.baseScope
  const base = baseScope === undefined ? undefined : lw.bodies.get(baseScope.name.toUpperCase())
  const layout = frame === undefined ? undefined : lw.layouts.get(frame.name.toUpperCase())
  if (frame === undefined || base === undefined || layout === undefined) return lw.bail("call-super", "SUPER^() outside a derived FB, or on a base with no body", call.span)
  const routine = baseBody(lw, frame, base, call.span)
  if (routine === undefined) return undefined
  const instance = thisPlace(frame, call.callee.span)
  const before: IrStmt[] = []
  const inouts: (Place | undefined)[] = routine.inouts.map(() => undefined)
  for (const arg of call.args) {
    if (arg.param === undefined || arg.output) return lw.bail("call-positional", "SUPER^ called with a positional or output argument", arg.span)
    if (arg.value === undefined) continue
    const name = arg.param.name.toUpperCase()
    const k = routine.inouts.findIndex((p) => p.name.toUpperCase() === name)
    if (k >= 0) {
      const target = bindInOut(lw, arg, routine.inouts[k]!, [instance, ...inouts.filter((p): p is Place => p !== undefined)])
      if (target === undefined) return undefined
      inouts[k] = target
      continue
    }
    const field = layout.fields.find((f) => f.name.toUpperCase() === name && f.section === "VAR_INPUT")
    if (field === undefined) return lw.bail("call-param", `${arg.param.name} is not an input of ${frame.name}'s base`, arg.span)
    const value = lowerExpr(lw, arg.value, field.type)
    if (value === undefined) return undefined
    const member: Place = { ...instance, path: [{ kind: "field", name: field.name }], type: field.type, span: arg.span }
    before.push({ kind: "assign", target: member, value: convert(value, field.type), span: arg.span })
  }
  if (inouts.includes(undefined)) return lw.bail("call-inout-missing", `SUPER^ called without every VAR_IN_OUT`, call.span)
  const invoke: IrInvoke = { kind: "invoke", routine: routine.key, instance, inputs: [], inouts: inouts as Place[], type: UNKNOWN, span: call.span }
  return [...before, { kind: "eval", value: invoke, span: call.span }]
}

/**
 * `inst(a := x, q => y)` → the input assignments, the call, the output assignments (IrCall). A FUNCTION, a METHOD or
 * ACTION called bare, or `SUPER^(…)`, goes to its own lowering; a PROGRAM calls like an FB on its one instance. An
 * argument written but left empty (`a := ,`) assigns nothing — the input keeps its value (conformance
 * `state_empty_argument`); an empty output reads into nothing.
 */
export function lowerCallStatement(lw: Lowering, call: Extract<Statement, { kind: "call_stmt" }>["call"]): IrStmt[] | undefined {
  const callee = call.callee
  if (isSuper(callee)) return lowerSuperCall(lw, call)
  if (callee.kind === "ident_expr" && !lw.holds(callee.name)) {
    const sym = lookup(lw.scope, callee.name)?.symbol
    const kind = sym?.kind
    if (kind === "function" || ownMember(lw, callee.name) !== undefined) {
      const value = lowerInvoke(lw, call)
      return value && [{ kind: "eval", value, span: call.span }]
    }
    // a PROGRAM's one instance is global, and calls like an FB's; a GVL instance goes on to be refused by what it is
    const global = kind === "gvl_var" || sym?.varSection === "VAR_EXTERNAL"
    if (!global && (kind !== "program" || !lw.isRoot || callee.name.toUpperCase() === lw.shared.root.toUpperCase())) {
      const code = kind === "program" ? "call-program" : kind === "method" || kind === "action" ? "call-this" : "stmt-call_stmt"
      return lw.bail(code, `${callee.name} is not a callable instance yet`, call.span)
    }
  }
  if (callee.kind === "member") {
    if (isSuper(callee.base)) {
      const value = lowerInvoke(lw, call)
      return value && [{ kind: "eval", value, span: call.span }]
    }
    const base = lowerPlace(lw, callee.base)
    if (base === undefined) return undefined
    const layout = base.type.kind === "function_block" ? lw.layouts.get(base.type.name.toUpperCase()) : undefined
    // `inst.M(…)` / `inst.A()` — anything that is not an instance held in a field is a METHOD or ACTION
    if (!layout?.fields.some((f) => f.name.toUpperCase() === callee.member.name.toUpperCase())) {
      const value = lowerInvoke(lw, call)
      return value && [{ kind: "eval", value, span: call.span }]
    }
  }
  const instance = lowerPlace(lw, callee)
  if (instance === undefined) return undefined
  if (instance.type.kind !== "function_block") return lw.bail("stmt-call_stmt", "a call of something that is not an FB instance", call.span)
  if (inGlobals(lw, instance)) return lw.bail("call-global-instance", `${instance.type.name} is called on an instance declared in a GVL`, call.span)
  const layout = calledLayout(lw, instance.type.name, call.span)
  if (layout === undefined) return undefined

  const before: IrStmt[] = []
  const after: IrStmt[] = []
  const bound = new Map<string, Place>()
  const inouts = layout.inouts ?? []
  for (const arg of call.args) {
    if (arg.param === undefined) return lw.bail("call-positional", `${layout.name} called with a positional argument`, arg.span)
    if (arg.value === undefined) continue
    const name = arg.param.name.toUpperCase()
    const param = inouts.find((p) => p.name.toUpperCase() === name)
    if (param !== undefined) {
      const target = bindInOut(lw, arg, param, [instance, ...bound.values()])
      if (target === undefined) return undefined
      bound.set(name, target)
      continue
    }
    const field = layout.fields.find((f) => f.name.toUpperCase() === name)
    if (field === undefined) return lw.bail("call-param", `${arg.param.name} is not a parameter of ${layout.name}`, arg.span)
    const member: Place = { ...instance, path: [...instance.path, { kind: "field", name: field.name }], type: field.type, span: arg.span }
    if (arg.output) {
      const written = lowerPlace(lw, arg.value)
      const target = written === undefined ? undefined : through(lw, written, arg.span)
      if (target === undefined) return undefined
      const value: IrExpr = { kind: "load", place: member, type: field.type, span: arg.span }
      after.push({ kind: "assign", target, value: convert(value, target.type), span: arg.span })
    } else {
      const value = lowerExpr(lw, arg.value, field.type)
      if (value === undefined) return undefined
      before.push({ kind: "assign", target: member, value: convert(value, field.type), span: arg.span })
    }
  }
  const missing = inouts.find((p) => !bound.has(p.name.toUpperCase()))
  if (missing !== undefined) return lw.bail("call-inout-missing", `${missing.name} is not bound`, call.span)
  const inoutPlaces = inouts.map((p) => bound.get(p.name.toUpperCase())!)
  return [...before, { kind: "call", instance, fb: layout.name, inouts: inoutPlaces, span: call.span }, ...after]
}

/**
 * Two places one call cannot hold as two `&mut`: the same root variable, whatever the path within it — or, through THIS^,
 * the instance and anything of its own. Only the instance was compared, by slot and root, so two VAR_IN_OUT bound to one
 * variable, or `THIS^.M(v := n)` with `n` a field of that FB, printed a double borrow (transpiler review 2026-09-15).
 */
export function aliases(a: Place, b: Place): boolean {
  const own = (p: Place) => p.root === "this" || p.root === undefined
  if (a.root === "this" || b.root === "this") return own(a) && own(b)
  return a.slot === b.slot && a.root === b.root
}
