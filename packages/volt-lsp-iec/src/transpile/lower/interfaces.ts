/**
 * INTERFACE variables (design §22, conformance `itf_*`). An interface variable holds the TAG of the FB instance it names —
 * 0 for none, as it starts (`itf_call_dispatches_on_instance`) — and a call through it dispatches on that tag to the
 * METHOD or PROPERTY accessor of each instance it may name. Tags are given per lowered POU, to instance places, so a copy
 * between two interface variables (`itf_extends_assigns_to_base`) is a plain copy of the tag.
 *
 * Which instances a variable may name is recorded as stores lower: an instance's tag, or an edge from the variable it
 * was copied from. The arms of a call are filled in only when the whole POU has lowered (`finishInterfaces`) — a store
 * later in the source reaches a call earlier in it on the next cycle, so source order proves nothing. An arm on an
 * instance of another frame reaches it as a `lent` place: the body is lent a `&mut` of that instance per call, and each
 * caller passes it from its own frame or from what it was lent in turn (design §24) — an FB's interface input is kept
 * like any input (`itf_fb_input_left_out`), so its instances are lent at every call of the FB, not only the one that
 * gave them. The POU itself has no caller to lend it one (`interface-context`).
 *
 * A tag names an instance by its place in a FRAME — for an FB's frame, a field of whichever instance runs — so a tag of
 * an FB frame means something only with the instance that stored it (review of the interface-input batch, 2026-09-15:
 * `x2(shape := x1.mine)` answered for x2's field). It may therefore not cross to another instance: an interface is read
 * and dispatched only through the frame's own variables; a value written through another instance (an in-out, a lent
 * instance, a global) is FOREIGN, and an FB-frame tag arriving foreign is refused (`interface-instance-relative`), as is
 * lending one to a call whose receiver is not the caller's own. A tag of the POU itself names its one instance and moves
 * freely. The shape the corpus uses — a parent handing its own child its own field — stays exact: the child is always
 * called by the instance that wrote it.
 *
 * Not built yet, and refused: an interface bound as an in-out or output, an interface argument of a call made through an
 * interface, a METHOD with a VAR_IN_OUT or VAR_OUTPUT called through one, an instance that is a local, an in-out, a
 * dereference or reached through a runtime index, an instance lent to a call that already holds it, and one FB type given
 * interface inputs from two frames — its instances are lent per TYPE, so every caller would have to lend both frames'
 * (`interface-context`; a limitation, not recorded behaviour).
 */
import type { Expr, Interface, Span, Statement } from "../../syntax/index.js"
import { lookup, lookupMember } from "../../symbols/index.js"
import { ANY_FAMILIES, elementaryRef, inferExprType, type Type, UNKNOWN } from "../../types/index.js"
import { type IrArm, type IrCall, type IrDispatch, type IrExpr, type IrInvoke, type IrStmt, peelArray, type Place } from "../ir/index.js"
import type { Lowering } from "./lowering.js"
import { convert } from "./convert.js"
import { storageOf } from "./storage.js"
import { lowerPlace } from "./places.js"
import { pointerKey, sameTarget } from "./pointers.js"
import { lowerExpr } from "./expressions.js"
import { rootType } from "./bytes.js"
import { aliases, methodOf, propertyRoutine } from "./calls.js"

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

/**
 * Where an interface variable's instances are recorded: its own frame's key (`pointerKey`) — or, for a field of an FB
 * instance reached by fields and constant indices, `FB:<type>.<field>`, the key the FB's own body uses, so what every
 * caller stores into `inst.shape` is what the body dispatches on.
 */
/**
 * An ARRAY of interfaces is keyed by the ARRAY, not the element (conformance `xo_interface_array_dispatch`: two
 * implementations stored into `ops[1]` and `ops[2]`, then called as `ops[i].Apply(…)` in a FOR loop). Every element
 * shares one held-set, which is exact: the dispatch is on the TAG the element holds at runtime, and the key only decides
 * which arms exist — an arm no element ever holds is dead, never wrong. A runtime index has no key of its own anyway.
 */
const elementOfArray = (place: Place): Place => {
  let path = place.path
  while (path.at(-1)?.kind === "index") path = path.slice(0, -1)
  return path === place.path ? place : { ...place, path }
}

