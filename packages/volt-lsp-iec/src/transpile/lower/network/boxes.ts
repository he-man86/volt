/**
 * A NETWORK'S BOXES AS THE ST THEY RUN AS (`network.ts` holds the statements, the wires and the network's own elements),
 * each rule as CODESYS measured it (network-text-st 1.3 / 1.4, network-output-member 2.3):
 *
 *   `GT(i, 3)`, `ADD(a, b, c)`, `NOT(a)`     the operator, infix: `i > 3`, `a + b + c`, `NOT a`; `MOVE(x)` the value x;
 *   `X(EN := e, pins…, OUT => o).ENO`        `IF e THEN o := X(pins…); eno := TRUE; ELSE eno := FALSE; END_IF` — an enabled
 *                                            box runs only when enabled and its ENO is its EN; an enabled COMPARISON's
 *                                            value is FALSE when disabled;
 *   `X(EN := e, pins…)`                      read by its value: a comparison FALSE when disabled; any other only as an
 *                                            assignment's whole value, which holds when disabled (`network.ts`);
 *   `X(pins…).ENO`                           the call on every scan, its ENO FALSE; on an FB refused (CODESYS compiles
 *                                            none);
 *   `t1(IN := a).Q`                          `t1(IN := a);` before the item, `t1.Q` in it, on every scan; under its own EN
 *                                            where shown; read through nothing named, its one output;
 *   `T(pins…)`, T an FB type (`???`)         the call of its type, read or enabled refused;
 *   `g(pins…).OUT`                           a function's value: the call.
 *
 * What a box's pins evaluate runs on every scan, only the box under its EN. A pin's or EN's own `NOT` (`t1(NOT IN := a)`)
 * negates what it reads; an edge mark on a pin or EN, and any mark on an output, is unmeasured and refused by name.
 */
import { type CallArg, type CallExpr, type Expr, type Statement, type BodySpan, type Span, UNNAMED } from "../../../frontend/syntax/index.js"
import type { Scope } from "../../../frontend/symbols/index.js"
import { declaresEno, networkBox, type NetworkBox } from "../../../frontend/types/index.js"
import { assign, assignAll, binary, bool, call, ifThen, member, NetworkRefusal, NOT_COMPILED, not, standing } from "./ast.js"

const INFIX: Readonly<Record<string, string>> = {
  AND: "AND", OR: "OR", XOR: "XOR", ADD: "+", SUB: "-", MUL: "*", DIV: "/", MOD: "MOD",
  GT: ">", GE: ">=", LT: "<", LE: "<=", EQ: "=", NE: "<>",
}
export const COMPARISON: ReadonlySet<string> = new Set(["GT", "GE", "LT", "LE", "EQ", "NE"])
export const isInfix = (name: string): boolean => INFIX[name.toUpperCase()] !== undefined

const named = (a: CallArg, name: string): boolean => a.param?.name.toUpperCase() === name

export abstract class BoxLowerer {
  constructor(
    protected readonly body: BodySpan,
    protected readonly scope: Scope,
    protected readonly project: Scope,
  ) {}

  /** `e` as the network runs it, what must run before it appended to `pre`. */
  abstract expr(e: Expr, pre: Statement[]): Expr

  /** A fresh BOOL of the network being lowered (`__nw<N>_eno<k>`), at `span`. */
  protected abstract temp(span: Span): Expr

  /** The text a span covers, for a refusal's message. */
  protected text(span: Span): string {
    return this.body.tokens.filter((t) => t.span.start >= span.start && t.span.end <= span.end).map((t) => t.text).join("").trim()
  }

  protected box(c: CallExpr): NetworkBox | undefined {
    return networkBox(c, this.scope, this.project)
  }

  protected name(box: NetworkBox): string {
    return box.call.callee.kind === "ident_expr" ? box.call.callee.name : this.text(box.call.callee.span)
  }

