/**
 * INTERFACE variables (design §22, conformance `itf_*`). An interface variable holds the TAG of the FB instance it names —
 * 0 for none, as it starts (`itf_call_dispatches_on_instance`) — and a call through it dispatches on that tag to the
 * METHOD or PROPERTY accessor of each instance it may name. Tags are given per lowered POU, to instance places, so a copy
 * between two interface variables (`itf_extends_assigns_to_base`) is a plain copy of the tag.
 *
 * Which instances a variable may name is recorded as stores lower: an instance's tag, or an edge from the variable it
 * was copied from. The arms of a call are filled in only when the whole POU has lowered (`finishInterfaces`) — a store
 * later in the source reaches a call earlier in it on the next cycle, so source order proves nothing. An instance is
 * reachable only from the frame its place indexes: an arm lowered in another frame is refused (`interface-context`).
 *
 * Not built yet, and refused: an interface passed as an input (`itf_function_input`) or bound as an in-out or output,
 * a METHOD with a VAR_IN_OUT or VAR_OUTPUT called through one, an instance that is a local, an in-out, a dereference or
 * reached through a runtime index.
 */
import type { Expr, Interface, Span, Statement } from "../../syntax/index.js"
import { lookup, lookupMember } from "../../symbols/index.js"
import { elementaryRef, inferExprType, type Type, UNKNOWN } from "../../types/index.js"
import type { IrArm, IrDispatch, IrExpr, IrInvoke, IrStmt, Place } from "../ir/index.js"
import type { Lowering } from "./lowering.js"
import { convert } from "./convert.js"
import { storageOf } from "./storage.js"
import { lowerPlace } from "./places.js"
import { pointerKey, sameTarget } from "./pointers.js"
import { lowerExpr } from "./expressions.js"
import { methodOf, propertyRoutine } from "./calls.js"

type FbType = Extract<Type, { kind: "function_block" }>
type SymbolAst = NonNullable<ReturnType<typeof lookup>>["symbol"]["ast"]

/** An interface's declaration and every one it EXTENDS, itself first. */
function interfaceChain(lw: Lowering, name: string): Interface[] {
  const chain: Interface[] = []
  const visit = (n: string): void => {
    const ast = lookup(lw.project, n)?.symbol.ast
    if (ast?.kind !== "interface" || chain.includes(ast)) return
    chain.push(ast)
    for (const base of ast.extends ?? []) visit(base.text)
  }
  visit(name)
  return chain
}

/** Whether the FB, or a base FB of it, IMPLEMENTS the interface — itself or one that EXTENDS it. */
export function implementsInterface(lw: Lowering, fb: string, itf: string): boolean {
  const wanted = itf.toUpperCase()
  for (let name: string | undefined = fb, depth = 0; name !== undefined && depth < 32; depth++) {
    const ast: SymbolAst | undefined = lookup(lw.project, name)?.symbol.ast
    if (ast?.kind !== "function_block") return false
    if ((ast.implements ?? []).some((i) => interfaceChain(lw, i.text).some((a) => a.name.text.toUpperCase() === wanted))) return true
    name = ast.extends?.text
  }
  return false
}

/** The tag of an FB instance — given at its first store, 1 and up. */
function tagOf(lw: Lowering, place: Place, fb: FbType, span: Span): number | undefined {
  const tracked =
    place.guard === undefined &&
    (place.root === undefined || place.root === "this" || place.root === "global") &&
    place.path.every((s) => s.kind === "field" || (s.kind === "index" && s.index.kind === "const"))
  if (!tracked) return lw.bail("interface-instance", "an interface stored with a local, an in-out, a dereference or an element at a runtime index", span)
  const context = place.root === "global" ? "GLOBAL" : lw.frameContext
  const known = lw.shared.instances.findIndex((x) => x.context === context && sameTarget({ base: x.place }, { base: place }))
  if (known >= 0) return known + 1
  lw.shared.instances.push({ place, context, fb })
  return lw.shared.instances.length
}

