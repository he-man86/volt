/**
 * THE EXEC TWIN'S BOXES (`network-twin.ts`, which holds the statements, the wires and the network's own elements): how a
 * box call runs as CODESYS ST — an operator infix, an enabled box under its EN, an FB box as its instance called before
 * the item that reads it, a marked output read into a temp and written to its target after the call — and what it hands
 * on: its default output (its ENO where EN is shown, else a function's value, an FB's first output) or the one a member
 * names.
 */
import { type CallArg, type CallExpr, type Expr, type OutputMark, UNNAMED } from "../../src/frontend/syntax/index.js"
import { type Scope } from "../../src/frontend/symbols/index.js"
import { defaultFlow, inferExprType, misleadingBox, networkBox, renderType, type NetworkBox } from "../../src/frontend/types/index.js"

export class TwinRefusal extends Error {}

export const INFIX: Readonly<Record<string, string>> = {
  AND: "AND", OR: "OR", XOR: "XOR", ADD: "+", SUB: "-", MUL: "*", DIV: "/", MOD: "MOD",
  GT: ">", GE: ">=", LT: "<", LE: "<=", EQ: "=", NE: "<>",
}
export const COMPARISON = new Set(["GT", "GE", "LT", "LE", "EQ", "NE"])

/** A marked output's write of `value` to `target`: the negated coil, the set coil, the reset coil. */
export function coilWrite(mark: OutputMark | "NOT" | "S=" | "R=", target: string, value: string): string {
  if (mark === "INVERTED" || mark === "NOT") return `${target} := (NOT ${value});`
  return `IF ${value} THEN ${target} := ${mark === "SET" || mark === "S=" ? "TRUE" : "FALSE"}; END_IF;`
}

export abstract class BoxTwinner {
  protected readonly temps: string[] = []
  /** The temps of another type than BOOL: `name : TYPE;`. */
  protected readonly typedTemps: string[] = []
  private n = 0

  constructor(
    protected readonly scope: Scope,
    protected readonly project: Scope,
    protected readonly source: string,
    protected readonly prefix: string,
  ) {}

  abstract expr(e: Expr, pre: string[]): string

  protected temp(): string {
    const name = `${this.prefix}eno${++this.n}`
    this.temps.push(name)
    return name
  }

  /** A temp of the type `e` has. */
  protected typedTemp(e: Expr): string {
    const type = inferExprType(e, this.scope, this.project)
    if (type.kind === "unknown") throw new TwinRefusal(`the value of ${this.text(e)} has no type the twin can declare`)
    const name = `${this.prefix}eno${++this.n}`
    this.typedTemps.push(`${name} : ${renderType(type)};`)
    return name
  }

  /** The box's pins with each marked output bound to a temp, and the writes of those temps to their targets. */
  protected markedOutputs(box: NetworkBox, args: readonly CallArg[], pre: string[]): { args: CallArg[]; post: string[] } {
    const post: string[] = []
    const out = args.map((a): CallArg => {
      if (a.coil === undefined || !a.output || a.value === undefined) return a
      const base: Expr = box.instance ?? box.call
      const t = this.typedTemp({ kind: "member", base, member: { kind: "ident_expr", name: a.param!.name, span: a.span }, span: box.call.span })
      post.push(coilWrite(a.coil, this.expr(a.value, pre), t))
      return { kind: "call_arg", param: a.param, output: true, value: { kind: "ident_expr", name: t, span: a.span }, span: a.span }
    })
    return { args: out, post }
  }

  protected text(e: { span: { start: number; end: number } }): string {
    return this.source.slice(e.span.start, e.span.end)
  }

  /** The box `call` is, an output pin holding `???` (`OUT => ???`, an output nothing is wired to) left out: it runs as
   *  the box with that output unread. */
  protected box(call: CallExpr): NetworkBox | undefined {
    const box = networkBox(call, this.scope, this.project)
    if (box === undefined) return undefined
    const wired = (a: CallArg) => !(a.output && a.value?.kind === "ident_expr" && a.value.name === UNNAMED)
    return { ...box, pins: box.pins.filter(wired), st: { ...box.st, args: box.st.args.filter(wired) } }
  }

  protected name(box: NetworkBox): string {
    return box.call.callee.kind === "ident_expr" ? box.call.callee.name : this.text(box.call.callee)
  }

