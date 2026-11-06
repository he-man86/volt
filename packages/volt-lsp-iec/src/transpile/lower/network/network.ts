/**
 * A PLAIN-ST NETWORK BODY AS THE ST STATEMENTS IT RUNS AS (openspec network-text-lowering, network-language "What it runs
 * as"): every box by its rule (`boxes.ts`), the network's own elements here —
 *
 *   `EXECUTE(EN := e, '<ST>')`               `IF e THEN <its ST> END_IF`; read where it stands, its ENO, which is its EN;
 *   `BRANCH(FEED := f, b1, b2)`              `f AND (b1 OR b2)`; `BRANCH_SHORTCIRCUIT` runs a branch holding a box, with
 *                                            the calls it reads, unless the feed and a box-free branch are both TRUE;
 *   `RISING(x)`, `FALLING(x)`, `INVERT(x)`   an `R_TRIG` / `F_TRIG` called where its tree is evaluated, read by Q; `NOT x`
 *                                            (bitwise on an integer); stacked, innermost first. `RAIL()` is `TRUE`;
 *   `ASSIGN(v, Q => x, Q_SET => y)`          every target receives v in list order, each its own mark (`Q_RESET` the reset,
 *                                            `Q_INVERTED` NOT v); in a tree v held in a temp, written, handed on;
 *   `Q => JMP.l`, `Q => RETURN`              `IF v THEN JMP l; END_IF` / `IF v THEN RETURN; END_IF` (`Q_INVERTED`: on NOT v),
 *                                            in its place in the ASSIGN's list (`sharing.ts`); in a tree, where it is evaluated;
 *   a value standing alone                   a box runs, what it hands on read by nothing; anything else runs nothing;
 *   a wire                                   a variable of its definition's type kept across scans — read before its
 *                                            definition, the previous scan's value (`nt_wire_read_before_definition_scan*`);
 *   a `%DISABLED` network                    nothing: CODESYS compiles none of it.
 *
 * The hidden state (wires, temps, edge detectors) is named `__nw<N>_<wire>`, `__nw<N>_eno<k>`, `__nw<N>_trig<k>` (`<N>` the
 * network's 1-based index in the body) behind `prefix`; the lowering declares it (`state.ts`). Text the network check
 * refuses (a mark word, a retired form) and a box no rule writes are refused by name (`NetworkRefusal`).
 */
import { type BodySpan, type CallExpr, emptyPinMessage, type Expr, plainStText, type PlainStNetwork, retiredForms, type Span, type Statement, stmtExprs, walkExpr } from "../../../frontend/syntax/index.js"
import { lookup, type Scope } from "../../../frontend/symbols/index.js"
import { boxMember, elementaryRef, inferExprType, rootBox, type Type } from "../../../frontend/types/index.js"
import { assign, binary, bool, call, ident, ifThen, member, NetworkRefusal, not } from "./ast.js"
import { BoxLowerer, coilWrite, COMPARISON, isInfix } from "./boxes.js"
import { guardedCalls, guardedReadBy } from "./guarded.js"
import { sharedValues } from "./sharing.js"

/** A variable the lowered network keeps: a wire or a temp (`type`), or an edge detector (`fb`). */
export type HiddenVar = { name: string; span: Span } & ({ type: Type } | { fb: "R_TRIG" | "F_TRIG" })

export interface LoweredNetworks {
  statements: Statement[]
  hidden: HiddenVar[]
}

/** The ST statements `statements` (the body's, as compiled) run as, and the variables they keep. */
export function lowerNetworks(body: BodySpan, statements: readonly Statement[], scope: Scope, project: Scope, prefix: string): LoweredNetworks {
  const text = plainStText(body)
  // text that is no network text (a mark word, a `%` key the form does not have) runs as nothing the push writes
  const [stray] = text.stray
  if (stray !== undefined) throw new NetworkRefusal(stray.message, undefined, stray.span)
  const executes = text.networks.flatMap((n) => n.executes)
  const code = statements.filter((s) => !executes.some((x) => s.span.start >= x.code.start && s.span.start < x.code.end))
  const wires = new Set(text.networks.flatMap((n) => n.wires.map((w) => w.name.toLowerCase())))
  // a retired form is no network text; a pin with no value is none either
  for (const s of code) {
    const [retired] = retiredForms(s, wires)
    if (retired !== undefined) throw new NetworkRefusal(retired.message, undefined, retired.span)
    for (const e of stmtExprs(s))
      walkExpr(e, (x) => {
        const empty = x.kind === "call" ? x.args.map(emptyPinMessage).find((m) => m !== undefined) : undefined
        if (empty !== undefined) throw new NetworkRefusal(empty)
      })
  }
  const n = new Networker(body, scope, project, prefix, statements, code)
  const out: Statement[] = []
  for (const s of code) {
    if (n.guarded.has(s)) continue // lowered inside its short-circuit branch's guard
    n.enter(s.span)
    out.push(...n.statement(s))
  }
  return { statements: out, hidden: n.hidden() }
}

