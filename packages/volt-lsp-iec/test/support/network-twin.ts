/**
 * THE EXEC TWIN OF PLAIN-ST NETWORK TEXT (openspec network-text-st 2.4, design.md oracle 3): the CODESYS ST that runs as
 * the network a plain-ST network body spells. CODESYS ST has no call form for an operator box and no EN/ENO (1.2), so the
 * twin writes what the network runs, as 1.3 / 1.4 / 1c measured it:
 *
 *   `GT(i, 3)`, `ADD(a, b, c)`, `NOT(a)`         the operator, infix: `(i > 3)`, `(a + b + c)`, `(NOT a)`;
 *   `X_EN(EN := e, pins…, OUT => o)`             `IF e THEN o := X(pins…); eno := TRUE; ELSE eno := FALSE; END_IF` — an
 *                                                enabled box runs only when enabled, and its ENO is its EN (1.3); an
 *                                                enabled COMPARISON is FALSE when disabled (1.3), so its value is
 *                                                written FALSE in the ELSE; read where it stands, the call is its `eno`;
 *   `X_ENONLY(EN := e, pins…)`                   the box with EN and no ENO, its value: a comparison's FALSE when disabled
 *                                                (1.3), any other an assignment's whole value, held when disabled (1.4):
 *                                                `IF e THEN y := X(pins…); END_IF`; at the root as `X_EN`;
 *   `t1_EN(EN := e, IN := a, Q => w)`            `IF e THEN t1(IN := a, Q => w); … END_IF` — the FB is not called;
 *   `%EXECUTE(EN := e, ENO => w)` … `%END_EXECUTE` `IF e THEN <its ST> END_IF; w := e;`;
 *   `X_ENO(…)`                                   the call, on every scan; its ENO TRUE;
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
 * Everything else — contacts, coils, `S=`/`R=`, inline assignments, labels, `JMP`, `RETURN`, function and FB calls — is
 * ST as it stands. A twin is ST and nothing else: a box the twin cannot write is refused by name (`TwinRefusal`).
 */
import {
  type BodySpan,
  type CallArg,
  type CallExpr,
  type Expr,
  plainStText,
  type Statement,
  walkExpr,
} from "../../src/frontend/syntax/index.js"
import { lookup, type Scope } from "../../src/frontend/symbols/index.js"
import { inferExprType, renderType } from "../../src/frontend/types/index.js"
import { type AssignStatement, fbOutputOf, guardedCalls, guardedReadBy, valueReads } from "./network-twin-reads.js"

export class TwinRefusal extends Error {}

const INFIX: Readonly<Record<string, string>> = {
  AND: "AND", OR: "OR", XOR: "XOR", ADD: "+", SUB: "-", MUL: "*", DIV: "/", MOD: "MOD",
  GT: ">", GE: ">=", LT: "<", LE: "<=", EQ: "=", NE: "<>",
}
const COMPARISON = new Set(["GT", "GE", "LT", "LE", "EQ", "NE"])

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

class Twinner {
  private readonly wires = new Map<string, string>()
  /** The wires an FB's output defines: read as that output (`t1.Q`), which holds what the call left in it — no
   *  variable to declare, and no type to name (a library's STRUCT may be named only through its namespace). */
  private readonly fbOutputs = new Set<string>()
  /** The output bindings those wires were defined by, by their call's start and their pin: dropped from the call. */
  private readonly droppedArgs = new Set<string>()
  private readonly temps: string[] = []
  /** The edge detectors an `R_EDGE(x)` / `F_EDGE(x)` runs on: `name : R_TRIG;`, one per edge. */
  private readonly trigs: string[] = []
  /** The call statements written inside a short-circuit branch's guard (`guardedCalls`). */
  readonly guarded: Set<Statement>
  private n = 0

