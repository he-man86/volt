/**
 * THE EXEC TWIN OF PLAIN-ST NETWORK TEXT (openspec network-text-st 2.4, design.md oracle 3; network-output-member 2.3): the
 * CODESYS ST that runs as the network a plain-ST network body spells. CODESYS ST has no call form for an operator box and
 * no EN/ENO (1.2), and no FB call in an expression, so the twin writes what the network runs, as 1.3 / 1.4 / 1c measured
 * it. Every box is a call (`types` `infer/network-box.ts`):
 *
 *   `GT(i, 3)`, `ADD(a, b, c)`, `NOT(a)`         the operator, infix: `(i > 3)`, `(a + b + c)`, `(NOT a)`;
 *   `X(EN := e, pins…, OUT => o).ENO`            `IF e THEN o := X(pins…); eno := TRUE; ELSE eno := FALSE; END_IF` — an
 *                                                enabled box runs only when enabled, and its ENO is its EN (1.3); an
 *                                                enabled COMPARISON is FALSE when disabled (1.3), so its value is
 *                                                written FALSE in the ELSE; read where it stands, the call is its `eno`;
 *   `X(EN := e, pins…)`                          the box with EN and no ENO, its value: a comparison's FALSE when disabled
 *                                                (1.3), any other an assignment's whole value, held when disabled (1.4):
 *                                                `IF e THEN y := X(pins…); END_IF`; at the root as with ENO;
 *   `X(pins…).ENO`                               the call, on every scan; its ENO TRUE;
 *   `T(FB := t1, IN := a).Q`                     `t1(IN := a);` before the item, `t1.Q` in it — the FB runs before the tree
 *                                                that reads it, on every scan though an enabled box reads it; with
 *                                                `EN := e` under `IF e THEN … END_IF`, what its pins evaluate with it; read
 *                                                by nothing named, its one output (`t1.Q`); `.ENO` its ENO, as above —
 *                                                the order network-text-st's FB statement and `t1_EN` call had, which
 *                                                network-output-member 2.3 runs against CODESYS;
 *   `T(FB := ???, pins…)`                         the vendor's unnamed instance: the call of its type, which the build
 *                                                refuses as it refuses the box;
 *   `g(pins…).OUT`                               a function's value: the call;
 *   `%EXECUTE(EN := e, ENO => w)` … `%END_EXECUTE` `IF e THEN <its ST> END_IF; w := e;`;
 *   `BRANCH(FEED := f, b1, b2)`                  `(f AND (b1 OR b2))`: every branch runs;
 *   `BRANCH_SHORTCIRCUIT(FEED := f, b1, b2)`     a branch holding a box runs, with the calls it reads, unless the feed
 *                                                and a box-free branch are both TRUE (1.4): `IF NOT (f AND free) THEN …`;
 *   `R_EDGE(x)`, `F_EDGE(x)`                     an `R_TRIG` / `F_TRIG` called every scan with x, read by its Q (1.3);
 *   `JMP(l, v)`, `RETURN(v)`                     `IF v THEN JMP l; END_IF;` / `IF v THEN RETURN; END_IF;`; in a tree its
 *                                                value held in a temp, the jump taken where the tree is evaluated;
 *   a wire                                       a variable of its definition's type (`types` `network-call.ts`),
 *                                                renamed into the twin's own names (`vtw<k>_w1`), as is every ENO;
 *   a `%DISABLED` network                        nothing: CODESYS compiles none of it (1c).
 *
 * Everything else — contacts, coils, `S=`/`R=`, inline assignments, labels, `JMP`, `RETURN` — is ST as it stands. A twin
 * is ST and nothing else: a box the twin cannot write is refused by name (`TwinRefusal`).
 */
import {
  type BodySpan,
  type CallExpr,
  type Expr,
  plainStText,
  type Statement,
  walkExpr,
} from "../../src/frontend/syntax/index.js"
import { lookup, type Scope } from "../../src/frontend/symbols/index.js"
import { boxMember, inferExprType, renderType, type NetworkBox } from "../../src/frontend/types/index.js"
import { BoxTwinner, COMPARISON, INFIX, TwinRefusal } from "./network-twin-boxes.js"
import { type AssignStatement, guardedCalls, guardedReadBy, valueReads } from "./network-twin-reads.js"

