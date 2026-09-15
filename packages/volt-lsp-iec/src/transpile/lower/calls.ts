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
import { ANY_FAMILIES, elementaryRef, inferExprType, type Type, UNKNOWN } from "../../types/index.js"
import { byteSize } from "./bytes.js"
import {
  defaultValueOf,
  type IrBinding,
  type IrDispatch,
  type IrExpr,
  type IrInvoke,
  type IrLayout,
  type IrRoutine,
  type IrSlot,
  type IrStmt,
  type Place,
  holdsCall,
} from "../ir/index.js"
import { baseOf, boundName, Lowering, openDims, type PendingBody } from "./lowering.js"
import { convert } from "./convert.js"
import { declareInOuts, declareOpenBounds, declareVars, storageOf, tempResets } from "./storage.js"
import { boundOf, lowerPlace } from "./places.js"
import { refuseConstantWrite, sameStorage, through } from "./pointers.js"
import { lowerExpr } from "./expressions.js"
import { lowerBlock } from "./statements.js"
import { interfaceArgument, interfaceCall, interfacePropertyGet, interfacePropertySet, storeInterface } from "./interfaces.js"

type FbType = Extract<Type, { kind: "function_block" }>
type RoutineSymbol = NonNullable<ReturnType<typeof lookup>>["symbol"]

/** The FB a body runs on — what `THIS^` names — when it runs on one. */
const selfFb = (lw: Lowering): FbType | undefined => (lw.selfType?.kind === "function_block" ? lw.selfType : undefined)

const thisPlace = (type: FbType, span: Span): Place => ({ slot: 0, path: [], type, span, root: "this" })

/** What a call already holds: its instance, each in-out bound to a place, and the place each copy is written back to. The
 *  SUPER^ and FB body calls passed only the places, so `SUPER^(a := n, b := n)` copied n twice (review of the copy-back). */
const holding = (instance: Place | undefined, bindings: readonly (IrBinding | undefined)[]): Place[] => [
  ...(instance === undefined ? [] : [instance]),
  ...bindings.flatMap((b) => (b === undefined ? [] : "kind" in b ? (b.back === undefined ? [] : [b.back]) : [b])),
]

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

/** Each routine's `touched` set, by key — per POU lowering, so the routine's callers can take it on. */
const touches = new WeakMap<object, Map<string, ReadonlySet<number>>>()
function touchesOf(lw: Lowering): Map<string, ReadonlySet<number>> {
  let map = touches.get(lw.shared)
  if (map === undefined) touches.set(lw.shared, (map = new Map()))
  return map
}

/** Each routine's parameters in declaration order — VAR_INPUT, VAR_IN_OUT and VAR_OUTPUT as written — by key: the order a
 *  positional argument binds in (conformance `callshape_positional_arguments`). */
const positionals = new WeakMap<object, Map<string, readonly { name: string; output: boolean }[]>>()
function positionalOf(lw: Lowering): Map<string, readonly { name: string; output: boolean }[]> {
  let map = positionals.get(lw.shared)
  if (map === undefined) positionals.set(lw.shared, (map = new Map()))
  return map
}

/** Each routine's ANY / ANY_* input slots, by key — the inputs a call fills with its argument's size, not its value. */
const anyInputs = new WeakMap<object, Map<string, ReadonlySet<number>>>()
function anyInputsOf(lw: Lowering): Map<string, ReadonlySet<number>> {
  let map = anyInputs.get(lw.shared)
  if (map === undefined) anyInputs.set(lw.shared, (map = new Map()))
  return map
}