  constructor(
    private readonly body: BodySpan,
    private readonly scope: Scope,
    private readonly project: Scope,
    private readonly source: string,
    private readonly prefix: string,
    private readonly guardedByWire: ReadonlyMap<string, Statement>,
  ) {
    this.guarded = new Set(guardedByWire.values())
    for (const net of plainStText(body).networks)
      for (const w of net.wires) {
        const def = lookup(scope, w.name)?.symbol.wire
        const output = def?.kind === "output" && def.param.toUpperCase() !== "ENO" ? fbOutputOf(def.call, def.param, source, scope, project) : undefined
        if (output === undefined) this.wires.set(w.name.toLowerCase(), prefix + w.name)
        else {
          this.wires.set(w.name.toLowerCase(), output.member)
          this.fbOutputs.add(w.name.toLowerCase())
          this.droppedArgs.add(`${output.at}:${output.pin}`)
        }
      }
  }

  declarations(): string[] {
    const out: string[] = []
    for (const [lower, renamed] of this.wires) {
      if (this.fbOutputs.has(lower)) continue
      const type = inferExprType({ kind: "ident_expr", name: lower, span: this.body.span }, this.scope, this.project)
      if (type.kind === "unknown") throw new TwinRefusal(`the wire ${lower} has no type the twin can declare`)
      out.push(`${renamed} : ${renderType(type)};`)
    }
    for (const t of this.temps) out.push(`${t} : BOOL;`)
    out.push(...this.trigs)
    return out
  }

  private temp(): string {
    const name = `${this.prefix}eno${++this.n}`
    this.temps.push(name)
    return name
  }

  private text(e: { span: { start: number; end: number } }): string {
    return this.source.slice(e.span.start, e.span.end)
  }

