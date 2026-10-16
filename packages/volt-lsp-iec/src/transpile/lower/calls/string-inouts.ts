/**
 * A STRING VAR_IN_OUT BOUND WIDER THAN IT DECLARES (transpile-restructure 8.2, design.md §7.2 Decision (step 8e)): the
 * in-out IS the caller's buffer, seen through its declared capacity. Recorded — a STRING(12) 'abcdefghijkl' bound to a
 * VAR_IN_OUT STRING(10) (`string_inout_wider_unit_read`, `_copies`, `_stores`, `_reads`; `wstring_inout_wider`, a WSTRING
 * the same):
 *   - `io[k]` reads and writes the CALLER's units: unit 11 'l'; `io[11] := 81` leaves the caller 'abcdefghijkQ';
 *   - every COPY of it takes the DECLARED capacity — a store, an input, a result, a Standard function's input, a
 *     conversion, MOVE, SEL: 'abcdefghij';
 *   - a COMPARISON reads the caller's string in place: `io = 'abcdefghij'` is FALSE;
 *   - a whole STORE into it writes as into a STRING(10) — min(n, 10) units and a 0, the caller's units behind kept;
 *   - SIZEOF(io) is 11.
 * So a routine a call binds such an in-out wider is lowered PER BOUND CAPACITY — the variant `io@=STRING12`
 * (`calls/routines.ts` `calledRoutine`): its slot holds the caller's type, so `io[k]` is bounded by it; its `readAs` is
 * the declared type, so every value read is the copy at that capacity (`places/access-guards.ts` `loadValue`), but a
 * comparison's operand (`inPlace`); a whole store targets the place typed at the declared capacity (`viewStore`), which
 * the interpreter's `storeString` and Rust's `store_within` write at; SIZEOF reads `declared`.
 *
 * CODESYS refuses a NARROWER binding of a non-CONSTANT one — "String variable 'v' too short for the VAR_IN_OUT parameter
 * 'io' of …" (`string_inout_narrower`), refused here too (`binding.ts` `bindPlace`, `call-inout-short`); a CONSTANT one
 * bound narrower (`xo4_inout_constant_chain`) is read as it is.
 */

import type { Expr, TopLevel } from "../../../frontend/syntax/index.js"
import { routineScope } from "./routine-scope.js"
import { stringKind, type Type } from "../../../frontend/types/index.js"
import type { IrExpr, Place } from "../../ir/index.js"
import { type Lowering, type RoutineSymbol, zeroInit } from "../core/lowering.js"
import { lowerPlace } from "../places/places.js"
import { slotOf } from "../places/access-guards.js"
import { storageOf } from "../storage/layout.js"
import { positionalParameters } from "./parameters.js"

/** A string type's capacity — undefined for anything else, or a string whose capacity lowering does not state. */
const capacity = (t: Type | undefined): number | undefined => (t?.kind === "elementary" && stringKind(t) !== undefined ? t.length : undefined)

/**
 * THE STRING VAR_IN_OUTS THIS CALL BINDS WIDER than they declare, by upper-cased parameter name: the type of the variable
 * each is bound to (a STRING(12) for a VAR_IN_OUT STRING(10)) — the variant in the routine's name. A probe of each
 * argument's place: nothing it reports stays reported.
 */
export function widerStringInOuts(lw: Lowering, sym: RoutineSymbol, call: Extract<Expr, { kind: "call" }>): Map<string, Type> {
  const out = new Map<string, Type>()
  const ast = sym.ast as Extract<TopLevel, { kind: "method" | "action" | "function" }>
  if (ast.kind === "action") return out
  const scope = routineScope(lw, sym)
  if (scope === undefined) return out // did not bind: `calledRoutine` refuses it
  const declared = new Map<string, Type>()
  for (const section of ast.varSections.filter((s) => s.sectionKind === "VAR_IN_OUT"))
    for (const decl of section.decls) {
      const type = storageOf(lw, lw.resolve(decl.type, scope), decl.type.span)
      if (capacity(type) !== undefined) for (const name of decl.names) declared.set(name.text.toUpperCase(), type)
    }
  if (declared.size === 0) return out
  const parameters = positionalParameters(ast.varSections)
  for (const [position, arg] of call.args.entries()) {
    const name = arg.param?.name.toUpperCase() ?? parameters[position]?.name.toUpperCase()
    const own = name === undefined ? undefined : declared.get(name)
    if (own === undefined || arg.output || arg.value === undefined) continue
    let value = arg.value
    while (value.kind === "paren") value = value.inner
    const before = lw.diagnostics.length
    const bound = lw.inArgument(() => lowerPlace(lw, value))?.type
    lw.diagnostics.length = before
    if (bound !== undefined && stringKind(bound) === stringKind(own) && capacity(bound)! > capacity(own)!) out.set(name!, bound)
  }
  return out
}

/** Each of the routine's VAR_IN_OUTs bound wider (`widerStringInOuts`) made the VIEW of the caller's buffer: its slot holds
 *  the bound type, and reads (`readAs`) and measures (`declared`, SIZEOF) as the type it declares. After `declareInOuts`. */
export function viewInOuts(r: Lowering, wider: ReadonlyMap<string, Type>): void {
  for (const [name, bound] of wider) {
    const at = r.inoutByName.get(name)!
    const slot = r.inoutSlots[at]!
    r.inoutSlots[at] = { ...slot, type: bound, init: zeroInit(bound), readAs: slot.type, declared: slot.type }
  }
}

/** The declared type a place reads through, when it is a whole VIEW of a wider buffer (`viewInOuts`) — else undefined. */
function viewOf(lw: Lowering, place: Place): Type | undefined {
  const slot = place.root === "inout" && place.path.length === 0 && place.guard === undefined ? slotOf(lw, place) : undefined
  return slot?.readAs !== undefined && capacity(slot.readAs) !== undefined ? slot.readAs : undefined
}

/** A WHOLE STORE into a place: through a view, at the capacity it declares (`string_inout_wider_stores`) — any other place
 *  as it is. */
export function viewStore(lw: Lowering, place: Place): Place {
  const declared = viewOf(lw, place)
  return declared === undefined ? place : { ...place, type: declared }
}

/** A COMPARISON's operand: a view's copy (`loadValue`'s convert) read in place instead — the caller's buffer, as CODESYS
 *  compares it (`string_inout_wider_reads`: `io > 'abcdefghij'` TRUE). Any other operand as it is. */
export function inPlace(lw: Lowering, x: IrExpr): IrExpr {
  return x.kind === "convert" && x.value.kind === "load" && viewOf(lw, x.value.place) === x.type ? x.value : x
}