/** The lowering a routine body is lowered in: the frame's fields (when it runs on an instance) plus per-call locals. */
function routineLowering(lw: Lowering, scope: Scope, frame: FbType | undefined, codeOwner: Scope | undefined, key: string): Lowering {
  const r = new Lowering(scope, lw.project, lw.shared)
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
 * The bare names a body reads — or "all" when it calls a METHOD or ACTION of its own instance (`M()`, `THIS^.M()`,
 * `SUPER^()`), which may reach any of the FB's in-outs. ponytail: "all" over-approximates; a call graph would narrow it.
 */
function reachedNames(r: Lowering, statements: readonly unknown[]): Set<string> | "all" {
  const names = new Set<string>()
  let all = false
  const walk = (node: unknown): void => {
    if (all || node === null || typeof node !== "object") return
    if (Array.isArray(node)) return node.forEach(walk)
    const n = node as { kind?: string; name?: string; callee?: { kind: string; name?: string; base?: { kind: string } } }
    if (n.kind === "ident_expr") names.add(n.name!.toUpperCase())
    if (n.kind === "call" && n.callee !== undefined) {
      const callee = n.callee
      const kind = callee.kind === "ident_expr" ? lookup(r.scope, callee.name!)?.symbol.kind : undefined
      if (kind === "method" || kind === "action" || callee.kind === "deref" || (callee.kind === "member" && callee.base?.kind === "deref")) all = true
    }
    for (const [key, child] of Object.entries(node)) if (key !== "span") walk(child)
  }
  walk(statements)
  return all ? "all" : names
}

/**
 * A METHOD or ACTION run on an instance of `frame`, or a FUNCTION — lowered once per frame, in the instance's fields plus
 * per-call locals. `as` names a routine that is not the one the frame resolves by name (`SUPER^.M()`).
 */
export function calledRoutine(lw: Lowering, sym: RoutineSymbol, frame: FbType | undefined, span: Span, as = sym.name): IrRoutine | undefined {
  const name = frame === undefined ? sym.name : `${frame.name}.${as}`
  return once(lw, name, span, () => {
    if (frame !== undefined && !lw.layouts.has(frame.name.toUpperCase())) return lw.bail("call-target", `${frame.name} has no layout`, span)
    const ast = sym.ast as Extract<TopLevel, { kind: "method" | "action" | "function" }>
    const scope = findChildScope(frame === undefined ? lw.project : sym.owner, sym.name)
    if (scope === undefined) return lw.bail("call-target", `${name} did not bind`, span)
    const sections = ast.kind === "action" ? [] : ast.varSections
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
      sections
        .filter((s) => s.sectionKind === "VAR_INPUT" || s.sectionKind === "VAR_IN_OUT" || s.sectionKind === "VAR_OUTPUT")
        .flatMap((s) => s.decls.flatMap((d) => d.names.map((n) => ({ name: n.text, output: s.sectionKind === "VAR_OUTPUT" })))),
    )
    declareVars(r, sections.filter((s) => s.sectionKind === "VAR" || s.sectionKind === "VAR_TEMP"))
    declareInOuts(r, sections.filter((s) => s.sectionKind === "VAR_IN_OUT"))
    const resets = declareOutputs(lw, r, sections.filter((s) => s.sectionKind === "VAR_OUTPUT"), span)
    if (resets === undefined) return undefined
    // The FB's own VAR_IN_OUT a METHOD or ACTION reaches — each a parameter the call binds (`lowerInvoke`). Taken from the
    // FB's declaration, in its scope, and only those the routine can reach: they were every in-out of the FB's LOWERED body,
    // so a METHOD that never names one was refused from outside, and which POU lowered first decided (review of batch 3a).
    if (frame !== undefined) {
      const reached = reachedNames(r, parsed.statements)
      const owner = lookup(lw.project, sym.owner.name)?.symbol.ast
      const declared = new Lowering(sym.owner, r.project, r.shared)
      declareInOuts(declared, owner !== undefined && "varSections" in owner ? owner.varSections.filter((s) => s.sectionKind === "VAR_IN_OUT") : [])
      r.diagnostics.push(...declared.diagnostics)
      for (const slot of declared.inoutSlots) {
        const own = slot.name.toUpperCase()
        if ((reached !== "all" && !reached.has(own)) || r.inoutByName.has(own) || r.localByName.has(own)) continue
        r.inoutByName.set(own, r.inoutSlots.length)
        r.inoutSlots.push({ ...slot, ofInstance: true })
      }
    }
    const body = [...resets, ...lowerBlock(r, parsed.statements)]
    if (r.diagnostics.length > 0) {
      lw.diagnostics.push(...r.diagnostics)
      return undefined
    }
    return { name, key, kind: ast.kind, ...(frame === undefined ? {} : { fb: frame.name }), locals: r.localSlots, inputs, inouts: r.inoutSlots, ...(result === undefined ? {} : { result }), body, lent: r.lends }
  })
}

/** A METHOD or ACTION called on an instance of `frame` — by the instance's own type, so an override wins wherever the
 *  call is written (conformance `inh_base_body_reaches_override`, `inh_inherited_method_reaches_override`). */
export function methodOf(lw: Lowering, frame: FbType, name: string, span: Span): IrRoutine | undefined {
  const sym = frame.scope === undefined ? undefined : lookupMember(frame.scope, name)
  if (sym?.kind !== "method" && sym?.kind !== "action") return lw.bail("call-method", `${name} is not a METHOD or ACTION lowering can call`, span)
  return calledRoutine(lw, sym, frame, span)
}

/**
 * A PROPERTY's GET or SET as a routine of the FB it runs on: the getter's result, or the setter's one input, is a local
 * named as the property, and its VAR starts over on every call (conformance `state_property_get_set`).
 */
