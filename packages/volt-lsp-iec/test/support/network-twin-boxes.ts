/**
 * THE EXEC TWIN'S BOXES (`network-twin.ts`, which holds the statements, the wires and the network's own elements): how a
 * box call runs as CODESYS ST — an operator infix, an enabled box under its EN, a box showing ENO without EN on every
 * scan, an FB box as its instance called before the item that reads it — and what it hands on.
 */
import { type CallArg, type CallExpr, type Expr, UNNAMED } from "../../src/frontend/syntax/index.js"
import { type Scope } from "../../src/frontend/symbols/index.js"
import { declaresEno, networkBox, type NetworkBox } from "../../src/frontend/types/index.js"

export class TwinRefusal extends Error {}

export const INFIX: Readonly<Record<string, string>> = {
  AND: "AND", OR: "OR", XOR: "XOR", ADD: "+", SUB: "-", MUL: "*", DIV: "/", MOD: "MOD",
  GT: ">", GE: ">=", LT: "<", LE: "<=", EQ: "=", NE: "<>",
}
export const COMPARISON = new Set(["GT", "GE", "LT", "LE", "EQ", "NE"])

export abstract class BoxTwinner {
  protected readonly temps: string[] = []
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

  protected text(e: { span: { start: number; end: number } }): string {
    return this.source.slice(e.span.start, e.span.end)
  }

  protected box(call: CallExpr): NetworkBox | undefined {
    return networkBox(call, this.scope, this.project)
  }

  protected name(box: NetworkBox): string {
    return box.call.callee.kind === "ident_expr" ? box.call.callee.name : this.text(box.call.callee)
  }

  /** A pin's (or EN's) value as the box reads it: its own `NOT` applied; an edge mark on a pin, and a mark on an output,
   *  has no measured run and is refused by name. */
  protected pin(a: CallArg, pre: string[]): string {
    const marks = a.marks ?? []
    const where = a.param?.name ?? "pin"
    if (a.output && marks.length > 0) throw new TwinRefusal(`the mark on the output ${where}: how a marked output runs is unmeasured`)
    if (marks.some((m) => m !== "NOT")) throw new TwinRefusal(`the edge mark on the pin ${where}: how an edge on a pin runs is unmeasured`)
    const v = this.expr(a.value!, pre)
    return marks.includes("NOT") ? `(NOT ${v})` : v
  }

  /** `X(pins…)` as the value a function box hands back: an operator infix, MOVE the value it moves (which then takes its
   *  target's type, as the box's output does: `x := 0`, not a SINT). */
  protected boxValue(box: NetworkBox, args: readonly CallArg[], pre: string[]): string {
    const base = this.name(box)
    if (base.toUpperCase() === "MOVE" && args.length === 1 && args[0]!.param === undefined) return this.pin(args[0]!, pre)
    if (INFIX[base.toUpperCase()] !== undefined || base.toUpperCase() === "NOT") return this.operator(base, args.filter((a) => !a.output), pre)
    return this.callText(box.st, args, pre)
  }

  /** `X(EN := e, pins…)` read by its value inside a tree: an enabled COMPARISON, FALSE when disabled (1.3). Any other is
   *  read by its value only as an assignment's whole value (`statement`). */
  protected enOnlyRead(box: NetworkBox, pre: string[]): string {
    const base = this.name(box)
    if (!COMPARISON.has(base.toUpperCase())) throw new TwinRefusal(`the enabled ${base} box is read by its value other than as an assignment's whole value`)
    const cond = this.pin(box.enable!, pre)
    const value = this.boxValue(box, box.pins.filter((a) => !a.output), pre)
    const t = this.temp()
    pre.push(`IF ${cond} THEN\n\t${t} := ${value};\nELSE\n\t${t} := FALSE;\nEND_IF;`)
    return t
  }

