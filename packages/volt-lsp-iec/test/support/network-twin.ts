/**
 * THE EXEC TWIN OF PLAIN-ST NETWORK TEXT (openspec network-text-st 2.4, design.md oracle 3; network-language): the CODESYS
 * ST that runs as the network a plain-ST network body spells. CODESYS ST has no call form for an operator box and no
 * EN/ENO (1.2), and no FB call in an expression, so the twin writes what the network runs, as 1.3 / 1.4 / 1c measured it.
 * Every box is a call (`types` `infer/network-box.ts`), handing on its default output — its ENO where EN is shown, else a
 * function's value, an FB's first output — or the output a member names:
 *
 *   `GT(i, 3)`, `ADD(a, b, c)`, `NOT(a)`         the operator, infix: `(i > 3)`, `(a + b + c)`, `(NOT a)`;
 *   `X(EN := e, pins…, OUT => o)`                `IF e THEN o := X(pins…); eno := TRUE; ELSE eno := FALSE; END_IF` — an
 *                                                enabled box runs only when enabled, and its ENO is its EN (1.3); read
 *                                                where it stands, the call is its `eno`;
 *   `X(EN := e, pins…).OUT`                      the box with EN read by its value: a comparison's FALSE when disabled
 *                                                (1.3), any other an assignment's whole value, held when disabled (1.4):
 *                                                `IF e THEN y := X(pins…); END_IF`;
 *   `t1(IN := a)`, `t1(IN := a).ET`              `t1(IN := a);` before the item, `t1.Q` / `t1.ET` in it — the FB runs
 *                                                before the tree that reads it, on every scan though an enabled box reads
 *                                                it; with `EN := e` under `IF e THEN … END_IF`. What any enabled box's pins
 *                                                evaluate runs on every scan, only the box under its EN (measured 2.3);
 *   `Q_INVERTED => x`, `Q_SET => k`              a marked output: read into a temp by the call, then written to its target;
 *   `T(pins…)`, T an FB type                     the vendor's unnamed instance: the call of its type, which the build
 *                                                refuses as it refuses the box;
 *   `EXECUTE(EN := e, '<ST>')`                   `IF e THEN <its ST> END_IF;`, the string decoded; read where it stands,
 *                                                its ENO, which is its EN: `eno := e;` before it, `eno` in the tree;
 *   `BRANCH(FEED := f, b1, b2)`                  `(f AND (b1 OR b2))`: every branch runs;
 *   `BRANCH_SHORTCIRCUIT(FEED := f, b1, b2)`     a branch holding a box runs, with the calls it reads, unless the feed
 *                                                and a box-free branch are both TRUE (1.4): `IF NOT (f AND free) THEN …`;
 *   `RISING(x)`, `FALLING(x)`                    an `R_TRIG` / `F_TRIG` called with x where its tree is evaluated, read
 *                                                by its Q (1.3): every scan, in an enabled box's pin too (2.3);
 *   `INVERT(x)`                                  `(NOT x)`;
 *   `RAIL()`                                     `TRUE`;
 *   `ASSIGN(v, Q => x, Q_INVERTED => y)`         every target receives the value, in list order, each its own mark:
 *                                                unmarked the ST chain `x := y := v;`, marked `t := v; x := t;
 *                                                y := (NOT t);`; in a tree the inline assignment `(x := v)`, a negated
 *                                                coil the value in a temp handed on;
 *   `a;`, `RAIL();`, a box whose flow ends       a value standing alone: a box runs; else nothing;
 *   `COMMENT(a, 'why')`                          `a` (the front-end reads the operand it wraps);
 *   `Q => JMP.l`, `Q => RETURN`                  `IF v THEN JMP l; END_IF;` / `IF v THEN RETURN; END_IF;`
 *                                                (`Q_INVERTED`: on `(NOT v)`); beside coils the value held in a temp, the
 *                                                coils written, then the jump; in a tree its value held in a temp, the
 *                                                jump taken where the tree is evaluated;
 *   a wire                                       a VAR of its definition's type (`types` `network-call.ts`), kept across
 *                                                scans: read before its definition, the previous scan's value (2.3);
 *                                                renamed into the twin's own names (`vtw<k>_w1`), as is every ENO;
 *   a `%DISABLED` network                        nothing: CODESYS compiles none of it (1c).
 *
 * Everything else — contacts, labels — is ST as it stands. A twin is ST and nothing else: a box the twin cannot write is
 * refused by name (`TwinRefusal`).
 */