export function propertyRoutine(lw: Lowering, frame: FbType, sym: RoutineSymbol, accessor: "get" | "set", span: Span): IrRoutine | undefined {
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
    return { name, key, kind: "method", fb: frame.name, locals: r.localSlots, inouts: [], ...shape, body, lent: r.lends }
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
export function lowerPropertyGet(lw: Lowering, e: Expr): IrInvoke | IrDispatch | undefined | null {
  const access = propertyAccess(lw, e)
  if (access === undefined) return undefined
  // not an instance's: perhaps an interface's (conformance `itf_property_through_interface`)
  if (access === null) return interfacePropertyGet(lw, e)
  if (lw.arguments > 0) return lw.bail("call-nested", "a PROPERTY read inside a call's arguments", e.span)
  const routine = propertyRoutine(lw, access.frame, access.sym, "get", e.span)
  if (routine === undefined) return undefined
  // The getter of an FB instance inside a PROGRAM runs on the program's instance (conformance
  // `callshape_program_instance_property`: 33, 34), with the program moved out as for a METHOD there — under the same checks.
  const inside = access.instance
  if (inside.root === "global" && inside.path.length > 0) {
    if (!staticPath(inside)) return lw.bail("call-program-property", `${access.sym.name} is read on an instance inside a PROGRAM through a runtime index`, e.span)
    if (touchesOf(lw).get(routine.key)?.has(inside.slot) || reachesDispatch(lw, routine.body))
      return lw.bail("call-program-reentrant", `${access.sym.name}'s getter may reach the PROGRAM it is read inside`, e.span)
  }
  return { kind: "invoke", routine: routine.key, instance: access.instance, inputs: [], inouts: [], type: routine.locals[0]!.type, span: e.span }
}

/**
 * `P := value` on a PROPERTY → the value into a temp, then the setter with it. The value is computed first, as a store's
 * right side is; handed straight to the setter, a getter inside it (`THIS^.L := THIS^.L + 5`, measured) would be a call
 * inside the setter's arguments — two `&mut` of one instance in Rust. `null` when the target is no property.
 */
export function lowerPropertySet(lw: Lowering, s: Extract<Statement, { kind: "assign" }>): IrStmt[] | undefined | null {
  const access = propertyAccess(lw, s.target)
  if (access === undefined) return undefined
  if (access === null) return interfacePropertySet(lw, s)
  if (s.op !== undefined || s.chained !== undefined) return lw.bail("property-store", `${access.sym.name} set by ${s.op ?? "a chain"}`, s.span)
  // written from outside the PROGRAM it lives in, it does not compile: "'gauge' is no input of 'PRG_CS_station21'"
  // (recorded while making `callshape_program_instance_property`)
  if (access.instance.root === "global" && access.instance.path.length > 0)
    return lw.bail("call-program-property", `${access.sym.name} is written on an instance inside a PROGRAM, from outside it`, s.span)
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
    if (isGraphicalBody(unit.body)) return lw.bail("graphical-body", `${unit.name.text} has a graphical body`, span)
    const parsed = parseActive(unit.body)
    if (!parsed.ok) return lw.bail("parse", parsed.firstError ?? `${unit.name.text}'s body did not parse`, span)
    const key = name.toUpperCase()
    const r = routineLowering(lw, base.lowering.scope, frame, base.lowering.codeOwner, key)
    declareInOuts(r, inOutSections(chain))
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
 * The place a VAR_IN_OUT argument binds. Refused: two `&mut` into one place (they do not exist in Rust — the handle form,
 * design §9 form 3, is for later), a bit, a global (every body holds the globals as one `&mut`), and a derived instance
 * or struct standing in for its base type — the parameter would dispatch on the base, which is not modelled.
 */
function bindInOut(lw: Lowering, arg: CallArg, param: IrSlot, held: readonly Place[], callee: readonly IrStmt[], calleeFb: string | undefined): IrBinding | undefined {
  // `(x)` is the variable x — it takes the alias check below like a bare `x` (review of the batch, 2026-09-15)
  let value = arg.value!
  while (value.kind === "paren") value = value.inner
  // A VAR_IN_OUT CONSTANT reads what it is lent (conformance `inout_const_*`). A LITERAL — the STRING literal CODESYS accepts —
  // is lent as a copy, which nothing can write; any other value goes on to `lowerPlace`, which refuses it, as CODESYS
  // refuses an expression (`inout_const_expression_2`).
  if (param.readOnly === true && value.kind === "literal" && value.literalKind === "string") {
    const literal = value
    const lowered = lw.inArgument(() => lowerExpr(lw, literal, param.type))
    return lowered && { kind: "copy", value: convert(lowered, param.type), type: param.type, span: arg.span }
  }
  const variable = value
  const written = lw.inArgument(() => lowerPlace(lw, variable))
  // a read-only binding writes nothing, so it is not a store `through` must check — a reference still reads its target
  const target = written === undefined ? undefined : param.constant === true && written.type.kind !== "reference" ? written : through(lw, written, arg.span)
  if (target === undefined) return undefined
  const shared = held.some((p) => aliases(target, p)) || target.root === "global"
  // A variable the call also holds (the instance a METHOD runs on, `inst.M(v := inst.x)`) or a global cannot be lent as `&`
  // beside the `&mut` of the instance or `g`. For a read-only in-out a copy reads the same — exactly when the callee writes
  // nothing but its own locals and calls nothing, so nothing can change the variable while it runs (`inout_const_method_9`).
  if (param.readOnly === true && shared && target.path.every((s) => s.kind !== "bit")) {
    if (writesOnlyLocals(callee)) return { kind: "copy", value: { kind: "load", place: target, type: target.type, span: arg.span }, type: param.type, span: arg.span }
    return lw.bail("call-inout-alias", `${param.name} is bound to a variable the callee could change while it reads it`, arg.span)
  }
  if (held.some((p) => aliases(target, p))) {
    // An FB lending its own field to its own METHOD — pro2193's `Shift(line := points)` (conformance
    // `callshape_array_star_of_struct`), `Mixed(counter, 3)` (`callshape_positional_arguments`) — is two `&mut` of one
    // instance. Copied in and written back after the call it reads the same — exactly in this shape, and only this: the
    // call is on THIS itself and nothing else the call binds is that field; the field is the FB's own, reached by fields
    // and constant indices, of the parameter's own type, not an output; and the callee touches nothing but its own locals,
    // inputs and in-outs and calls nothing, so the in-out is its one way to the field. The review of the first cut (a
    // callee that "does not name the field") found eight ways a stale copy was still seen — through another in-out, a
    // sub-instance, an interface, a FUNCTION given THIS^ — and each wrote a wrong value.
    const aliased = held.filter((p) => aliases(target, p))
    const own = aliased.length === 1 && aliased[0]!.root === "this" && aliased[0]!.path.length === 0 && target.root === undefined
    // an ARRAY[*] parameter takes an array of its dimensions over its element (design §26); anything else, the same storage
    const lendable =
      openDims(param.type) > 0
        ? param.type.kind === "array" && target.type.kind === "array" && param.type.dims.length === target.type.dims.length && sameStorage(param.type.element, target.type.element)
        : sameStorage(param.type, target.type)
    if (own && param.section !== "VAR_OUTPUT" && staticPath(target) && target.guard === undefined && lendable && touchesOnlyItsOwn(callee))
      return { kind: "copy", value: { kind: "load", place: target, type: target.type, span: arg.span }, type: param.type, back: target, span: arg.span }
    return lw.bail("call-inout-alias", `${param.name} is bound to a variable the call already holds`, arg.span)
  }
  if (target.path.some((s) => s.kind === "bit")) return lw.bail("call-inout-bit", `${param.name} is bound to a bit`, arg.span)
  if (target.root === "global") return lw.bail("call-inout-global", `${param.name} is bound to a global variable`, arg.span)
  const composite = (t: Type): string | undefined => (t.kind === "function_block" || t.kind === "struct" ? t.name.toUpperCase() : undefined)
  if (composite(param.type) !== undefined && composite(param.type) !== composite(target.type))
    return lw.bail("call-inout-derived", `${param.name} is bound to a ${target.type.kind === "function_block" || target.type.kind === "struct" ? target.type.name : target.type.kind}, not its own type`, arg.span)
  return target
}

/**
 * A callee that touches nothing but its own locals, inputs and in-outs, and calls nothing — no METHOD, FB body, FUNCTION or
 * interface call, no dereference. The only way from it to a variable of its caller is then an in-out it was bound.
 */
function touchesOnlyItsOwn(node: unknown): boolean {
  if (Array.isArray(node)) return node.every(touchesOnlyItsOwn)
  if (node === null || typeof node !== "object") return true
  const n = node as { kind?: string; slot?: unknown; path?: unknown; root?: string; guard?: unknown }
  if (n.kind === "invoke" || n.kind === "dispatch" || n.kind === "call") return false
  if (typeof n.slot === "number" && Array.isArray(n.path) && (n.guard !== undefined || (n.root !== "local" && n.root !== "inout"))) return false
  return Object.entries(node).every(([key, child]) => key === "type" || key === "of" || key === "span" || touchesOnlyItsOwn(child))
}

/** A body that writes nothing but its own locals and calls nothing (IR walked whole; a type's scope graph is skipped). */
function writesOnlyLocals(node: unknown): boolean {
  if (Array.isArray(node)) return node.every(writesOnlyLocals)
  if (node === null || typeof node !== "object") return true
  const n = node as { kind?: string; target?: Place }
  if (n.kind === "invoke" || n.kind === "dispatch" || n.kind === "call") return false
  if (n.kind === "assign" && n.target?.root !== "local") return false
  return Object.entries(node).every(([key, child]) => key === "type" || key === "of" || key === "span" || writesOnlyLocals(child))
}

/** A binding that is the caller's place — not a copy lent to a VAR_IN_OUT CONSTANT. */

/**
 * `inst.M(a := x)`, `M()` inside an FB, `SUPER^.M()`, `inst.A()` or `F(x)` → an `IrInvoke`. Arguments bind by name;
 * positionally only to a routine with no VAR_IN_OUT (measured for a FUNCTION's input, `fbcall_function_locals`). An
 * input left out is refused — whether it takes its initial value is not measured.
 */
export function lowerInvoke(lw: Lowering, call: Extract<Expr, { kind: "call" }>): IrInvoke | IrDispatch | undefined {
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
    // through an interface: the method of whichever instance it holds (conformance `itf_call_dispatches_on_instance`)
    if (base.type.kind === "interface") return interfaceCall(lw, base, call, callee.member.name)
    if (inGlobals(lw, base)) return lw.bail("call-global-instance", `${callee.member.name} is called on an instance declared in a GVL`, call.span)
    // A METHOD of a PROGRAM's one instance (conformance `callshape_method_on_program`) runs moved out of `Programs`, as the
    // program's own call does — and so does one of an FB instance INSIDE a program (`callshape_program_instance_from_outside`),
    // on the path into the moved-out program. It was refused (`prg.p.inst.m(g, prg)` borrows `Programs` twice). A runtime
    // index in that path would be read on the stand-in: refused.
    if (base.root === "global" && !staticPath(base)) return lw.bail("call-program-method", `${callee.member.name} is called on an instance inside a PROGRAM through a runtime index`, call.span)
    if (base.type.kind !== "function_block") return lw.bail("call-method", `${callee.member.name} is not a METHOD or ACTION lowering can call`, call.span)
    routine = methodOf(lw, base.type, callee.member.name, call.span)
    instance = base
    // moved out while it runs, the program must not reach its own instance from the method
    if (routine !== undefined && base.root === "global" && touchesOf(lw).get(routine.key)?.has(base.slot))
      return lw.bail("call-program-reentrant", `${callee.member.name} reaches its own PROGRAM's instance while it runs`, call.span)
    if (routine !== undefined && base.root === "global" && base.path.length > 0 && reachesDispatch(lw, routine.body))
      return lw.bail("call-program-reentrant", `${callee.member.name} calls through an interface, which may reach its PROGRAM while it runs`, call.span)
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
  // the inputs in the order they are written — the order they run in (conformance `callshape_argument_order`)
  const order: number[] = []
  const inouts: (IrBinding | undefined)[] = routine.inouts.map(() => undefined)
  const held = () => holding(instance, inouts)
  // Positional arguments bind in declaration order across VAR_INPUT and VAR_IN_OUT (conformance
  // `callshape_positional_arguments`: 100, 315, 46), so each is named here by the parameter at its position. They were
  // refused whenever the routine had an in-out — pro2193's `Arrays.Bool_All(result, TRUE)` — and a METHOD calling its own
  // FB's METHODs takes the FB's in-outs, so even `ManualControl(a, b)` was. How a position counts a VAR_OUTPUT declared
  // among them is not recorded: refused.
  const declared = positionalOf(lw).get(routine.key) ?? []
  const args: CallArg[] = []
  for (const [position, arg] of call.args.entries()) {
    if (arg.param !== undefined || arg.output) {
      args.push(arg)
      continue
    }
    const parameter = declared[position]
    if (parameter === undefined || declared.slice(0, position + 1).some((d) => d.output))
      return lw.bail("call-positional", `${routine.name} called with a positional argument ${parameter === undefined ? "past its parameters" : "counted across a VAR_OUTPUT"}`, arg.span)
    args.push({ ...arg, param: { kind: "ident_expr", name: parameter.name, span: arg.span } })
  }
  for (const arg of args) {
    const name = arg.param?.name.toUpperCase()
    const bound = name === undefined ? -1 : routine.inouts.findIndex((p) => p.name.toUpperCase() === name)
    const param = bound >= 0 ? routine.inouts[bound]! : undefined
    // `name => target`: a VAR_OUTPUT bound to the caller's place (conformance `state_routine_outputs`); left empty, a temp
    if (arg.output) {
      if (param?.section !== "VAR_OUTPUT") return lw.bail("call-output", `${arg.param?.name ?? "an argument"} is no VAR_OUTPUT of ${routine.name}`, arg.span)
      if (arg.value === undefined) continue
      const target = bindInOut(lw, arg, param, held(), routine.body, routine.fb)
      if (target === undefined) return undefined
      if (target.type.kind !== "elementary" || param.type.kind !== "elementary" || target.type.name !== param.type.name || target.type.length !== param.type.length)
        return lw.bail("call-output-type", `${param.name} is read into a variable of another type`, arg.span)
      inouts[bound] = target
      continue
    }
    if (arg.value === undefined) return lw.bail("call-output", `${routine.name} called with an empty argument`, arg.span)
    if (param?.section === "VAR_OUTPUT") return lw.bail("call-output", `${param.name} is a VAR_OUTPUT, bound with :=`, arg.span)
    if (param !== undefined) {
      const target = bindInOut(lw, arg, param, held(), routine.body, routine.fb)
      if (target === undefined) return undefined
      inouts[bound] = target
      continue
    }
    const k = routine.inputs.findIndex((i) => routine!.locals[i]!.name.toUpperCase() === name)
    if (k < 0) return lw.bail("call-param", `${arg.param!.name} is not an input of ${routine.name}`, arg.span)
    if (anyInputsOf(lw).get(routine.key)?.has(routine.inputs[k]!)) {
      // an ANY argument: the routine sees its size — SIZEOF's layout (conformance `state_any_input_sizes`) — of a variable
      const place = lw.inArgument(() => lowerPlace(lw, arg.value!))
      if (place === undefined) return undefined
      const size = byteSize(lw, place.type)
      if (size === undefined) return lw.bail("any-input", "an ANY argument whose byte size is not measured", arg.span)
      inputs[k] = { kind: "const", value: size.size, type: elementaryRef("DINT"), span: arg.span }
      order.push(k)
      continue
    }
    const slot = routine.locals[routine.inputs[k]!]!
    if (slot.type.kind === "interface") {
      // a routine's interface input: the tag, recorded for the routine's own local (conformance `itf_function_input`,
      // `itf_method_input_passed_on`) — the instances it names are lent to the routine by its callers (design §24)
      // handed to a METHOD of an instance other than this body's own (an in-out, a lent instance, a global): foreign
      const foreign = instance !== undefined && instance.root !== undefined && instance.root !== "this"
      const tag = interfaceArgument(lw, `ROUTINE:${routine.key}.${slot.name.toUpperCase()}`, slot.type, arg.value!, arg.span, foreign)
      if (tag === undefined) return undefined
      inputs[k] = tag
      order.push(k)
      continue
    }
    // A call or PROPERTY read in an input runs where it is written, before the call (`callshape_argument_order`,
    // `callshape_property_read_in_arguments`) — each backend takes the inputs in `order`. It was refused (`call-nested`),
    // which stays for a call inside an in-out binding, whose place the call borrows.
    const value = lowerExpr(lw, arg.value!, slot.type)
    if (value === undefined) return undefined
    inputs[k] = convert(value, slot.type)
    order.push(k)
  }
  // An `ARRAY[*]` in-out is handed the bounds of the array it binds, as hidden inputs (design §26): a sized array's fold, an
  // open in-out passed on hands on its own (conformance `callshape_array_star_passed_on`: 9804).
  for (const [i, slot] of routine.inouts.entries()) {
    const binding = inouts[i]
    for (let dim = 1; binding !== undefined && dim <= openDims(slot.type); dim++)
      for (const which of ["lower", "upper"] as const) {
        const k = routine.inputs.findIndex((index) => routine!.locals[index]!.name.toUpperCase() === boundName(slot.name, which, dim).toUpperCase())
        // a copy written back takes the bounds of the place it copies (an FB's own array lent to its own METHOD)
        const at = "kind" in binding ? binding.back : binding
        const value = k < 0 || at === undefined ? undefined : boundOf(lw, at, which, dim)
        if (value === undefined) return lw.bail("call-open-array", `${slot.name} is bound to an array whose bounds are not known here`, call.span)
        inputs[k] = value
        order.push(k)
      }
  }
  // An input left out starts at its declared initial value on every call (conformance `callshape_input_left_out`: 54 and
  // 51, never the last call's) — CODESYS compiles the omission only for an input that has one. An ANY input, or one
  // whose initial value is an aggregate, stays refused.
  for (const [k, index] of routine.inputs.entries()) {
    if (inputs[k] !== undefined) continue
    const slot = routine.locals[index]!
    if (anyInputsOf(lw).get(routine.key)?.has(index) || typeof slot.init === "object")
      return lw.bail("call-input-missing", `${routine.name} called without ${slot.name}, whose starting value is not modelled`, call.span)
    inputs[k] = { kind: "const", value: slot.init, type: slot.type, span: call.span }
    order.push(k)
  }
  // the FB's own VAR_IN_OUT a METHOD reaches: bound to the in-out this body holds — a call on THIS instance from the FB's own
  // run. From outside, CODESYS uses the instance's LAST binding (`callshape_inout_in_method_after_call`): not modelled.
  for (const [i, slot] of routine.inouts.entries()) {
    if (slot.ofInstance !== true) continue
    // THIS instance itself — `THIS^.inner.M()` is rooted at THIS too, but runs on a child with in-outs of its own
    const held = instance?.root === "this" && instance.path.length === 0 ? lw.inoutByName.get(slot.name.toUpperCase()) : undefined
    if (held === undefined) return lw.bail("call-fb-inout", `${routine.name} reaches ${slot.name}, its FB's VAR_IN_OUT, called outside the FB's own run`, call.span)
    inouts[i] = { slot: held, path: [], type: lw.inoutSlots[held]!.type, span: call.span, root: "inout" }
  }
  for (const [i, slot] of routine.inouts.entries()) {
    if (inouts[i] !== undefined) continue
    if (slot.section !== "VAR_OUTPUT") return lw.bail("call-inout-missing", `${routine.name} called without every VAR_IN_OUT`, call.span)
    // an unconnected output still needs somewhere to go: a temp of its own, which nothing reads
    const temp = lw.tempPlace("output", slot.type, call.span)
    if (held().some((p) => aliases(temp, p))) return lw.bail("call-inout-alias", `${slot.name} is unconnected on a call of this instance's own method`, call.span)
    inouts[i] = temp
  }
  // every argument is named by now — a positional one by the parameter at its position
  const moved = movedInOut(
    { args },
    (name) => inouts[routine!.inouts.findIndex((p) => p.name.toUpperCase() === name)],
    (arg) => inputs[routine!.inputs.findIndex((i) => routine!.locals[i]!.name.toUpperCase() === arg.param!.name.toUpperCase())],
  )
  if (moved !== undefined) return lw.bail("call-inout-order", `${routine.name}'s ${moved} is bound before a call in a later argument that could move it`, call.span)
  const type = routine.result === undefined ? UNKNOWN : routine.locals[routine.result]!.type
  return { kind: "invoke", routine: routine.key, ...(instance === undefined ? {} : { instance }), inputs: inputs as IrExpr[], order, inouts: inouts as IrBinding[], type, span: call.span }
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
  if (isGraphicalBody(unit.body)) return lw.fail(pending, "graphical-body", `${name} has a graphical body`, span)
  const parsed = parseActive(unit.body)
  if (!parsed.ok) return lw.fail(pending, "parse", parsed.firstError ?? `${name}'s body did not parse`, span)
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
  const called: IrLayout = { ...layout, body, inouts: nested.inoutSlots, lent: nested.lends }
  lw.layouts.set(key, called)
  return called
}

/**
 * Whether a body, or any body it calls, calls through an interface. Such a call's arms are finished only after the POU
 * lowers, so the PROGRAM instances they reach are not in `touched` when a call on an instance inside a program is checked
 * — one read the program's `::new()` stand-in (review of the batch). ponytail: refuses every such body; check the finished
 * arms instead if the corpus needs it.
 */
function reachesDispatch(lw: Lowering, body: readonly IrStmt[], seen = new Set<string>()): boolean {
  let found = false
  const walk = (node: unknown): void => {
    if (found || node === null || typeof node !== "object") return
    if (Array.isArray(node)) return node.forEach(walk)
    const n = node as { kind?: string; routine?: string; fb?: string }
    if (n.kind === "dispatch") return void (found = true)
    if (n.kind === "invoke" && n.routine !== undefined && !seen.has(n.routine)) {
      seen.add(n.routine)
      const called = lw.routines.get(n.routine)
      if (called?.state === "lowered") walk(called.routine.body)
    }
    if (n.kind === "call" && n.fb !== undefined && !seen.has(`FB:${n.fb}`)) {
      seen.add(`FB:${n.fb}`)
      walk(lw.layouts.get(n.fb.toUpperCase())?.body)
    }
    for (const [key, child] of Object.entries(node)) if (key !== "span" && key !== "type") walk(child)
  }
  walk(body)
  return found
}

/** A place whose path is fields and constant indices only — the same place read before a program is moved out and after. */
const staticPath = (place: Place): boolean => place.path.every((s) => s.kind === "field" || (s.kind === "index" && s.index.kind === "const"))

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
  const inouts: (IrBinding | undefined)[] = routine.inouts.map(() => undefined)
  for (const arg of call.args) {
    if (arg.param === undefined || arg.output) return lw.bail("call-positional", "SUPER^ called with a positional or output argument", arg.span)
    if (arg.value === undefined) continue
    const name = arg.param.name.toUpperCase()
    const k = routine.inouts.findIndex((p) => p.name.toUpperCase() === name)
    if (k >= 0) {
      const target = bindInOut(lw, arg, routine.inouts[k]!, holding(instance, inouts), routine.body, routine.fb)
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
  // The bounds live on the instance, which the derived body shares: `SUPER^(data := other)` overwrote them, and the derived
  // body then indexed its own `data` by `other`'s bounds (review of batch 3b). Only passing an open in-out on as itself —
  // same bounds — is kept; rebinding one under SUPER^ is not recorded.
  for (const [i, slot] of routine.inouts.entries()) {
    const binding = inouts[i]!
    if (openDims(slot.type) > 0 && ("kind" in binding || binding.root !== "inout" || binding.path.length > 0 || lw.inoutSlots[binding.slot]!.name.toUpperCase() !== slot.name.toUpperCase()))
      return lw.bail("call-open-array", `SUPER^ binds its ARRAY[*] ${slot.name} to another array`, call.span)
  }
  const bounds = storeOpenBounds(lw, instance, layout.fields, routine.inouts, (i) => inouts[i], call.span)
  if (bounds === undefined) return undefined
  const invoke: IrInvoke = { kind: "invoke", routine: routine.key, instance, inputs: [], inouts: inouts as IrBinding[], type: UNKNOWN, span: call.span }
  return [...before, ...bounds, { kind: "eval", value: invoke, span: call.span }]
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
    if (!global && (kind !== "program" || callee.name.toUpperCase() === lw.shared.root.toUpperCase())) {
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
  // An FB instance inside a PROGRAM, called from outside it (`callshape_program_instance_from_outside`): the program is
  // moved out of `Programs` for the call, as for its own. It was refused (`prg.p.inst.call(g, prg)` borrows `Programs`
  // twice). A runtime index on the way would be read on the stand-in, and a body reaching its program would too: refused.
  if (instance.root === "global" && !staticPath(instance))
    return lw.bail("call-program-member", `${instance.type.name} is called inside a PROGRAM's instance through a runtime index`, call.span)
  const layout = calledLayout(lw, instance.type.name, call.span)
  if (layout === undefined) return undefined
  if (instance.root === "global" && instance.path.length > 0 && lw.bodies.get(instance.type.name.toUpperCase())?.lowering.touched.has(instance.slot))
    return lw.bail("call-program-reentrant", `${instance.type.name}'s body reaches the PROGRAM it is called inside`, call.span)
  if (instance.root === "global" && instance.path.length > 0 && reachesDispatch(lw, layout.body ?? []))
    return lw.bail("call-program-reentrant", `${instance.type.name}'s body calls through an interface, which may reach the PROGRAM it is called inside`, call.span)

  const before: IrStmt[] = []
  const after: IrStmt[] = []
  const bound = new Map<string, IrBinding>()
  const inouts = layout.inouts ?? []
  for (const arg of call.args) {
    if (arg.param === undefined) return lw.bail("call-positional", `${layout.name} called with a positional argument`, arg.span)
    if (arg.value === undefined) continue
    const name = arg.param.name.toUpperCase()
    const param = inouts.find((p) => p.name.toUpperCase() === name)
    if (param !== undefined) {
      const target = bindInOut(lw, arg, param, holding(instance, [...bound.values()]), layout.body ?? [], layout.name)
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
      // an input stored into an instance lent through a VAR_IN_OUT CONSTANT: CODESYS calls one (`inout_const_fb_call_13`), but
      // storing into it is not recorded — refused as the store it is
      if (refuseConstantWrite(lw, member, arg.span)) return undefined
      if (field.type.kind === "interface") {
        // an FB keeps an interface input as it keeps any (`itf_fb_input_left_out`): the tag stored into its field
        const stored = storeInterface(lw, member, arg.value, arg.span)
        if (stored === undefined) return undefined
        before.push(stored)
        continue
      }
      const value = lowerExpr(lw, arg.value, field.type)
      if (value === undefined) return undefined
      before.push({ kind: "assign", target: member, value: convert(value, field.type), span: arg.span })
    }
  }
  const missing = inouts.find((p) => !bound.has(p.name.toUpperCase()))
  if (missing !== undefined) return lw.bail("call-inout-missing", `${missing.name} is not bound`, call.span)
  const moved = movedInOut(call, (name) => bound.get(name), (arg) => before.filter((s) => s.kind === "assign" && s.target.path.at(-1)?.kind === "field" && (s.target.path.at(-1) as { name: string }).name.toUpperCase() === arg.param?.name.toUpperCase()))
  if (moved !== undefined) return lw.bail("call-inout-order", `${layout.name}'s ${moved} is bound before a call in a later argument that could move it`, call.span)
  const bounds = storeOpenBounds(lw, instance, layout.fields, inouts, (i) => bound.get(inouts[i]!.name.toUpperCase()), call.span)
  if (bounds === undefined) return undefined
  const inoutPlaces = inouts.map((p) => bound.get(p.name.toUpperCase())!)
  return [...before, ...bounds, { kind: "call", instance, fb: layout.name, inouts: inoutPlaces, span: call.span }, ...after]
}

/**
 * The bounds of the arrays an FB's `ARRAY[*]` in-outs bind, stored into the instance's hidden fields before its body runs —
 * where the body reads them (design §26; conformance `callshape_array_star_fb_inout`: 2, then 4). A METHOD reaching the
 * in-out is refused (`boundOf`): no recording shows which bounds it sees.
 */
function storeOpenBounds(lw: Lowering, instance: Place, fields: readonly IrSlot[], inouts: readonly IrSlot[], binding: (i: number) => IrBinding | undefined, span: Span): IrStmt[] | undefined {
  const stores: IrStmt[] = []
  for (const [i, slot] of inouts.entries())
    for (let dim = 1; dim <= openDims(slot.type); dim++)
      for (const which of ["lower", "upper"] as const) {
        const field = fields.find((f) => f.name.toUpperCase() === boundName(slot.name, which, dim).toUpperCase())
        const bound = binding(i)
        const at = bound === undefined ? undefined : "kind" in bound ? bound.back : bound
        const value = field === undefined || at === undefined ? undefined : boundOf(lw, at, which, dim)
        if (value === undefined) return lw.bail("call-open-array", `${slot.name} is bound to an array whose bounds are not known here`, span)
        stores.push({ kind: "assign", target: { ...instance, path: [...instance.path, { kind: "field", name: field!.name }], type: field!.type, span }, value, span })
      }
  return stores
}

/**
 * The in-out a call in a LATER-written argument could move — its binding reads an index, a pointer or a copied value.
 * CODESYS binds each in-out where it is written (conformance `callshape_inout_binding_order`: 201 written after the call,
 * 101 before it); both backends bind every in-out after the inputs, which differs exactly there — so it is refused.
 */
function movedInOut(call: { args: readonly CallArg[] }, binding: (name: string) => IrBinding | undefined, input: (arg: CallArg, position: number) => unknown): string | undefined {
  let callLater = false
  for (let position = call.args.length - 1; position >= 0; position--) {
    const arg = call.args[position]!
    const bound = arg.param === undefined ? undefined : binding(arg.param.name.toUpperCase())
    if (bound === undefined) {
      if (holdsCall(input(arg, position))) callLater = true
    } else if (callLater && ("kind" in bound || bound.guard !== undefined || bound.path.some((s) => s.kind === "index" && s.index.kind !== "const")))
      return arg.param!.name
  }
  return undefined
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