  statement(s: Statement): string[] {
    const pre: string[] = []
    switch (s.kind) {
      case "assign": {
        // an enabled box other than a comparison, the assignment's whole value: the assignment runs only when enabled, and
        // its targets hold when disabled (1.4)
        if (s.value.kind === "call" && this.isEnOnly(s.value) && !COMPARISON.has(this.enOnlyBase(s.value).toUpperCase())) {
          const call = s.value
          const [en, ...rest] = call.args
          if (en === undefined || en.param?.name.toUpperCase() !== "EN") throw new TwinRefusal(`${this.enOnlyBase(call)}_ENONLY without EN`)
          const cond = this.expr(en.value!, pre)
          const inner: string[] = []
          const value = this.boxValue(call, this.enOnlyBase(call), rest.filter((a) => !a.output), inner)
          const text = this.assign(s, value, inner)
          return [...pre, `IF ${cond} THEN\n\t${[...inner, text].join("\n\t")}\nEND_IF;`]
        }
        const text = this.assign(s, this.expr(s.value, pre), pre)
        return [...pre, text]
      }
      case "call_stmt":
        return [...pre, ...this.callStatement(s.call, pre)]
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

  /** A call standing as a statement: its outputs written, its ENO read by nobody. */
  private callStatement(call: CallExpr, pre: string[]): string[] {
    const head = call.callee.kind === "ident_expr" ? call.callee.name : undefined
    if (head?.toUpperCase() === "EXECUTE") return this.execute(call, pre)
    if (head !== undefined && (head.toUpperCase().endsWith("_EN") || this.isEnOnly(call)) && lookup(this.scope, head) === undefined) {
      this.enabled(call, pre, false)
      return pre.splice(0)
    }
    if (head !== undefined && head.toUpperCase().endsWith("_ENO") && lookup(this.scope, head) === undefined) {
      this.enoOnly(call, pre)
      return pre.splice(0)
    }
    if (head !== undefined && INFIX[head.toUpperCase()] !== undefined) {
      const out = call.args.find((a) => a.output)
      return out === undefined ? [] : [`${this.expr(out.value!, pre)} := ${this.operator(head, call.args.filter((a) => !a.output), pre)};`]
    }
    return [this.callText(call, call.args, pre) + ";"]
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

  /** Is `call` a box with EN and no ENO (`X_ENONLY`), X no declared name? */
  private isEnOnly(call: CallExpr): boolean {
    return call.callee.kind === "ident_expr" && /.(_ENONLY)$/i.test(call.callee.name) && lookup(this.scope, call.callee.name) === undefined
  }

  private enOnlyBase(call: CallExpr): string {
    return (call.callee as { name: string }).name.slice(0, -"_ENONLY".length)
  }

  /** `X(pins…)` as the value a function box hands back: an operator infix, MOVE the value it moves (which then takes its
   *  target's type, as the box's output does: `x := 0`, not a SINT). */
  private boxValue(call: CallExpr, base: string, args: readonly CallArg[], pre: string[]): string {
    const baseExpr: Expr = { kind: "ident_expr", name: base, span: call.callee.span }
    if (base.toUpperCase() === "MOVE" && args.length === 1 && args[0]!.param === undefined) return this.expr(args[0]!.value!, pre)
    if (INFIX[base.toUpperCase()] !== undefined) return this.operator(base, args.filter((a) => !a.output), pre)
    return this.callText({ ...call, callee: baseExpr }, args, pre)
  }

  /** `X_ENONLY(EN := e, pins…)` read by its value inside a tree: an enabled COMPARISON, FALSE when disabled (1.3). Any other
   *  is read by its value only as an assignment's whole value (`statement`). */
  private enOnlyRead(call: CallExpr, pre: string[]): string {
    const base = this.enOnlyBase(call)
    if (!COMPARISON.has(base.toUpperCase())) throw new TwinRefusal(`the enabled ${base} box is read by its value other than as an assignment's whole value`)
    const [en, ...rest] = call.args
    if (en === undefined || en.param?.name.toUpperCase() !== "EN") throw new TwinRefusal(`${base}_ENONLY without EN`)
    const cond = this.expr(en.value!, pre)
    const inner: string[] = []
    const value = this.boxValue(call, base, rest.filter((a) => !a.output), inner)
    const t = this.temp()
    pre.push(`IF ${cond} THEN\n\t${[...inner, `${t} := ${value};`].join("\n\t")}\nELSE\n\t${t} := FALSE;\nEND_IF;`)
    return t
  }

  /** An enabled box: runs under its EN; its ENO is EN (1.3). Returns the ENO's temp where `read`. */
  private enabled(call: CallExpr, pre: string[], read: boolean): string {
    const name = (call.callee as { name: string }).name
    const base = name.slice(0, -(/_ENONLY$/i.test(name) ? 7 : 3))
    const [en, ...rest] = call.args
    if (en === undefined || en.param?.name.toUpperCase() !== "EN") throw new TwinRefusal(`${name} without EN`)
    const cond = this.expr(en.value!, pre)
    const eno = read ? this.temp() : undefined
    const inner: string[] = []
    const elseLines: string[] = []
    const baseExpr: Expr = { kind: "ident_expr", name: base, span: call.callee.span }
    const isFb = inferExprType(baseExpr, this.scope, this.project).kind === "function_block"
    const outs = rest.filter((a) => a.output)
    const ins = rest.filter((a) => !a.output)
    const enoOut = outs.find((a) => a.param?.name.toUpperCase() === "ENO")
    if (isFb) inner.push(this.callText({ ...call, callee: baseExpr }, rest.filter((a) => a !== enoOut), inner) + ";")
    else {
      const result = outs.find((a) => a.param?.name.toUpperCase() === "OUT")
      const value = this.boxValue(call, base, [...ins, ...outs.filter((a) => a !== result && a !== enoOut)], inner)
      if (result !== undefined) {
        const target = this.expr(result.value!, inner)
        inner.push(`${target} := ${value};`)
        if (COMPARISON.has(base.toUpperCase())) elseLines.push(`${target} := FALSE;`)
      } else inner.push(`${value};`)
    }
    if (enoOut !== undefined) {
      const target = this.expr(enoOut.value!, inner)
      inner.push(`${target} := TRUE;`)
      elseLines.push(`${target} := FALSE;`)
    }
    if (eno !== undefined) {
      inner.push(`${eno} := TRUE;`)
      elseLines.push(`${eno} := FALSE;`)
    }
    pre.push(`IF ${cond} THEN\n\t${inner.join("\n\t")}` + (elseLines.length > 0 ? `\nELSE\n\t${elseLines.join("\n\t")}` : "") + "\nEND_IF;")
    return eno ?? ""
  }

  /** A box showing its ENO and no EN (`X_ENO`): it runs on every scan, and its ENO is TRUE (its EN is the rail). */
  private enoOnly(call: CallExpr, pre: string[]): string {
    const name = (call.callee as { name: string }).name
    const base: Expr = { kind: "ident_expr", name: name.slice(0, -4), span: call.callee.span }
    const enoOut = call.args.find((a) => a.output && a.param?.name.toUpperCase() === "ENO")
    const rest = call.args.filter((a) => a !== enoOut)
    if (inferExprType(base, this.scope, this.project).kind === "function_block") pre.push(this.callText({ ...call, callee: base }, rest, pre) + ";")
    else {
      const result = rest.filter((a) => a.output && a.param?.name.toUpperCase() === "OUT")
      if (result.length === 0) throw new TwinRefusal(`${name}: a function showing ENO whose value nothing reads`)
      const value = this.callText({ ...call, callee: base }, rest.filter((a) => !result.includes(a)), pre)
      pre.push(result.map((r) => `${this.expr(r.value!, pre)} := `).join("") + value + ";")
    }
    if (enoOut !== undefined) pre.push(`${this.expr(enoOut.value!, pre)} := TRUE;`)
    return "TRUE"
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

  private operator(name: string, args: readonly CallArg[], pre: string[]): string {
    const values = args.map((a) => this.expr(a.value!, pre))
    if (name.toUpperCase() === "NOT") return `(NOT ${values[0]})`
    return `(${values.join(` ${INFIX[name.toUpperCase()]} `)})`
  }

  private callText(call: CallExpr, args: readonly CallArg[], pre: string[]): string {
    const head = this.expr(call.callee, pre)
    const parts = args.filter((a) => !(a.output && this.droppedArgs.has(`${call.span.start}:${a.param?.name.toLowerCase()}`))).map((a) => {
      if (a.param === undefined) return this.expr(a.value!, pre)
      return `${a.param.name} ${a.output ? "=>" : ":="} ${a.value === undefined ? "" : this.expr(a.value, pre)}`
    })
    return `${head}(${parts.join(", ")})`
  }

  expr(e: Expr, pre: string[]): string {
    switch (e.kind) {
      case "ident_expr":
        return this.wires.get(e.name.toLowerCase()) ?? e.name
      case "call": {
        const head = e.callee.kind === "ident_expr" ? e.callee.name : undefined
        const upper = head?.toUpperCase()
        if (upper !== undefined && (INFIX[upper] !== undefined || upper === "NOT") && e.args.every((a) => a.param === undefined && !a.output))
          return this.operator(head!, e.args, pre)
        if (head !== undefined && upper!.endsWith("_EN") && lookup(this.scope, head) === undefined) return this.enabled(e, pre, true)
        if (this.isEnOnly(e)) return this.enOnlyRead(e, pre)
        if (head !== undefined && upper!.endsWith("_ENO") && lookup(this.scope, head) === undefined) return this.enoOnly(e, pre)
        if (upper === "BRANCH" || upper === "BRANCH_SHORTCIRCUIT") return this.branch(e, pre)
        if (upper === "R_EDGE" || upper === "F_EDGE") return this.edge(e, pre)
        if (upper === "JMP" || upper === "RETURN") return this.control(e, upper, pre)
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
