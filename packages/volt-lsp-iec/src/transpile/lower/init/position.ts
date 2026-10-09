/**
 * THE POSITION RULE (design.md §3.4, task 5.7): a frame's initialization is ONE declaration-ordered walk, so a constant
 * initial value is folded into its slot only while no step statement precedes it in its frame. From the frame's first step
 * statement on — an initializer that runs, an instance's init, an FB_Init — every later constant is a statement at its
 * position, and its slot starts at its type's zero: `i : INT := ABS(other); other : INT := -7;` is 0
 * (`cfold_non_constant_argument`), `viaThisLater : INT := THIS^.m; m : INT := 9;` is 0 (`init_this_in_initializer`). By
 * position, not by an analysis of what an earlier statement reads, so it is exact for every path a statement reaches a later
 * slot by — a name, THIS, a pointer handed to an FB_Init, a called body.
 *
 * In an instance's frame the field is zeroed by a statement at the start of the instance's walk, never in the type's
 * layout (gate 5c: a VAR_TEMP's reset and every other construction keep the declared value), and a structured initializer
 * the instance is created with is applied after its whole init (`fb-init.ts` `visitFields`).
 *
 * Not a statement: a VAR CONSTANT (folded where it is read, a compile-time value), a slot already at its type's zero, and
 * an instance's or a struct's own field values — those are folded per TYPE (`T.__init`, `new()`), so a later instance has
 * no per-instance "not yet initialized" state; a read of one is `init-reads-later` (`sequence.ts`).
 */

import { peelArray, type Type } from "../../../frontend/types/index.js"
import { zeroInit } from "../core/lowering.js"
import type { IrInit, IrStmt, Place } from "../../ir/index.js"
import { initFrame, type InitStep } from "./state.js"
import { chainNamesOf } from "../core/chain.js"
import { isPlace, someNode } from "../../ir/walk.js"
import { reachesFbInit } from "./fb-init.js"

/** Whether a slot of `type` starting at `init` is set by a statement once its frame's walk has started. */
export function startsAsStatement(st: InitStep, type: Type, init: IrInit, constant: boolean): boolean {
  if (constant || type.kind === "function_block" || reachesFbInit(st, type, "init-step")) return false
  if (type.kind === "struct") return typeof init === "object" && "fields" in init
  const element = peelArray(type)?.element
  if (element !== undefined && (element.kind === "function_block" || reachesFbInit(st, element, "init-step"))) return false
  return !sameInit(init, zeroInit(type))
}

/** The statement that gives `place` its initial value `init` at its position: a constant, or a fresh aggregate. */
export function startStatement(place: Place, init: IrInit): IrStmt {
  const value = typeof init === "object" ? { kind: "fresh" as const, init, type: place.type, span: place.span } : { kind: "const" as const, value: init, type: place.type, span: place.span }
  return { kind: "assign", target: place, value, span: place.span }
}

/** Two initial values, compared by value — a `bigint` included. */
function sameInit(a: IrInit, b: IrInit): boolean {
  const text = (v: IrInit): string => JSON.stringify(v, (_, x: unknown) => (typeof x === "bigint" ? `${x}n` : x))
  return text(a) === text(b)
}

/** A structured initializer's fields, or undefined for any other initial value. */
export function fieldsOf(init: IrInit | undefined): Readonly<Record<string, IrInit>> | undefined {
  return typeof init === "object" && init !== null && "fields" in init ? init.fields : undefined
}

/** The value a structured initializer gives the field `name` (case-insensitive), if it names it. */
export function namedIn(fields: Readonly<Record<string, IrInit>> | undefined, name: string): IrInit | undefined {
  const key = fields === undefined ? undefined : Object.keys(fields).find((k) => k.toUpperCase() === name.toUpperCase())
  return key === undefined ? undefined : fields![key]
}

/**
 * A structured initializer naming a field that one of the type's RUNNING initializers reads (by name, through THIS, or its
 * address): refused, `init-reads-instance`. Whether the initializer sees the structured or the declared value is not
 * recorded — `fb_init_and_structured_initializer` records only that FB_Init sees the declared one — and the walk answered
 * by the field's position (gate 5c: declared before the type's first running initializer it is folded with the structured
 * value in place, 7; after it, a position statement with the structured value re-applied at the end, 5).
 */
export function structuredUnread(st: InitStep, t: Type, structured: Readonly<Record<string, IrInit>> | undefined): boolean {
  const named = new Set(Object.keys(structured ?? {}).map((k) => k.toUpperCase()))
  if (named.size === 0 || t.kind !== "function_block") return true
  const fields = st.lw.layouts.get(t.name.toUpperCase())?.fields ?? []
  const names = (p: Place): boolean => {
    if (p.root === undefined) return named.has(fields[p.slot]?.name.toUpperCase() ?? "")
    const first = p.path[0]
    return p.root === "this" && first?.kind === "field" && named.has(first.name.toUpperCase())
  }
  for (const type of chainNamesOf(t)) {
    const frame = st.lw.bodies.get(type.toUpperCase())?.lowering
    for (const { slot, statements } of (frame === undefined ? undefined : initFrame(frame).initSequence?.bySlot) ?? [])
      for (const s of statements)
        if (someNode(s.kind === "assign" ? s.value : s, (n) => isPlace(n) && names(n)))
          return (
            st.lw.bail("init-reads-instance", `${fields[slot]?.name ?? "an initializer"} of ${t.name} reads a field the instance's structured initializer sets — whether it sees the structured or the declared value is not recorded`, st.span) ??
            false
          )
  }
  return true
}

/**
 * An ENCLOSING structured initializer reaching an instance that runs FB_Init (`o : Outer := (inner := (k := 9))`) is in the
 * enclosing slot's value at construction, so FB_Init would see it — where on the instance's own declaration it is applied
 * after FB_Init (`fb_init_and_structured_initializer`: 0). Not recorded: refused `fb-init-order`, as the instance's own nested
 * structured value is (gate 5c). niche: accepted loss (0 occurrences in the corpora: no nested structured initializer).
 */
export function enclosingStructuredFree(st: InitStep, t: Type, runsFbInit: boolean, given: IrInit | undefined): boolean {
  if (!runsFbInit || Object.keys(fieldsOf(given) ?? {}).length === 0) return true
  return st.lw.bail("fb-init-order", `${t.kind === "function_block" ? t.name : "an instance"} runs FB_Init and an enclosing structured initializer sets its fields — whether FB_Init sees them is not recorded`, st.span) ?? false
}
