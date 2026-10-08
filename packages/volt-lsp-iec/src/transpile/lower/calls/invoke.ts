/**
 * A call expression → an `IrInvoke`: which routine on which instance, and each argument bound in the order it is written.
 */

import type { IrBinding, IrDispatch, IrExpr, IrInvoke, IrRoutine, Place } from "../../ir/index.js"
import { type InFrame, isInFrame, specializeRoutine } from "./specialize.js"
import { aliases, bindInOut, bindWhereWritten, holding, shadowedInOutsOf } from "./binding.js"
import type { Lowering } from "../core/lowering.js"
import type { CallArg, Expr, Span } from "../../../frontend/syntax/index.js"
import { anyInputsOf, bindAnyArgument, bindAnyTargets } from "../pointers/any.js"
import { bindOutputArgument, bindUnconnectedOutputs } from "./outputs.js"
import { UNKNOWN } from "../../../frontend/types/index.js"
import { lastBinding } from "./last-binding.js"
import { isSuper } from "./super.js"
import { instancePlace, selfFb, thisPlace } from "../places/self.js"
import { lookup, lookupLocal, lookupMember, pickForAsker, scopeUri } from "../../../frontend/symbols/index.js"
import { calledRoutine } from "./routines.js"
import { namespaceOf } from "./namespace.js"
import { methodOf, ownMember } from "../places/names.js"
import { lowerPlace } from "../places/places.js"
import { interfaceCall } from "../interfaces/dispatch.js"
import { inGlobals, programReentrant, programTarget, routineCallee } from "./reentrancy.js"
import { fieldIndex, staticPath } from "../places/path.js"
import { positionalBinding, positionalOf } from "./parameters.js"
import { bindCursorArgument, cursorInputsOf } from "../pointers/cursor.js"
import { bindBorrowedArgument, borrowedInputsOf } from "../pointers/borrowed.js"
import { interfaceArgument } from "../interfaces/tags.js"
import { lowerExpr } from "../expressions/expressions.js"
import { refuseImplicitString } from "../statements/assign.js"
import { convert } from "../values/convert.js"
import { boundName, boundOf, openDims } from "../places/bounds.js"

/** A call expression's bindings while `lowerInvoke` builds them: each input, each in-out, the order they are written in
 *  (`number` an input, `{ inout }` an in-out), and each ANY argument's place by parameter name — the hidden VAR_IN_OUT
 *  `pValue` reads is bound to it. */
export interface InvokeBindings {
  readonly routine: IrRoutine
  readonly instance: Place | undefined
  readonly inputs: (IrExpr | undefined)[]
  readonly order: (number | { inout: number; output?: true })[]
  readonly inouts: (IrBinding | InFrame | undefined)[]
  readonly anyPlaces: Map<string, Place>
}

/** The places a call already holds: its instance and every in-out bound so far. */
export const callHolds = (b: InvokeBindings): Place[] => holding(b.instance, b.inouts)

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
  const target = invokeTarget(lw, call)
  if (target === undefined || "kind" in target) return target
  const { routine, instance } = target
  const b: InvokeBindings = { routine, instance, inputs: routine.inputs.map(() => undefined), order: [], inouts: routine.inouts.map(() => undefined), anyPlaces: new Map() }
  const args = positionalArguments(lw, routine, call)
  if (args === undefined) return undefined
  for (const arg of args) if (bindArgument(lw, b, arg) === undefined) return undefined
  if (bindOpenBounds(lw, b, call.span) === undefined || defaultInputs(lw, b, call.span) === undefined) return undefined
  const outside = bindInstanceInOuts(lw, b, call.span)
  if (outside === undefined || bindAnyTargets(lw, b, call.span) === undefined || bindUnconnectedOutputs(lw, b, outside, call.span) === undefined) return undefined
  const written = bindWhereWritten(lw, b, call.span)
  if (written === undefined) return undefined
  const type = routine.result === undefined ? UNKNOWN : routine.locals[routine.result]!.type
  // An in-out bound inside the instance is substituted into a copy of the routine, not lent (`specialize.ts`). Never
  // beside `outside`, whose unbound in-outs `lastBinding` fills by the routine's own parameter indices.
  const special = outside ? undefined : specializeRoutine(lw, routine, b.inouts)
  const bound = special?.inouts ?? (b.inouts as (IrBinding | undefined)[])
  if (special !== undefined && bound.includes(undefined)) return lw.bail("call-inout-missing", `${routine.name} called without every VAR_IN_OUT`, call.span)
  const invoke: IrInvoke = { kind: "invoke", routine: special?.routine.key ?? routine.key, ...(instance === undefined ? {} : { instance }), inputs: b.inputs as IrExpr[], order: written, inouts: bound as IrBinding[], type, span: call.span }
  return outside ? lastBinding(lw, routine, invoke, call.span) : invoke
}

