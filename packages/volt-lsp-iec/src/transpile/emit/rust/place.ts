/** A PLACE AS A RUST LVALUE — `self.inst.q`, `self.arr[(self.i as i64 - 1i64) as usize].x`, `(*v)` — and a PROGRAM's
 *  instance as a call runs it, moved out of `Programs`. */
import type { IrExpr, IrPou, Place } from "../../ir/index.js"
import { elementOf, isIntegral, type Type } from "../../../frontend/types/index.js"
import { castTo } from "./convert.js"
import { expr } from "./expr.js"
import { tmp } from "./names.js"
import type { Printer } from "./printer.js"

/** A place as a Rust lvalue — `self.inst.q`, `self.arr[(self.i as i64 - 1i64) as usize].x`, `(*v)`, `count` — without a final bit step. */
export function place(p: Printer, at: Place, slots: IrPou["slots"]): string {
  // an image place is no lvalue: it is read and written through `Mem` (`image.ts`), and a site that reached here missed that
  if (at.root === "image") throw new Error("emit: an image place printed as a Rust lvalue")
  // A BORROW NEEDS NO `*` WHEN A FIELD OR AN INDEX FOLLOWS — Rust auto-derefs through `.x` and `[i]`, so
  // `(*path).used` is `path.used` and `clippy::explicit_auto_deref` says so. It IS needed when the place is the
  // whole value (`*v = x`, `*v + 1`) and when a BIT step follows, which shifts the value itself.
  const through = at.path[0]?.kind === "field" || at.path[0]?.kind === "index"
  const deref = (name: string): string => (through ? name : `(*${name})`)
  let text =
    at.root === "inout"
      ? deref(p.frame.inoutNames[at.slot]!)
      : at.root === "lent"
        ? deref(tmp("lent", at.slot))
      : at.root === "local"
        ? p.frame.localNames[at.slot]!
        : at.root === "global"
          ? p.globals.access[at.slot]!
          : at.root === "this"
            ? "self"
            : `self.${p.fields[at.slot]}`
  let type: Type =
    at.root === "inout"
      ? p.frame.inoutSlots[at.slot]!.type
      : at.root === "lent"
        ? at.type
      : at.root === "local"
        ? p.frame.localSlots[at.slot]!.type
        : at.root === "global"
          ? p.globals.slots[at.slot]!.type
          : at.root === "this"
            ? p.frame.selfType!
            : slots[at.slot]!.type
  for (const step of at.path) {
    if (step.kind === "field") {
      const entry = type.kind === "struct" || type.kind === "function_block" ? p.layouts.get(type.name.toUpperCase()) : undefined
      const i = entry?.layout.fields.findIndex((f) => f.name.toUpperCase() === step.name.toUpperCase()) ?? -1
      if (entry === undefined || i < 0) throw new Error(`no field ${step.name} in ${type.kind}`)
      text += `.${entry.fields[i]}`
      type = entry.layout.fields[i]!.type
    } else if (step.kind === "index") {
      // WIDENED TO i64 ONLY WHEN IT IS NOT ONE. An index is usually already `i64` after lowering, and the
      // unconditional `as i64` printed `(0i64 as i64) as usize` — a cast to its own type inside parentheses
      // neither rustc nor clippy has any use for.
      // a constant index is already its element's position (`lower/values/fold.ts` `foldedPlace`, 7.2.3): `[3]`
      // (inside the array only: an index outside it keeps its run-time check, as a constant one rustc would refuse to build)
      const at = step.index.kind === "const" && typeof step.index.value === "bigint" ? step.index.value : undefined
      if (at !== undefined && step.lower === 0n && step.length !== undefined && at >= 0n && at < BigInt(step.length)) {
        text += `[${at}]`
        type = elementOf(type)!
        continue
      }
      // AN INDEX MINUS ITS LOWER BOUND PRINTS ONE WAY (7.2.3): an `ARRAY[*]` dimension's offset is the IR's LINT `sub` of
      // two values widened from 32 bits or fewer, which cannot overflow — so the plain `-` a declared bound prints, not
      // the `wrapping_sub` a LINT subtraction prints elsewhere
      const offset = step.index
      if (step.lower === 0n && offset.kind === "binary" && offset.op === "sub" && widenedNarrow(offset.left) && widenedNarrow(offset.right)) {
        text += `[(${expr(p, offset.left, slots)} - ${expr(p, offset.right, slots)}) as usize]`
        type = elementOf(type)!
        continue
      }
      const index = castTo(expr(p, step.index, slots), step.index.type, "i64")
      // NOT `unparen`ed, and that is the whole point: `as` binds TIGHTER than the arithmetic operators, so
      // stripping the printer's parentheses off `(self.li / 2i64)` leaves `self.li / 2i64 as usize`, which Rust
      // reads as `self.li / (2i64 as usize)` — E0277, `cannot divide i64 by usize`. `arr[li / 2]` is the reaching
      // case and no fixture has one, so the suite stayed green over an emission that does not compile.
      // a negative offset wraps to a huge usize, so an index below the lower bound panics like one above the upper
      text += step.lower === 0n ? `[${index} as usize]` : `[(${index} - ${step.lower}i64) as usize]`
      type = elementOf(type)!
    }
  }
  return text
}

/** An integer of 32 bits or fewer widened to a LINT — two of them subtract without overflow. */
const widenedNarrow = (e: IrExpr): boolean => e.kind === "convert" && isIntegral(e.value.type) && e.value.type.kind === "elementary" && e.value.type.elem.bits <= 32

/** The PROGRAM's own place and the member path under it — a call runs it moved out of `Programs` and puts it back.
 *  It used to return the program's TYPE as well, for `std::mem::replace(&mut p, T::new())`; `mem::take` needs no
 *  stand-in to swap in, so the type went with it. `take` is why the `Default` impl is not optional. */
export function movedOut(p: Printer, at: Place, slots: IrPou["slots"]): { program: string; member: string } {
  const program = place(p, { ...at, path: [] }, slots)
  return { program, member: place(p, at, slots).slice(program.length) }
}