  /** A pin's (or EN's) value as the box reads it: its own `NOT` applied. An edge mark on a pin, and a mark on an output,
   *  has no measured run and is refused by name. */
  protected pin(a: CallArg, pre: Statement[]): Expr {
    const marks = a.marks ?? []
    const where = a.param?.name ?? "pin"
    if (a.output && marks.length > 0) throw new NetworkRefusal(`the mark on the output ${where}: how a marked output runs is unmeasured`)
    if (marks.some((m) => m !== "NOT")) throw new NetworkRefusal(`the edge mark on the pin ${where}: how an edge on a pin runs is unmeasured`)
    const v = this.expr(a.value!, pre)
    return marks.includes("NOT") ? not(v, a.span) : v
  }

  /** `X(pins…)` as the value a function box hands back: an operator infix, MOVE the value it moves. */
  protected boxValue(box: NetworkBox, args: readonly CallArg[], pre: Statement[]): Expr {
    const base = this.name(box).toUpperCase()
    if (base === "MOVE" && args.length === 1 && args[0]!.param === undefined) return this.pin(args[0]!, pre)
    if (isInfix(base) || base === "NOT") return this.operator(base, box.call.span, args.filter((a) => !a.output), pre)
    return this.callOf(box.st, args, pre)
  }

  /** `X(EN := e, pins…)` read by its value in a tree: an enabled comparison, FALSE when disabled. */
  protected enOnlyRead(box: NetworkBox, pre: Statement[]): Expr {
    const base = this.name(box)
    if (!COMPARISON.has(base.toUpperCase())) throw new NetworkRefusal(`the enabled ${base} box is read by its value other than as an assignment's whole value`)
    const cond = this.pin(box.enable!, pre)
    const value = this.boxValue(box, box.pins.filter((a) => !a.output), pre)
    const t = this.temp(box.call.span)
    pre.push(ifThen(cond, [assign(t, value, box.call.span)], [assign(t, bool(false, box.call.span), box.call.span)], box.call.span))
    return t
  }

  /** An enabled function box: it runs under its EN, its ENO is its EN. Returns the ENO's temp where `read`. */
  protected enabled(box: NetworkBox, pre: Statement[], read: boolean): Expr | undefined {
    const span = box.call.span
    const cond = this.pin(box.enable!, pre)
    const eno = read ? this.temp(span) : undefined
    const outs = box.pins.filter((a) => a.output)
    const enoOut = outs.find((a) => named(a, "ENO"))
    const result = outs.find((a) => named(a, "OUT"))
    const value = this.boxValue(box, [...box.pins.filter((a) => !a.output), ...outs.filter((a) => a !== result && a !== enoOut)], pre)
    const then: Statement[] = []
    const otherwise: Statement[] = []
    if (result !== undefined) {
      const target = this.expr(result.value!, pre)
      then.push(assign(target, value, span))
      if (COMPARISON.has(this.name(box).toUpperCase())) otherwise.push(assign(target, bool(false, span), span))
    } else then.push(standing(value))
    for (const flag of [...(enoOut === undefined ? [] : [this.expr(enoOut.value!, pre)]), ...(eno === undefined ? [] : [eno])]) {
      then.push(assign(flag, bool(true, span), span))
      otherwise.push(assign(flag, bool(false, span), span))
    }
    pre.push(ifThen(cond, then, otherwise, span))
    return eno
  }

  /** A function box showing its ENO and no EN: it runs on every scan, and its ENO is FALSE (CODESYS sets no ENO a box has
   *  no EN for). */
  protected enoOnly(box: NetworkBox, pre: Statement[]): Expr {
    const span = box.call.span
    const enoOut = box.pins.find((a) => a.output && named(a, "ENO"))
    const rest = box.pins.filter((a) => a !== enoOut)
    const results = rest.filter((a) => a.output && named(a, "OUT"))
    if (results.length === 0) pre.push(standing(this.callOf(box.st, rest, pre)))
    else {
      const value = this.callOf(box.st, rest.filter((a) => !results.includes(a)), pre)
      pre.push(assignAll(results.map((r) => this.expr(r.value!, pre)), value, span))
    }
    if (enoOut !== undefined) pre.push(assign(this.expr(enoOut.value!, pre), bool(false, span), span))
    return bool(false, span)
  }