/** The routine a call expression runs and the instance it runs on — or, through an interface, the dispatch itself. */
function invokeTarget(lw: Lowering, call: Extract<Expr, { kind: "call" }>): { routine: IrRoutine; instance: Place | undefined } | IrDispatch | undefined {
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
    routine = calledRoutine(lw, sym, frame, call.span, `SUPER_${sym.owner.name}_${sym.name}`, call)
    instance = thisPlace(frame, callee.base.span)
  } else if (callee.kind === "member" && namespaceOf(lw, callee.base) !== undefined) {
    // `Stu.StrTrimA(…)` — a library FUNCTION named through its library's NAMESPACE (the `.library` manifest's), which
    // is the same function the bare name reaches, looked up among that library's own symbols only
    const ns = namespaceOf(lw, callee.base)!
    const sym = ns.symbols.get(callee.member.name.toLowerCase())?.find((s) => s.kind === "function")
    if (sym === undefined) return lw.bail("expr-call", `${ns.name}.${callee.member.name} is no FUNCTION of that namespace`, call.span)
    routine = calledRoutine(lw, sym, undefined, call.span, sym.name, call)
  } else if (callee.kind === "member") {
    return memberTarget(lw, call, callee)
  } else if (callee.kind === "ident_expr" && ownMember(lw, callee.name) !== undefined) {
    const frame = selfFb(lw)!
    routine = methodOf(lw, frame, callee.name, call.span, call)
    instance = thisPlace(frame, callee.span)
  } else if (callee.kind === "ident_expr") {
    // a project-level name with several FUNCTIONs behind it (a project one and a library's) means the one the ASKER sees
    // first (`symbols/precedence.ts`): the project's from project code (transpile-review 21, `tr_21_namespace_*`)
    const found = lookup(lw.scope, callee.name)
    const sym =
      found?.symbol.kind === "function" && found.foundIn === lw.project
        ? pickForAsker(lw.project, lookupLocal(lw.project, callee.name).filter((s) => s.kind === "function"), (s) => s.uri, scopeUri(lw.scope))
        : found?.symbol
    if (sym?.kind !== "function") return lw.bail("expr-call", `${callee.name} is not a project FUNCTION`, call.span)
    // A library FUNCTION lowers like a project one when its body is there — the library repo's (`libraries/`) — and is
    // refused as `call-library` by `calledRoutine` when only the materialized declaration is.
    routine = calledRoutine(lw, sym, undefined, call.span, sym.name, call)
  } else return lw.bail("expr-call", "a call of an expression", call.span)
  return routine === undefined ? undefined : { routine, instance }
}

/** `inst.M(…)`: the METHOD or ACTION of the instance a place names — through an interface, the dispatch; on a PROGRAM's
 *  instance, run moved out of `Programs`, so a routine that reaches that instance while it runs is refused. */
function memberTarget(
  lw: Lowering,
  call: Extract<Expr, { kind: "call" }>,
  callee: Extract<Expr, { kind: "member" }>,
): { routine: IrRoutine; instance: Place | undefined } | IrDispatch | undefined {
  const named = lowerPlace(lw, callee.base)
  const base = named === undefined ? undefined : instancePlace(lw, named, call.span)
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
  const routine = methodOf(lw, base.type, callee.member.name, call.span, call)
  // moved out while it runs, the program must not reach its own instance from the method
  const reentrant = routine === undefined ? undefined : programReentrant(lw, routineCallee(lw, routine), programTarget(base), { touched: "always", dispatch: "inside" })
  if (reentrant === "touches") return lw.bail("call-program-reentrant", `${callee.member.name} reaches its own PROGRAM's instance while it runs`, call.span)
  if (reentrant === "dispatch")
    return lw.bail("call-program-reentrant", `${callee.member.name} calls through an interface, which may reach its PROGRAM while it runs`, call.span)
  return routine === undefined ? undefined : { routine, instance: base }
}