/** The instances an interface variable holds, by `pointerKey` — created at its first use. */
function heldAt(lw: Lowering, place: Place, span: Span) {
  const key = pointerKey(lw, place)
  if (key === undefined) return lw.bail("interface-place", "an interface held somewhere this does not track — a field of another instance, an element, an in-out", span)
  let held = lw.shared.interfaces.get(key)
  if (held === undefined) lw.shared.interfaces.set(key, (held = { tags: new Set(), from: [] }))
  return { key, held }
}

/** Every tag the variable may hold: its own stores, and what each variable it was copied from may hold. */
function tagsOf(lw: Lowering, key: string, seen: ReadonlySet<string> = new Set()): Set<number> {
  const held = lw.shared.interfaces.get(key)
  if (held === undefined || seen.has(key)) return new Set()
  const tags = new Set(held.tags)
  for (const edge of held.from)
    for (const tag of tagsOf(lw, edge.key, new Set([...seen, key])))
      if (edge.only === undefined || implementsInterface(lw, lw.shared.instances[tag - 1]!.fb.name, edge.only)) tags.add(tag)
  return tags
}

/** A finisher: run for each tag the variable may hold that it has not seen, reporting into the root lowering. */
function onEachTag(lw: Lowering, key: string, each: (tag: number) => void): void {
  const seen = new Set<number>()
  lw.shared.dispatches.push((root) => {
    const before = lw.diagnostics.length
    const fresh = [...tagsOf(lw, key)].filter((tag) => !seen.has(tag))
    for (const tag of fresh) {
      seen.add(tag)
      each(tag)
    }
    if (lw !== root) root.diagnostics.push(...lw.diagnostics.slice(before))
    return fresh.length > 0
  })
}

/** `ref := inst`, `ref := other`, `ref := 0` — the tag stored, and what the variable may hold recorded. */
export function storeInterface(lw: Lowering, target: Place, value: Expr, span: Span): IrStmt | undefined {
  const into = heldAt(lw, target, span)
  if (into === undefined) return undefined
  const store = (v: IrExpr): IrStmt => ({ kind: "assign", target, value: v, span })
  if (value.kind === "literal" && value.value === 0n) return store({ kind: "const", value: 0n, type: target.type, span })
  const source = lowerPlace(lw, value)
  if (source === undefined) return undefined
  if (source.type.kind === "function_block") {
    const itf = (target.type as { name: string }).name
    if (!implementsInterface(lw, source.type.name, itf)) return lw.bail("interface-type", `${source.type.name} does not implement ${itf}`, span)
    const tag = tagOf(lw, source, source.type, span)
    if (tag === undefined) return undefined
    into.held.tags.add(tag)
    return store({ kind: "const", value: BigInt(tag), type: target.type, span })
  }
  if (source.type.kind === "interface") {
    const from = heldAt(lw, source, span)
    if (from === undefined) return undefined
    into.held.from.push({ key: from.key })
    return store({ kind: "load", place: source, type: target.type, span })
  }
  return lw.bail("interface-value", "an interface stored from something that is neither an FB instance nor an interface", span)
}

/** A call through `ref`: one arm per instance it may hold, each built by `arm` once every store has lowered. */
function dispatch(lw: Lowering, ref: Place, type: Type, arm: (instance: Place, fb: FbType) => IrInvoke | undefined, span: Span): IrDispatch | undefined {
  const at = heldAt(lw, ref, span)
  if (at === undefined) return undefined
  const arms: { tag: bigint; call: IrInvoke }[] = []
  const context = lw.frameContext
  onEachTag(lw, at.key, (tag) => {
    const instance = lw.shared.instances[tag - 1]!
    if (instance.context !== context) return void lw.bail("interface-context", `a call through an interface on ${instance.fb.name} held in another frame`, span)
    const call = arm(instance.place, instance.fb)
    if (call !== undefined) arms.push({ tag: BigInt(tag), call })
  })
  return { kind: "dispatch", tag: { kind: "load", place: ref, type: ref.type, span }, arms, type, span }
}

