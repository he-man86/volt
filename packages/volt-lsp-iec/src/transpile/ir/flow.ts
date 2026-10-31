/** CONTROL FLOW OVER THE IR — the statement lists a statement holds, whether control comes out of the bottom of a
 *  statement, and which of its labels a loop uses: what a backend asks before it prints a block. */
import type { IrLabeled, IrLoop, IrStmt } from "./stmt.js"
import { isPlace, someNode } from "./walk.js"

/** Every statement list a statement holds directly: an IF's two branches, a CASE's arms and ELSE, a loop's init, body
 *  and step. */
export function blocksOf(s: IrStmt): readonly (readonly IrStmt[])[] {
  switch (s.kind) {
    case "if":
      return [s.then, s.else]
    case "switch":
      return [...s.arms.map((a) => a.body), s.else]
    case "loop":
      return [s.init, s.body, s.step]
    case "labeled":
      return s.segments.map((g) => g.body)
    default:
      return []
  }
}

/**
 * Does control never come out of the bottom of this statement — a RETURN, an EXIT or a CONTINUE, an IF whose both
 * branches end so, a CASE whose every arm and ELSE do, or a loop nothing leaves (no test, or the constant TRUE, and no
 * EXIT of its own: `cc4_loop_exit_constant`'s WHILE TRUE)? Whatever follows it in its block cannot run, and the printer
 * prints none of it (lean 7.5.11): Rust's `unreachable_code` was right about every such line, and the ST line is dead
 * either way (`stmt_return_midway`, `stmt_exit_inner` ask what it does — nothing).
 */
export function diverges(s: IrStmt): boolean {
  switch (s.kind) {
    case "return":
    case "break":
    case "continue":
    case "jump":
      return true
    case "if":
      return s.else.length > 0 && divergesAll(s.then) && divergesAll(s.else)
    case "switch":
      return s.else.length > 0 && s.arms.every((a) => divergesAll(a.body)) && divergesAll(s.else)
    // a jump leaves every loop it stands in: its label is the body's (`IrLabeled`)
    case "loop":
      return (s.test === undefined || (s.test.cond.kind === "const" && s.test.cond.value === true)) && !loopUses(s).exits && !someNode(s.body, (n) => !isPlace(n) && n.kind === "jump")
    // a labeled body is left by its last segment's bottom (every other goes on to the next) or a jump past its end
    case "labeled":
      return divergesAll(s.segments.at(-1)!.body) && !leaves(s)
    default:
      return false
  }
}

/** Does a statement list never come out of its bottom — does one of its statements diverge (`diverges`)? */
export function divergesAll(list: readonly IrStmt[]): boolean {
  return list.some(diverges)
}

/** Which of a loop's two labels its body uses: an EXIT (`exits`) or a CONTINUE (`continues`) of THIS loop — one inside
 *  a nested loop is that loop's. A label no statement names is a rustc warning. */
export function loopUses(loop: IrLoop): { exits: boolean; continues: boolean } {
  const uses = { exits: false, continues: false }
  const visit = (stmts: readonly IrStmt[]): void => {
    for (const s of stmts) {
      if (s.kind === "break") uses.exits = true
      else if (s.kind === "continue") uses.continues = true
      else if (s.kind !== "loop") for (const nested of blocksOf(s)) visit(nested)
    }
  }
  visit(loop.body)
  return uses
}

/** Does a jump in this labeled body leave it — name the label at its end, one past its last segment? */
export function leaves(s: IrLabeled): boolean {
  return someNode(s.segments.flatMap((g) => g.body), (n) => !isPlace(n) && n.kind === "jump" && n.target === s.segments.length)
}