export { TwinRefusal } from "./network-twin-boxes.js"

/** One body's twin: its ST statements and the variables they need (`name : TYPE;`). */
export interface BodyTwin {
  code: string
  declarations: string[]
}

/** The twin of one plain-ST network body, read in `scope` (its network scope, `symbols` `bodies`). */
export function twinOf(body: BodySpan, statements: readonly Statement[], scope: Scope, project: Scope, source: string, k: number): BodyTwin {
  const skip = plainStText(body).networks.flatMap((n) => n.executes)
  const code = statements.filter((s) => skip.find((x) => s.span.start > x.header.end && s.span.start < x.span.end) === undefined)
  const t = new Twinner(body, scope, project, source, `vtw${k}_`, guardedCalls(body, code, valueReads(body, code)))
  const lines: string[] = []
  for (const s of code) {
    if (t.guarded.has(s)) continue // written inside its short-circuit branch's guard
    lines.push(...t.statement(s))
  }
  return { code: lines.join("\n"), declarations: t.declarations() }
}

class Twinner extends BoxTwinner {
  private readonly wires = new Map<string, string>()
  /** The edge detectors an `R_EDGE(x)` / `F_EDGE(x)` runs on: `name : R_TRIG;`, one per edge. */
  private readonly trigs: string[] = []
  /** The call statements written inside a short-circuit branch's guard (`guardedCalls`). */
  readonly guarded: Set<Statement>

  constructor(
    private readonly body: BodySpan,
    scope: Scope,
    project: Scope,
    source: string,
    prefix: string,
    private readonly guardedByWire: ReadonlyMap<string, Statement>,
  ) {
    super(scope, project, source, prefix)
    this.guarded = new Set(guardedByWire.values())
    for (const net of plainStText(body).networks) for (const w of net.wires) this.wires.set(w.name.toLowerCase(), prefix + w.name)
  }

  declarations(): string[] {
    const out: string[] = []
    for (const [lower, renamed] of this.wires) {
      const type = inferExprType({ kind: "ident_expr", name: lower, span: this.body.span }, this.scope, this.project)
      if (type.kind === "unknown") throw new TwinRefusal(`the wire ${lower} has no type the twin can declare`)
      out.push(`${renamed} : ${renderType(type)};`)
    }
    for (const t of this.temps) out.push(`${t} : BOOL;`)
    out.push(...this.trigs)
    return out
  }

  statement(s: Statement): string[] {
    const pre: string[] = []
    switch (s.kind) {
      case "assign": {
        // an enabled box other than a comparison, the assignment's whole value: the assignment runs only when enabled, and
        // its targets hold when disabled (1.4)
        const box = s.value.kind === "call" ? this.box(s.value) : undefined
        if (box !== undefined && this.enabledValue(box) && !COMPARISON.has(this.name(box).toUpperCase())) {
          const cond = this.expr(box.enable!.value!, pre)
          const inner = this.gated(pre)
          const value = this.boxValue(box, box.pins.filter((a) => !a.output), inner)
          const text = this.assign(s, value, inner)
          return [...pre, `IF ${cond} THEN\n\t${[...inner, text].join("\n\t")}\nEND_IF;`]
        }
        const text = this.assign(s, this.expr(s.value, pre), pre)
        return [...pre, text]
      }
      case "call_stmt":
        return [...pre, ...this.callStatement(s.call, false, pre)]
      case "expr_stmt":
        // a box at a root closed by `.ENO`: the call statement, its ENO read by nobody
        if (s.expr.kind === "member" && s.expr.base.kind === "call" && boxMember(s.expr, this.scope, this.project)?.eno === true)
          return [...pre, ...this.callStatement(s.expr.base, true, pre)]
        throw new TwinRefusal(`the statement ${this.text(s)} in a network`)
      case "empty":
        return []
      case "jmp":
      case "return":
        if (s.value !== undefined) {
          const cond = this.expr(s.value, pre)
          return [...pre, `IF ${cond} THEN ${s.kind === "jmp" ? `JMP ${this.text(s.target)}` : "RETURN"}; END_IF;`]
        }
        return [this.text(s) + (this.text(s).trimEnd().endsWith(";") ? "" : ";")]
      case "label":
        return [this.text(s)]
      case "if": {
        const branch = s.branches[0]!
        const cond = this.expr(branch.cond, pre)
        const inner = this.text(branch.body[0]!).trim()
        return [...pre, `IF ${cond} THEN ${inner.endsWith(";") ? inner : inner + ";"} END_IF;`]
      }
      default:
        throw new TwinRefusal(`a ${s.kind} statement in a network`)
    }
  }