function interfaceKey(lw: Lowering, written: Place): string | undefined {
  const place = elementOfArray(written)
  const own = pointerKey(lw, place)
  if (own !== undefined) return own
  const last = place.path.at(-1)
  if (place.guard !== undefined || place.root === "inout" || place.root === "lent" || last?.kind !== "field") return undefined
  let type = rootType(lw, place)
  for (const step of place.path.slice(0, -1)) {
    if (type === undefined) return undefined
    if (step.kind === "field") type = type.kind === "struct" || type.kind === "function_block" ? lw.layouts.get(type.name.toUpperCase())?.fields.find((f) => f.name.toUpperCase() === step.name.toUpperCase())?.type : undefined
    else if (step.kind === "index" && step.index.kind === "const") type = peelArray(type)?.element
    else return undefined
  }
  return type?.kind === "function_block" ? `FB:${type.name.toUpperCase()}.${last.name.toUpperCase()}` : undefined
}

/** The instances recorded under a key — created at its first use. */
function heldBy(lw: Lowering, key: string) {
  let held = lw.shared.interfaces.get(key)
  if (held === undefined) lw.shared.interfaces.set(key, (held = { tags: new Map(), from: [] }))
  return held
}

/**
 * The instances an interface variable READ holds — one of this frame's own variables (`pointerKey`). Another instance's
 * interface field (`x1.mine`) holds tags of that instance's frame, which would name the reader's own fields: refused.
 */
function heldAt(lw: Lowering, read: Place, span: Span) {
  const key = pointerKey(lw, elementOfArray(read))
  if (key === undefined) return lw.bail("interface-place", "an interface read somewhere this does not track — another instance's field, an element, an in-out, a dereference", span)
  return { key, held: heldBy(lw, key) }
}

/** A tag naming a place of an FB's frame — a field of whichever instance runs — not of the POU's one instance. */
const instanceRelative = (root: Lowering, tag: number): boolean => root.shared.instances[tag - 1]!.context !== root.frameContext

/**
 * Where `body` reaches the instance a tag names: its own place, when the instance is of the body's frame — otherwise a
 * `lent` place, a `&mut` its callers lend it, appended the first time it is needed (design §24). The POU has no caller,
 * and a GVL instance is not lent beside the globals every body already holds.
 */
function lendPlace(root: Lowering, body: Lowering, tag: number, span: Span): Place | undefined {
  const instance = body.shared.instances[tag - 1]!
  if (instance.context === body.frameContext) return instance.place
  if (body === root || instance.context === "GLOBAL")
    return body.bail("interface-context", `an instance of ${instance.fb.name} held where no caller can lend it`, span)
  let at = body.lends.findIndex((l) => l.tag === tag)
  if (at < 0) at = body.lends.push({ tag, type: instance.fb }) - 1
  return { slot: at, path: [], type: instance.fb, span, root: "lent" }
}

/** Every tag the variable may hold — its own stores, and what each variable it was copied from may hold — each with
 *  whether it arrived through a foreign write anywhere on the way. */
function tagsOf(lw: Lowering, key: string, seen: ReadonlySet<string> = new Set()): Map<number, boolean> {
  const held = lw.shared.interfaces.get(key)
  if (held === undefined || seen.has(key)) return new Map()
  const tags = new Map(held.tags)
  for (const edge of held.from)
    for (const [tag, foreign] of tagsOf(lw, edge.key, new Set([...seen, key])))
      if (edge.only === undefined || implementsInterface(lw, lw.shared.instances[tag - 1]!.fb.name, edge.only))
        tags.set(tag, (tags.get(tag) ?? false) || foreign || edge.foreign)
  return tags
}

/** A finisher: run for each tag the variable may hold that it has not seen, reporting into the root lowering. */
function onEachTag(lw: Lowering, key: string, each: (tag: number, root: Lowering, foreign: boolean) => void): void {
  const seen = new Set<number>()
  lw.shared.dispatches.push((root) => {
    const before = lw.diagnostics.length
    const fresh = [...tagsOf(lw, key)].filter(([tag]) => !seen.has(tag))
    for (const [tag, foreign] of fresh) {
      seen.add(tag)
      each(tag, root, foreign)
    }
    if (lw !== root) root.diagnostics.push(...lw.diagnostics.slice(before))
    return fresh.length > 0
  })
}

