/** LOOPS AS RUST — the one IR loop as one Rust `loop`, and EXIT and CONTINUE as breaks out of its two labels. */
import type { IrPou, IrStmt } from "../../ir/index.js"
import { negated } from "./expr.js"
import { tmp } from "./names.js"
import { type Printer, push } from "./printer.js"
import { block, stmt } from "./stmt.js"

export function stmtLoop(p: Printer, s: Extract<IrStmt, { kind: "loop" }>, slots: IrPou["slots"], indent: number): void {
  // One IR shape → one Rust shape: `loop` with the test placed at the head or the tail. The body sits in a labeled
  // block, and an IR `continue` leaves THAT block, so the step and a tail test still run — as CODESYS runs them: a
  // CONTINUE in FOR still steps and in REPEAT still tests UNTIL (conformance `continue_in_*`). It printed a bare Rust
  // `continue`, which skipped both and looped forever (transpiler review 2026-09-14). EXIT names the loop, since an
  // unlabeled `break` may not sit directly in a labeled block.
  // No pass counter: CODESYS caps no loop (`tr_27_loop_cap_*`) — a runaway loop is its harness's to bound, and
  // a harness's guard counts what the interpreter's does: one body entry, after the head test.
  const frame = { n: ++p.loopCount, exits: false, continues: false }
  for (const init of s.init) stmt(p, init, slots, indent)
  if (p.loopGuard !== undefined) push(p, `let mut ${tmp("guard", frame.n)}: u64 = 0;`, indent)
  const loopLine = p.lines.length
  push(p, `'loop_${frame.n}: loop {`, indent, s.span)
  if (s.test !== undefined && !s.test.atEnd)
    push(p, `if ${negated(p, s.test.cond, slots)} { break; }`, indent + 1)
  if (p.loopGuard !== undefined) {
    const guard = String(p.loopGuard).replace(/\B(?=(\d{3})+(?!\d))/g, "_")
    push(p, `${tmp("guard", frame.n)} += 1;`, indent + 1)
    push(p, `assert!(${tmp("guard", frame.n)} <= ${guard}, "harness loop guard");`, indent + 1)
  }
  const bodyLine = p.lines.length
  push(p, `'body_${frame.n}: {`, indent + 1)
  p.loops.push(frame)
  block(p, s.body, slots, indent + 2)
  p.loops.pop()
  push(p, "}", indent + 1)
  if (!frame.exits) p.lines[loopLine] = p.lines[loopLine]!.replace(`'loop_${frame.n}: `, "")
  if (!frame.continues) p.lines[bodyLine] = p.lines[bodyLine]!.replace(`'body_${frame.n}: `, "")
  for (const step of s.step) stmt(p, step, slots, indent + 1)
  if (s.test !== undefined && s.test.atEnd)
    push(p, `if ${negated(p, s.test.cond, slots)} { break; }`, indent + 1)
  push(p, "}", indent)
  return
}

export function stmtBreak(p: Printer, s: Extract<IrStmt, { kind: "break" }>, slots: IrPou["slots"], indent: number): void {
  const frame = p.loops.at(-1)
  if (frame !== undefined) frame.exits = true
  push(p, frame === undefined ? "break;" : `break 'loop_${frame.n};`, indent, s.span)
  return
}

export function stmtContinue(p: Printer, s: Extract<IrStmt, { kind: "continue" }>, slots: IrPou["slots"], indent: number): void {
  const frame = p.loops.at(-1)
  if (frame !== undefined) frame.continues = true
  push(p, frame === undefined ? "continue;" : `break 'body_${frame.n};`, indent, s.span)
  return
}