  /** `targets := value;`, the targets as the assignment spells them. */
  private assign(s: AssignStatement, value: string, pre: string[]): string {
    const targets = [s.target, ...(s.chained ?? [])].map((x) => this.expr(x, pre))
    const ops = [s.op ?? ":=", ...(s.chainOps ?? []).map((o) => o ?? ":=")]
    return targets.map((x, i) => `${x} ${ops[i]} `).join("") + value + ";"
  }

  /** A function box with EN shown and no ENO, read by its value (`X(EN := e, …)`). */
  private enabledValue(box: NetworkBox): boolean {
    return box.instance === undefined && box.enable !== undefined
  }

  /** A box standing as a statement (`eno`: closed by `.ENO`): its outputs written, its ENO read by nobody. */
  private callStatement(call: CallExpr, eno: boolean, pre: string[]): string[] {
    const head = call.callee.kind === "ident_expr" ? call.callee.name : undefined
    if (head?.toUpperCase() === "EXECUTE") return this.execute(call, pre)
    const box = this.box(call)
    if (box === undefined) return [this.callText(call, call.args, pre) + ";"]
    if (box.instance !== undefined) {
      this.fb(box, false, undefined, pre) // a root's ENO: read by nothing
      return pre.splice(0)
    }
    if (box.enable !== undefined) {
      this.enabled(box, pre, false)
      return pre.splice(0)
    }
    if (eno) {
      this.enoOnly(box, pre)
      return pre.splice(0)
    }
    // a function box at the root: its value to the targets its `OUT =>` names, an operator's infix
    const results = box.pins.filter((a) => a.output && a.param?.name.toUpperCase() === "OUT")
    if (results.length > 0) {
      const value = this.boxValue(box, box.pins.filter((a) => !results.includes(a)), pre)
      return [...pre.splice(0), results.map((r) => `${this.expr(r.value!, pre)} := `).join("") + value + ";"]
    }
    if (INFIX[this.name(box).toUpperCase()] !== undefined) return []
    return [...pre.splice(0), this.callText(box.st, box.pins, pre) + ";"]
  }

  private execute(call: CallExpr, pre: string[]): string[] {
    const box = plainStText(this.body).networks.flatMap((n) => n.executes).find((x) => x.header.start <= call.span.start && call.span.start <= x.header.end)
    if (box === undefined) throw new TwinRefusal("an EXECUTE call that is no Execute box")
    const lines = this.source.slice(box.header.end, box.span.end).split("\n").slice(1)
    const st = lines.slice(0, lines.length - 1).join("\n")
    const en = call.args.find((a) => a.param?.name.toUpperCase() === "EN")
    const eno = call.args.find((a) => a.output && a.param?.name.toUpperCase() === "ENO")
    const cond = en === undefined ? "TRUE" : this.expr(en.value!, pre)
    const out = [...pre.splice(0), `IF ${cond} THEN\n${st}\nEND_IF;`]
    if (eno !== undefined) out.push(`${this.expr(eno.value!, pre)} := ${cond};`)
    return out
  }

