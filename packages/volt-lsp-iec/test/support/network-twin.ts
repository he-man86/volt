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
 *   `X_EN(…, OUT => w); y := w;`                 any other enabled box read by its value is an assignment's value, which
 *                                                HOLDS when disabled (1.4): `IF e THEN y := X(pins…); END_IF`;
 *   `t1_EN(EN := e, IN := a, Q => w)`            `IF e THEN t1(IN := a, Q => w); … END_IF` — the FB is not called;
 *   `%EXECUTE(EN := e, ENO => w)` … `%END_EXECUTE` `IF e THEN <its ST> END_IF; w := e;`;
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
  isPlainStNetworkBody,
  type ParseResult,
  plainStText,
  type Statement,
  stmtExprs,
  unitBodies,
  walkExpr,
  allUnits,
  type TopLevel,
} from "../../src/frontend/syntax/index.js"
import { bodies, lookup, type Scope } from "../../src/frontend/symbols/index.js"
import { inferExprType, renderType } from "../../src/frontend/types/index.js"

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
  const t = new Twinner(body, scope, project, source, `vtw${k}_`, valueReads(body, code))
  const lines: string[] = []
  for (const s of code) {
    if (t.heldAssigns.has(s)) continue // written inside its enabled box's IF
    lines.push(...t.statement(s))
  }
  return { code: lines.join("\n"), declarations: t.declarations() }
}

type AssignStatement = Extract<Statement, { kind: "assign" }>

/** Each wire's occurrences in the network's code (its definition included), and the assignments whose whole value it is. */
interface ValueReads {
  occurrences: Map<string, number>
  assignedBy: Map<string, AssignStatement>
}

function valueReads(body: BodySpan, statements: readonly Statement[]): ValueReads {
  const wires = new Set(plainStText(body).networks.flatMap((n) => n.wires.map((w) => w.name.toLowerCase())))
  const occurrences = new Map<string, number>()
  const assignedBy = new Map<string, AssignStatement>()
  for (const s of statements) {
    for (const e of stmtExprs(s))
      walkExpr(e, (x) => {
        if (x.kind === "ident_expr" && wires.has(x.name.toLowerCase())) occurrences.set(x.name.toLowerCase(), (occurrences.get(x.name.toLowerCase()) ?? 0) + 1)
      })
    if (s.kind === "assign" && s.value.kind === "ident_expr" && wires.has(s.value.name.toLowerCase())) assignedBy.set(s.value.name.toLowerCase(), s)
  }
  return { occurrences, assignedBy }
}

class Twinner {
  /** The assignments an enabled box's value is written into inside its IF (held when disabled), by their wire. */
  readonly heldAssigns = new Set<Statement>()
  private readonly held = new Map<string, AssignStatement>()
  private readonly wires = new Map<string, string>()
  /** The wires an FB's output defines: read as that output (`t1.Q`), which holds what the call left in it — no
   *  variable to declare, and no type to name (a library's STRUCT may be named only through its namespace). */
  private readonly fbOutputs = new Set<string>()
  /** The output bindings those wires were defined by, by their call's start and their pin: dropped from the call. */
  private readonly droppedArgs = new Set<string>()
  private readonly temps: string[] = []
  private n = 0

  constructor(
    private readonly body: BodySpan,
    private readonly scope: Scope,
    private readonly project: Scope,
    private readonly source: string,
    private readonly prefix: string,
    private readonly reads: ValueReads,
  ) {
    for (const net of plainStText(body).networks)
      for (const w of net.wires) {
        const def = lookup(scope, w.name)?.symbol.wire
        const output = def?.kind === "output" && def.param.toUpperCase() !== "ENO" ? this.fbOutputOf(def.call, def.param) : undefined
        if (output === undefined) this.wires.set(w.name.toLowerCase(), prefix + w.name)
        else {
          this.wires.set(w.name.toLowerCase(), output.member)
          this.fbOutputs.add(w.name.toLowerCase())
          this.droppedArgs.add(`${output.at}:${output.pin}`)
        }
      }
  }

  /** `t1.Q` for a wire `t1(…, Q => w)` / `t1_EN(…, Q => w)` defines, where `t1` is an FB instance; else undefined. */
  private fbOutputOf(call: CallExpr, param: string): { member: string; at: number; pin: string } | undefined {
    if (call.callee.kind !== "ident_expr" && call.callee.kind !== "member" && call.callee.kind !== "index") return undefined
    const text = this.text(call.callee)
    const enabled = call.callee.kind === "ident_expr" && text.toUpperCase().endsWith("_EN") && lookup(this.scope, text) === undefined
    const instance = enabled ? text.slice(0, -3) : text
    const head: Expr = enabled ? { kind: "ident_expr", name: instance, span: call.callee.span } : call.callee
    if (inferExprType(head, this.scope, this.project).kind !== "function_block") return undefined
    return { member: `${instance}.${param}`, at: call.span.start, pin: param.toLowerCase() }
  }

