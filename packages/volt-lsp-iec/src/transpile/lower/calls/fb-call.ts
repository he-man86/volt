/**
 * An FB call statement → its input stores, the call, its output copies — or, when it names a routine, that call.
 */

import type { FbType, Lowering } from "../core/lowering.js"
import type { CallArg, Span, Statement } from "../../../frontend/syntax/index.js"
import type { IrBinding, IrCall, IrLayout, IrSlot, IrStmt, Place } from "../../ir/index.js"
import { isSuper, lowerSuperCall } from "./super.js"
import { bindInOut, holding, movedInOut } from "./binding.js"
import { registerBodyCall } from "./last-binding.js"
import { lowerInvoke } from "./invoke.js"
import { lookup } from "../../../frontend/symbols/index.js"
import { ownMember } from "../places/names.js"
import { namespaceOf } from "./namespace.js"
import { lowerPlace } from "../places/places.js"
import { instancePlace } from "../places/self.js"
import { inGlobals, programReentrant, programTarget, touchedOf } from "./reentrancy.js"
import { fieldIn, staticPath } from "../places/path.js"
import { calledLayout } from "./routines.js"
import { isInFrame } from "./specialize.js"
import { fbOutputCopy } from "./outputs.js"
import { guardWrite } from "../places/access-guards.js"
import { storeInterface } from "../interfaces/tags.js"
import { lowerExpr } from "../expressions/expressions.js"
import { refuseImplicitString } from "../statements/assign.js"
import { assignTo } from "../values/convert.js"
import { boundName, boundOf, openDims } from "../places/bounds.js"

/**
 * `inst(a := x, q => y)` → the input assignments, the call, the output assignments (IrCall). A FUNCTION, a METHOD or
 * ACTION called bare, or `SUPER^(…)`, goes to its own lowering; a PROGRAM calls like an FB on its one instance. An
 * argument written but left empty (`a := ,`) assigns nothing — the input keeps its value (conformance
 * `state_empty_argument`); an empty output reads into nothing.
 */
export function lowerCallStatement(lw: Lowering, call: Extract<Statement, { kind: "call_stmt" }>["call"]): IrStmt[] | undefined {
  if (isSuper(call.callee)) return lowerSuperCall(lw, call)
  const routed = routineCallStatement(lw, call)
  if (routed !== null) return routed
  const target = calledInstance(lw, call)
  if (target === undefined) return undefined
  const { instance, layout } = target
  const inouts = layout.inouts ?? []
  const args = fbArguments(lw, call, instance, layout)
  if (args === undefined) return undefined
  const { before, after, bound } = args
  const missing = inouts.find((p) => !bound.has(p.name.toUpperCase()))
  if (missing !== undefined) return lw.bail("call-inout-missing", `${missing.name} is not bound`, call.span)
  const moved = movedInOut(call, (name) => bound.get(name), (arg) => before.filter((s) => s.kind === "assign" && s.target.path.at(-1)?.kind === "field" && (s.target.path.at(-1) as { name: string }).name.toUpperCase() === arg.param?.name.toUpperCase()))
  if (moved !== undefined) return lw.bail("call-inout-order", `${layout.name}'s ${moved} is bound before a call in a later argument that could move it`, call.span)
  const bounds = storeOpenBounds(lw, instance, layout.fields, inouts, (i) => bound.get(inouts[i]!.name.toUpperCase()), call.span)
  if (bounds === undefined) return undefined
  const inoutPlaces = inouts.map((p) => bound.get(p.name.toUpperCase())!)
  const stmt: IrCall = { kind: "call", instance, fb: layout.name, inouts: inoutPlaces, span: call.span }
  // every call of an FB with in-outs records the binding it makes, for its METHODs called from outside (`last-binding.ts`)
  if (inouts.length > 0) registerBodyCall(lw, stmt)
  return [...before, ...bounds, stmt, ...after]
}

/** A call statement that calls a ROUTINE — a FUNCTION, a METHOD or ACTION, `SUPER^.M()`, a namespaced library FUNCTION —
 *  lowered as its call expression; a name that is no callable instance, refused; `null` when it calls an instance. */