class Networker extends BoxLowerer {
  /** Each network's wires, lower-case name → hidden name, by network index. */
  private readonly wires = new Map<number, Map<string, string>>()
  private readonly temps: HiddenVar[] = []
  private readonly counts = new Map<number, { eno: number; trig: number }>()
  private network: PlainStNetwork | undefined
  readonly guarded: Set<Statement>
  /** The temp the value a jump or a return shares is held in (`plan`, `sharing.ts`). */
  private shared: Expr | undefined
  private readonly guardedByWire: ReadonlyMap<string, Statement>

  constructor(
    body: BodySpan,
    scope: Scope,
    project: Scope,
    private readonly prefix: string,
    private readonly all: readonly Statement[],
    code: readonly Statement[],
    private readonly plan = sharedValues(code),
  ) {
    super(body, scope, project)
    const names = new Set<string>()
    for (const net of plainStText(body).networks) {
      const own = new Map<string, string>()
      for (const w of net.wires) own.set(w.name.toLowerCase(), `${this.at(net)}${w.name}`)
      for (const w of net.wires) names.add(w.name.toLowerCase())
      this.wires.set(net.index, own)
    }
    this.guardedByWire = guardedCalls(code, names)
    this.guarded = new Set(this.guardedByWire.values())
  }

  /** The hidden names' stem of `net`: `__nw<N>_` behind the prefix. */
  private at(net: PlainStNetwork): string {
    return `${this.prefix}${net.index + 1}_`
  }

  /** The network the statement at `span` stands in. */
  enter(span: Span): void {
    this.network = plainStText(this.body).networks.find((n) => span.start >= n.span.start && span.start < n.span.end)
    if (this.network === undefined) throw new NetworkRefusal(`the statement ${this.text(span)} stands in no network`)
  }

  /** Every variable the lowered body keeps: its wires, each of its definition's type, its temps and edge detectors. */
  hidden(): HiddenVar[] {
    const out: HiddenVar[] = []
    for (const net of plainStText(this.body).networks)
      for (const w of net.wires) {
        const type = inferExprType({ kind: "ident_expr", name: w.name.toLowerCase(), span: w.span }, this.scope, this.project)
        if (type.kind === "unknown") throw new NetworkRefusal(`the wire ${w.name.toLowerCase()} has no type lowering can declare`, undefined, w.span)
        out.push({ name: this.wires.get(net.index)!.get(w.name.toLowerCase())!, span: w.span, type })
      }
    return [...out, ...this.temps]
  }

  private count(): { eno: number; trig: number } {
    const index = this.network!.index
    let c = this.counts.get(index)
    if (c === undefined) this.counts.set(index, (c = { eno: 0, trig: 0 }))
    return c
  }

  protected temp(span: Span): Expr {
    return this.typedTemp(span, elementaryRef("BOOL"))
  }

  protected typedTemp(span: Span, type: Type): Expr {
    const name = `${this.at(this.network!)}eno${++this.count().eno}`
    this.temps.push({ name, span, type })
    return ident(name, span)
  }

  /** A temp of `value`'s type (`e` the expression it was lowered from). */
  private valueTemp(e: Expr, span: Span): Expr {
    const type = inferExprType(e, this.scope, this.project)
    if (type.kind === "unknown") throw new NetworkRefusal(`the value of ${this.text(e.span)} has no type lowering can declare`)
    return this.typedTemp(span, type)
  }