  /** `BRANCH(FEED := f, b1, b2)` (every branch runs) and `BRANCH_SHORTCIRCUIT(…)`: a branch holding a box runs unless the
   *  feed and a box-free branch are both TRUE (1.4), the calls it reads through wires (`guardedCalls`) with it. */
  private branch(call: CallExpr, pre: string[]): string {
    const fed = call.args[0]?.param?.name.toUpperCase() === "FEED"
    const feed = fed ? this.expr(call.args[0]!.value!, pre) : "TRUE"
    const branches = call.args.slice(fed ? 1 : 0).map((a) => a.value!)
    if ((call.callee as { name: string }).name.toUpperCase() === "BRANCH")
      return `(${feed} AND (${branches.map((b) => this.expr(b, pre)).join(" OR ")}))`
    const holdsBox = (e: Expr) => {
      let box = false
      walkExpr(e, (x) => {
        if (x.kind === "call" || (x.kind === "ident_expr" && this.wires.has(x.name.toLowerCase()))) box = true
      })
      return box
    }
    const f = this.temp()
    const free = this.temp()
    pre.push(`${f} := ${feed};`)
    const freeBranches = branches.filter((b) => !holdsBox(b))
    pre.push(`${free} := ${freeBranches.length === 0 ? "FALSE" : freeBranches.map((b) => this.expr(b, pre)).join(" OR ")};`)
    const inner: string[] = []
    const values: string[] = []
    for (const b of branches.filter(holdsBox)) {
      for (const s of guardedReadBy(b, this.guardedByWire)) inner.push(...this.statement(s))
      const v = this.temp()
      inner.push(`${v} := ${this.expr(b, inner)};`)
      values.push(v)
    }
    if (inner.length > 0) pre.push(`IF NOT (${f} AND ${free}) THEN\n\t${inner.join("\n\t")}\nEND_IF;`)
    return `(${f} AND (${[free, ...values].join(" OR ")}))`
  }

  /** `JMP(l, v)` / `RETURN(v)` in a tree: the value in a temp, the jump taken on it, the temp handed on. */
  private control(call: CallExpr, upper: string, pre: string[]): string {
    const t = this.temp()
    pre.push(`${t} := ${this.expr(call.args.at(-1)!.value!, pre)};`)
    pre.push(`IF ${t} THEN ${upper === "JMP" ? `JMP ${this.text(call.args[0]!.value!)}` : "RETURN"}; END_IF;`)
    return t
  }

  /** `R_EDGE(x)` / `F_EDGE(x)`: an edge detector called on every scan with x, read by its Q (1.3). */
  private edge(call: CallExpr, pre: string[]): string {
    const rising = (call.callee as { name: string }).name.toUpperCase() === "R_EDGE"
    const name = `${this.prefix}trig${this.trigs.length + 1}`
    this.trigs.push(`${name} : ${rising ? "R_TRIG" : "F_TRIG"};`)
    pre.push(`${name}(CLK := ${this.expr(call.args[0]!.value!, pre)});`)
    return `${name}.Q`
  }

  override expr(e: Expr, pre: string[]): string {
    switch (e.kind) {
      case "ident_expr":
        return this.wires.get(e.name.toLowerCase()) ?? e.name
      case "member": {
        const m = e.base.kind === "call" ? boxMember(e, this.scope, this.project) : undefined
        if (m !== undefined) return this.boxRead(m.box, m.name, pre)
        return this.text(e)
      }
      case "call": {
        const head = e.callee.kind === "ident_expr" ? e.callee.name : undefined
        const upper = head?.toUpperCase()
        if ((upper === "BRANCH" || upper === "BRANCH_SHORTCIRCUIT") && lookup(this.scope, head!) === undefined) return this.branch(e, pre)
        if ((upper === "R_EDGE" || upper === "F_EDGE") && lookup(this.scope, head!) === undefined) return this.edge(e, pre)
        if (upper === "JMP" || upper === "RETURN") return this.control(e, upper, pre)
        const box = this.box(e)
        if (box !== undefined) return this.boxRead(box, undefined, pre)
        return this.callText(e, e.args, pre)
      }
      case "binary":
        return `(${this.expr(e.left, pre)} ${e.op} ${this.expr(e.right, pre)})`
      case "unary":
        return `(${e.op} ${this.expr(e.operand, pre)})`
      case "paren":
        return `(${this.expr(e.inner, pre)})`
      case "assign_expr":
        return `(${this.expr(e.target, pre)} ${e.op ?? ":="} ${this.expr(e.value, pre)})`
      default:
        return this.text(e)
    }
  }
}
