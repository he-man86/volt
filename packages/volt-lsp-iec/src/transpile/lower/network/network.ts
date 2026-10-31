/**
 * A PLAIN-ST NETWORK BODY AS THE ST STATEMENTS IT RUNS AS (openspec network-text-lowering; the spelling is
 * `docs/network-text.html`'s): every box by its rule (`boxes.ts`), the network's own elements here —
 *
 *   `EXECUTE(EN := e, '<ST>')`                `IF e THEN <its ST> END_IF`; read where it stands, its ENO, which is its EN;
 *   `BRANCH(FEED := f, b1, b2)`               `f AND (b1 OR b2)`: every branch runs;
 *   `BRANCH_SHORTCIRCUIT(FEED := f, b1, b2)`  a branch holding a box runs, with the calls it reads, unless the feed and a
 *                                             box-free branch are both TRUE: `IF NOT (f AND free) THEN … END_IF`;
 *   `RISING(x)`, `FALLING(x)`                 an `R_TRIG` / `F_TRIG` called with x where its tree is evaluated, read by Q;
 *   `RAIL()`                                  `TRUE`;
 *   `NOT y := x := a`                         every target receives the power flow, the first its mark applied:
 *                                             `x := a; y := NOT a` (`RISING y`, `FALLING y`: a coil's edge runs as a
 *                                             plain coil, measured, network-text-st 1.3);
 *   `JMP.l := v`, `RETURN := v`               `IF v THEN JMP l; END_IF` / `IF v THEN RETURN; END_IF`; beside coils
 *                                             (`y := JMP.l := v`) the value held in a temp, the coils written, then the
 *                                             jump; in a tree its value held in a temp, the jump taken where the tree is
 *                                             evaluated;
 *   a wire                                    a variable of its definition's type kept across scans — read before its
 *                                             definition, the previous scan's value (scan 1: the recording,
 *                                             `nt_wire_read_before_definition_scan*`);
 *   a `%DISABLED` network                     nothing: CODESYS compiles none of it (its code is no statement).
 *
 * Everything else — contacts, coils, `S=`/`R=`, labels — is ST as it stands. The hidden state (wires,
 * ENO temps, edge detectors) is named `__nw<N>_<wire>`, `__nw<N>_eno<k>`, `__nw<N>_trig<k>` (`<N>` the network's 1-based
 * index in the body) behind `prefix`; the lowering declares it (`state.ts`). A box no rule writes is refused by name
 * (`NetworkRefusal`).
 */
import { type BodySpan, type CallExpr, type Expr, plainStText, type PlainStNetwork, type Span, type Statement, stmtExprs, walkExpr } from "../../../frontend/syntax/index.js"
import { lookup, type Scope } from "../../../frontend/symbols/index.js"
import { boxMember, elementaryRef, inferExprType, type Type } from "../../../frontend/types/index.js"
import { assign, binary, bool, call, ident, ifThen, member, NetworkRefusal, NOT_COMPILED, not } from "./ast.js"
import { BoxLowerer, COMPARISON, isInfix } from "./boxes.js"
import { guardedCalls, guardedReadBy } from "./guarded.js"

/** A variable the lowered network keeps: a wire or ENO temp (`type`), or an edge detector (`fb`). */
export type HiddenVar = { name: string; span: Span } & ({ type: Type } | { fb: "R_TRIG" | "F_TRIG" })

export interface LoweredNetworks {
  statements: Statement[]
  hidden: HiddenVar[]
}