  statement(s: Statement): Statement[] {
    const pre: Statement[] = []
    switch (s.kind) {
      case "assign": {
        const targets = [s.target, ...(s.chained ?? [])]
        const ops = [s.op, ...(s.chainOps ?? [])]
        const marked = s.marks?.some((m) => m !== undefined) === true
        // an enabled box other than a comparison read by its value, the assignment's whole value: the assignment runs only
        // when enabled, and its targets hold when disabled (1.4)
        const read = s.value.kind === "member" && s.value.base.kind === "call" ? boxMember(s.value, this.scope, this.project) : undefined
        const box = read !== undefined && !read.eno && read.name.toUpperCase() === "OUT" ? read.box : undefined
        if (box !== undefined && box.instance === undefined && box.enable !== undefined && !COMPARISON.has(this.name(box).toUpperCase())) {
          this.refuseMisleading(box, { consumed: true, member: read!.name })
          if (marked || this.plan.sharing.has(s)) throw new NetworkRefusal(`the enabled ${this.name(box)} box's value with a marked coil or a jump on it`)
          const cond = this.pin(box.enable, pre)
          const value = this.boxValue(box, box.pins.filter((a) => !a.output), pre)
          return [...pre, ifThen(cond, [this.assign(s, value, pre)], [], s.span)]
        }
        let value = this.expr(s.value, pre)
        if (marked || this.plan.sharing.has(s)) {
          const t = this.valueTemp(s.value, s.span)
          pre.push(assign(t, value, s.span))
          value = t
          if (this.plan.sharing.has(s)) this.shared = t
        }
        const between = this.plan.between.get(s) ?? []
        if (!marked && between.length === 0) return [...pre, this.assign(s, value, pre)]
        // every target receives the value, in list order, each its own mark; a jump or a return between them taken in its place
        const writes = targets.flatMap((t, i) => {
          const jumps = between.filter((j) => j.coilsBefore === i).flatMap((j) => this.jumpStatement(j, pre))
          const target = this.expr(t, pre)
          const op = s.marks?.[i]?.includes("NOT") === true ? "NOT" : ops[i]
          return [...jumps, op === "NOT" || op === "S=" || op === "R=" ? coilWrite(op, target, value, s.span) : assign(target, value, s.span)]
        })
        return [...pre, ...writes]
      }
      case "call_stmt":
      case "expr_stmt": {
        // a value standing alone: a box consumed by nothing runs, its flow read by nobody, the marks around it of no
        // effect; any other value — an operand, contacts, a branch, the rail — is evaluated, what it runs kept, its value
        // unread
        const value = s.kind === "call_stmt" ? s.call : s.expr
        const root = rootBox(value)
        if (root === undefined) {
          this.expr(value, pre)
          return pre
        }
        const execute = this.text(root.call.callee.span).toUpperCase() === "EXECUTE"
        if (root.member !== undefined && !execute && boxMember(root.member, this.scope, this.project) === undefined)
          throw new NetworkRefusal(`the statement ${this.text(s.span)} in a network`)
        return this.callStatement(root.call, root.member?.member.name, pre)
      }
      case "empty":
        return []
      case "jmp":
      case "return":
        if (this.plan.placed.has(s)) return [] // lowered between its ASSIGN's coils
        return this.jumpStatement(s, pre)
      case "label":
        return [s]
      default:
        throw new NetworkRefusal(`a ${s.kind} statement in a network`)
    }
  }

  /** A jump or the return: run when its value holds — its own, or beside coils the value they were written from. */
  private jumpStatement(s: Extract<Statement, { kind: "jmp" | "return" }>, pre: Statement[]): Statement[] {
    const jump: Statement = s.kind === "jmp" ? { kind: "jmp", target: s.target, span: s.span } : { kind: "return", span: s.span }
    // beside coils: on the value they were written from, held once
    if (s.sharesValue === true) {
      if (this.shared === undefined) throw new NetworkRefusal(`the jump ${this.text(s.span)} shares a value no item before it holds`)
      return [ifThen(this.jumpCond(s.marks, this.shared, s.span), [jump], [], s.span)]
    }
    if (s.value === undefined) return [s]
    let cond = this.expr(s.value, pre)
    if (this.plan.sharing.has(s)) {
      const t = this.temp(s.span)
      pre.push(assign(t, cond, s.span))
      cond = this.shared = t
    }
    return [...pre, ifThen(this.jumpCond(s.marks, cond, s.span), [jump], [], s.span)]
  }

  /** `targets := value;`, the targets as the assignment spells them. */
  private assign(s: Extract<Statement, { kind: "assign" }>, value: Expr, pre: Statement[]): Statement {
    const { assignHead: _head, marks: _marks, ...plain } = s
    return { ...plain, target: this.expr(s.target, pre), ...(s.chained === undefined ? {} : { chained: s.chained.map((x) => this.expr(x, pre)) }), value }
  }