/**
 * The call's arguments, each named — a positional one by the parameter at its position. Positional arguments bind in
 * declaration order across VAR_INPUT and VAR_IN_OUT (conformance `callshape_positional_arguments`: 100, 315, 46), so each is
 * named here by the parameter at its position. They were refused whenever the routine had an in-out — pro2193's
 * `Arrays.Bool_All(result, TRUE)` — and a METHOD calling its own FB's METHODs takes the FB's in-outs, so even
 * `ManualControl(a, b)` was. How a position counts a VAR_OUTPUT declared among them is not recorded: refused.
 */
function positionalArguments(lw: Lowering, routine: IrRoutine, call: Extract<Expr, { kind: "call" }>): CallArg[] | undefined {
  const declared = positionalOf(lw).get(routine.key) ?? []
  const args: CallArg[] = []
  for (const [position, arg] of call.args.entries()) {
    if (arg.param !== undefined || arg.output) {
      args.push(arg)
      continue
    }
    const parameter = positionalBinding(declared, position)
    if (typeof parameter === "string")
      return lw.bail("call-positional", `${routine.name} called with a positional argument ${parameter === "past-parameters" ? "past its parameters" : "counted across a VAR_OUTPUT"}`, arg.span)
    args.push({ ...arg, param: { kind: "ident_expr", name: parameter.name, span: arg.span } })
  }
  return args
}

/** One named argument, bound — to an in-out, a VAR_OUTPUT, or an input (an ANY, a string cursor, a borrowed pointer, an
 *  interface, or a plain value) — and its place in the order of the call. */
function bindArgument(lw: Lowering, b: InvokeBindings, arg: CallArg): true | undefined {
  const routine = b.routine
  const name = arg.param?.name.toUpperCase()
  const bound = name === undefined ? -1 : fieldIndex(routine.inouts, name)
  const param = bound >= 0 ? routine.inouts[bound]! : undefined
  // `name => target`: a VAR_OUTPUT bound to the caller's place (conformance `state_routine_outputs`); left empty, a temp
  if (arg.output) return bindOutputArgument(lw, b, arg, bound, param)
  if (arg.value === undefined) return lw.bail("call-output", `${routine.name} called with an empty argument`, arg.span)
  if (param?.section === "VAR_OUTPUT") return lw.bail("call-output", `${param.name} is a VAR_OUTPUT, bound with :=`, arg.span)
  if (param !== undefined) {
    const target = bindInOut(lw, arg, param, callHolds(b), routine.body, routine.fb, b.instance)
    if (target === undefined) return undefined
    b.inouts[bound] = target
    b.order.push({ inout: bound })
    return true
  }
  const k = name === undefined ? -1 : fieldIndex(routine.inputs.map((i) => routine.locals[i]!), name)
  if (k < 0) return lw.bail("call-param", `${arg.param!.name} is not an input of ${routine.name}`, arg.span)
  if (anyInputsOf(lw).get(routine.key)?.has(routine.inputs[k]!)) return bindAnyArgument(lw, b, arg, k, name!)
  const cursorInOut = cursorInputsOf(lw).get(routine.key)?.get(routine.inputs[k]!)
  if (cursorInOut !== undefined) return bindCursorArgument(lw, b, arg, k, cursorInOut)
  const borrowedInOutIndex = borrowedInputsOf(lw).get(routine.key)?.get(routine.inputs[k]!)
  if (borrowedInOutIndex !== undefined) return bindBorrowedArgument(lw, b, arg, k, borrowedInOutIndex)
  const slot = routine.locals[routine.inputs[k]!]!
  if (slot.type.kind === "interface") {
    // a routine's interface input: the tag, recorded for the routine's own local (conformance `itf_function_input`,
    // `itf_method_input_passed_on`) — the instances it names are lent to the routine by its callers (design §24)
    // handed to a METHOD of an instance other than this body's own (an in-out, a lent instance, a global): foreign
    const foreign = b.instance !== undefined && b.instance.root !== undefined && b.instance.root !== "this"
    const tag = interfaceArgument(lw, `ROUTINE:${routine.key}.${slot.name.toUpperCase()}`, slot.type, arg.value!, arg.span, foreign)
    if (tag === undefined) return undefined
    b.inputs[k] = tag
    b.order.push(k)
    return true
  }
  // A call or PROPERTY read in an input runs where it is written, before the call (`callshape_argument_order`,
  // `callshape_property_read_in_arguments`) — each backend takes the inputs in `order`. It was refused (`call-nested`),
  // which stays for a call inside an in-out binding, whose place the call borrows.
  const value = lowerExpr(lw, arg.value!, slot.type)
  if (value === undefined || refuseImplicitString(lw, value, slot.type, arg.span)) return undefined
  b.inputs[k] = convert(value, slot.type)
  b.order.push(k)
  return true
}

