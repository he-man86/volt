/** STATEMENTS AS RUST — a statement list, the dispatch over the IR's statement kinds, and assign, IF, CASE. */
import type { IrPou, IrStmt, Place } from "../../ir/index.js"
import { holdsCall } from "../../ir/walk.js"
import { stringKind, type Type } from "../../../frontend/types/index.js"
import { stmtCall } from "./calls.js"
import { expr, unparen, unparenHead } from "./expr.js"
import { stmtBreak, stmtContinue, stmtLoop } from "./loops.js"
import { tmp } from "./names.js"
import { place } from "./place.js"
import { guardLine, type Printer, push } from "./printer.js"
import { rustType } from "./types.js"
import { storeImage } from "./image.js"

export function block(p: Printer, list: readonly IrStmt[], slots: IrPou["slots"], indent: number): void {
  if (list.length === 0) {
    push(p, "// (empty)", indent)
    return
  }
  for (const s of list) stmt(p, s, slots, indent)
}

export function stmt(p: Printer, s: IrStmt, slots: IrPou["slots"], indent: number): void {
  switch (s.kind) {
    case "assign":
      return stmtAssign(p, s, slots, indent)
    case "if":
      return stmtIf(p, s, slots, indent)
    case "switch":
      return stmtSwitch(p, s, slots, indent)
    case "loop":
      return stmtLoop(p, s, slots, indent)
    case "break":
      return stmtBreak(p, s, slots, indent)
    case "continue":
      return stmtContinue(p, s, slots, indent)
    case "return":
      push(p, p.frame.result === undefined ? "return;" : `return ${p.frame.result};`, indent, s.span)
      return
    case "eval":
      push(p, `${expr(p, s.value, slots)};`, indent, s.span)
      return
    case "call":
      return stmtCall(p, s, slots, indent)
  }
}

/**
 * An assignment: the target's pointer checked on the line before (`guardLine`) — and ONE GUARD PER STATEMENT (lean 9.3):
 * a value with no call in it cannot change that pointer before it is read, so a read through the same pointer in the
 * value prints unchecked (`Printer.checked`). A call in the value may write the pointer, and its reads keep their check.
 */
function stmtAssign(p: Printer, s: Extract<IrStmt, { kind: "assign" }>, slots: IrPou["slots"], indent: number): void {
  guardLine(p, s.target, slots, indent)
  const outer = p.checked
  p.checked = s.target.guard !== undefined && !holdsCall(s.value) ? place(p, s.target.guard, slots) : undefined
  assignValue(p, s, slots, indent)
  p.checked = outer
}

function assignValue(p: Printer, s: Extract<IrStmt, { kind: "assign" }>, slots: IrPou["slots"], indent: number): void {
  // a store into the image moves the value's bytes (`image.ts`)
  if (s.target.root === "image") return push(p, storeImage(p, s.target, expr(p, s.value, slots), slots), indent, s.span)
  const field = place(p, s.target, slots)
  const bit = s.target.path.at(-1)
  if (bit?.kind !== "bit") {
    const value = expr(p, s.value, slots)
    // A STRING INTO A STRING OF ANOTHER CAPACITY IS A STORE INTO THE PLACE'S OWN BUFFER (model 2): `min(n, m)` units of
    // the source and a 0, the place's units behind them kept — `IecStr::store`, the interpreter's `storeString`;
    // `assignTo` hands the value over at its own capacity. Both capacities are the types' const generics, so a STRING
    // VAR_IN_OUT's generic one (`inoutType`) needs no name — which is why an in-out on either side stores too. At one
    // capacity the store writes every unit, so it IS the plain copy, and prints as one.
    if (stringKind(s.target.type) !== undefined && (!sameCapacity(s.value.type, s.target.type) || generic(s.target) || (s.value.kind === "load" && generic(s.value.place)))) {
      const bare = unparen(field)
      // a method call binds tighter than `*`: a dereferenced place is the receiver only in parentheses
      const receiver = bare.startsWith("*") ? `(${bare})` : bare
      push(p, `${receiver}.store(&${unparen(value)});`, indent, s.span)
      return
    }
    push(p, `${unparen(field)} = ${unparen(value)};`, indent, s.span)
    return
  }
  // a typed one — `1i16 << 15` is -32768, exactly the two's complement bit the IDE sets. The place is named once,
  // through one `&mut`: printed on both sides, an index holding a call ran that call twice (transpiler review
  // 2026-09-15). The value first, as a plain `place = value` evaluates it.
  const one = `(1${rustType(bit.of)} << ${bit.index})`
  // reserved prefix, for the reason the MOD expansion above spells out: `v` and `w` are ordinary IEC
  // identifiers, and a routine's parameters and VAR_TEMPs are Rust locals in the same scope as this block
  push(p,
    `{ let ${tmp("bit_v")} = ${expr(p, s.value, slots)}; let ${tmp("bit_w")} = &mut ${field}; *${tmp("bit_w")} = if ${tmp("bit_v")} { *${tmp("bit_w")} | ${one} } else { *${tmp("bit_w")} & !${one} }; }`,
    indent,
    s.span,
  )
  return
}

function stmtIf(p: Printer, s: Extract<IrStmt, { kind: "if" }>, slots: IrPou["slots"], indent: number): void {
  push(p, `if ${unparenHead(expr(p, s.cond, slots))} {`, indent, s.span)
  block(p, s.then, slots, indent + 1)
  if (s.else.length > 0) {
    push(p, "} else {", indent)
    block(p, s.else, slots, indent + 1)
  }
  push(p, "}", indent)
  return
}

function stmtSwitch(p: Printer, s: Extract<IrStmt, { kind: "switch" }>, slots: IrPou["slots"], indent: number): void {
  push(p, `match ${unparenHead(expr(p, s.selector, slots))} {`, indent, s.span)
  for (const arm of s.arms) {
    const pattern = arm.labels
      .map((l) => (l.lo === l.hi ? `${l.lo}` : `${l.lo}..=${l.hi}`))
      .join(" | ")
    push(p, `${pattern} => {`, indent + 1, arm.span)
    block(p, arm.body, slots, indent + 2)
    push(p, "}", indent + 1)
  }
  push(p, "_ => {", indent + 1)
  block(p, s.else, slots, indent + 2)
  push(p, "}", indent + 1)
  push(p, "}", indent)
  return
}

/** Two string types of one capacity. */
const sameCapacity = (a: Type, b: Type): boolean => a.kind === "elementary" && b.kind === "elementary" && a.length === b.length

/** A place whose Rust string type has a GENERIC capacity: a STRING VAR_IN_OUT (`inoutType`). */
const generic = (place: Place): boolean => place.root === "inout"
