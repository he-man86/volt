/** STRUCTS AS RUST — one block per struct: its fields and its `impl` with `new`. */
import type { IrInit, IrLayout } from "../../ir/index.js"
import type { Span } from "../../../frontend/syntax/index.js"
import { peelArray, stringKind, type Type } from "../../../frontend/types/index.js"
import { type Printer, push, typeOf } from "./printer.js"
import { initOf, type Layouts } from "./values.js"
import { isCopy, isEq } from "./types.js"

/**
 * One struct block: the struct with its fields, its `impl` with a `new` at the slots' initial values, and whatever
 * `members` prints inside that `impl`. The POU's own struct, each DUT and FB layout, `Globals` and `Programs` are all
 * printed through it.
 *
 * NO `impl Default` (lean 7.8.11). Every struct had one, five lines deferring to `new`, for clippy's
 * `new_without_default` alone: the contract is `::new()` (`emit/rust/index.ts` — a harness constructs through it) and the
 * one move-out that needed a stand-in builds it with `new` too (`calls.ts`, `std::mem::replace`). `#[derive(Default)]`
 * instead is exact only where every initial value is its type's zero and no array is longer than 32 — a second way to
 * build the same struct for the structs where it holds, measured at 7.8.11 and not taken: one uniform shape, `new` and
 * `#[allow(clippy::new_without_default)]`.
 */
export function printStruct(p: Printer, name: string, slots: readonly { type: Type; init: IrInit }[], names: readonly string[], span: Span | undefined, members: () => void, kind?: IrLayout["kind"]): void {
  push(p, "#[allow(non_camel_case_types)]", 0)
  // the derives the fields allow (lean 7.8.1): `Copy` for a DUT STRUCT whose fields all are — a store of it then copies,
  // no `.clone()` (`types.isCopy`) — and `Eq` wherever no REAL/LREAL is in it
  const copy = kind === "struct" && slots.every((s) => isCopy(s.type, p.layouts))
  const eq = slots.every((s) => isEq(s.type, p.layouts))
  push(p, `#[derive(Debug, Clone, ${copy ? "Copy, " : ""}PartialEq${eq ? ", Eq" : ""})]`, 0)
  push(p, `pub struct ${name} {`, 0, span)
  for (const [i, slot] of slots.entries()) push(p, `pub ${names[i]}: ${typeOf(p, slot.type)},`, 1)
  push(p, "}", 0)
  push(p, "", 0)
  push(p, `impl ${name} {`, 0)
  // `new` seeds the declared initial values — a `const fn` where every one of them can be built at compile time, and
  // `#[must_use]`: a `new` whose value is dropped did nothing (lean 7.7.4, clippy's `must_use_candidate`,
  // `missing_const_for_fn`)
  push(p, "#[must_use]", 1)
  push(p, "#[allow(clippy::new_without_default)]", 1)
  push(p, `pub ${slots.every((slot) => constInit(p.layouts, slot.type, slot.init)) ? "const " : ""}fn new() -> Self {`, 1)
  push(p, "Self {", 2)
  for (const [i, slot] of slots.entries()) push(p, `${names[i]}: ${initOf(p.layouts, slot.type, slot.init, true)},`, 3)
  push(p, "}", 2)
  push(p, "}", 1)
  members()
  push(p, "}", 0)
  push(p, "", 0)
}

/**
 * Whether `initOf` builds this initial value with what a `const fn` may call: a number, a BOOL, an address, an array of
 * them (`[0i16; 3]`, `[1, 2, 3]`), a STRUCT or FB whose own `new` is one, its fields set after it. A STRING is not (its
 * `lit` / `new` loop over the buffer), nor an array of non-Copy elements (`std::array::from_fn`); a repeat of a Copy
 * one is (`[T::new(); N]`, lean 7.8.2).
 */
function constInit(layouts: Layouts, t: Type, init: IrInit): boolean {
  if (t.kind === "struct" || t.kind === "function_block") {
    const entry = layouts.get(t.name.toUpperCase())
    if (entry === undefined || !constLayout(layouts, entry.layout)) return false
    const named = typeof init === "object" && "fields" in init ? init.fields : {}
    return entry.layout.fields.every((f) => named[f.name.toUpperCase()] === undefined || constInit(layouts, f.type, named[f.name.toUpperCase()]!))
  }
  const array = peelArray(t)
  if (array !== undefined) {
    if (typeof init !== "object" || !("elements" in init)) return false
    if (init.elements.length === 0 && !isCopy(array.element, layouts)) return false
    return [...init.elements, init.rest].every((e) => constInit(layouts, array.element, e))
  }
  return t.kind === "elementary" ? stringKind(t) === undefined : t.kind === "pointer" || t.kind === "reference" || t.kind === "interface"
}

/** Whether a layout's own `new` is a `const fn` — every field its struct holds (`module.ts` `held`) built so. */
function constLayout(layouts: Layouts, layout: IrLayout): boolean {
  const held = layout.kind === "function_block" ? layout.fields.filter((f) => f.image === undefined && f.scoped !== true) : layout.fields
  return held.every((f) => constInit(layouts, f.type, f.init))
}