/** An `ARRAY[*]` in-out is handed the bounds of the array it binds, as hidden inputs (design §26): a sized array's fold, an
 *  open in-out passed on hands on its own (conformance `callshape_array_star_passed_on`: 9804). */
function bindOpenBounds(lw: Lowering, b: InvokeBindings, span: Span): true | undefined {
  const routine = b.routine
  for (const [i, slot] of routine.inouts.entries()) {
    const binding = b.inouts[i]
    for (let dim = 1; binding !== undefined && dim <= openDims(slot.type); dim++)
      for (const which of ["lower", "upper"] as const) {
        const k = fieldIndex(routine.inputs.map((index) => routine.locals[index]!), boundName(slot.name, which, dim))
        // a copy written back takes the bounds of the place it copies (an FB's own array lent to its own METHOD)
        const at = isInFrame(binding) ? undefined : "kind" in binding ? binding.back : binding
        const value = k < 0 || at === undefined ? undefined : boundOf(lw, at, which, dim)
        if (value === undefined) return lw.bail("call-open-array", `${slot.name} is bound to an array whose bounds are not known here`, span)
        b.inputs[k] = value
        b.order.push(k)
      }
  }
  return true
}

/** An input left out starts at its declared initial value on every call (conformance `callshape_input_left_out`: 54 and
 *  51, never the last call's) — CODESYS compiles the omission only for an input that has one. An ANY input, or one
 *  whose initial value is an aggregate, stays refused. */
function defaultInputs(lw: Lowering, b: InvokeBindings, span: Span): true | undefined {
  const routine = b.routine
  for (const [k, index] of routine.inputs.entries()) {
    if (b.inputs[k] !== undefined) continue
    const slot = routine.locals[index]!
    if (anyInputsOf(lw).get(routine.key)?.has(index) || typeof slot.init === "object")
      return lw.bail("call-input-missing", `${routine.name} called without ${slot.name}, whose starting value is not modelled`, span)
    b.inputs[k] = { kind: "const", value: slot.init, type: slot.type, span }
    b.order.push(k)
  }
  return true
}

/**
 * The FB's own VAR_IN_OUT a METHOD reaches: bound to the in-out this body holds — a call on THIS instance from the FB's own
 * run. From outside, CODESYS uses the instance's LAST binding (`callshape_inout_in_method_after_call`): left unbound here,
 * for `lastBinding` to dispatch on. Answers whether any was left so (`outside`).
 */
function bindInstanceInOuts(lw: Lowering, b: InvokeBindings, span: Span): boolean | undefined {
  const { routine, instance } = b
  let outside = false
  for (const [i, slot] of routine.inouts.entries()) {
    if (slot.ofInstance !== true) continue
    // THIS instance itself — `THIS^.inner.M()` is rooted at THIS too, but runs on a child with in-outs of its own
    // a parameter or local of this routine by that name hides the FB's in-out — lending it would lend the wrong one (review)
    if (instance?.root === "this" && instance.path.length === 0 && shadowedInOutsOf(lw).has(slot.name.toUpperCase()))
      return lw.bail("call-inout-shadowed", `${routine.name} reaches ${slot.name}, which a parameter or local of the calling routine hides`, span)
    const held = instance?.root === "this" && instance.path.length === 0 ? lw.inoutByName.get(slot.name.toUpperCase()) : undefined
    if (held === undefined) outside = true
    else {
      const own: Place = { slot: held, path: [], type: lw.inoutSlots[held]!.type, span, root: "inout" }
      // an explicit argument already lent it — `Bump2(x := shared)` where Bump2 reaches `shared` too: two `&mut` (E0499, review)
      if (b.inouts.some((x) => x !== undefined && !("kind" in x) && aliases(own, x)))
        return lw.bail("call-inout-alias", `${routine.name} reaches ${slot.name}, which an argument of the same call already lends`, span)
      b.inouts[i] = own
    }
  }
  return outside
}