function routineCallStatement(lw: Lowering, call: Extract<Statement, { kind: "call_stmt" }>["call"]): IrStmt[] | undefined | null {
  const callee = call.callee
  const asInvoke = (): IrStmt[] | undefined => {
    const value = lowerInvoke(lw, call)
    return value && [{ kind: "eval", value, span: call.span }]
  }
  if (callee.kind === "ident_expr" && !lw.holds(callee.name)) {
    const sym = lookup(lw.scope, callee.name)?.symbol
    const kind = sym?.kind
    if (kind === "function" || ownMember(lw, callee.name) !== undefined) return asInvoke()
    // a PROGRAM's one instance is global, and calls like an FB's; a GVL instance goes on to be refused by what it is
    const global = kind === "gvl_var" || sym?.varSection === "VAR_EXTERNAL"
    if (!global && (kind !== "program" || callee.name.toUpperCase() === lw.shared.root.toUpperCase())) {
      const code = kind === "program" ? "call-program" : kind === "method" || kind === "action" ? "call-this" : "stmt-call_stmt"
      return lw.bail(code, `${callee.name} is not a callable instance yet`, call.span)
    }
  }
  if (callee.kind === "member") {
    // `SUPER^.M()`, and `Stu.StrTrimA(…)` through a library namespace — calls of a routine, not of an instance
    if (isSuper(callee.base) || namespaceOf(lw, callee.base) !== undefined) return asInvoke()
    const named = lowerPlace(lw, callee.base)
    const base = named === undefined ? undefined : instancePlace(lw, named, call.span)
    if (base === undefined) return undefined
    // A STRUCT's field can be an FB instance too (conformance `xo2_instance_in_struct`: `x.drive(speed := 6)` on a
    // `DUT_X2_axis` holding an `FB_X2_motor`) — only an FB's layout was looked at, so the call went on as a METHOD of
    // the struct and was refused `call-method`.
    const layout = base.type.kind === "function_block" || base.type.kind === "struct" ? lw.layouts.get(base.type.name.toUpperCase()) : undefined
    // `inst.M(…)` / `inst.A()` — anything that is not an instance held in a field is a METHOD or ACTION
    if (fieldIn(layout?.fields, callee.member.name) === undefined) return asInvoke()
  }
  return null
}

/** The FB instance a call statement calls and its layout, the body lowered — or the refusal of what it is instead. */
function calledInstance(lw: Lowering, call: Extract<Statement, { kind: "call_stmt" }>["call"]): { instance: Place & { type: FbType }; layout: IrLayout } | undefined {
  const callee = call.callee
  const named = lowerPlace(lw, callee)
  const instance = named === undefined ? undefined : instancePlace(lw, named, call.span)
  if (instance === undefined) return undefined
  if (instance.type.kind !== "function_block") {
    // AN UNRESOLVED TYPE IS ITS OWN ANSWER, not "not an FB instance".
    //
    // `t1 : TON` types as `unknown` when no declaration of TON reached lowering — the project's Library Manager was not
    // handed in. Calling one was reported as "a call of something that is not an FB instance", which is false (it IS
    // an instance) and which piled the whole class into `stmt-call_stmt`, the bucket `lower-completeness` ranks work by.
    // Handed in, the declaration types it, and its body comes from the library repo (`libraries/`) for the version
    // the project resolved — or, for a version the repo has not written, `calledLayout` refuses the empty body.
    if (instance.type.kind === "unknown")
      return lw.bail(
        "call-library",
        `the type of ${callee.kind === "ident_expr" ? callee.name : "this instance"} is not declared — no library declaring it was handed to lowering`,
        call.span,
      )
    return lw.bail("stmt-call_stmt", "a call of something that is not an FB instance", call.span)
  }
  if (inGlobals(lw, instance)) return lw.bail("call-global-instance", `${instance.type.name} is called on an instance declared in a GVL`, call.span)
  // An FB instance inside a PROGRAM, called from outside it (`callshape_program_instance_from_outside`): the program is
  // moved out of `Programs` for the call, as for its own. It was refused (`prg.p.inst.call(g, prg)` borrows `Programs`
  // twice). A runtime index on the way would be read on the stand-in, and a body reaching its program would too: refused.
  if (instance.root === "global" && !staticPath(instance))
    return lw.bail("call-program-member", `${instance.type.name} is called inside a PROGRAM's instance through a runtime index`, call.span)
  const layout = calledLayout(lw, instance.type.name, call.span)
  if (layout === undefined) return undefined
  const body = lw.bodies.get(instance.type.name.toUpperCase())
  const run = { touched: body === undefined ? undefined : touchedOf(body.lowering), body: layout.body ?? [] }
  const reentrant = programReentrant(lw, run, programTarget(instance), { touched: "inside", dispatch: "inside" })
  if (reentrant === "touches") return lw.bail("call-program-reentrant", `${instance.type.name}'s body reaches the PROGRAM it is called inside`, call.span)
  if (reentrant === "dispatch")
    return lw.bail("call-program-reentrant", `${instance.type.name}'s body calls through an interface, which may reach the PROGRAM it is called inside`, call.span)
  return { instance: instance as Place & { type: FbType }, layout }
}

