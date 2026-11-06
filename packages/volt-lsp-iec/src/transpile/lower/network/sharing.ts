/**
 * THE VALUE AN ASSIGN'S JUMPS SHARE (`ASSIGN(v, Q => x, Q => JMP.l, Q => y)`): the statement before a jump or a return on
 * its value holds that value, and a jump between the coils is taken in its place in the list, so the coils after it are not
 * written when it is (live CODESYS 3.5.21.40, assign-states#0490-0495). Shared by the lowering and the exec twin.
 */
import type { Statement } from "../../../frontend/syntax/index.js"

type Control = Extract<Statement, { kind: "jmp" | "return" }>

/** `sharing`: the statements whose value a jump or a return after them shares; `between`: an ASSIGN's jumps and returns
 *  that stand between its coils, by the ASSIGN, and `placed` the same jumps, written there and not where they stand. */
export function sharedValues(code: readonly Statement[]): { sharing: Set<Statement>; between: Map<Statement, Control[]>; placed: Set<Statement> } {
  const sharing = new Set<Statement>()
  const between = new Map<Statement, Control[]>()
  const shares = (s: Statement | undefined): s is Control => (s?.kind === "jmp" || s?.kind === "return") && s.sharesValue === true
  code.forEach((s, i) => {
    if (shares(code[i + 1]) && !shares(s)) sharing.add(s)
    if (s.kind !== "assign") return
    const coils = 1 + (s.chained?.length ?? 0)
    const inside: Control[] = []
    for (const c of code.slice(i + 1)) {
      if (!shares(c)) break
      if (c.coilsBefore !== undefined && c.coilsBefore < coils) inside.push(c)
    }
    if (inside.length > 0) between.set(s, inside)
  })
  return { sharing, between, placed: new Set([...between.values()].flat()) }
}