/** `ref := inst`, `ref := other`, `ref := 0` — the tag stored, and what the variable may hold recorded. */
export function storeInterface(lw: Lowering, target: Place, value: Expr, span: Span): IrStmt | undefined {
  const key = interfaceKey(lw, target)
  if (key === undefined) return lw.bail("interface-place", "an interface held somewhere this does not track — an element, an in-out, a dereference", span)
  // a variable of this frame (or this routine), or the field of one of its own child instances — else foreign (a global)
  const frame = key.slice(0, key.lastIndexOf("."))
  const own = frame === lw.frameContext || frame === lw.routineContext
  const child = (target.root === undefined || target.root === "this") && target.path.length > 0
  const tag = interfaceArgument(lw, key, target.type, value, span, !own && !child)
  return tag && { kind: "assign", target, value: tag, span }
}

/**
 * The tag an interface of type `itf` is given — `0`, an FB instance's tag, or another interface's value — with what it may
 * name recorded under `key`: a variable's (`storeInterface`), an FB's input field, a routine's input local. `foreign`: the
 * write reaches the key through another instance than this body's own.
 */
export function interfaceArgument(lw: Lowering, key: string, itf: Type, value: Expr, span: Span, foreign: boolean): IrExpr | undefined {
  const held = heldBy(lw, key)
  if (value.kind === "literal" && value.value === 0n) return { kind: "const", value: 0n, type: itf, span }
  const source = lowerPlace(lw, value)
  if (source === undefined) return undefined
  if (source.type.kind === "function_block") {
    const name = (itf as { name: string }).name
    if (!implementsInterface(lw, source.type.name, name)) return lw.bail("interface-type", `${source.type.name} does not implement ${name}`, span)
    const tag = tagOf(lw, source, source.type, span)
    if (tag === undefined) return undefined
    held.tags.set(tag, (held.tags.get(tag) ?? false) || foreign)
    return { kind: "const", value: BigInt(tag), type: itf, span }
  }
  if (source.type.kind === "interface") {
    const from = heldAt(lw, source, span)
    if (from === undefined) return undefined
    held.from.push({ key: from.key, foreign })
    return { kind: "load", place: source, type: itf, span }
  }
  return lw.bail("interface-value", "an interface given something that is neither an FB instance nor an interface", span)
}

