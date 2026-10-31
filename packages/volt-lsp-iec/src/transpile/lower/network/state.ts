/**
 * THE STATE A LOWERED NETWORK KEEPS (`network.ts` `HiddenVar`), declared where the body runs: a PROGRAM's or FB's own
 * body in its frame (a field of the instance, kept across scans, as the twin's `VAR` — measured 2.3); an ACTION's, or a
 * base body `SUPER^()` runs, in the frame of the instance it runs on; a METHOD's, FUNCTION's or accessor's in its call
 * frame, started over on every call as its own `VAR` is. A wire's variable starts at its type's initial value.
 */
import type { Identifier, Span, VarSection } from "../../../frontend/syntax/index.js"
import type { Lowering } from "../core/lowering.js"
import { declareVars } from "../storage/declare.js"
import { storageOf } from "../storage/layout.js"
import { drain } from "../core/nested.js"
import type { HiddenVar } from "./network.js"

/** A `VAR` section declaring `name : <type name>;`. */
function section(name: Identifier, type: string, span: Span): VarSection {
  return {
    kind: "var_section",
    sectionKind: "VAR",
    decls: [{ kind: "var_decl", names: [name], type: { kind: "named_type", name: { kind: "identifier", text: type, span }, span }, span }],
    span,
  }
}

/** The state of a body that runs in the frame of `frame` (an ACTION's, a base body's run by `SUPER^()`), declared as
 *  fields of that FB, before the routine copies its fields; false when a declaration was refused (carried into `lw`). */
export function declareInFrame(lw: Lowering, frame: string, hidden: readonly HiddenVar[], span: Span): boolean {
  if (hidden.length === 0) return true
  const owner = lw.bodies.get(frame.toUpperCase())?.lowering
  if (owner === undefined) {
    lw.bail("network-frame", `${frame} has no frame to keep a network's state in`, span)
    return false
  }
  const before = owner.diagnostics.length
  declareNetworkState(owner, hidden)
  return !drain(lw, owner, before)
}

/** Declare every hidden variable `lw` does not hold yet (an ACTION's body lowered again on the same frame holds it). */
export function declareNetworkState(lw: Lowering, hidden: readonly HiddenVar[]): void {
  for (const h of hidden) {
    if (lw.declared(h.name)) continue
    const name: Identifier = { kind: "identifier", text: h.name, span: h.span }
    if ("fb" in h) declareVars(lw, [section(name, h.fb, h.span)])
    else if (h.type.kind === "elementary") lw.slot(name, storageOf(lw, h.type, h.span), "VAR")
    // a named type's variable starts as its declaration says (an enum's first value, a struct's field initializers)
    else if (h.type.kind === "enum" || h.type.kind === "struct" || h.type.kind === "function_block") declareVars(lw, [section(name, h.type.name, h.span)])
    else lw.bail("network-wire-type", `the wire ${h.name} is a ${h.type.kind}, which lowering does not declare`, h.span)
  }
}
