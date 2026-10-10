/** STRUCTS AS RUST — one block per struct: its fields, its `impl` with `new`, and its `Default`. */
import type { IrInit } from "../../ir/index.js"
import type { Span } from "../../../frontend/syntax/index.js"
import type { Type } from "../../../frontend/types/index.js"
import { type Printer, push, typeOf } from "./printer.js"
import { initOf } from "./values.js"

/**
 * `Default` alongside `new` — deferring to it, never duplicating the initial values.
 *
 * A Rust type with a no-argument `new` and no `Default` is what `clippy::new_without_default` names, and it named
 * all 2,289 structs the fixtures emit. It is not derived (Rust derives `Default` only for arrays up to 32 elements,
 * which is why `new` builds every value explicitly) and it is not the CONTRACT — `emit/rust/index.ts` says a
 * harness constructs through `::new()`. This exists so the emitted crate composes the way a Rust programmer expects:
 * `Default::default()`, `..Default::default()`, and a struct holding one of these deriving its own.
 */
function defaultImpl(p: Printer, name: string): void {
  push(p, `impl Default for ${name} {`, 0)
  push(p, "fn default() -> Self {", 1)
  push(p, "Self::new()", 2)
  push(p, "}", 1)
  push(p, "}", 0)
  push(p, "", 0)
}

/**
 * One struct block: the struct with its fields, its `impl` with a `new` at the slots' initial values, whatever
 * `members` prints inside that `impl`, and its `Default`. The POU's own struct, each DUT and FB layout, `Globals` and
 * `Programs` are all printed through it.
 */
export function printStruct(p: Printer, name: string, slots: readonly { type: Type; init: IrInit }[], names: readonly string[], span: Span | undefined, members: () => void): void {
  push(p, "#[allow(non_camel_case_types)]", 0)
  push(p, "#[derive(Debug, Clone, PartialEq)]", 0)
  push(p, `pub struct ${name} {`, 0, span)
  for (const [i, slot] of slots.entries()) push(p, `pub ${names[i]}: ${typeOf(p, slot.type)},`, 1)
  push(p, "}", 0)
  push(p, "", 0)
  push(p, `impl ${name} {`, 0)
  // `new` seeds the declared initial values.
  push(p, "pub fn new() -> Self {", 1)
  push(p, "Self {", 2)
  for (const [i, slot] of slots.entries()) push(p, `${names[i]}: ${initOf(p.layouts, slot.type, slot.init, true)},`, 3)
  push(p, "}", 2)
  push(p, "}", 1)
  members()
  push(p, "}", 0)
  push(p, "", 0)
  defaultImpl(p, name)
}
