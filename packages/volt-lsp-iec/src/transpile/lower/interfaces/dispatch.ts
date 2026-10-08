/**
 * A call through an interface: a dispatch on the tag the variable holds, one arm per instance it may name — a METHOD,
 * or a PROPERTY's accessor.
 */

import { lookup, lookupMember } from "../../../frontend/symbols/index.js"
import type { FbType, Lowering } from "../core/lowering.js"
import type { IrDispatch, IrExpr, IrInvoke, IrStmt, Place } from "../../ir/index.js"
import { ANY_FAMILIES, inferExprType, type Type, UNKNOWN } from "../../../frontend/types/index.js"
import type { Expr, Span, Statement } from "../../../frontend/syntax/index.js"
import { heldAt, instanceRelative, lendPlace } from "./lend.js"
import { onEachTag } from "../entry/finish.js"
import { storageOf } from "../storage/layout.js"
import { lowerExpr } from "../expressions/expressions.js"
import { convert } from "../values/convert.js"
import { methodOf } from "../places/names.js"
import { lowerPlace } from "../places/places.js"
import { propertyRoutine } from "../calls/property.js"
import { interfaceTables } from "./state.js"
import { tempPlace } from "../core/temps.js"
import { interfaceChainOf } from "../core/chain.js"
import { indexOfTag } from "../core/tags.js"

type SymbolAst = NonNullable<ReturnType<typeof lookup>>["symbol"]["ast"]

/** A call through `ref`: one arm per instance it may hold, each built by `arm` once every store has lowered. */
function dispatch(lw: Lowering, ref: Place, type: Type, arm: (instance: Place, fb: FbType) => IrInvoke | undefined, span: Span): IrDispatch | undefined {
  const at = heldAt(lw, ref, span)
  if (at === undefined) return undefined
  const arms: { tag: bigint; call: IrInvoke }[] = []
  onEachTag(lw, at.key, (tag, root, foreign) => {
    // an FB frame's tag handed across instances names a field of whichever instance runs here — not the one it came from
    if (foreign && instanceRelative(root, tag))
      return void lw.bail("interface-instance-relative", `an interface naming a field of one ${interfaceTables(lw).instances[indexOfTag(tag)]!.fb.name} holder, handed to another instance — which instance it names is not tracked`, span)
    // the instance where this body can reach it: its own, or lent to it by its callers
    const place = lendPlace(root, lw, tag, span)
    if (place === undefined) return
    const call = arm(place, interfaceTables(lw).instances[indexOfTag(tag)]!.fb)
    // one arm per tag — a revisit (an escalated `foreign`) is here to refuse, not to add a second
    if (call !== undefined && !arms.some((a) => a.tag === BigInt(tag))) arms.push({ tag: BigInt(tag), call })
  })
  return { kind: "dispatch", tag: { kind: "load", place: ref, type: ref.type, span }, arms, type, span }
}

/** `ref.M(…)` — each instance's METHOD, with the arguments lowered ONCE, against the interface's own declaration. */
export function interfaceCall(lw: Lowering, ref: Place, call: Extract<Expr, { kind: "call" }>, name: string): IrDispatch | undefined {
  const itf = (ref.type as { name: string }).name
  const method = interfaceChainOf(lw, itf).flatMap((a) => a.methods).find((m) => m.name.text.toUpperCase() === name.toUpperCase())
  if (method === undefined) return lw.bail("call-method", `${name} is no METHOD of ${itf}`, call.span)
  const declared = method.varSections.flatMap((s) => s.decls.flatMap((d) => d.names.map((n) => ({ section: s.sectionKind, name: n.text.toUpperCase(), type: d.type }))))
  if (declared.some((d) => d.section !== "VAR_INPUT")) return lw.bail("interface-call-shape", `${name} has a VAR_IN_OUT or VAR_OUTPUT — through an interface, not built yet`, call.span)
  const inputs = new Map<string, IrExpr>()
  for (const [position, arg] of call.args.entries()) {
    const param = arg.param === undefined ? declared[position] : declared.find((d) => d.name === arg.param!.name.toUpperCase())
    if (param === undefined || arg.output || arg.value === undefined) return lw.bail("call-param", `an argument ${name} of ${itf} does not take`, arg.span)
    const type = storageOf(lw, lw.resolve(param.type, lw.project), param.type.span)
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
  const type = method.returnType === undefined ? UNKNOWN : storageOf(lw, lw.resolve(method.returnType, lw.project), method.returnType.span)
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
  const property = interfaceChainOf(lw, ref.type.name).flatMap((a) => a.properties).find((p) => p.name.text.toUpperCase() === e.member.name.toUpperCase())
  return property === undefined ? null : { ref, name: property.name.text, type: storageOf(lw, lw.resolve(property.dataType, lw.project), property.dataType.span) }
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
  const temp = tempPlace(lw, "property", access.type, s.span)
  const load: IrExpr = { kind: "load", place: temp, type: access.type, span: s.span }
  const set = dispatch(lw, access.ref, UNKNOWN, (instance, fb) => accessorCall(lw, fb, instance, access.name, "set", [load], UNKNOWN, s.span), s.span)
  return set && [{ kind: "assign", target: temp, value: convert(value, access.type), span: s.span }, { kind: "eval", value: set, span: s.span }]
}
