/** LOOPS AS RUST — the one IR loop as a Rust `while` (a head test) or `loop` (a tail test, or none), and EXIT and CONTINUE as
 *  Rust's own `break` and `continue` — or breaks out of the loop's two labels where a body block needs them. */
import type { IrPou, IrStmt } from "../../ir/index.js"
import { loopUses } from "../../ir/walk.js"
import { head, negated, print } from "./expr.js"
import { tmp } from "./names.js"
import { type Printer, push } from "./printer.js"
import { block, stmt } from "./stmt.js"

export function stmtLoop(p: Printer, s: Extract<IrStmt, { kind: "loop" }>, slots: IrPou["slots"], indent: number): void {
  // ONE IR SHAPE, THE RUST AN ENGINEER WRITES (lean 5): a head test is `while cond { … }` (7.5.4) — never a `for` range:
  // a FOR to its counter's maximum wraps and runs until an EXIT (`for_counter_at_type_max`), which a range would end — a
  // constant TRUE one `loop`; a tail test (REPEAT) is `loop { …; if !cond { break; } }`.
  //
  // A CONTINUE must still step a FOR and test a REPEAT's UNTIL, as CODESYS runs them (conformance `continue_in_*`): a bare
  // Rust `continue` skipped both and looped forever (transpiler review 2026-09-14). So where a step or a tail test
  // follows the body, the body sits in a labeled block and CONTINUE leaves THAT block (`break 'body_N`); EXIT then names
  // the loop (`break 'loop_N`), since an unlabeled `break` may not sit in a labeled block. Anywhere else there is no body
  // block (7.5.2): EXIT is `break` and CONTINUE `continue` — a WHILE's `continue` returns to its head test (7.5.3). Which
  // the loop needs is asked of the IR before printing (`loopUses`): an unused label is a rustc warning.
  //
  // No pass counter: CODESYS caps no loop (`tr_27_loop_cap_*`), so the counter lines went with the cap (7.5.1) — a runaway
  // loop is its harness's to bound, and a harness's guard counts what the interpreter's does: one body entry, after the
  // head test.
  const uses = loopUses(s)
  const tail = s.test !== undefined && s.test.atEnd
  const labeled = uses.continues && (s.step.length > 0 || tail)
  const frame = { n: ++p.loopCount, labeled }
  for (const init of s.init) stmt(p, init, slots, indent)
  if (p.loopGuard !== undefined) push(p, `let mut ${tmp("guard", frame.n)}: u64 = 0;`, indent)
  const label = labeled && uses.exits ? `'loop_${frame.n}: ` : ""
  // `while c {}` with nothing in it to change `c` is clippy's `while_immutable_condition` (an empty WHILE, `stmt_while_empty_body`):
  // that one stays the test-and-break `loop` it was
  const empty = s.body.length === 0 && s.step.length === 0
  const always = s.test === undefined || tail || empty || (s.test.cond.kind === "const" && s.test.cond.value === true)
  push(p, always ? `${label}loop {` : `${label}while ${head(print(p, s.test!.cond, slots))} {`, indent, s.span)
  if (always && empty && !tail && s.test !== undefined) push(p, `if ${head(negated(p, s.test.cond, slots))} { break; }`, indent + 1)
  if (p.loopGuard !== undefined) {
    const guard = String(p.loopGuard).replace(/\B(?=(\d{3})+(?!\d))/g, "_")
    push(p, `${tmp("guard", frame.n)} += 1;`, indent + 1)
    push(p, `assert!(${tmp("guard", frame.n)} <= ${guard}, "harness loop guard");`, indent + 1)
  }
  p.loops.push(frame)
  // a body that ENDS in an EXIT, CONTINUE or RETURN before a step or a tail test keeps a plain block: printed bare, the
  // step after it is a statement rustc calls unreachable (`stmt_exit_inner`; 7.5.11 decides what is printed after one)
  const diverges = ["break", "continue", "return"].includes(s.body.at(-1)?.kind ?? "") && (s.step.length > 0 || tail)
  if (labeled || diverges) {
    push(p, `${labeled ? `'body_${frame.n}: ` : ""}{`, indent + 1)
    block(p, s.body, slots, indent + 2)
    push(p, "}", indent + 1)
  } else block(p, s.body, slots, indent + 1)
  p.loops.pop()
  for (const step of s.step) stmt(p, step, slots, indent + 1)
  // REPEAT … UNTIL FALSE keeps going for ever: its test is the constant TRUE, and `if false { break; }` says nothing (7.5.8)
  if (tail && !(s.test!.cond.kind === "const" && s.test!.cond.value === true)) push(p, `if ${head(negated(p, s.test!.cond, slots))} { break; }`, indent + 1)
  push(p, "}", indent)
  return
}

export function stmtBreak(p: Printer, s: Extract<IrStmt, { kind: "break" }>, slots: IrPou["slots"], indent: number): void {
  const frame = p.loops.at(-1)
  push(p, frame?.labeled === true ? `break 'loop_${frame.n};` : "break;", indent, s.span)
  return
}

export function stmtContinue(p: Printer, s: Extract<IrStmt, { kind: "continue" }>, slots: IrPou["slots"], indent: number): void {
  const frame = p.loops.at(-1)
  push(p, frame?.labeled === true ? `break 'body_${frame.n};` : "continue;", indent, s.span)
  return
}
