/**
 * A ROUTINE'S RESULT AS ITS TAIL EXPRESSION (lean 7.7.3): `pub fn f(a: i16) -> i16 { a.wrapping_mul(2i16) }`, and
 * `if c { b.wrapping_sub(32u8) } else { b }` where every branch of a final IF stores it — not `let mut f: i16 = 0i16;
 * f = …; f`, nor (clippy's `needless_late_init`) `let f; if c { f = … } else { f = … } f`.
 */
import type { IrExpr, IrRoutine, IrStmt } from "../../ir/index.js"
import { diverges, type IrNode, isPlace, someNode, somePlace } from "../../ir/walk.js"
import { stringKind } from "../../../frontend/types/index.js"
import type { Span } from "../../../frontend/syntax/index.js"
import { closingBrace, head, print } from "./expr.js"
import { at, Prec } from "./precedence.js"
import { type Printer, push } from "./printer.js"
import { block } from "./stmt.js"

/** What a body ends in that yields the result: the value of a store of it, or an IF each branch of which ends so. */
type Yield =
  | { readonly kind: "value"; readonly value: IrExpr; readonly span: Span }
  | { readonly kind: "if"; readonly cond: IrExpr; readonly then: Tail; readonly else: Tail; readonly span: Span }

/** A block that yields the result: its statements, then what yields it. */
export interface Tail {
  readonly before: readonly IrStmt[]
  readonly yields: Yield
}

/**
 * The body as a tail, or undefined where the result stays a local. Only where nothing could tell: the body — up to a
 * RETURN that ends it, which `fnBody` leaves out — ends in a store of the whole result, or in an IF with an ELSE every
 * branch of which ends so, to any depth; the result is named nowhere else (no read of it, no other store) and no RETURN
 * hands it back early; and each store is a plain one (a STRING of another capacity is stored INTO the result's
 * buffer, `IecStr::store`).
 */
export function resultTail(routine: IrRoutine): Tail | undefined {
  const result = routine.result
  if (result === undefined) return undefined
  const end = routine.body.findIndex(diverges)
  const body = end >= 0 && routine.body[end]!.kind === "return" ? routine.body.slice(0, end) : routine.body
  if (someNode(body, (n) => !isPlace(n) && n.kind === "return")) return undefined
  const type = routine.locals[result]!.type
  const named = (n: IrNode | readonly IrNode[]): boolean => somePlace(n, (at) => at.root === "local" && at.slot === result)
  const tail = (list: readonly IrStmt[]): Tail | undefined => {
    const last = list.at(-1)
    const before = list.slice(0, -1)
    if (last === undefined || named(before)) return undefined
    if (last.kind === "assign" && last.target.root === "local" && last.target.slot === result && last.target.path.length === 0) {
      const plain = stringKind(type) === undefined || (last.value.type.kind === "elementary" && type.kind === "elementary" && last.value.type.length === type.length)
      return plain && !named(last.value) ? { before, yields: { kind: "value", value: last.value, span: last.span } } : undefined
    }
    if (last.kind !== "if" || last.else.length === 0 || named(last.cond)) return undefined
    const [then, otherwise] = [tail(last.then), tail(last.else)]
    return then === undefined || otherwise === undefined ? undefined : { before, yields: { kind: "if", cond: last.cond, then, else: otherwise, span: last.span } }
  }
  return tail(body)
}

/** A tail printed: its statements, then the expression it yields — an IF of them as `if … { … } else { … }`. */
export function printTail(p: Printer, tail: Tail, slots: Parameters<typeof block>[2], indent: number): void {
  if (tail.before.length > 0) block(p, tail.before, slots, indent)
  printYield(p, tail.yields, slots, indent, "if")
}

function printYield(p: Printer, y: Yield, slots: Parameters<typeof block>[2], indent: number, opener: string): void {
  if (y.kind === "value") {
    // a tail that opens with a brace and goes on after it would be read as a block statement and a stray operator
    // (`{ iec_deref(p); … } == 0u8`): parenthesized; one that is the block alone is the block
    const value = print(p, y.value, slots)
    const opens = value.text.startsWith("{") && closingBrace(value.text) < value.text.length - 1
    return push(p, opens ? head(value) : at(value, Prec.Block), indent, y.span)
  }
  push(p, `${opener} ${head(print(p, y.cond, slots))} {`, indent, y.span)
  printTail(p, y.then, slots, indent + 1)
  // an ELSE that is one more IF is its `else if` (7.5.5)
  if (y.else.before.length === 0 && y.else.yields.kind === "if") return printYield(p, y.else.yields, slots, indent, "} else if")
  push(p, "} else {", indent)
  printTail(p, y.else, slots, indent + 1)
  push(p, "}", indent)
}