import {
  type BodySpan,
  type CallExpr,
  type Expr,
  plainStText,
  type Statement,
  stmtExprs,
  walkExpr,
} from "../../src/frontend/syntax/index.js"
import { lookup, type Scope } from "../../src/frontend/symbols/index.js"
import { boxMember, inferExprType, renderType, rootBox } from "../../src/frontend/types/index.js"
import { BoxTwinner, coilWrite, COMPARISON, INFIX, TwinRefusal } from "./network-twin-boxes.js"
import { type AssignStatement, guardedCalls, guardedReadBy, valueReads } from "./network-twin-reads.js"

export { TwinRefusal } from "./network-twin-boxes.js"

/** One body's twin: its ST statements and the variables they need (`name : TYPE;`) — its wires, each with its definition's
 *  type, its ENO temps and edge detectors, all in `VAR` (a wire keeps its value across scans, measured 2.3). */
export interface BodyTwin {
  code: string
  declarations: string[]
  wires: string[]
}

/** The twin of one plain-ST network body, read in `scope` (its network scope, `symbols` `bodies`). */
export function twinOf(body: BodySpan, statements: readonly Statement[], scope: Scope, project: Scope, source: string, k: number): BodyTwin {
  const skip = plainStText(body).networks.flatMap((n) => n.executes)
  const code = statements.filter((s) => skip.find((x) => s.span.start >= x.code.start && s.span.start < x.code.end) === undefined)
  const t = new Twinner(body, scope, project, source, `vtw${k}_`, guardedCalls(body, code, valueReads(body, code)))
  // the items a jump or a return after them shares the value of (`y := JMP.l := v;`)
  code.forEach((s, i) => {
    const next = code[i + 1]
    if ((next?.kind === "jmp" || next?.kind === "return") && next.sharesValue === true && !((s.kind === "jmp" || s.kind === "return") && s.sharesValue === true))
      t.sharing.add(s)
  })
  const lines: string[] = []
  for (const s of code) {
    if (t.guarded.has(s)) continue // written inside its short-circuit branch's guard
    lines.push(...t.statement(s))
  }
  return { code: lines.join("\n"), declarations: t.declarations(), wires: t.wireDeclarations() }
}

class Twinner extends BoxTwinner {
  private readonly wires = new Map<string, string>()
  /** The items whose value a jump or a return after them shares, and the temp the last one's value is held in. */
  readonly sharing = new Set<Statement>()
  private shared: string | undefined
  /** The edge detectors a `RISING(x)` / `FALLING(x)` runs on: `name : R_TRIG;`, one per edge. */
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

  /** The wires, each with its definition's type (`types` `network-call.ts`). */
  wireDeclarations(): string[] {
    const out: string[] = []
    for (const [lower, renamed] of this.wires) {
      const type = inferExprType({ kind: "ident_expr", name: lower, span: this.body.span }, this.scope, this.project)
      if (type.kind === "unknown") throw new TwinRefusal(`the wire ${lower} has no type the twin can declare`)
      out.push(`${renamed} : ${renderType(type)};`)
    }
    return out
  }

  declarations(): string[] {
    const out: string[] = []
    for (const t of this.temps) out.push(`${t} : BOOL;`)
    out.push(...this.typedTemps, ...this.trigs)
    return out
  }