/** An FB call's arguments: each in-out bound (by upper-cased name), each input stored into the instance before the call,
 *  each output copied out after it. */
function fbArguments(
  lw: Lowering,
  call: Extract<Statement, { kind: "call_stmt" }>["call"],
  instance: Place,
  layout: IrLayout,
): { before: IrStmt[]; after: IrStmt[]; bound: Map<string, IrBinding> } | undefined {
  const before: IrStmt[] = []
  const after: IrStmt[] = []
  const bound = new Map<string, IrBinding>()
  const inouts = layout.inouts ?? []
  for (const arg of call.args) {
    if (arg.param === undefined) return lw.bail("call-positional", `${layout.name} called with a positional argument`, arg.span)
    if (arg.value === undefined) continue
    const name = arg.param.name.toUpperCase()
    const param = fieldIn(inouts, name)
    if (param !== undefined) {
      const target = bindInOut(lw, arg, param, holding(instance, [...bound.values()]), layout.body ?? [], layout.name, undefined)
      if (target === undefined || isInFrame(target)) return undefined
      bound.set(name, target)
      continue
    }
    const field = fieldIn(layout.fields, name)
    if (field === undefined) return lw.bail("call-param", `${arg.param.name} is not a parameter of ${layout.name}`, arg.span)
    const member: Place = { ...instance, path: [...instance.path, { kind: "field", name: field.name }], type: field.type, span: arg.span }
    const stmt = arg.output ? fbOutputCopy(lw, arg, member, field) : fbInputStore(lw, arg, member, field)
    if (stmt === undefined) return undefined
    ;(arg.output ? after : before).push(stmt)
  }
  return { before, after, bound }
}

/** `a := x`: the input stored into the instance's field before the call — an interface input as the tag it holds. */
function fbInputStore(lw: Lowering, arg: CallArg, member: Place, field: IrSlot): IrStmt | undefined {
  // an input stored into an instance lent through a VAR_IN_OUT CONSTANT: CODESYS calls one (`inout_const_fb_call_13`), but
  // storing into it is not recorded — refused as the store it is
  if (guardWrite(lw, member, arg.span, ["constant"]) === undefined) return undefined
  // an FB keeps an interface input as it keeps any (`itf_fb_input_left_out`): the tag stored into its field
  if (field.type.kind === "interface") return storeInterface(lw, member, arg.value!, arg.span)
  const value = lowerExpr(lw, arg.value!, field.type)
  if (value === undefined || refuseImplicitString(lw, value, field.type, arg.span)) return undefined
  return assignTo(member, value, arg.span)
}

/**
 * The bounds of the arrays an FB's `ARRAY[*]` in-outs bind, stored into the instance's hidden fields before its body runs —
 * where the body reads them (design §26; conformance `callshape_array_star_fb_inout`: 2, then 4). A METHOD reaching the
 * in-out is refused (`boundOf`): no recording shows which bounds it sees.
 */
export function storeOpenBounds(lw: Lowering, instance: Place, fields: readonly IrSlot[], inouts: readonly IrSlot[], binding: (i: number) => IrBinding | undefined, span: Span): IrStmt[] | undefined {
  const stores: IrStmt[] = []
  for (const [i, slot] of inouts.entries())
    for (let dim = 1; dim <= openDims(slot.type); dim++)
      for (const which of ["lower", "upper"] as const) {
        const field = fieldIn(fields, boundName(slot.name, which, dim))
        const bound = binding(i)
        const at = bound === undefined ? undefined : "kind" in bound ? bound.back : bound
        const value = field === undefined || at === undefined ? undefined : boundOf(lw, at, which, dim)
        if (value === undefined) return lw.bail("call-open-array", `${slot.name} is bound to an array whose bounds are not known here`, span)
        stores.push({ kind: "assign", target: { ...instance, path: [...instance.path, { kind: "field", name: field!.name }], type: field!.type, span }, value, span })
      }
  return stores
}
