/**
 * Calls: an FB instance's body, a METHOD, ACTION or FUNCTION lowered once — and what a call may bind as `&mut`.
 */
import {
  type Expr,
  isGraphicalBody,
  parseStatements,
  type Span,
  type Statement,
  type TopLevel,
} from "../../syntax/index.js"
import { findChildScope, libraryOf, lookup, lookupMember } from "../../symbols/index.js"
import { UNKNOWN } from "../../types/index.js"
import {
  defaultValueOf,
  type IrExpr,
  type IrInvoke,
  type IrLayout,
  type IrRoutine,
  type IrStmt,
  type Place,
} from "../ir/index.js"
import { baseOf, Lowering } from "./lowering.js"
import { convert } from "./convert.js"
import { declareInOuts, declareVars, storageOf } from "./storage.js"
import { lowerPlace } from "./places.js"
import { through } from "./pointers.js"
import { lowerExpr } from "./expressions.js"
import { lowerBlock } from "./statements.js"

/**
 * A METHOD or ACTION of the FB laid out as `fb`, or a FUNCTION — lowered once, in a frame of the instance's fields (for a
 * METHOD or ACTION) plus per-call locals. Refused, until each is measured: a VAR_OUTPUT (how `=>` reads it back), and
 * VAR_INST or VAR_STAT (storage that outlives the call).
 */
export function calledRoutine(lw: Lowering, sym: NonNullable<ReturnType<typeof lookup>>["symbol"], fb: IrLayout | undefined, span: Span): IrRoutine | undefined {
  const name = fb === undefined ? sym.name : `${fb.name}.${sym.name}`
  const key = name.toUpperCase()
  const cached = lw.routines.get(key)
  if (cached?.state === "lowered") return cached.routine
  if (cached?.state === "failed") return lw.bail("call-body", `${name}'s body does not lower`, span)
  // A routine reached again while its own body lowers calls itself — which lowered it again, without end (a RangeError
  // out of lowering; transpiler review 2026-09-15). Whether CODESYS allows a recursive call at all is not measured.
  if (cached?.state === "lowering") return lw.bail("call-recursive", `${name} calls itself`, span)
  lw.routines.set(key, { state: "lowering" })
  const failed = (code: string, message: string): undefined => {
    lw.routines.set(key, { state: "failed" })
    return lw.bail(code, message, span)
  }
  const ast = sym.ast as Extract<TopLevel, { kind: "method" | "action" | "function" }>
  const scope = findChildScope(fb === undefined ? lw.project : sym.owner, sym.name)
  if (scope === undefined) return failed("call-target", `${name} did not bind`)
  const sections = ast.kind === "action" ? [] : ast.varSections
  const unmeasured = sections.find((s) => ["VAR_OUTPUT", "VAR_INST", "VAR_STAT"].includes(s.sectionKind))
  if (unmeasured !== undefined) return failed(`routine-${unmeasured.sectionKind.toLowerCase()}`, `${name} has ${unmeasured.sectionKind}, not measured yet`)
  if (isGraphicalBody(ast.body)) return failed("graphical-body", `${name} has a graphical body`)
  const parsed = parseStatements(ast.body)
  if (!parsed.ok) return failed("parse", parsed.firstError ?? `${name}'s body did not parse`)

  const r = new Lowering(scope, lw.project, lw.shared)
  if (fb !== undefined) r.inherit(fb.fields)
  if (fb !== undefined) r.selfType = { kind: "function_block", name: fb.name, scope: sym.owner }
  // a METHOD's plain slots are its FB's fields, so its pointers there share the FB's keys; its locals are its own
  r.frameContext = fb === undefined ? `FUNCTION:${key}` : `FB:${fb.name.toUpperCase()}`
  r.routineContext = `ROUTINE:${key}`
  r.routineMode = true
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
    lw.routines.set(key, { state: "failed" })
    return undefined
  }
  const kind = ast.kind
  const routine: IrRoutine = { name, key, kind, ...(fb === undefined ? {} : { fb: fb.name }), locals: r.localSlots, inputs, inouts: r.inoutSlots, ...(result === undefined ? {} : { result }), body }
  lw.routines.set(key, { state: "lowered", routine })
  return routine
}

/**
 * `inst.M(a := x)`, `inst.A()` or `F(x)` → an `IrInvoke`. Arguments bind by name; positionally only to a routine with
 * no VAR_IN_OUT (measured for a FUNCTION's input, `fbcall_function_locals`). An input left out is refused — whether it
 * takes its initial value is not measured.
 */