  /** A box standing as a statement (`member` the one closing its call): it runs, its flow read by nobody. */
  private callStatement(c: CallExpr, closer: string | undefined, pre: Statement[]): Statement[] {
    const head = c.callee.kind === "ident_expr" ? c.callee.name.toUpperCase() : undefined
    if (head === "EXECUTE") {
      if (closer !== undefined) throw new NetworkRefusal(`the Execute box is closed by .${closer}: its one output is its ENO, which flows on with no member`)
      const { cond, st } = this.execute(c, pre)
      return [...pre, ifThen(cond, st, [], c.span)]
    }
    const box = this.box(c)
    if (box === undefined) return [...pre, { kind: "call_stmt", call: this.callOf(c, c.args, pre), span: c.span }]
    this.refuseMisleading(box, { consumed: false, member: closer })
    if (box.instance !== undefined) {
      this.fb(box, false, undefined, pre) // a root's flow is read by nothing: with no EN it runs as the plain call (live CODESYS 3.5.21.40)
      return pre
    }
    if (box.enable !== undefined) {
      this.enabled(box, pre, false)
      return pre
    }
    const result = box.pins.find((a) => a.output && a.param?.name.toUpperCase() === "OUT")
    if (result !== undefined) {
      const marked = this.markedOutputs(box, box.pins.filter((a) => a !== result), pre)
      const value = this.plainValue(box, marked.args, pre)
      const target = this.expr(result.value!, pre)
      return [...pre, result.coil === undefined ? assign(target, value, c.span) : coilWrite(result.coil, target, value, c.span), ...marked.post]
    }
    if (isInfix(this.name(box))) return []
    const marked = this.markedOutputs(box, box.pins, pre)
    return [...pre, { kind: "call_stmt", call: this.callOf(box.st, marked.args, pre), span: c.span }, ...marked.post]
  }

  /** The Execute box: its EN and its ST, the statements its CODE string holds (they follow the box's statement). */
  private execute(c: CallExpr, pre: Statement[]): { cond: Expr; st: Statement[] } {
    const box = this.network!.executes.find((x) => x.call.start === c.span.start)
    if (box?.st === undefined) throw new NetworkRefusal("an EXECUTE call that is no Execute box")
    const en = c.args.find((a) => a.param?.name.toUpperCase() === "EN")
    const st = this.all.filter((s) => s.span.start >= box.code.start && s.span.start < box.code.end)
    return { cond: en === undefined ? bool(true, c.span) : this.pin(en, pre), st }
  }

  /** `BRANCH(…)`: every branch runs; `BRANCH_SHORTCIRCUIT(…)`: a branch holding a box runs unless the feed and a box-free
   *  branch are both TRUE (1.4), the calls it reads through wires with it. */
  private branch(c: CallExpr, pre: Statement[]): Expr {
    const span = c.span
    const fed = c.args[0]?.param?.name.toUpperCase() === "FEED"
    const feed = fed ? this.expr(c.args[0]!.value!, pre) : bool(true, span)
    const branches = c.args.slice(fed ? 1 : 0).map((a) => a.value!)
    const any = (xs: readonly Expr[]) => xs.slice(1).reduce((l, r) => binary("OR", l, r, span), xs[0]!)
    if ((c.callee as { name: string }).name.toUpperCase() === "BRANCH") return binary("AND", feed, any(branches.map((b) => this.expr(b, pre))), span)
    const own = this.wires.get(this.network!.index)!
    const holdsBox = (e: Expr) => {
      let box = false
      walkExpr(e, (x) => {
        if (x.kind === "call" || (x.kind === "ident_expr" && own.has(x.name.toLowerCase()))) box = true
      })
      return box
    }
    const f = this.temp(span)
    const free = this.temp(span)
    pre.push(assign(f, feed, span))
    const freeBranches = branches.filter((b) => !holdsBox(b))
    const freeValue = freeBranches.length === 0 ? bool(false, span) : any(freeBranches.map((b) => this.expr(b, pre)))
    pre.push(assign(free, freeValue, span))
    const inner: Statement[] = []
    const values: Expr[] = [free]
    for (const b of branches.filter(holdsBox)) {
      for (const s of guardedReadBy(b, this.guardedByWire)) inner.push(...this.statement(s))
      const v = this.temp(span)
      const value = this.expr(b, inner)
      inner.push(assign(v, value, span))
      values.push(v)
    }
    if (inner.length > 0) pre.push(ifThen(not(binary("AND", f, free, span), span), inner, [], span))
    return binary("AND", f, any(values), span)
  }

  /** A jump or the return in a tree (an ASSIGN's target, read as the call `JMP(l, v)` / `RETURN(v)`): the value in a temp,
   *  the jump taken on it (its own mark applied), the temp handed on. */
  private control(c: CallExpr, upper: string, pre: Statement[]): Expr {
    const t = this.temp(c.span)
    const value = this.expr(c.args.at(-1)!.value!, pre)
    pre.push(assign(t, value, c.span))
    const jump: Statement = upper === "JMP" ? { kind: "jmp", target: c.args[0]!.value!, span: c.span } : { kind: "return", span: c.span }
    pre.push(ifThen(this.jumpCond(c.marks, t, c.span), [jump], [], c.span))
    return t
  }