  /**
   * AN FB BOX: its instance called before the item that reads it, on every scan — under its own EN where shown; read
   * through `.ENO` its ENO (its EN), through `.NAME` that output. Returns what the box hands on (undefined at a root).
   */
  protected fb(box: NetworkBox, eno: boolean, read: string | undefined, pre: Statement[]): Expr | undefined {
    const inst = box.instance!
    const span = box.call.span
    if (inst.kind === "ident_expr" && inst.name === UNNAMED) {
      if (read !== undefined || eno || box.enable !== undefined) throw new NetworkRefusal(`the ${this.name(box)} box with no instance (???) is read or enabled`)
      pre.push(standing(this.callOf(box.call, box.pins, pre)))
      return undefined
    }
    const instance = this.expr(inst, pre)
    const enoOut = box.pins.find((a) => a.output && named(a, "ENO") && !declaresEno(box.signature))
    const pins = box.pins.filter((a) => a !== enoOut)
    let value: Expr | undefined
    if (box.enable !== undefined) {
      const cond = this.pin(box.enable, pre)
      const then: Statement[] = [standing(this.callOf({ ...box.st, callee: inst }, pins, pre))]
      const otherwise: Statement[] = []
      const flags = enoOut === undefined ? [] : [this.expr(enoOut.value!, pre)]
      if (eno) flags.push((value = this.temp(span)))
      for (const flag of flags) {
        then.push(assign(flag, bool(true, span), span))
        otherwise.push(assign(flag, bool(false, span), span))
      }
      pre.push(ifThen(cond, then, otherwise, span))
    } else {
      if (eno || enoOut !== undefined) throw new NetworkRefusal(`the ${this.name(box)} box shows ENO without EN, which CODESYS does not compile`, NOT_COMPILED)
      pre.push(standing(this.callOf({ ...box.st, callee: inst }, pins, pre)))
    }
    if (eno || read === undefined) return value
    return member(instance, read, span)
  }

  /** A box read where it stands (`name` the member closing its call). */
  protected boxRead(box: NetworkBox, name: string | undefined, pre: Statement[]): Expr {
    const eno = name !== undefined && name.toUpperCase() === "ENO" && !declaresEno(box.signature)
    if (box.instance !== undefined) {
      const read = eno ? undefined : name ?? box.signature?.outputs[0]
      if (!eno && read === undefined) throw new NetworkRefusal(`the ${this.name(box)} box is read, and no declaration names its output`)
      // an FB read by its ENO hands on the ENO's temp; one that is read always has an instance here
      return this.fb(box, eno, read, pre)!
    }
    if (name !== undefined && !eno && name.toUpperCase() !== "OUT") throw new NetworkRefusal(`the ${this.name(box)} box is read through its VAR_OUTPUT ${name}`)
    if (box.enable !== undefined) return eno ? this.enabled(box, pre, true)! : this.enOnlyRead(box, pre)
    if (eno) return this.enoOnly(box, pre)
    return this.boxValue(box, box.pins, pre)
  }

  /** An operator box infix, left to right: `ADD(a, b, c)` is `(a + b) + c`. */
  private operator(name: string, span: Span, args: readonly CallArg[], pre: Statement[]): Expr {
    const values = args.map((a) => this.pin(a, pre))
    if (name === "NOT") return not(values[0]!, span)
    return values.slice(1).reduce((left, right) => binary(INFIX[name]!, left, right, span), values[0]!)
  }

  /** `head(args…)`, every value as the network runs it. */
  protected callOf(c: CallExpr, args: readonly CallArg[], pre: Statement[]): CallExpr {
    const head = this.expr(c.callee, pre)
    return call(head, args.map((a) => (a.value === undefined ? a : { ...a, value: this.pin(a, pre) })), c.span)
  }
}