  /** An enabled function box: runs under its EN, what its pins evaluate on every scan (2.3); its ENO is EN (1.3).
   *  Returns the ENO's temp where `read`. */
  protected enabled(box: NetworkBox, pre: string[], read: boolean): string {
    const base = this.name(box)
    const cond = this.pin(box.enable!, pre)
    const eno = read ? this.temp() : undefined
    const inner: string[] = []
    const elseLines: string[] = []
    const outs = box.pins.filter((a) => a.output)
    const ins = box.pins.filter((a) => !a.output)
    const enoOut = outs.find((a) => a.param?.name.toUpperCase() === "ENO")
    const result = outs.find((a) => a.param?.name.toUpperCase() === "OUT")
    const value = this.boxValue(box, [...ins, ...outs.filter((a) => a !== result && a !== enoOut)], pre)
    if (result !== undefined) {
      const target = this.expr(result.value!, pre)
      inner.push(`${target} := ${value};`)
      if (COMPARISON.has(base.toUpperCase())) elseLines.push(`${target} := FALSE;`)
    } else inner.push(`${value};`)
    if (enoOut !== undefined) {
      const target = this.expr(enoOut.value!, pre)
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

  /** A function box showing its ENO and no EN (`X(…).ENO`): it runs on every scan, and its ENO is FALSE (measured,
   *  network-output-member 2.3: CODESYS sets no ENO a box has no EN for). */
  protected enoOnly(box: NetworkBox, pre: string[]): string {
    const enoOut = box.pins.find((a) => a.output && a.param?.name.toUpperCase() === "ENO")
    const rest = box.pins.filter((a) => a !== enoOut)
    const result = rest.filter((a) => a.output && a.param?.name.toUpperCase() === "OUT")
    if (result.length === 0) pre.push(this.callText(box.st, rest, pre) + ";")
    else {
      const value = this.callText(box.st, rest.filter((a) => !result.includes(a)), pre)
      pre.push(result.map((r) => `${this.expr(r.value!, pre)} := `).join("") + value + ";")
    }
    if (enoOut !== undefined) pre.push(`${this.expr(enoOut.value!, pre)} := FALSE;`)
    return "FALSE"
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
    const enoOut = box.pins.find((a) => a.output && a.param?.name.toUpperCase() === "ENO" && !declaresEno(box.signature))
    const pins = box.pins.filter((a) => a !== enoOut)
    let value = ""
    if (box.enable !== undefined) {
      const cond = this.pin(box.enable, pre)
      const inner: string[] = []
      inner.push(this.callText({ ...box.st, callee: inst }, pins, pre) + ";")
      const elseLines: string[] = []
      if (enoOut !== undefined) {
        inner.push(`${this.expr(enoOut.value!, pre)} := TRUE;`)
        elseLines.push(`${this.expr(enoOut.value!, pre)} := FALSE;`)
      }
      if (eno) {
        value = this.temp()
        inner.push(`${value} := TRUE;`)
        elseLines.push(`${value} := FALSE;`)
      }
      pre.push(`IF ${cond} THEN\n\t${inner.join("\n\t")}` + (elseLines.length > 0 ? `\nELSE\n\t${elseLines.join("\n\t")}` : "") + "\nEND_IF;")
    } else {
      if (eno || enoOut !== undefined) throw new TwinRefusal(`the ${this.name(box)} box shows ENO without EN, which CODESYS does not compile`)
      pre.push(this.callText({ ...box.st, callee: inst }, pins, pre) + ";")
    }
    if (eno || read === undefined) return value
    return `${instance}.${read}`
  }

  /** A box read where it stands (`member` the name closing its call). */
  protected boxRead(box: NetworkBox, member: string | undefined, pre: string[]): string {
    const eno = member !== undefined && member.toUpperCase() === "ENO" && !declaresEno(box.signature)
    if (box.instance !== undefined) {
      const read = eno ? undefined : member ?? box.signature?.outputs[0]
      if (!eno && read === undefined) throw new TwinRefusal(`the ${this.name(box)} box is read, and no declaration names its output`)
      return this.fb(box, eno, read, pre)
    }
    if (member !== undefined && !eno && member.toUpperCase() !== "OUT") throw new TwinRefusal(`the ${this.name(box)} box is read through its VAR_OUTPUT ${member}`)
    if (box.enable !== undefined) return eno ? this.enabled(box, pre, true) : this.enOnlyRead(box, pre)
    if (eno) return this.enoOnly(box, pre)
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
