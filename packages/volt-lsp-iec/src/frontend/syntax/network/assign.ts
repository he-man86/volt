/**
 * THE STATEMENTS OF A PLAIN-ST NETWORK BODY (openspec network-language; `plain-st.ts` reads the body's tokens): every coil,
 * jump and return is an `ASSIGN` call — its value first, then its targets, each an output whose name carries its mark
 * (`Q`, `Q_SET`, `Q_RESET`, `Q_INVERTED`). Standing as a statement it is the ST assignment of its coils (`Assignment`, the
 * targets in list order) and the jump or return on the same value; in a tree an inline assignment per target
 * (`AssignExpr`, the first target innermost), handing its value on. A mark on a value is the call `INVERT(a)` (read as the
 * ST `NOT a`, bitwise on an integer), `RISING(a)`, `FALLING(a)`.
 */
import type { CallArg, CallExpr, Expr, Statement, StatementList } from "../ast/nodes/index.js"
import { stmtExprs, walkExpr } from "../ast/walk.js"
import type { Span } from "../span.js"

/** The coil, the jump and the return: `ASSIGN(value, Q => target, …)`. */
export const ASSIGN = "ASSIGN"
/** A mark on a value: `INVERT(a)`. */
export const INVERT = "INVERT"

/** ASSIGN's outputs, each a target's mark: the coil, the set coil, the reset coil, the negated coil. */
const ASSIGN_OUTPUTS: Readonly<Record<string, { op?: "S=" | "R="; marks?: readonly string[] }>> = {
  Q: {}, Q_SET: { op: "S=" }, Q_RESET: { op: "R=" }, Q_INVERTED: { marks: ["NOT"] },
}

type Control = { jump: true; label: Expr } | { jump: false }

/** A jump target `JMP.l` (its label) or the return `RETURN` (no label) as the ST parser reads it; undefined for a coil. */
function controlTarget(e: Expr): Control | undefined {
  if (e.kind === "member" && e.base.kind === "ident_expr" && e.base.name.toUpperCase() === "JMP") return { jump: true, label: e.member }
  if (e.kind === "ident_expr" && e.name.toUpperCase() === "RETURN") return { jump: false }
  return undefined
}

const isHead = (call: CallExpr, word: string): boolean => call.callee.kind === "ident_expr" && call.callee.name.toUpperCase() === word

/** One target of an ASSIGN: its expression, its operator and mark, and the jump or return it is. */
interface AssignTarget {
  expr: Expr
  op?: "S=" | "R="
  marks?: readonly string[]
  control?: Control
}

/**
 * WHAT IS WRONG WITH AN ASSIGN'S FORM, in the bridge reader's words, or undefined where it is `ASSIGN(value, Q => t, …)`:
 * its value first, positional; then one target or more, each `Q`, `Q_SET`, `Q_RESET` or `Q_INVERTED`; a jump or the
 * return neither set nor reset.
 */
export function assignFormFinding(call: CallExpr): string | undefined {
  const [value, ...targets] = call.args
  if (value === undefined || value.output || value.param !== undefined || value.value === undefined || targets.length === 0 || targets.some((t) => !t.output))
    return "ASSIGN takes its value, positional, then one target or more, ASSIGN(value, Q => y)"
  for (const t of targets) {
    const name = t.param?.name.toUpperCase()
    if (name === undefined || ASSIGN_OUTPUTS[name] === undefined)
      return `${t.param?.name ?? ""} => on an ASSIGN: its outputs are Q, Q_INVERTED, Q_SET and Q_RESET; an edge is on the value, RISING(a)`
    if (t.value === undefined) return "ASSIGN takes its value, positional, then one target or more, ASSIGN(value, Q => y)"
    const c = controlTarget(t.value)
    if (c !== undefined && ASSIGN_OUTPUTS[name]!.op !== undefined)
      return `${t.param!.name} => ${c.jump ? "JMP" : "RETURN"}: a jump or a return is no set or reset coil`
  }
  return undefined
}

/** An ASSIGN call's value and targets, where its form is one (`assignFormFinding`). */
function assignParts(call: CallExpr): { value: Expr; targets: AssignTarget[] } | undefined {
  if (!isHead(call, ASSIGN) || assignFormFinding(call) !== undefined) return undefined
  const [value, ...rest] = call.args
  const targets = rest.map((arg): AssignTarget => {
    const out = ASSIGN_OUTPUTS[arg.param!.name.toUpperCase()]!
    const control = controlTarget(arg.value!)
    return { expr: arg.value!, ...(out.op !== undefined ? { op: out.op } : {}), ...(out.marks !== undefined ? { marks: out.marks } : {}), ...(control !== undefined ? { control } : {}) }
  })
  return { value: value!.value!, targets }
}

/** `INVERT(a)`'s one value, where its form is one: one value, positional. */
function invertOperand(call: CallExpr): Expr | undefined {
  if (!isHead(call, INVERT) || call.args.length !== 1) return undefined
  const [a] = call.args
  return a!.output || a!.param !== undefined ? undefined : a!.value
}

/** The jump or the return as the call it is in a tree (`JMP(l, v)`, `RETURN(v)`), its value handed on. */
function controlCall(c: Control, at: Span, value: Expr, span: Span, extra: Pick<CallExpr, "marks" | "assignHead">): CallExpr {
  const callee: Expr = { kind: "ident_expr", name: c.jump ? "JMP" : "RETURN", span: at }
  const args: CallArg[] = c.jump ? [{ kind: "call_arg", output: false, value: c.label, span: c.label.span }] : []
  args.push({ kind: "call_arg", output: false, value, span: value.span })
  return { kind: "call", callee, args, span, ...extra }
}

