/**
 * THE RETIRED FORMS OF A NETWORK'S STATEMENTS (openspec network-language, "What changes in today's text"): every coil, jump
 * and return is an `ASSIGN` (`plain-st.ts` reads one as the ST it is). What the text writes the retired way is no network
 * text, refused naming its ASSIGN in the bridge reader's words — by the network check while typing and by the lowering,
 * which runs no text the push refuses: a coil as an ST assignment (`y := a;`, `y S= a;`; a wire's definition `w1 := a;`,
 * also inline `(w1 := a)`, is no coil), a jump or the return as an assignment's target (`JMP.l := a;`, `RETURN := a;`), a
 * coil inside a value (`(y := a) AND b`), a member closing an ASSIGN.
 */
import type { Expr, Statement } from "../ast/nodes/index.js"
import { stmtExprs, walkExpr } from "../ast/walk.js"
import type { Span } from "../span.js"
import { CONTROL_FORM } from "./receivers.js"

/** The form of a coil an earlier text wrote with an assignment operator, named (the bridge's reader's words). */
function coilForm(op: string | undefined): string {
  if (op === "S=") return "y S= value is no network text: a set coil is ASSIGN(value, Q_SET => y)"
  if (op === "R=") return "y R= value is no network text: a reset coil is ASSIGN(value, Q_RESET => y)"
  return "y := value is no network text: a coil is ASSIGN(value, Q => y), and only a wire is assigned, w1 := value"
}

/** Each retired form in `stmt` (its network's wires named by `wires`, lower-cased): where it stands and its ASSIGN. */
export function retiredForms(stmt: Statement, wires: ReadonlySet<string>): { span: Span; message: string }[] {
  const out: { span: Span; message: string }[] = []
  const isWire = (e: Expr) => e.kind === "ident_expr" && wires.has(e.name.toLowerCase())
  if (stmt.kind === "assign" && stmt.assignHead === undefined && !(stmt.chained === undefined && stmt.op === undefined && isWire(stmt.target)))
    out.push({ span: stmt.span, message: coilForm(stmt.op === "REF=" ? undefined : stmt.op) })
  if ((stmt.kind === "jmp" || stmt.kind === "return") && stmt.assignHead === undefined && (stmt.value !== undefined || stmt.sharesValue === true))
    out.push({ span: stmt.span, message: CONTROL_FORM })
  for (const e of stmtExprs(stmt))
    walkExpr(e, (x) => {
      // a wire defined where it is first read, `(w1 := value)`, is a wire's definition
      const inlineWire = x.kind === "assign_expr" && x.op === undefined && isWire(x.target) && (x.value.kind !== "assign_expr" || x.value.assignHead !== undefined)
      if (x.kind === "assign_expr" && x.assignHead === undefined && !inlineWire)
        out.push({ span: x.span, message: "(y := value) is no network text: a coil inside a value is ASSIGN(value, Q => y)" })
      // a jump or the return written in a tree the retired way, read as its call (`plain-st.ts`)
      if (x.kind === "call" && x.assignHead === undefined && x.callee.kind === "ident_expr" && ["JMP", "RETURN"].includes(x.callee.name.toUpperCase()))
        out.push({ span: x.span, message: CONTROL_FORM })
      if (x.kind === "member" && (x.base.kind === "assign_expr" || (x.base.kind === "call" && x.base.assignHead !== undefined)))
        out.push({ span: x.span, message: `ASSIGN(…).${x.member.name}: an ASSIGN hands its value on, and names no output` })
    })
  return out
}