/** `ref.M(…)` — each instance's METHOD, with the arguments lowered ONCE, against the interface's own declaration. */
export function interfaceCall(lw: Lowering, ref: Place, call: Extract<Expr, { kind: "call" }>, name: string): IrDispatch | undefined {
  const itf = (ref.type as { name: string }).name
  const method = interfaceChain(lw, itf).flatMap((a) => a.methods).find((m) => m.name.text.toUpperCase() === name.toUpperCase())
  if (method === undefined) return lw.bail("call-method", `${name} is no METHOD of ${itf}`, call.span)
  const declared = method.varSections.flatMap((s) => s.decls.flatMap((d) => d.names.map((n) => ({ section: s.sectionKind, name: n.text.toUpperCase(), type: d.type }))))
  if (declared.some((d) => d.section !== "VAR_INPUT")) return lw.bail("interface-call-shape", `${name} has a VAR_IN_OUT or VAR_OUTPUT — through an interface, not built yet`, call.span)
  const inputs = new Map<string, IrExpr>()
  for (const [position, arg] of call.args.entries()) {
    const param = arg.param === undefined ? declared[position] : declared.find((d) => d.name === arg.param!.name.toUpperCase())
    if (param === undefined || arg.output || arg.value === undefined) return lw.bail("call-param", `an argument ${name} of ${itf} does not take`, arg.span)
    const type = storageOf(lw, lw.resolve(param.type))
    if (type.kind === "interface") return lw.bail("interface-input", "an interface passed as an input — not built yet", arg.span)
    const value = lw.inArgument(() => lowerExpr(lw, arg.value!, type))
    if (value === undefined) return undefined
    inputs.set(param.name, convert(value, type))
  }
  if (inputs.size !== declared.length) return lw.bail("call-input-missing", `${name} called without every input — its default is not measured yet`, call.span)
  const type = method.returnType === undefined ? UNKNOWN : storageOf(lw, lw.resolve(method.returnType))
  return dispatch(lw, ref, type, (instance, fb) => {
    const routine = methodOf(lw, fb, name, call.span)
    if (routine === undefined) return undefined
    const args = routine.inputs.map((i) => inputs.get(routine.locals[i]!.name.toUpperCase()))
    if (routine.inouts.length > 0 || args.includes(undefined)) return lw.bail("interface-call-shape", `${fb.name}.${name} does not take the arguments of ${itf}.${name}`, call.span)
    return { kind: "invoke", routine: routine.key, instance, inputs: args as IrExpr[], inouts: [], type, span: call.span }
  }, call.span)
}

/** `ref.P` on a PROPERTY of the interface — its variable, and the property's name and type. `null` when it names none. */
function interfaceProperty(lw: Lowering, e: Expr): { ref: Place; name: string; type: Type } | undefined | null {
  if (e.kind !== "member" || inferExprType(e.base, lw.scope, lw.project).kind !== "interface") return null
  const ref = lowerPlace(lw, e.base)
  if (ref === undefined) return undefined
  if (ref.type.kind !== "interface") return null
  const property = interfaceChain(lw, ref.type.name).flatMap((a) => a.properties).find((p) => p.name.text.toUpperCase() === e.member.name.toUpperCase())
  return property === undefined ? null : { ref, name: property.name.text, type: storageOf(lw, lw.resolve(property.dataType)) }
}

/** The instance's accessor of a PROPERTY, invoked — one arm of a dispatch. */
function accessorCall(lw: Lowering, fb: FbType, instance: Place, name: string, accessor: "get" | "set", inputs: IrExpr[], type: Type, span: Span): IrInvoke | undefined {
  const sym = fb.scope === undefined ? undefined : lookupMember(fb.scope, name)
  if (sym?.kind !== "property") return lw.bail("property-accessor", `${fb.name} has no PROPERTY ${name}`, span)
  const routine = propertyRoutine(lw, fb, sym, accessor, span)
  return routine && { kind: "invoke", routine: routine.key, instance, inputs, inouts: [], type, span }
}

/** `ref.P` read — each instance's getter (conformance `itf_property_through_interface`). */
export function interfacePropertyGet(lw: Lowering, e: Expr): IrDispatch | undefined | null {
  const access = interfaceProperty(lw, e)
  if (access === null || access === undefined) return access
  if (lw.arguments > 0) return lw.bail("call-nested", "a PROPERTY read inside a call's arguments", e.span)
  return dispatch(lw, access.ref, access.type, (instance, fb) => accessorCall(lw, fb, instance, access.name, "get", [], access.type, e.span), e.span)
}