/** The ST statements `statements` (the body's, as compiled) run as, and the variables they keep. */
export function lowerNetworks(body: BodySpan, statements: readonly Statement[], scope: Scope, project: Scope, prefix: string): LoweredNetworks {
  const text = plainStText(body)
  const executes = text.networks.flatMap((n) => n.executes)
  const code = statements.filter((s) => !executes.some((x) => s.span.start >= x.code.start && s.span.start < x.code.end))
  // a marked output has no measured run
  for (const s of code)
    for (const e of stmtExprs(s))
      walkExpr(e, (x) => {
        const marked = x.kind === "call" ? x.args.find((a) => a.output && a.marks !== undefined) : undefined
        if (marked !== undefined) throw new NetworkRefusal(`the mark on the output ${marked.param?.name ?? ""}: how a marked output runs is unmeasured`)
      })
  const n = new Networker(body, scope, project, prefix, statements, code)
  // the items a jump or a return after them shares the value of (`y := JMP.l := v;`)
  code.forEach((s, i) => {
    const next = code[i + 1]
    if ((next?.kind === "jmp" || next?.kind === "return") && next.sharesValue === true && !((s.kind === "jmp" || s.kind === "return") && s.sharesValue === true))
      n.sharing.add(s)
  })
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
  /** The items whose value a jump or a return after them shares, and the temp the last one's value is held in. */
  readonly sharing = new Set<Statement>()
  private shared: Expr | undefined
  private readonly guardedByWire: ReadonlyMap<string, Statement>

  constructor(
    body: BodySpan,
    scope: Scope,
    project: Scope,
    private readonly prefix: string,
    private readonly all: readonly Statement[],
    code: readonly Statement[],
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
        if (type.kind === "unknown") throw new NetworkRefusal(`the wire ${w.name.toLowerCase()} has no type lowering can declare`)
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
    const name = `${this.at(this.network!)}eno${++this.count().eno}`
    this.temps.push({ name, span, type: elementaryRef("BOOL") })
    return ident(name, span)
  }

  statement(s: Statement): Statement[] {
    const pre: Statement[] = []
    switch (s.kind) {
      case "assign": {
        // an enabled box other than a comparison, the assignment's whole value: the assignment runs only when enabled, and
        // its targets hold when disabled (1.4)
        const box = s.value.kind === "call" ? this.box(s.value) : undefined
        const first = s.marks?.[0]
        if (box !== undefined && box.instance === undefined && box.enable !== undefined && !COMPARISON.has(this.name(box).toUpperCase())) {
          if (first !== undefined || this.sharing.has(s))
            throw new NetworkRefusal(`the enabled ${this.name(box)} box's value with a marked coil or a jump on it`)
          const cond = this.pin(box.enable, pre)
          const value = this.boxValue(box, box.pins.filter((a) => !a.output), pre)
          return [...pre, ifThen(cond, [this.assign(s, value, pre)], [], s.span)]
        }
        let value = this.expr(s.value, pre)
        if (first !== undefined || this.sharing.has(s)) {
          const t = this.temp(s.span)
          pre.push(assign(t, value, s.span))
          value = t
          if (this.sharing.has(s)) this.shared = t
        }
        if (first === undefined) return [...pre, this.assign(s, value, pre)]
        // every target receives the power flow, the first its own mark applied (a coil's edge runs as a plain coil)
        const [next, ...rest] = s.chained ?? []
        const restOps = (s.chainOps ?? []).slice(1)
        const others: Statement[] = next === undefined ? [] : [this.assign({
          kind: "assign", target: next, value: s.value, span: s.span,
          ...(s.chainOps?.[0] !== undefined ? { op: s.chainOps[0] } : {}),
          ...(rest.length > 0 ? { chained: rest, chainOps: restOps } : {}),
        }, value, pre)]
        const marked: Statement = {
          kind: "assign", target: this.expr(s.target, pre), value: first.includes("NOT") ? not(value, s.span) : value, span: s.span,
          ...(s.op !== undefined ? { op: s.op } : {}),
        }
        return [...pre, ...others, marked]
      }
      case "call_stmt":
        return this.callStatement(s.call, false, pre)
      case "expr_stmt":
        // a box at a root closed by `.ENO`: the call statement, its ENO read by nobody
        if (s.expr.kind === "member" && s.expr.base.kind === "call" && boxMember(s.expr, this.scope, this.project)?.eno === true)
          return this.callStatement(s.expr.base, true, pre)
        throw new NetworkRefusal(`the statement ${this.text(s.span)} in a network`)
      case "empty":
        return []
      case "jmp":
      case "return": {
        const jump: Statement = s.kind === "jmp" ? { kind: "jmp", target: s.target, span: s.span } : { kind: "return", span: s.span }
        // beside coils: on the value they were written from, held once
        if (s.sharesValue === true) {
          if (this.shared === undefined) throw new NetworkRefusal(`the jump ${this.text(s.span)} shares a value no item before it holds`)
          return [ifThen(this.shared, [jump], [], s.span)]
        }
        if (s.value === undefined) return [s]
        let cond = this.expr(s.value, pre)
        if (this.sharing.has(s)) {
          const t = this.temp(s.span)
          pre.push(assign(t, cond, s.span))
          cond = this.shared = t
        }
        return [...pre, ifThen(cond, [jump], [], s.span)]
      }
      case "label":
        return [s]
      case "if": {
        const branch = s.branches[0]!
        return [...pre, ifThen(this.expr(branch.cond, pre), [branch.body[0]!], [], s.span)]
      }
      default:
        throw new NetworkRefusal(`a ${s.kind} statement in a network`)
    }
  }

  /** `targets := value;`, the targets as the assignment spells them. */
  private assign(s: Extract<Statement, { kind: "assign" }>, value: Expr, pre: Statement[]): Statement {
    return { ...s, target: this.expr(s.target, pre), ...(s.chained === undefined ? {} : { chained: s.chained.map((x) => this.expr(x, pre)) }), value }
  }

  /** A box standing as a statement (`eno`: closed by `.ENO`): its outputs written, its ENO read by nobody. */
  private callStatement(c: CallExpr, eno: boolean, pre: Statement[]): Statement[] {
    const head = c.callee.kind === "ident_expr" ? c.callee.name.toUpperCase() : undefined
    if (head === "EXECUTE") {
      const { cond, st } = this.execute(c, pre)
      return [...pre, ifThen(cond, st, [], c.span)]
    }
    const box = this.box(c)
    if (box === undefined) return [...pre, { kind: "call_stmt", call: this.callOf(c, c.args, pre), span: c.span }]
    if (box.instance !== undefined) {
      this.fb(box, eno && box.enable === undefined, undefined, pre) // a root's ENO: read by nothing
      return pre
    }
    if (box.enable !== undefined) {
      this.enabled(box, pre, false)
      return pre
    }
    // measured 2.3: CODESYS does not compile a root box showing ENO without EN (`rcc_network_eno_function_without_en_root`)
    if (eno) throw new NetworkRefusal(`the ${this.name(box)} box at a root shows ENO without EN, which CODESYS does not compile`, NOT_COMPILED)
    // a function box at the root: its value to the targets its `OUT =>` names
    const results = box.pins.filter((a) => a.output && a.param?.name.toUpperCase() === "OUT")
    if (results.length > 0) {
      const value = this.boxValue(box, box.pins.filter((a) => !results.includes(a)), pre)
      const targets = results.map((r) => this.expr(r.value!, pre))
      return [...pre, { kind: "assign", target: targets[0]!, value, ...(targets.length > 1 ? { chained: targets.slice(1), chainOps: targets.slice(1).map(() => undefined) } : {}), span: c.span }]
    }
    if (isInfix(this.name(box))) return []
    return [...pre, { kind: "call_stmt", call: this.callOf(box.st, box.pins, pre), span: c.span }]
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

  /** `(JMP.l := v)` / `(RETURN := v)` in a tree (read as the call `JMP(l, v)` / `RETURN(v)`): the value in a temp, the
   *  jump taken on it, the temp handed on. */
  private control(c: CallExpr, upper: string, pre: Statement[]): Expr {
    const t = this.temp(c.span)
    const value = this.expr(c.args.at(-1)!.value!, pre)
    pre.push(assign(t, value, c.span))
    const jump: Statement = upper === "JMP" ? { kind: "jmp", target: c.args[0]!.value!, span: c.span } : { kind: "return", span: c.span }
    pre.push(ifThen(t, [jump], [], c.span))
    return t
  }

  /** `RISING(x)` / `FALLING(x)`: an edge detector called with x where its tree is evaluated, read by its Q (1.3). */
  private edge(c: CallExpr, pre: Statement[]): Expr {
    const rising = (c.callee as { name: string }).name.toUpperCase() === "RISING"
    const name = `${this.at(this.network!)}trig${++this.count().trig}`
    this.temps.push({ name, span: c.span, fb: rising ? "R_TRIG" : "F_TRIG" })
    const clk = this.expr(c.args[0]!.value!, pre)
    pre.push({ kind: "call_stmt", call: call(ident(name, c.span), [{ kind: "call_arg", param: { kind: "ident_expr", name: "CLK", span: c.span }, output: false, value: clk, span: c.span }], c.span), span: c.span })
    return member(ident(name, c.span), "Q", c.span)
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
        return { ...e, target: this.expr(e.target, pre), value: this.expr(e.value, pre) }
      case "index":
        return { ...e, base: this.expr(e.base, pre), indices: e.indices.map((i) => this.expr(i, pre)) }
      case "deref":
        return { ...e, base: this.expr(e.base, pre) }
      default:
        return e
    }
  }
}
