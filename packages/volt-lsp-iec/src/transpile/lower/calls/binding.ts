/**
 * What a call may bind as `&mut`: a VAR_IN_OUT bound to a place, the guards on it, the places a call already holds, and
 * each in-out frozen where it is written.
 */

import type { Access, IrBinding, IrFreeze, IrSlot, IrStmt, Place } from "../../ir/index.js"
import { type InFrame, inFramePlace, isInFrame } from "./specialize.js"
import { frameState, type Lowering } from "../core/lowering.js"
import type { CallArg, Span } from "../../../frontend/syntax/index.js"
import { lowerExpr } from "../expressions/expressions.js"
import { convert } from "../values/convert.js"
import { lowerPlace } from "../places/places.js"
import { FULL_WRITE, guardWrite } from "../places/access-guards.js"
import { openDims } from "../places/bounds.js"
import { sameStorage, staticPath } from "../places/path.js"
import type { Type } from "../../../frontend/types/index.js"
import type { InvokeBindings } from "./invoke.js"
import { holdsCall, touchesOnlyItsOwn, writesOnlyLocals } from "../../ir/walk.js"
import { tempPlace } from "../core/temps.js"
import { refuseCursorOverrun } from "../pointers/cursor.js"

/** The FB in-outs a routine would reach but a parameter or local of its own hides, by upper-cased name (`calledRoutine`). */
export const shadowedInOutsOf = frameState(() => new Set<string>())

/** What a call already holds: its instance, each in-out bound to a place, and the place each copy is written back to. The
 *  SUPER^ and FB body calls passed only the places, so `SUPER^(a := n, b := n)` copied n twice (review of the copy-back).
 *  An in-frame binding lends nothing — it is a path into the instance, which is held already. */
export const holding = (instance: Place | undefined, bindings: readonly (IrBinding | InFrame | undefined)[]): Place[] => [
  ...(instance === undefined ? [] : [instance]),
  ...bindings.flatMap((b) => (b === undefined || isInFrame(b) ? [] : "kind" in b ? (b.back === undefined ? [] : [b.back]) : [b])),
]

/**
 * The place a VAR_IN_OUT argument binds. Refused: two `&mut` into one place (they do not exist in Rust — the handle form,
 * design §9 form 3, is for later), a bit, a global (every body holds the globals as one `&mut`), and a derived instance
 * or struct standing in for its base type — the parameter would dispatch on the base, which is not modelled.
 */
export function bindInOut(lw: Lowering, arg: CallArg, param: IrSlot, held: readonly Place[], callee: readonly IrStmt[], calleeFb: string | undefined, instance: Place | undefined): IrBinding | InFrame | undefined {
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
  return written && bindPlace(lw, written, arg, param, held, callee, calleeFb, instance)
}

/** A place, already lowered, lent to a VAR_IN_OUT — every check `bindInOut` makes once it has the argument's place. A
 *  STRING CURSOR binds this way to what a pointer argument names, which is a place and no expression. */