/** `ref.P := value` — the value into a temp first, as for an instance (`lowerPropertySet`), then each instance's setter. */
export function interfacePropertySet(lw: Lowering, s: Extract<Statement, { kind: "assign" }>): IrStmt[] | undefined | null {
  const access = interfaceProperty(lw, s.target)
  if (access === null || access === undefined) return access
  if (s.op !== undefined || s.chained !== undefined) return lw.bail("property-store", `${access.name} set by ${s.op ?? "a chain"}`, s.span)
  const value = lowerExpr(lw, s.value, access.type)
  if (value === undefined) return undefined
  const temp = lw.tempPlace("property", access.type, s.span)
  const load: IrExpr = { kind: "load", place: temp, type: access.type, span: s.span }
  const set = dispatch(lw, access.ref, UNKNOWN, (instance, fb) => accessorCall(lw, fb, instance, access.name, "set", [load], UNKNOWN, s.span), s.span)
  return set && [{ kind: "assign", target: temp, value: convert(value, access.type), span: s.span }, { kind: "eval", value: set, span: s.span }]
}

/**
 * `found := __QUERYINTERFACE(from, into)` (conformance `itf_queryinterface_success_and_failure`): TRUE, and `into` names the
 * instance, when the instance `from` names implements `into`'s interface; otherwise FALSE — and `into` is null, measured:
 * it does not keep what it held. `null` when the statement is no such query.
 */
export function lowerQueryInterface(lw: Lowering, s: Extract<Statement, { kind: "assign" }>): IrStmt[] | undefined | null {
  const v = s.value
  if (v.kind !== "call" || v.callee.kind !== "ident_expr" || v.callee.name.toUpperCase() !== "__QUERYINTERFACE") return null
  if (s.op !== undefined || s.chained !== undefined || v.args.length !== 2 || v.args.some((a) => a.param !== undefined || a.value === undefined))
    return lw.bail("interface-query", "__QUERYINTERFACE other than `found := __QUERYINTERFACE(from, into)`", s.span)
  const [target, from, into] = [lowerPlace(lw, s.target), lowerPlace(lw, v.args[0]!.value!), lowerPlace(lw, v.args[1]!.value!)]
  if (target === undefined || from === undefined || into === undefined) return undefined
  if (from.type.kind !== "interface" || into.type.kind !== "interface") return lw.bail("interface-query", "__QUERYINTERFACE of something other than two interfaces", s.span)
  const [source, dest] = [heldAt(lw, from, s.span), heldAt(lw, into, s.span)]
  if (source === undefined || dest === undefined) return undefined
  const wanted = into.type.name
  dest.held.from.push({ key: source.key, only: wanted })
  const bool = elementaryRef("BOOL")
  const outcome = (tag: bigint, found: boolean): IrStmt[] => [
    { kind: "assign", target: into, value: { kind: "const", value: tag, type: into.type, span: s.span }, span: s.span },
    { kind: "assign", target, value: convert({ kind: "const", value: found, type: bool, span: s.span }, target.type), span: s.span },
  ]
  const arms: IrArm[] = []
  onEachTag(lw, source.key, (tag) => {
    if (implementsInterface(lw, lw.shared.instances[tag - 1]!.fb.name, wanted))
      arms.push({ labels: [{ lo: BigInt(tag), hi: BigInt(tag) }], body: outcome(BigInt(tag), true), span: s.span })
  })
  return [{ kind: "switch", selector: { kind: "load", place: from, type: from.type, span: s.span }, arms, else: outcome(0n, false), span: s.span }]
}

/**
 * Every call through an interface, and every __QUERYINTERFACE, given the instances its variables may hold — run once the
 * POU has lowered. Finishing one can lower a routine that stores more, so it repeats until nothing new is reached.
 */
export function finishInterfaces(root: Lowering): void {
  for (let progress = true; progress; ) {
    progress = false
    for (const finish of [...root.shared.dispatches]) if (finish(root)) progress = true
  }
}