  /** A pin's (or EN's) value as the box reads it. */
  protected pin(a: CallArg, pre: string[]): string {
    return this.expr(a.value!, pre)
  }

  /** `X(pins…)` as the value a function box hands back, in a tree: a marked output of the call written right after it,
   *  the call held in a temp before the tree that reads it. */
  protected boxValue(box: NetworkBox, args: readonly CallArg[], pre: string[]): string {
    const marked = this.markedOutputs(box, args, pre)
    const v = this.plainValue(box, marked.args, pre)
    if (marked.post.length === 0) return v
    const t = this.typedTemp({ ...box.call, args: box.call.args.filter((a) => a.param?.name.toUpperCase() !== "EN") })
    pre.push(`${t} := ${v};`, ...marked.post)
    return t
  }

  /** `X(pins…)` as the value a function box hands back: an operator infix, MOVE the value it moves (which then takes its
   *  target's type, as the box's output does: `x := 0`, not a SINT). */
  protected plainValue(box: NetworkBox, args: readonly CallArg[], pre: string[]): string {
    const base = this.name(box)
    if (base.toUpperCase() === "MOVE" && args.length === 1 && args[0]!.param === undefined) return this.pin(args[0]!, pre)
    if (INFIX[base.toUpperCase()] !== undefined || base.toUpperCase() === "NOT") return this.operator(base, args.filter((a) => !a.output), pre)
    return this.callText(box.st, args, pre)
  }

  /** `X(EN := e, pins…).OUT` read by its value inside a tree: an enabled COMPARISON, FALSE when disabled (1.3). Any other
   *  is read by its value only as an assignment's whole value (`statement`). */
  protected enOnlyRead(box: NetworkBox, pre: string[]): string {
    const base = this.name(box)
    if (!COMPARISON.has(base.toUpperCase())) throw new TwinRefusal(`the enabled ${base} box is read by its value other than as an assignment's whole value`)
    const cond = this.pin(box.enable!, pre)
    const value = this.boxValue(box, box.pins.filter((a) => !a.output), pre)
    const t = this.temp()
    pre.push(`IF ${cond} THEN\n\t${t} := ${value};\nELSE\n\t${t} := FALSE;\nEND_IF;`)
    return t
  }

  /** An enabled function box: runs under its EN, what its pins evaluate on every scan (2.3); its ENO is EN (1.3), shown
   *  with EN: a comparison holds its target when disabled. Returns the ENO's temp where `read`. */
  protected enabled(box: NetworkBox, pre: string[], read: boolean): string {
    const cond = this.pin(box.enable!, pre)
    const eno = read ? this.temp() : undefined
    const inner: string[] = []
    const elseLines: string[] = []
    const outs = box.pins.filter((a) => a.output)
    const ins = box.pins.filter((a) => !a.output)
    const result = outs.find((a) => a.param?.name.toUpperCase() === "OUT")
    const marked = this.markedOutputs(box, [...ins, ...outs.filter((a) => a !== result)], pre)
    const value = this.plainValue(box, marked.args, pre)
    if (result !== undefined) {
      const target = this.expr(result.value!, pre)
      inner.push(result.coil === undefined ? `${target} := ${value};` : coilWrite(result.coil, target, value))
    } else if (!value.startsWith("(")) inner.push(`${value};`) // an operator's value wired nowhere runs nothing (rule 7)
    inner.push(...marked.post)
    if (eno !== undefined) {
      inner.push(`${eno} := TRUE;`)
      elseLines.push(`${eno} := FALSE;`)
    }
    pre.push(`IF ${cond} THEN\n\t${inner.join("\n\t")}` + (elseLines.length > 0 ? `\nELSE\n\t${elseLines.join("\n\t")}` : "") + "\nEND_IF;")
    return eno ?? ""
  }