export function bindPlace(lw: Lowering, written: Place, arg: CallArg, param: IrSlot, held: readonly Place[], callee: readonly IrStmt[], calleeFb: string | undefined, instance: Place | undefined): IrBinding | InFrame | undefined {
  // a read-only binding writes nothing, so it is not a store `guardWrite` must check — a reference still reads its target
  const target = param.constant === true && written.type.kind !== "reference" ? written : guardWrite(lw, written, arg.span, FULL_WRITE)
  if (target === undefined) return undefined
  // a cursor's `p^` lent to a VAR_IN_OUT (VAR_OUTPUT) the callee may store up to its own capacity into — a whole-string
  // store through the cursor (`cursor_whole_store_capacity`); a read-only one writes nothing
  if (param.readOnly !== true && param.constant !== true && refuseCursorOverrun(lw, target, param.type, arg.span)) return undefined
  // A place INSIDE the instance the callee runs on is not lent at all: the routine is specialized on the path to it
  // (`specialize.ts`), which is the only exact answer where the callee also reaches that storage another way.
  // Not a VAR_IN_OUT CONSTANT: what it reads after the callee writes the same field by name is not recorded, and its copy
  // rule (`inout_const_method_9`) already covers what is.
  if (held.some((p) => aliases(target, p)) && param.readOnly !== true && param.section !== "VAR_OUTPUT" && openDims(param.type) === 0 && sameStorage(param.type, target.type) && !holdsCall(callee)) {
    const place = inFramePlace(lw, instance, target, calleeFb)
    if (place !== undefined) return { kind: "inframe", place, span: arg.span }
  }
  const shared = held.some((p) => aliases(target, p)) || target.root === "global"
  // A variable the call also holds (the instance a METHOD runs on, `inst.M(v := inst.x)`) or a global cannot be lent as `&`
  // beside the `&mut` of the instance or `g`. For a read-only in-out a copy reads the same — exactly when the callee writes
  // nothing but its own locals and calls nothing, so nothing can change the variable while it runs (`inout_const_method_9`).
  if (param.readOnly === true && shared && target.path.every((s) => s.kind !== "bit")) {
    if (writesOnlyLocals(callee)) return { kind: "copy", value: { kind: "load", place: target, type: target.type, span: arg.span }, type: param.type, span: arg.span }
    return lw.bail("call-inout-alias", `${param.name} is bound to a variable the callee could change while it reads it`, arg.span)
  }
  // A VAR_OUTPUT the caller COPIES OUT after the call (`bindOutputArgument`) is not lent, so a place the call holds is no
  // second `&mut`: `Count(o => seen)` in an FB's own body, `seen` its field (6.A.12, `tr_a12_bare_method_call_unconnected_output`).
  const copiedOut = param.section === "VAR_OUTPUT" && target.guard === undefined
  if (!copiedOut && held.some((p) => aliases(target, p))) {
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
  if (lendGuards(lw, target, param.name, arg.span) === undefined) return undefined
  const composite = (t: Type): string | undefined => (t.kind === "function_block" || t.kind === "struct" ? t.name.toUpperCase() : undefined)
  if (composite(param.type) !== undefined && composite(param.type) !== composite(target.type))
    return lw.bail("call-inout-derived", `${param.name} is bound to a ${target.type.kind === "function_block" || target.type.kind === "struct" ? target.type.name : target.type.kind}, not its own type`, arg.span)
  // A REAL BOUND TO AN INTEGER IN-OUT (or the reverse) does not compile (`cc5_in_out_type_mismatch`, refused); lent, the
  // callee read the REAL's storage as an INT — a value no backend defines (transpile-restructure 7.3.1 found it: the
  // interpreter's answer changed once the INT arithmetic on it computed narrow). Only the real/integer crossing is
  // recorded; two integer types of another width or sign are not, and stay lent as before.
  if (param.section !== "VAR_OUTPUT" && numeric(param.type) !== undefined && numeric(target.type) !== undefined && numeric(param.type) !== numeric(target.type))
    return lw.bail("call-inout-type", `${param.name} is a ${numeric(param.type)} bound to a ${numeric(target.type)}`, arg.span)
  return target
}

/**
 * THE GUARDS EVERY LENT PLACE MUST PASS — a bit, and a global.
 *
 * Both were spelled inline at the end of `bindInOut` and nowhere else, which is how the ANY-argument path came
 * to lend a place that had passed NEITHER. An `ANY_INT` input given a global emitted `f(g, …, &mut g.g_val)` —
 * `g` and a field of `g` in one argument list, E0499 — with no diagnostic at all, while the SAME variable on a
 * plain VAR_IN_OUT was correctly refused `call-inout-global`. A bit fared worse: `w.3` bound the whole WORD to a
 * `&mut bool` and the bit step was dropped silently.
 *
 * One function, two callers, so a third path cannot skip them by being written somewhere else.
 */
export function lendGuards(lw: Lowering, target: Place, name: string, span: Span): Place | undefined {
  if (target.path.some((s) => s.kind === "bit")) return lw.bail("call-inout-bit", `${name} is bound to a bit`, span)
  if (target.root === "global") return lw.bail("call-inout-global", `${name} is bound to a global variable`, span)
  return target
}

/**
 * The order the call's arguments run in, with each in-out bound where it is written (conformance
 * `callshape_inout_binding_order`: 101 before a call that moves its index, 201 after). Both backends bind after the inputs,
 * so an in-out written before an input holding a call has each runtime index taken into a temp there. It was refused
 * (`call-inout-order`); a pointer's target or a copied value still is — what the call could move there is more than an
 * index.
 */
export function bindWhereWritten(lw: Lowering, b: InvokeBindings, span: Span): (number | IrFreeze)[] | undefined {
  const { routine, instance, inputs, order, inouts } = b
  const written: (number | IrFreeze)[] = []
  for (const [at, entry] of order.entries()) {
    if (typeof entry === "number") {
      written.push(entry)
      continue
    }
    if (!order.slice(at + 1).some((later) => typeof later === "number" && inputs[later] !== undefined && holdsCall(inputs[later]))) continue
    const binding = inouts[entry.inout]!
    // an output copied out after the call reads its index then, whatever a later argument did to it
    if (entry.output === true && "kind" in binding && binding.kind === "copy" && binding.back !== undefined) continue
    const name = routine.inouts[entry.inout]!.name
    // A VAR_OUTPUT's target is NOT bound where written: its index is read after the inputs (`callshape_output_index_before_call`:
    // 7 into numbers[1]) — as both backends bind it — for a FUNCTION that binds nothing else and touches only its own
    // locals, so nothing moves the index while it runs. Anything else is refused: a METHOD could move it, a global write
    // or another in-out on the index variable could (review: `io := cursor` beside it printed E0503), and a pointer's
    // target is not recorded there.
    if (entry.output === true && instance === undefined && routine.inouts.length === 1 && touchesOnlyItsOwn(routine.body) && !("kind" in binding) && binding.guard === undefined) continue
    const movable = "kind" in binding || binding.guard !== undefined || binding.path.some((s) => s.kind === "index" && s.index.kind !== "const")
    if (movable && ("kind" in binding || entry.output === true))
      return lw.bail("call-inout-order", `${routine.name}'s ${name} is bound before a call in a later argument that could move it`, span)
    const frozen = frozenWhereWritten(lw, binding)
    written.push(...frozen.freezes)
    inouts[entry.inout] = frozen.binding
  }
  return written
}

/**
 * An in-out's place bound WHERE IT IS WRITTEN: each runtime part of it taken into a temp there (`freezes`, in order), and the
 * place reading the temps (`binding`) — for the routine path (`bindWhereWritten`) and the FB body call alike.
 */
export function frozenWhereWritten(lw: Lowering, binding: Place): { freezes: IrFreeze[]; binding: Place } {
  const freezes: IrFreeze[] = []
  // A pointer's target moves with the POINTER, and `p^`'s index is read from it — so the pointer's own value is frozen
  // where the in-out is written, as an index is (conformance `callshape_inout_pointer_before_call`: 101, `boundValue`
  // still numbers[0] after a later argument repoints p). The frozen value carries the null check with it.
  let guard = binding.guard
  if (guard !== undefined) {
    const temp = tempPlace(lw, "inout_guard", guard.type, binding.span)
    freezes.push({ kind: "freeze", temp, value: { kind: "load", place: guard, type: guard.type, span: binding.span } })
    guard = temp
  }
  // a place in the byte image is where its ADDRESS says (model 3): the address is frozen where the in-out is written
  let address = binding.at
  if (address !== undefined) {
    const temp = tempPlace(lw, "inout_address", address.type, binding.span)
    freezes.push({ kind: "freeze", temp, value: address })
    address = { kind: "load", place: temp, type: address.type, span: binding.span }
  }
  const path = binding.path.map((step): Access => {
    if (step.kind !== "index" || step.index.kind === "const") return step
    const temp = tempPlace(lw, "inout_index", step.index.type, binding.span)
    freezes.push({ kind: "freeze", temp, value: step.index })
    return { ...step, index: { kind: "load", place: temp, type: step.index.type, span: binding.span } }
  })
  return { freezes, binding: { ...binding, path, ...(guard === undefined ? {} : { guard }), ...(address === undefined ? {} : { at: address }) } }
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

/** Whether an elementary type is a REAL or an integer (a bit string among them) — undefined for anything else (a string,
 *  a BOOL or BIT, a time, a composite). */
function numeric(t: Type): "real" | "integer" | undefined {
  if (t.kind !== "elementary") return undefined
  if (t.elem.family === "real") return "real"
  return (t.elem.family === "int" || t.elem.family === "bitstring") && t.elem.bits !== 1 ? "integer" : undefined
}