/** A call through `ref`: one arm per instance it may hold, each built by `arm` once every store has lowered. */
function dispatch(lw: Lowering, ref: Place, type: Type, arm: (instance: Place, fb: FbType) => IrInvoke | undefined, span: Span): IrDispatch | undefined {
  const at = heldAt(lw, ref, span)
  if (at === undefined) return undefined
  const arms: { tag: bigint; call: IrInvoke }[] = []
  onEachTag(lw, at.key, (tag, root, foreign) => {
    // an FB frame's tag handed across instances names a field of whichever instance runs here — not the one it came from
    if (foreign && instanceRelative(root, tag))
      return void lw.bail("interface-instance-relative", `an interface naming a field of one ${lw.shared.instances[tag - 1]!.fb.name} holder, handed to another instance — which instance it names is not tracked`, span)
    // the instance where this body can reach it: its own, or lent to it by its callers
    const place = lendPlace(root, lw, tag, span)
    if (place === undefined) return
    const call = arm(place, lw.shared.instances[tag - 1]!.fb)
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
    const type = storageOf(lw, lw.resolve(param.type, lw.project))
    if (type.kind === "interface") return lw.bail("interface-input", "an interface passed as an input — not built yet", arg.span)
    // AN ANY INPUT THROUGH AN INTERFACE IS REFUSED, not passed.
    //
    // A direct call to a routine with an `ANY`/`ANY_*` VAR_INPUT lowers a SPECIAL variant: the input is a hidden
    // DINT the call fills with the argument's BYTE SIZE, and the argument itself is lent separately as a hidden
    // VAR_IN_OUT (conformance `state_any_input_sizes`). This path lowers its arguments against the INTERFACE's
    // declaration and resolves each arm with `methodOf(lw, fb, name, call.span)` — without the `call`, which is
    // what selects that variant — so the PLAIN routine was lowered and the argument's VALUE went to an input
    // expecting its SIZE. `Take(v := big)` with `big : LREAL := 42.0` passed 42 where the body reads `v.diSize`
    // and 8 is the answer.
    //
    // Making it work means filling the size and lending the place PER ARM, which is real work and not this
    // change's (D6: coverage belongs to `transpile-st-to-rust`). The refusal is the difference between a gap
    // and a wrong answer.
    if (param.type.kind === "named_type" && ANY_FAMILIES.has(param.type.name.text.toUpperCase()))
      return lw.bail(
        "interface-any-input",
        `${name} takes an ANY input through an interface — the size an ANY input needs is not filled per arm`,
        arg.span,
      )
    const value = lw.inArgument(() => lowerExpr(lw, arg.value!, type))
    if (value === undefined) return undefined
    inputs.set(param.name, convert(value, type))
  }
  if (inputs.size !== declared.length) return lw.bail("call-input-missing", `${name} called without every input — its default is not measured yet`, call.span)
  const type = method.returnType === undefined ? UNKNOWN : storageOf(lw, lw.resolve(method.returnType, lw.project))
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
  return property === undefined ? null : { ref, name: property.name.text, type: storageOf(lw, lw.resolve(property.dataType, lw.project)) }
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
  if (!isQuery(v)) return null
  if (s.op !== undefined || s.chained !== undefined) return lw.bail("interface-query", "__QUERYINTERFACE other than `found := __QUERYINTERFACE(from, into)`", s.span)
  const target = lowerPlace(lw, s.target)
  return target && queryInto(lw, target, v, s.span)
}

const isQuery = (e: Expr): e is Extract<Expr, { kind: "call" }> => e.kind === "call" && e.callee.kind === "ident_expr" && e.callee.name.toUpperCase() === "__QUERYINTERFACE"

/** The query itself: `into` set to the instance or null, `target` to whether it implements `into`'s interface. */
function queryInto(lw: Lowering, target: Place, v: Extract<Expr, { kind: "call" }>, span: Span): IrStmt[] | undefined {
  if (v.args.length !== 2 || v.args.some((a) => a.param !== undefined || a.value === undefined))
    return lw.bail("interface-query", "__QUERYINTERFACE other than `found := __QUERYINTERFACE(from, into)`", span)
  const [from, into] = [lowerPlace(lw, v.args[0]!.value!), lowerPlace(lw, v.args[1]!.value!)]
  if (from === undefined || into === undefined) return undefined
  if (from.type.kind !== "interface" || into.type.kind !== "interface") return lw.bail("interface-query", "__QUERYINTERFACE of something other than two interfaces", span)
  const [source, dest] = [heldAt(lw, from, span), heldAt(lw, into, span)]
  if (source === undefined || dest === undefined) return undefined
  const wanted = into.type.name
  dest.held.from.push({ key: source.key, only: wanted, foreign: false })
  const bool = elementaryRef("BOOL")
  const outcome = (tag: bigint, found: boolean): IrStmt[] => [
    { kind: "assign", target: into, value: { kind: "const", value: tag, type: into.type, span }, span },
    { kind: "assign", target, value: convert({ kind: "const", value: found, type: bool, span }, target.type), span },
  ]
  const arms: IrArm[] = []
  onEachTag(lw, source.key, (tag) => {
    if (implementsInterface(lw, lw.shared.instances[tag - 1]!.fb.name, wanted))
      arms.push({ labels: [{ lo: BigInt(tag), hi: BigInt(tag) }], body: outcome(BigInt(tag), true), span })
  })
  return [{ kind: "switch", selector: { kind: "load", place: from, type: from.type, span }, arms, else: outcome(0n, false), span }]
}

/**
 * `IF __QUERYINTERFACE(from, into) THEN` — pro2193's form (~30 uses) — and the query as the condition's LEADING operand:
 * under NOT, in parentheses, or the left side of AND_THEN / OR_ELSE, which always runs first
 * (`IF NOT __QUERYINTERFACE(xuUnit, xuUnitExtended) OR_ELSE NOT xuUnitExtended.InSafePosForMouldEntry THEN`). It is the
 * recorded query above, into a hidden BOOL taken just before the test; the condition then lowers as written, the call
 * reading that BOOL (`hoistedQueries`, read by `lowerBuiltin`). An ELSIF's is taken inside the ELSE its IF lowers to, so
 * only when reached. A query anywhere else — a right operand a short-circuit may skip, an operand of a plain AND/OR whose
 * order is not recorded — stays refused there. `null` when the condition leads with no query.
 */
export function queryCondition(lw: Lowering, cond: Expr): { before: IrStmt[]; cond: IrExpr } | undefined | null {
  const leading = (e: Expr): Expr | undefined =>
    e.kind === "paren" ? leading(e.inner)
    : e.kind === "unary" && e.op === "NOT" ? leading(e.operand)
    : e.kind === "binary" && (e.op === "AND_THEN" || e.op === "OR_ELSE") ? leading(e.left)
    : e
  const call = leading(cond)
  if (call === undefined || !isQuery(call)) return null
  const bool = elementaryRef("BOOL")
  const found = lw.tempPlace("query_found", bool, cond.span)
  const before = queryInto(lw, found, call, cond.span)
  if (before === undefined) return undefined
  lw.hoistedQueries.set(call, { kind: "load", place: found, type: bool, span: call.span })
  const lowered = lowerExpr(lw, cond, bool)
  lw.hoistedQueries.delete(call)
  return lowered && { before, cond: lowered }
}

/**
 * Every call through an interface, and every __QUERYINTERFACE, given the instances its variables may hold — run once the
 * POU has lowered. Finishing one can lower a routine that stores more, so it repeats until nothing new is reached.
 */
export function finishInterfaces(root: Lowering, rootBody: readonly IrStmt[]): void {
  for (let progress = true; progress; ) {
    progress = false
    for (const finish of [...root.shared.dispatches]) if (finish(root)) progress = true
    // a dispatch may have made its body need a lent instance: every call of that body passes it, and so on up
    for (const [body, lowering] of bodiesOf(root, rootBody)) if (lendToCallees(root, lowering, body)) progress = true
  }
}

/** Every lowered body with the lowering it was lowered in: the POU's, each FB body's, each routine's. */
function bodiesOf(root: Lowering, rootBody: readonly IrStmt[]): [readonly IrStmt[], Lowering][] {
  const out: [readonly IrStmt[], Lowering][] = [[rootBody, root]]
  for (const [key, layout] of root.layouts) {
    const pending = root.bodies.get(key)
    if (layout.body !== undefined && pending !== undefined) out.push([layout.body, pending.lowering])
  }
  for (const [key, entry] of root.routines) {
    const lowering = root.shared.routineLowerings.get(key)
    if (entry.state === "lowered" && lowering !== undefined) out.push([entry.routine.body, lowering])
  }
  return out
}

/** Calls whose lending was refused, so a later round does not report them again. */
const refusedLends = new WeakSet<object>()

/** Each call in `body` passes its callee the instances the callee is lent — from the caller's frame, or lent on. */
function lendToCallees(root: Lowering, caller: Lowering, body: readonly IrStmt[]): boolean {
  let progress = false
  for (const node of callsIn(body)) {
    if (refusedLends.has(node)) continue
    const callee = node.kind === "call" ? root.bodies.get(node.fb.toUpperCase())?.lowering : root.shared.routineLowerings.get(node.routine)
    const needs = callee?.lends ?? []
    const lent = ((node as { lent?: Place[] }).lent ??= [])
    const before = caller.diagnostics.length
    // a call on this body's own instance, a child field of it, or no instance at all (a FUNCTION)
    const ownReceiver = node.instance === undefined || node.instance.root === undefined || node.instance.root === "this"
    for (let i = lent.length; i < needs.length && !refusedLends.has(node); i++) {
      // an FB frame's tag lent to another instance (an in-out, a lent one) would name this caller's field for it
      if (!ownReceiver && instanceRelative(root, needs[i]!.tag)) {
        caller.bail("interface-instance-relative", `an instance of ${needs[i]!.type.name} named relative to this FB, lent to a call on another instance`, node.span)
        refusedLends.add(node)
        break
      }
      const place = lendPlace(root, caller, needs[i]!.tag, node.span)
      const held = [...(node.instance === undefined ? [] : [node.instance]), ...node.inouts.filter((b): b is Place => !("kind" in b)), ...lent]
      if (place !== undefined && held.some((p) => aliases(place, p)))
        caller.bail("interface-lend-alias", `an instance of ${needs[i]!.type.name} lent to a call that already holds it`, node.span)
      if (place === undefined || caller.diagnostics.length > before) refusedLends.add(node)
      else {
        lent.push(place)
        progress = true
      }
    }
    if (caller !== root) root.diagnostics.push(...caller.diagnostics.slice(before))
  }
  return progress
}

/** Every call in a body — FB calls, and invokes wherever they sit, dispatch arms included. */
function callsIn(node: unknown, out: (IrInvoke | IrCall)[] = []): (IrInvoke | IrCall)[] {
  if (Array.isArray(node)) {
    for (const child of node) callsIn(child, out)
    return out
  }
  if (node === null || typeof node !== "object") return out
  const kind = (node as { kind?: string }).kind
  if (kind === "call" || kind === "invoke") out.push(node as IrInvoke | IrCall)
  for (const [key, child] of Object.entries(node)) if (key !== "type" && key !== "of" && key !== "span" && key !== "lent") callsIn(child, out)
  return out
}