/** In place: `node` becomes `other` (the parse is this body's own, made here). */
function become(node: Expr, other: Expr): void {
  const n = node as unknown as Record<string, unknown>
  for (const k of Object.keys(n)) delete n[k]
  Object.assign(n, other)
}

/** Every INVERT and ASSIGN in `e`'s tree read as what it is, the innermost first: `INVERT(a)` the ST `NOT a`; an ASSIGN its
 *  inline assignments, the first target innermost, a jump or the return the call handing its value on. */
function desugar(e: Expr): void {
  const calls: CallExpr[] = []
  walkExpr(e, (x) => {
    if (x.kind === "call") calls.push(x)
  })
  for (const call of calls.reverse()) {
    const operand = invertOperand(call)
    if (operand !== undefined) {
      become(call, { kind: "unary", op: "NOT", operand, span: call.span })
      continue
    }
    const parts = assignParts(call)
    if (parts === undefined) continue
    const head = call.callee.span
    // the coils written first, then the jump or the return taken: in a tree as standing (`assignStatements`)
    const ordered = [...parts.targets.filter((t) => t.control === undefined), ...parts.targets.filter((t) => t.control !== undefined)]
    const tree = ordered.reduce<Expr>((value, t) => {
      const marks = t.marks !== undefined ? { marks: t.marks } : {}
      if (t.control !== undefined) return controlCall(t.control, t.expr.span, value, call.span, { assignHead: head, ...marks })
      return { kind: "assign_expr", target: t.expr, value, span: call.span, assignHead: head, ...(t.op !== undefined ? { op: t.op } : {}), ...marks }
    }, parts.value)
    become(call, tree)
  }
}

/** A statement-level ASSIGN as the ST it is: the assignment of its coils (in list order, each its own operator and mark),
 *  then each jump or return on the same value, in list order — a jump stored between coils taken after them all, as the
 *  lowering has always run a target list. */
function assignStatements(call: CallExpr, parts: { value: Expr; targets: AssignTarget[] }): Statement[] {
  const head = call.callee.span
  const coils = parts.targets.filter((t) => t.control === undefined)
  const controls = parts.targets.filter((t) => t.control !== undefined)
  const out: Statement[] = []
  if (coils.length > 0) {
    const [first, ...rest] = coils
    const marks = coils.map((c) => c.marks)
    out.push({
      kind: "assign", target: first!.expr, value: parts.value, span: call.span, assignHead: head,
      ...(first!.op !== undefined ? { op: first!.op } : {}),
      ...(rest.length > 0 ? { chained: rest.map((c) => c.expr), chainOps: rest.map((c) => c.op) } : {}),
      ...(marks.some((m) => m !== undefined) ? { marks } : {}),
    })
  }
  controls.forEach((t, i) => {
    const c = t.control!
    const value = out.length > 0 || i > 0 ? { sharesValue: true as const } : { value: parts.value }
    const own = { assignHead: head, ...(t.marks !== undefined ? { marks: t.marks } : {}) }
    out.push(c.jump ? { kind: "jmp", target: c.label, ...value, ...own, span: t.expr.span } : { kind: "return", ...value, ...own, span: t.expr.span })
  })
  return out
}

/**
 * A NETWORK'S STATEMENTS AS THE ST THEY ARE (the module comment): each ASSIGN and INVERT read as what it is. A jump or the
 * return written as an assignment's target — the retired form, `JMP.l := v;`, which the network check names — is read as
 * the jump or return it says, so nothing cascades from it.
 */
export function networkStatements(list: StatementList): StatementList {
  return list.flatMap((s): Statement[] => {
    if (s.kind === "call_stmt") {
      const parts = assignParts(s.call)
      if (parts !== undefined) {
        desugar(parts.value)
        for (const t of parts.targets) desugar(t.expr)
        return assignStatements(s.call, parts)
      }
    }
    for (const e of stmtExprs(s)) desugar(e)
    // a mark standing alone (`INVERT(b);`) is a value standing alone, no call
    if (s.kind === "call_stmt" && (s.call as Expr).kind !== "call") return [{ kind: "expr_stmt", expr: s.call as Expr, span: s.span }]
    for (const e of stmtExprs(s))
      walkExpr(e, (x) => {
        const c = x.kind === "assign_expr" && x.assignHead === undefined ? controlTarget(x.target) : undefined
        if (x.kind === "assign_expr" && c !== undefined) become(x, controlCall(c, x.target.span, x.value, x.span, {}))
      })
    if (s.kind !== "assign") return [s]
    const targets = [s.target, ...(s.chained ?? [])]
    const ops = [s.op, ...(s.chainOps ?? [])]
    const controls = targets.filter((t) => controlTarget(t) !== undefined)
    if (controls.length === 0) return [s]
    const coils = targets.map((t, i) => ({ t, op: ops[i] })).filter((x) => controlTarget(x.t) === undefined)
    const out: Statement[] = []
    if (coils.length > 0) {
      const [first, ...rest] = coils
      out.push({
        kind: "assign", target: first!.t, value: s.value, span: s.span,
        ...(first!.op !== undefined && first!.op !== "REF=" ? { op: first!.op } : {}),
        ...(rest.length > 0 ? { chained: rest.map((c) => c.t), chainOps: rest.map((c) => c.op) } : {}),
      })
    }
    controls.forEach((t, i) => {
      const c = controlTarget(t)!
      const value = out.length > 0 || i > 0 ? { sharesValue: true as const } : { value: s.value }
      out.push(c.jump ? { kind: "jmp", target: c.label, ...value, span: t.span } : { kind: "return", ...value, span: t.span })
    })
    return out
  })
}