  statement(s: Statement): string[] {
    const pre: string[] = []
    switch (s.kind) {
      case "assign": {
        const targets = [s.target, ...(s.chained ?? [])]
        const ops = [s.op ?? ":=", ...(s.chainOps ?? []).map((o) => o ?? ":=")]
        const marked = s.marks?.some((m) => m !== undefined) === true
        // an enabled box other than a comparison read by its value, the assignment's whole value: the assignment runs only
        // when enabled, and its targets hold when disabled (1.4)
        const read = s.value.kind === "member" && s.value.base.kind === "call" ? boxMember(s.value, this.scope, this.project) : undefined
        const box = read !== undefined && !read.eno && read.name.toUpperCase() === "OUT" ? this.box(read.box.call) : undefined
        if (box !== undefined && box.instance === undefined && box.enable !== undefined && !COMPARISON.has(this.name(box).toUpperCase())) {
          this.refuseMisleading(box, { consumed: true, member: read!.name })
          if (marked || this.sharing.has(s)) throw new TwinRefusal(`the enabled ${this.name(box)} box's value with a marked coil or a jump on it`)
          const cond = this.pin(box.enable!, pre)
          const value = this.boxValue(box, box.pins.filter((a) => !a.output), pre)
          const text = this.assign(s, value, pre)
          return [...pre, `IF ${cond} THEN\n\t${text}\nEND_IF;`]
        }
        let value = this.expr(s.value, pre)
        if (marked || this.sharing.has(s)) {
          const t = this.temp()
          pre.push(`${t} := ${value};`)
          value = t
          if (this.sharing.has(s)) this.shared = t
        }
        if (!marked) return [...pre, this.assign(s, value, pre)]
        // every target receives the value, in list order, each its own mark
        return [...pre, ...targets.map((x, i) => {
          const target = this.expr(x, pre)
          if (s.marks?.[i]?.includes("NOT") === true) return coilWrite("NOT", target, value)
          return `${target} ${ops[i]} ${value};`
        })]
      }
      case "call_stmt":
      case "expr_stmt": {
        // a value standing alone: a box consumed by nothing runs, its ENO read by nobody, the marks around it of no effect;
        // any other value is evaluated, what it runs kept, its value unread
        const value = s.kind === "call_stmt" ? s.call : s.expr
        const root = rootBox(value)
        if (root === undefined) {
          this.expr(value, pre)
          return pre
        }
        // closed by the name of another output, which runs as the call
        const execute = this.text(root.call.callee).toUpperCase() === "EXECUTE"
        if (root.member !== undefined && (execute || boxMember(root.member, this.scope, this.project) === undefined))
          throw new TwinRefusal(`the statement ${this.text(s)} in a network`)
        return [...pre, ...this.callStatement(root.call, root.member?.member.name, pre)]
      }
      case "empty":
        return []
      case "jmp":
      case "return": {
        const jump = s.kind === "jmp" ? `JMP ${this.text(s.target)}` : "RETURN"
        if (s.sharesValue === true) {
          if (this.shared === undefined) throw new TwinRefusal(`the jump ${this.text(s)} shares a value no item before it holds`)
          return [`IF ${this.jumpCond(s.marks, this.shared, s)} THEN ${jump}; END_IF;`]
        }
        if (s.value === undefined) throw new TwinRefusal(`the jump ${this.text(s)} on no value`)
        let cond = this.expr(s.value, pre)
        if (this.sharing.has(s)) {
          const t = this.temp()
          pre.push(`${t} := ${cond};`)
          cond = this.shared = t
        }
        return [...pre, `IF ${this.jumpCond(s.marks, cond, s)} THEN ${jump}; END_IF;`]
      }
      case "label":
        return [this.text(s)]
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

  /** A box standing as a statement (`closer` the member closing its call): it runs, its flow read by nobody. */
  private callStatement(call: CallExpr, closer: string | undefined, pre: string[]): string[] {
    const head = call.callee.kind === "ident_expr" ? call.callee.name : undefined
    if (head?.toUpperCase() === "EXECUTE") return this.execute(call, pre)
    const box = this.box(call)
    if (box === undefined) return [this.callText(call, call.args, pre) + ";"]
    this.refuseMisleading(box, { consumed: false, member: closer })
    if (box.instance !== undefined) {
      this.fb(box, false, undefined, pre) // a root's flow is read by nothing: with no EN it runs as the plain call (live CODESYS 3.5.21.40)
      return pre.splice(0)
    }
    if (box.enable !== undefined) {
      this.enabled(box, pre, false)
      return pre.splice(0)
    }
    // a function box at the root: its value to the target its `OUT =>` names, an operator's infix
    const result = box.pins.find((a) => a.output && a.param?.name.toUpperCase() === "OUT")
    if (result !== undefined) {
      const marked = this.markedOutputs(box, box.pins.filter((a) => a !== result), pre)
      const value = this.plainValue(box, marked.args, pre)
      const target = this.expr(result.value!, pre)
      return [...pre.splice(0), result.coil === undefined ? `${target} := ${value};` : coilWrite(result.coil, target, value), ...marked.post]
    }
    if (INFIX[this.name(box).toUpperCase()] !== undefined) return []
    const marked = this.markedOutputs(box, box.pins, pre)
    return [...pre.splice(0), this.callText(box.st, marked.args, pre) + ";", ...marked.post]
  }

  /** The Execute box at a root: its ST under its EN. */
  private execute(call: CallExpr, pre: string[]): string[] {
    const { cond, st } = this.executeBox(call, pre)
    return [...pre.splice(0), `IF ${cond} THEN\n${st}\nEND_IF;`]
  }

  /** The Execute box read where it stands: its ST under its EN, before the tree; its ENO, which is its EN, in it. */
  private executeRead(call: CallExpr, pre: string[]): string {
    const { cond, st } = this.executeBox(call, pre)
    const eno = this.temp()
    pre.push(`${eno} := ${cond};`, `IF ${eno} THEN\n${st}\nEND_IF;`)
    return eno
  }

  private executeBox(call: CallExpr, pre: string[]): { cond: string; st: string } {
    const box = plainStText(this.body).networks.flatMap((n) => n.executes).find((x) => x.call.start === call.span.start)
    if (box?.st === undefined) throw new TwinRefusal("an EXECUTE call that is no Execute box")
    const en = call.args.find((a) => a.param?.name.toUpperCase() === "EN")
    return { cond: en === undefined ? "TRUE" : this.pin(en, pre), st: box.st }
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

  /** A jump or the return in a tree (an ASSIGN's target, read as the call `JMP(l, v)` / `RETURN(v)`): the value in a
   *  temp, the jump taken on it (its own mark applied), the temp handed on. */
  private control(call: CallExpr, upper: string, pre: string[]): string {
    const t = this.temp()
    pre.push(`${t} := ${this.expr(call.args.at(-1)!.value!, pre)};`)
    const cond = call.marks?.includes("NOT") === true ? `(NOT ${t})` : t
    pre.push(`IF ${cond} THEN ${upper === "JMP" ? `JMP ${this.text(call.args[0]!.value!)}` : "RETURN"}; END_IF;`)
    return t
  }

  /** `RISING(x)` / `FALLING(x)`: an edge detector called with x where its tree is evaluated (`pre`), read by its Q (1.3). */
  private edge(call: CallExpr, pre: string[]): string {
    return this.edgeOf((call.callee as { name: string }).name.toUpperCase() === "RISING", this.expr(call.args[0]!.value!, pre), pre)
  }

  private edgeOf(rising: boolean, clk: string, pre: string[]): string {
    const name = `${this.prefix}trig${this.trigs.length + 1}`
    this.trigs.push(`${name} : ${rising ? "R_TRIG" : "F_TRIG"};`)
    pre.push(`${name}(CLK := ${clk});`)
    return `${name}.Q`
  }

  /** A jump's or the return's condition under its own mark: `Q_INVERTED => JMP.l` jumps when NOT the value. */
  private jumpCond(marks: readonly string[] | undefined, cond: string, _s: Statement): string {
    return marks?.includes("NOT") === true ? `(NOT ${cond})` : cond
  }

  /** An unmarked inline assignment, its value one too where it is (series coils, one ST chain). */
  private inline(e: Extract<Expr, { kind: "assign_expr" }>, pre: string[]): string {
    const v = e.value.kind === "assign_expr" && e.value.marks?.includes("NOT") !== true ? this.inline(e.value, pre) : this.expr(e.value, pre)
    return `(${this.expr(e.target, pre)} ${e.op ?? ":="} ${v})`
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
        if ((upper === "RISING" || upper === "FALLING") && lookup(this.scope, head!) === undefined) return this.edge(e, pre)
        if (upper === "RAIL" && lookup(this.scope, head!) === undefined) return "TRUE"
        if (upper === "JMP" || upper === "RETURN") return this.control(e, upper, pre)
        if (upper === "EXECUTE") return this.executeRead(e, pre)
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
      case "assign_expr": {
        // the inline assignment in its brackets, a series of them one chain (`((x := (y := v)))`)
        if (e.marks?.includes("NOT") !== true) return `(${this.inline(e, pre)})`
        // a negated coil in a tree hands on the value it receives, unmarked: the value in a temp
        const t = this.typedTemp(e.value)
        pre.push(`${t} := ${this.expr(e.value, pre)};`, coilWrite("NOT", this.expr(e.target, pre), t))
        return t
      }
      default:
        return this.text(e)
    }
  }
}