export function lowerInvoke(lw: Lowering, call: Extract<Expr, { kind: "call" }>): IrInvoke | undefined {
  // `a.M(k := b.M(k := 1))` prints the inner call as an argument of the outer one: two `&mut g` at once, or two of `a`
  // for `a.M(k := a.M(…))` — E0499 (transpiler review 2026-09-15, compiled). Hoisting the inner call would move it ahead
  // of the operands read before it, an evaluation order not measured — so it is refused.
  if (lw.arguments > 0) return lw.bail("call-nested", "a METHOD, ACTION or FUNCTION called inside another call's arguments", call.span)
  const callee = call.callee
  let routine: IrRoutine | undefined
  let instance: Place | undefined
  if (callee.kind === "member") {
    const base = lowerPlace(lw, callee.base)
    if (base === undefined) return undefined
    if (inGlobals(lw, base)) return lw.bail("call-global-instance", `${callee.member.name} is called on an instance declared in a GVL`, call.span)
    const layout = base.type.kind === "function_block" ? lw.layouts.get(base.type.name.toUpperCase()) : undefined
    const sym = base.type.kind === "function_block" && base.type.scope !== undefined ? lookupMember(base.type.scope, callee.member.name) : undefined
    if (layout === undefined || (sym?.kind !== "method" && sym?.kind !== "action"))
      return lw.bail("call-method", `${callee.member.name} is not a METHOD or ACTION lowering can call`, call.span)
    // an override in a derived FB would decide which body runs — dynamic dispatch, not measured
    const pendingFb = lw.bodies.get(layout.name.toUpperCase())
    if (pendingFb !== undefined && baseOf(pendingFb.unit) !== undefined)
      return lw.bail("call-extends", `${layout.name} EXTENDS another FB — which ${callee.member.name} runs is not measured yet`, call.span)
    routine = calledRoutine(lw, sym, layout, call.span)
    instance = base
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
        const written = lw.inArgument(() => lowerPlace(lw, arg.value!))
        const target = written === undefined ? undefined : through(lw, written, arg.span)
        if (target === undefined) return undefined
        if ((instance !== undefined && aliases(target, instance)) || inouts.some((p) => p !== undefined && aliases(target, p)))
          return lw.bail("call-inout-alias", `${arg.param.name} is bound to a variable the call already holds`, arg.span)
        if (target.path.some((s) => s.kind === "bit")) return lw.bail("call-inout-bit", `${arg.param.name} is bound to a bit`, arg.span)
        // every body is handed the globals as one `&mut`, so a VAR_IN_OUT into them would be a second borrow of the same place
        if (target.root === "global") return lw.bail("call-inout-global", `${arg.param.name} is bound to a global variable`, arg.span)
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
 * An FB's layout with its body lowered — once, at the first call that reaches it. Refused, until each is recorded:
 * a derived FB (which bodies a call runs), and an FB with VAR_TEMP (whether it starts over per call).
 */
export function calledLayout(lw: Lowering, name: string, span: Span): IrLayout | undefined {
  const key = name.toUpperCase()
  const pending = lw.bodies.get(key)
  const layout = lw.layouts.get(key)
  if (pending === undefined || layout === undefined) return lw.bail("call-target", `${name} has no body lowering can call`, span)
  if (pending.state === "lowered") return layout
  if (pending.state === "failed") return lw.bail("call-body", `${name}'s body does not lower`, span)
  const unit = pending.unit
  const base = baseOf(unit)
  if (base !== undefined) return lw.fail(pending, "call-extends", `${name} EXTENDS ${base.text} — which bodies a call runs is not measured yet`, span)
  if (unit.varSections.some((s) => s.sectionKind === "VAR_TEMP"))
    return lw.fail(pending, "fb-var-temp", `${name} has VAR_TEMP — whether it starts over per call is not measured yet`, span)
  if (isGraphicalBody(unit.body)) return lw.fail(pending, "graphical-body", `${name} has a graphical body`, span)
  const parsed = parseStatements(unit.body)
  if (!parsed.ok) return lw.fail(pending, "parse", parsed.firstError ?? `${name}'s body did not parse`, span)
  const nested = pending.lowering
  const before = nested.diagnostics.length
  declareInOuts(nested, unit.varSections.filter((s) => s.sectionKind === "VAR_IN_OUT"))
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
 * `inst(a := x, q => y)` → the input assignments, the call, the output assignments (IrCall). A FUNCTION, PROGRAM, METHOD
 * or ACTION call reports its own code — they are the plan's next steps.
 */
export function lowerCallStatement(lw: Lowering, call: Extract<Statement, { kind: "call_stmt" }>["call"]): IrStmt[] | undefined {
  const callee = call.callee
  const upper = callee.kind === "ident_expr" ? callee.name.toUpperCase() : ""
  if (callee.kind === "ident_expr" && !lw.localByName.has(upper) && !lw.byName.has(upper) && !lw.inoutByName.has(upper)) {
    const sym = lookup(lw.scope, callee.name)?.symbol
    const kind = sym?.kind
    if (kind === "function") {
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
    if (arg.param === undefined || arg.value === undefined)
      return lw.bail("call-positional", `${layout.name} called with a positional or empty argument`, arg.span)
    const name = arg.param.name.toUpperCase()
    if (inouts.some((p) => p.name.toUpperCase() === name)) {
      const written = lowerPlace(lw, arg.value)
      const target = written === undefined ? undefined : through(lw, written, arg.span)
      if (target === undefined) return undefined
      // two `&mut` into one place do not exist in Rust — the handle form (design §9 form 3) is for later
      if (aliases(target, instance) || [...bound.values()].some((p) => aliases(target, p)))
        return lw.bail("call-inout-alias", `${arg.param.name} is bound to a variable the call already holds`, arg.span)
      if (target.path.some((s) => s.kind === "bit")) return lw.bail("call-inout-bit", `${arg.param.name} is bound to a bit`, arg.span)
      // every body is handed the globals as one `&mut`, so a VAR_IN_OUT into them would be a second borrow of the same place
      if (target.root === "global") return lw.bail("call-inout-global", `${arg.param.name} is bound to a global variable`, arg.span)
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