  /**
   * AN FB BOX: its instance called before the item that reads it (`t1(IN := a);`, the FB runs before the tree) — before
   * the enabled box that reads it too, on every scan — under its own EN where shown, what its pins evaluate on every
   * scan (measured, network-output-member 2.3); read through `.ENO` its ENO, its EN; through `.NAME` that output, through
   * nothing its one output. Returns what the box hands on, `read` naming the output (undefined at a root). An FB box
   * showing ENO without EN is refused: CODESYS does not compile it ("'ENO' is no component of …", 2.3).
   */
  protected fb(box: NetworkBox, eno: boolean, read: string | undefined, pre: string[]): string {
    const inst = box.instance!
    // the vendor's unnamed instance (`???`): the call of its TYPE, which names no instance — the build's own errors
    // over the marker (`Program name, function or function block instance expected`), a box nothing reads
    if (inst.kind === "ident_expr" && inst.name === UNNAMED) {
      if (read !== undefined || eno || box.enable !== undefined) throw new TwinRefusal(`the ${this.name(box)} box with no instance (???) is read or enabled`)
      pre.push(this.callText(box.call, box.pins, pre) + ";")
      return ""
    }
    const instance = this.expr(inst, pre)
    const marked = this.markedOutputs(box, box.pins, pre)
    const pins = marked.args
    let value = ""
    if (box.enable !== undefined) {
      const cond = this.pin(box.enable, pre)
      const inner: string[] = []
      inner.push(this.callText({ ...box.st, callee: inst }, pins, pre) + ";", ...marked.post)
      const elseLines: string[] = []
      if (eno) {
        value = this.temp()
        inner.push(`${value} := TRUE;`)
        elseLines.push(`${value} := FALSE;`)
      }
      pre.push(`IF ${cond} THEN\n\t${inner.join("\n\t")}` + (elseLines.length > 0 ? `\nELSE\n\t${elseLines.join("\n\t")}` : "") + "\nEND_IF;")
    } else pre.push(this.callText({ ...box.st, callee: inst }, pins, pre) + ";", ...marked.post)
    if (eno || read === undefined) return value
    return `${instance}.${read}`
  }

  /** A box whose text claims what its run does not do has no twin (`misleadingBox`). */
  protected refuseMisleading(box: NetworkBox, at: { consumed: boolean; member: string | undefined }): void {
    const [first] = misleadingBox(box, this.name(box), at)
    if (first !== undefined) throw new TwinRefusal(first.message)
    if (box.ambiguous.length > 0) throw new TwinRefusal(`the ambiguous output ${box.ambiguous[0]!.param!.name} of ${this.name(box)}`)
  }

  /** A box read where it stands (`member` the name closing its call): its default output, or the one `member` names. */
  protected boxRead(box: NetworkBox, member: string | undefined, pre: string[]): string {
    this.refuseMisleading(box, { consumed: true, member })
    const flow = member === undefined ? defaultFlow(box) : undefined
    if (member === undefined && flow === undefined) throw new TwinRefusal(`the ${this.name(box)} box is read, and no declaration names its output`)
    if (flow?.kind === "none") throw new TwinRefusal(`the ${this.name(box)} box is read, and declares no output to read`)
    const eno = flow?.kind === "eno"
    if (box.instance !== undefined) return this.fb(box, eno, eno ? undefined : member ?? (flow?.kind === "output" ? flow.name : undefined), pre)
    if (eno) return this.enabled(box, pre, true)
    if (box.signature?.shape === "program" && !box.isFunction) {
      // a program box read where it stands: the program runs before the tree, the output read after it
      const read = member ?? (flow?.kind === "output" ? flow.name : undefined)
      if (read === undefined) throw new TwinRefusal(`the ${this.name(box)} program box is read, and declares no output to read`)
      const marked = this.markedOutputs(box, box.pins, pre)
      pre.push(this.callText(box.st, marked.args, pre) + ";", ...marked.post)
      return `${this.expr(box.call.callee, pre)}.${read}`
    }
    if (member !== undefined && member.toUpperCase() !== "OUT") throw new TwinRefusal(`the ${this.name(box)} box is read through its VAR_OUTPUT ${member}`)
    if (box.enable !== undefined) return this.enOnlyRead(box, pre)
    return this.boxValue(box, box.pins, pre)
  }

  protected operator(name: string, args: readonly CallArg[], pre: string[]): string {
    const values = args.map((a) => this.pin(a, pre))
    if (name.toUpperCase() === "NOT") return `(NOT ${values[0]})`
    return `(${values.join(` ${INFIX[name.toUpperCase()]} `)})`
  }

  protected callText(call: CallExpr, args: readonly CallArg[], pre: string[]): string {
    const head = this.expr(call.callee, pre)
    const parts = args.map((a) => {
      if (a.param === undefined) return this.pin(a, pre)
      return `${a.param.name} ${a.output ? "=>" : ":="} ${a.value === undefined ? "" : this.pin(a, pre)}`
    })
    return `${head}(${parts.join(", ")})`
  }
}