  /** A coil in a tree (an ASSIGN's target): the value in a temp, the target written with its own mark, the temp handed
   *  on — the value the coil receives, unmarked. */
  private coil(e: Extract<Expr, { kind: "assign_expr" }>, pre: Statement[]): Expr {
    const value = this.expr(e.value, pre)
    const t = this.valueTemp(e.value, e.span)
    pre.push(assign(t, value, e.span))
    const target = this.expr(e.target, pre)
    pre.push(e.marks?.includes("NOT") === true ? coilWrite("NOT", target, t, e.span) : e.op !== undefined ? coilWrite(e.op, target, t, e.span) : assign(target, t, e.span))
    return t
  }

  /** `RISING(x)` / `FALLING(x)`: an edge detector called with x where its tree is evaluated, read by its Q (1.3). */
  private edge(c: CallExpr, pre: Statement[]): Expr {
    return this.edgeOf((c.callee as { name: string }).name.toUpperCase() === "RISING", this.expr(c.args[0]!.value!, pre), c.span, pre)
  }

  private edgeOf(rising: boolean, clk: Expr, span: Span, pre: Statement[]): Expr {
    const name = `${this.at(this.network!)}trig${++this.count().trig}`
    this.temps.push({ name, span, fb: rising ? "R_TRIG" : "F_TRIG" })
    pre.push({ kind: "call_stmt", call: call(ident(name, span), [{ kind: "call_arg", param: { kind: "ident_expr", name: "CLK", span }, output: false, value: clk, span }], span), span })
    return member(ident(name, span), "Q", span)
  }

  /** A jump's or the return's condition under its own mark: `Q_INVERTED => JMP.l` jumps when NOT the value. */
  private jumpCond(marks: readonly string[] | undefined, cond: Expr, span: Span): Expr {
    return marks?.includes("NOT") === true ? not(cond, span) : cond
  }

  override expr(e: Expr, pre: Statement[]): Expr {
    switch (e.kind) {
      case "ident_expr": {
        const wire = this.wires.get(this.network!.index)!.get(e.name.toLowerCase())
        return wire === undefined ? e : ident(wire, e.span)
      }
      case "member": {
        const m = e.base.kind === "call" ? boxMember(e, this.scope, this.project) : undefined
        if (m !== undefined) return this.boxRead(m.box, m.name, pre)
        return { ...e, base: this.expr(e.base, pre) }
      }
      case "call": {
        const head = e.callee.kind === "ident_expr" ? e.callee.name : undefined
        const upper = head?.toUpperCase()
        if ((upper === "BRANCH" || upper === "BRANCH_SHORTCIRCUIT") && lookup(this.scope, head!) === undefined) return this.branch(e, pre)
        if ((upper === "RISING" || upper === "FALLING") && lookup(this.scope, head!) === undefined) return this.edge(e, pre)
        if (upper === "RAIL" && lookup(this.scope, head!) === undefined) return bool(true, e.span)
        if (upper === "JMP" || upper === "RETURN") return this.control(e, upper, pre)
        if (upper === "EXECUTE") {
          const { cond, st } = this.execute(e, pre)
          const eno = this.temp(e.span)
          pre.push(assign(eno, cond, e.span), ifThen(eno, st, [], e.span))
          return eno
        }
        if ((upper === "ASSIGN" || upper === "INVERT") && lookup(this.scope, head!) === undefined)
          throw new NetworkRefusal(`the call ${this.text(e.span)} is no ${upper} the text has`)
        const box = this.box(e)
        if (box !== undefined) return this.boxRead(box, undefined, pre)
        return this.callOf(e, e.args, pre)
      }
      case "binary":
        return { ...e, left: this.expr(e.left, pre), right: this.expr(e.right, pre) }
      case "unary":
        return { ...e, operand: this.expr(e.operand, pre) }
      case "paren":
        return { ...e, inner: this.expr(e.inner, pre) }
      case "assign_expr":
        return this.coil(e, pre)
      case "index":
        return { ...e, base: this.expr(e.base, pre), indices: e.indices.map((i) => this.expr(i, pre)) }
      case "deref":
        return { ...e, base: this.expr(e.base, pre) }
      default:
        return e
    }
  }
}