  declarations(): string[] {
    const out: string[] = []
    for (const [lower, renamed] of this.wires) {
      if (this.fbOutputs.has(lower) || this.held.has(lower)) continue
      const type = inferExprType({ kind: "ident_expr", name: lower, span: this.body.span }, this.scope, this.project)
      if (type.kind === "unknown") throw new TwinRefusal(`the wire ${lower} has no type the twin can declare`)
      out.push(`${renamed} : ${renderType(type)};`)
    }
    for (const t of this.temps) out.push(`${t} : BOOL;`)
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
        const text = this.assign(s, this.expr(s.value, pre), pre)
        return [...pre, text]
      }
      case "call_stmt":
        return [...pre, ...this.callStatement(s.call, pre)]
      case "jmp":
      case "return":
      case "label":
        return [this.text(s) + (s.kind === "label" || this.text(s).trimEnd().endsWith(";") ? "" : ";")]
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
    if (head !== undefined && head.toUpperCase().endsWith("_EN") && lookup(this.scope, head) === undefined) {
      this.enabled(call, pre, false)
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

  /** An enabled box: runs under its EN; its ENO is EN (1.3). Returns the ENO's temp where `read`. */
  private enabled(call: CallExpr, pre: string[], read: boolean): string {
    const name = (call.callee as { name: string }).name
    const base = name.slice(0, -3)
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
      const named = outs.filter((a) => a !== result && a !== enoOut)
      // MOVE is the value it moves, which then takes its target's type, as the box's output does (`x := 0`, not a SINT)
      const moved = base.toUpperCase() === "MOVE" && ins.length === 1 && ins[0]!.param === undefined && named.length === 0
      const value = moved ? this.expr(ins[0]!.value!, inner)
        : INFIX[base.toUpperCase()] !== undefined ? this.operator(base, ins, inner) : this.callText({ ...call, callee: baseExpr }, [...ins, ...named], inner)
      const wire = result?.value?.kind === "ident_expr" && this.wires.has(result.value.name.toLowerCase()) ? result.value.name.toLowerCase() : undefined
      const holder = wire === undefined ? undefined : this.reads.assignedBy.get(wire)
      // read once by its value (its definition and one read): only as an assignment's whole value, which holds when the
      // box is disabled (1.4); CODESYS refuses it inside a box
      if (wire !== undefined && !COMPARISON.has(base.toUpperCase()) && this.reads.occurrences.get(wire) === 2) {
        if (holder === undefined)
          throw new TwinRefusal(`the enabled ${base} box is read by its value other than as an assignment's whole value`)
        this.held.set(wire, holder)
        this.heldAssigns.add(holder)
        inner.push(this.assign(holder, value, inner))
      } else if (result !== undefined) {
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

/** Every plain-ST network body of a parse with the scope it resolves in, its compiled statements, its unit. */
export function* networkBodies(parseResult: ParseResult, project: Scope): Generator<{ unit: TopLevel; body: BodySpan; scope: Scope; statements: readonly Statement[] }> {
  const wanted = new Set<BodySpan>()
  for (const unit of allUnits(parseResult.units)) for (const b of unitBodies(unit)) if (isPlainStNetworkBody(b)) wanted.add(b)
  for (const b of bodies(parseResult.units, project)) if (wanted.has(b.body)) yield b
}

/** An edit of the source: replace [start, end) with `text`. */
interface Edit {
  start: number
  end: number
  text: string
}

/**
 * A file with every plain-ST network body as its twin (`%LANGUAGE ST`), the variables each twin needs declared in a
 * `VAR` block of the unit that owns its scope — a POU's or a METHOD's own declaration; an ACTION, which has none, its
 * POU's. A body the twin cannot write is named in `refused` and left as it is.
 */
export function twinFile(source: string, parseResult: ParseResult, project: Scope): { source: string; refused: string[]; twinned: number } {
  const edits: Edit[] = []
  const refused: string[] = []
  let k = 0
  const units = allUnits(parseResult.units)
  for (const { unit, body, scope, statements } of networkBodies(parseResult, project)) {
    k++
    let twin: BodyTwin
    try {
      twin = twinOf(body, statements, scope, project, source, k)
    } catch (e) {
      if (!(e instanceof TwinRefusal)) throw e
      refused.push(`${unitName(unit)}: ${e.message}`)
      continue
    }
    const line = body.languageLine!
    edits.push({ start: line.span.start, end: Math.max(body.span.end, line.span.end), text: `%LANGUAGE ST\n${twin.code}\n` })
    if (twin.declarations.length === 0) continue
    // an ACTION's POU is the program or function block before it in the file (a pull writes the members after their POU)
    const owner = unit.kind === "action" ? [...units].reverse().find((u) => (u.kind === "program" || u.kind === "function_block") && u.span.start < unit.span.start) ?? unit : unit
    const at = owner === unit ? line.span.start : ("body" in owner && owner.body.kind === "body" ? owner.body.languageLine?.span.start : undefined)
    if (at === undefined) {
      refused.push(`${unitName(unit)}: no declaration to hold the twin's variables`)
      edits.pop()
      continue
    }
    edits.push({ start: at, end: at, text: `VAR\n\t${twin.declarations.join("\n\t")}\nEND_VAR\n` })
  }
  let out = source
  for (const e of edits.sort((a, b) => b.start - a.start || b.end - a.end)) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  return { source: out, refused, twinned: edits.filter((e) => e.text.startsWith("%LANGUAGE ST")).length }
}

function unitName(unit: TopLevel): string {
  return "name" in unit && unit.name !== undefined ? String((unit.name as { text?: string; name?: string }).text ?? (unit.name as { name?: string }).name) : unit.kind
}
