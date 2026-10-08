/**
 * PROPERTY accessors as routines: a GET read and a SET assigned.
 */

import type { FbType, Lowering, RoutineSymbol } from "../core/lowering.js"
import type { Expr, Property, Span, Statement } from "../../../frontend/syntax/index.js"
import type { IrDispatch, IrInvoke, IrRoutine, IrStmt, Place } from "../../ir/index.js"
import { bodyOf, once, routineLowering } from "./routines.js"
import { childScopesByName, lookupMember } from "../../../frontend/symbols/index.js"
import { storageOf } from "../storage/layout.js"
import { inferExprType, typeZero, UNKNOWN } from "../../../frontend/types/index.js"
import { declareVars } from "../storage/declare.js"
import { lowerBlock } from "../statements/statements.js"
import { isSuper } from "./super.js"
import { instancePlace, selfFb, thisPlace } from "../places/self.js"
import { lowerPlace } from "../places/places.js"
import { inGlobals, programReentrant, programTarget, routineCallee } from "./reentrancy.js"
import { interfacePropertyGet, interfacePropertySet } from "../interfaces/dispatch.js"
import { staticPath } from "../places/path.js"
import { lowerExpr } from "../expressions/expressions.js"
import { refuseImplicitString } from "../statements/assign.js"
import { assignTo } from "../values/convert.js"
import { interfaceFrame } from "../interfaces/state.js"
import { tempPlace } from "../core/temps.js"
import { drain } from "../core/nested.js"

/**
 * A PROPERTY's GET or SET as a routine of the FB it runs on: the getter's result, or the setter's one input, is a local
 * named as the property, and its VAR starts over on every call (conformance `state_property_get_set`).
 */
export function propertyRoutine(lw: Lowering, frame: FbType, sym: RoutineSymbol, accessor: "get" | "set", span: Span, as = sym.name): IrRoutine | undefined {
  const name = `${frame.name}.${as}__${accessor}`
  return once(lw, name, span, () => {
    const ast = sym.ast as Property
    const part = accessor === "get" ? ast.getter : ast.setter
    if (part === undefined) return lw.bail("property-accessor", `${sym.name} has no ${accessor.toUpperCase()}`, span)
    const scope = childScopesByName(sym.owner, sym.name).find((s) => s.span === ast.span)?.children.find((c) => c.span === part.body.span)
    if (scope === undefined) return lw.bail("call-target", `${name} did not bind`, span)
    const unmeasured = part.varSections.find((s) => s.sectionKind !== "VAR" && s.sectionKind !== "VAR_TEMP")
    if (unmeasured !== undefined) return lw.bail(`routine-${unmeasured.sectionKind.toLowerCase()}`, `${name} has ${unmeasured.sectionKind}, not measured yet`, span)
    const parsed = bodyOf(lw, ast, part.body, name)
    if ("code" in parsed) return lw.bail(parsed.code, parsed.message, span)
    const key = name.toUpperCase()
    const r = routineLowering(lw, scope, frame, sym.owner, key, name)
    const type = storageOf(r, r.resolve(ast.dataType), ast.dataType.span)
    r.localByName.set(sym.name.toUpperCase(), 0)
    r.localSlots.push({ name: sym.name, type, section: accessor === "get" ? "VAR" : "VAR_INPUT", init: typeZero(type) })
    declareVars(r, part.varSections)
    const body = lowerBlock(r, parsed.statements)
    if (drain(lw, r)) return undefined
    const shape = accessor === "get" ? { inputs: [], result: 0 } : { inputs: [0] }
    return { name, key, kind: "method", fb: frame.name, uri: sym.uri, locals: r.localSlots, inouts: [], ...shape, body, lent: interfaceFrame(r).lends }
  })
}

/**
 * The instance and PROPERTY an expression names — `inst.P`, `THIS^.P`, or `P` bare inside the FB — resolved by the
 * instance's own type, as a METHOD is. `null` when it names no property; `undefined` when it does and was refused.
 */
function propertyAccess(lw: Lowering, e: Expr): { instance: Place; frame: FbType; sym: RoutineSymbol; as?: string } | undefined | null {
  // `SUPER^.P` — the BASE's accessor, run on this instance, as `SUPER^.M()` runs the base's METHOD (conformance
  // `xo2_property_override_chain`: the derived getter gives 82 where SUPER^ gives 41). It was no place at all —
  // `place-shape`, "deref is not a lowerable storage location" — because only `SUPER^.M()` was ever resolved.
  if (e.kind === "member" && isSuper(e.base)) {
    const frame = selfFb(lw)
    const baseScope = lw.codeOwner?.baseScope
    const sym = baseScope === undefined ? undefined : lookupMember(baseScope, e.member.name)
    if (frame === undefined || sym?.kind !== "property") return null
    return { instance: thisPlace(frame, e.base.span), frame, sym, as: `SUPER_${sym.owner.name}_${sym.name}` }
  }
  if (e.kind === "ident_expr") {
    const frame = selfFb(lw)
    if (frame?.scope === undefined || lw.holds(e.name)) return null
    const sym = lookupMember(frame.scope, e.name)
    return sym?.kind === "property" ? { instance: thisPlace(frame, e.span), frame, sym } : null
  }
  if (e.kind !== "member" || /^\d+$/.test(e.member.name)) return null
  // A PROPERTY THROUGH A REFERENCE TO (or POINTER TO) AN FB runs on the instance it points at — the same rule
  // `instancePlace` already applies to a body call and a METHOD, and the same shape as `xo_reference_to_fb_call`.
  // This path looked only at the reference's OWN type, in both of the places it asks: the inferred type was
  // `reference`, never `function_block`, so `r.Size` was not recognised as a property at all and fell through to the
  // generic member path (`expr-member` reading it, `place-shape` writing it).
  const written = inferExprType(e.base, lw.scope, lw.project)
  const seen = written.kind === "reference" || written.kind === "pointer" ? storageOf(lw, written.target, e.span) : written
  if (seen.kind !== "function_block" || seen.scope === undefined || lookupMember(seen.scope, e.member.name)?.kind !== "property") return null
  const resolved = lowerPlace(lw, e.base)
  if (resolved === undefined) return undefined
  const instance = instancePlace(lw, resolved, e.base.span)
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
  const routine = propertyRoutine(lw, access.frame, access.sym, "get", e.span, access.as)
  if (routine === undefined) return undefined
  // The getter of an FB instance inside a PROGRAM runs on the program's instance (conformance
  // `callshape_program_instance_property`: 33, 34), with the program moved out as for a METHOD there — under the same checks.
  const inside = access.instance
  if (inside.root === "global" && inside.path.length > 0) {
    if (!staticPath(inside)) return lw.bail("call-program-property", `${access.sym.name} is read on an instance inside a PROGRAM through a runtime index`, e.span)
    if (programReentrant(lw, routineCallee(lw, routine), programTarget(inside)) !== undefined)
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
  const routine = propertyRoutine(lw, access.frame, access.sym, "set", s.span, access.as)
  if (routine === undefined) return undefined
  const type = routine.locals[0]!.type
  const value = lowerExpr(lw, s.value, type)
  if (value === undefined || refuseImplicitString(lw, value, type, s.span)) return undefined
  const temp = tempPlace(lw, "property", type, s.span)
  const set: IrInvoke = { kind: "invoke", routine: routine.key, instance: access.instance, inputs: [{ kind: "load", place: temp, type, span: s.span }], inouts: [], type: UNKNOWN, span: s.span }
  return [assignTo(temp, value, s.span), { kind: "eval", value: set, span: s.span }]
}
