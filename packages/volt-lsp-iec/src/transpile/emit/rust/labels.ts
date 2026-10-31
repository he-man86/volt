/**
 * JUMPS AND LABELS AS RUST (openspec lower-jumps-and-labels). Rust has no goto, so a labeled body (`IrLabeled`) prints as
 * the dispatch an engineer writes for one — a loop over a `match` on the segment to run next:
 *
 *   let mut __segment_1: usize = 0;
 *   'jump_1: loop {
 *       match __segment_1 {
 *           0 => { …; __segment_1 = 1; }        // a segment that ends goes on to the next
 *           1 => { if c { __segment_1 = 0; continue 'jump_1; } …; __segment_1 = 2; }
 *           _ => { …; break; }                  // the last one leaves the body
 *       }
 *   }
 *
 * A JMP sets the segment and starts the loop over; at a segment's end it only sets the segment. A body of one segment (its
 * first statement the one label a JMP names) is the loop alone: `'jump_1: loop { …; break; }`, a JMP `continue 'jump_1;`.
 * A JMP to the label at the body's end leaves it: `break 'jump_1;` — and where no JMP goes anywhere else, nothing loops:
 * the body is a labeled block, `'jump_1: { … }`. A harness's loop guard counts the jumps into the body, as the
 * interpreter's does.
 */
import type { IrPou, IrStmt } from "../../ir/index.js"
import { diverges, divergesAll } from "../../ir/flow.js"
import { isPlace, someNode } from "../../ir/walk.js"
import { tmp } from "./names.js"
import { type Printer, push } from "./printer.js"
import { block } from "./stmt.js"

export function stmtLabeled(p: Printer, s: Extract<IrStmt, { kind: "labeled" }>, slots: IrPou["slots"], indent: number): void {
  const n = ++p.loopCount
  const single = s.segments.length === 1
  const end = s.segments.length
  const jumps = (list: readonly IrStmt[], test: (target: number) => boolean) => someNode(list, (x) => !isPlace(x) && x.kind === "jump" && test(x.target))
  const loops = jumps(s.segments.flatMap((g) => g.body), (t) => t < end)
  const outer = p.jumps
  p.jumps = { n, single, end, loops }
  const state = tmp("segment", n)
  if (p.loopGuard !== undefined && loops) push(p, `let mut ${tmp("guard", n)}: u64 = 0;`, indent)
  if (!single) push(p, `let mut ${state}: usize = 0;`, indent)
  // the label only where a JMP names it: one no `continue` or `break` names is rustc's `unused_labels`
  const named = s.segments.some((g) => {
    const last = tailJump(g.body)
    return jumps(last === undefined ? g.body : g.body.slice(0, last), () => true)
  })
  const label = named ? `'jump_${n}: ` : ""
  if (!loops) {
    // nothing jumps back: one segment, left at its end or by a jump to the label there
    if (named) push(p, `${label}{`, indent, s.span)
    segment(p, s.segments[0]!.body, undefined, slots, indent + (named ? 1 : 0))
    if (named) push(p, "}", indent)
    p.jumps = outer
    return
  }
  push(p, `${label}loop {`, indent, s.span)
  if (single) segment(p, s.segments[0]!.body, undefined, slots, indent + 1)
  else {
    push(p, `match ${state} {`, indent + 1)
    s.segments.forEach((g, k) => {
      const last = k === s.segments.length - 1
      push(p, `${last ? "_" : k} => {`, indent + 2)
      segment(p, g.body, last ? undefined : k + 1, slots, indent + 3)
      push(p, "}", indent + 2)
    })
    push(p, "}", indent + 1)
  }
  push(p, "}", indent)
  p.jumps = outer
}

/** A segment's statements, then where it goes on: the `next` segment, or out of the body (`undefined`). A JMP that is its
 *  last statement only sets the segment — the loop starts over at the bottom anyway. */
function segment(p: Printer, body: readonly IrStmt[], next: number | undefined, slots: IrPou["slots"], indent: number): void {
  const end = tailJump(body)
  if (end === undefined) {
    block(p, body, slots, indent)
    if (divergesAll(body)) return
    if (next === undefined) {
      if (p.jumps!.loops) push(p, "break;", indent)
    }
    else push(p, `${tmp("segment", p.jumps!.n)} = ${next};`, indent)
    return
  }
  if (end > 0) block(p, body.slice(0, end), slots, indent)
  jumpTo(p, body[end] as Extract<IrStmt, { kind: "jump" }>, indent, false)
}

/** Where a segment's last statement that runs is a JMP, its index: nothing after the first statement that diverges runs. */
function tailJump(body: readonly IrStmt[]): number | undefined {
  const end = body.findIndex(diverges)
  return end >= 0 && body[end]!.kind === "jump" ? end : undefined
}

/** `JMP l;`: the segment set, and the loop started over there — unless it stands last in its segment (`again` false); to
 *  the label at the body's end, the body left. */
export function jumpTo(p: Printer, s: Extract<IrStmt, { kind: "jump" }>, indent: number, again = true): void {
  const at = p.jumps
  if (at === undefined) throw new Error(`emit/rust: the JMP to ${s.label} stands in no labeled body`)
  if (s.target === at.end) {
    if (again) push(p, `break 'jump_${at.n};`, indent, s.span)
    else if (at.loops) push(p, "break;", indent, s.span)
    return
  }
  if (p.loopGuard !== undefined) {
    const guard = String(p.loopGuard).replace(/\B(?=(\d{3})+(?!\d))/g, "_")
    push(p, `${tmp("guard", at.n)} += 1;`, indent)
    push(p, `assert!(${tmp("guard", at.n)} <= ${guard}, "harness loop guard");`, indent)
  }
  if (!at.single) push(p, `${tmp("segment", at.n)} = ${s.target};`, indent, s.span)
  if (again) push(p, `continue 'jump_${at.n};`, indent, s.span)
}
