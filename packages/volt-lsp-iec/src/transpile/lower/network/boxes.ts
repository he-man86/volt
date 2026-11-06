/**
 * A NETWORK'S BOXES AS THE ST THEY RUN AS (`network.ts` holds the statements, the wires and the network's own elements),
 * each rule as CODESYS measured it (network-text-st 1.3 / 1.4, network-output-member 2.3, network-language): a box hands on
 * its default output — its ENO where EN is shown, else a function's value, an FB's first output — or the output a member
 * names.
 *
 *   `GT(i, 3)`, `ADD(a, b, c)`, `NOT(a)`     the operator, infix: `i > 3`, `a + b + c`, `NOT a`; `MOVE(x)` the value x;
 *   `X(EN := e, pins…, OUT => o)`            `IF e THEN o := X(pins…); eno := TRUE; ELSE eno := FALSE; END_IF` — an enabled
 *                                            box runs only when enabled and its ENO is its EN;
 *   `X(EN := e, pins…).OUT`                  read by its value: a comparison FALSE when disabled; any other only as an
 *                                            assignment's whole value, which holds when disabled (`network.ts`);
 *   `t1(IN := a)`, `t1(IN := a).ET`          `t1(IN := a);` before the item, `t1.Q` / `t1.ET` in it, on every scan; under its
 *                                            own EN where shown;
 *   `T(pins…)`, T an FB type (`???`)         the call of its type, read or enabled refused;
 *   `Q_INVERTED => x`, `Q_SET => k`,         a marked output: the output read into a temp by the call, then written to its
 *   `Q_RESET => k`                           target — `x := NOT q`, `IF q THEN k := TRUE`, `IF q THEN k := FALSE`.
 *
 * What a box's pins evaluate runs on every scan, only the box under its EN.
 */
import { type CallArg, type CallExpr, type Expr, type OutputMark, type Statement, type BodySpan, type Span, UNNAMED } from "../../../frontend/syntax/index.js"
import type { Scope } from "../../../frontend/symbols/index.js"
import { defaultFlow, inferExprType, isOperatorBox, misleadingBox, networkBox, type NetworkBox, type Type } from "../../../frontend/types/index.js"
import { assign, binary, bool, call, ifThen, member, NetworkRefusal, NOT_COMPILED, not, standing } from "./ast.js"

const INFIX: Readonly<Record<string, string>> = {
  AND: "AND", OR: "OR", XOR: "XOR", ADD: "+", SUB: "-", MUL: "*", DIV: "/", MOD: "MOD",
  GT: ">", GE: ">=", LT: "<", LE: "<=", EQ: "=", NE: "<>",
}
export const COMPARISON: ReadonlySet<string> = new Set(["GT", "GE", "LT", "LE", "EQ", "NE"])
export const isInfix = (name: string): boolean => INFIX[name.toUpperCase()] !== undefined

const named = (a: CallArg, name: string): boolean => a.param?.name.toUpperCase() === name

/** The pins a built-in function box shows by name, in its declaration's order; `IN<n>` numbered where it is extensible
 *  (MUX after its K, MIN, MAX and the operators). */
const OPERATOR_PINS: Readonly<Record<string, readonly string[]>> = {
  LIMIT: ["MN", "IN", "MX"], SEL: ["G", "IN0", "IN1"], MUX: ["K"], MOVE: ["IN"],
  SHL: ["IN", "N"], SHR: ["IN", "N"], ROL: ["IN", "N"], ROR: ["IN", "N"],
}
const NUMBERED: ReadonlySet<string> = new Set(["MUX", "MIN", "MAX", ...Object.keys(INFIX)])

/**
 * A BUILT-IN FUNCTION BOX'S PINS BY POSITION (openspec network-function-formal-pins): the box shows its pins by name
 * (`LIMIT(MN := 0, IN := v, MX := 100)`), and runs them in its declaration's order (live CODESYS 3.5.21.40, F12) — the
 * order `misleadingBox` holds the text to — so the call is the positional one. A name the box has no pin of, or a pin
 * given twice, is refused by name; a missing one is the call's arity.
 */
function positionalPins(base: string, args: readonly CallArg[]): CallArg[] {
  const known = OPERATOR_PINS[base] ?? []
  const seen = new Set<string>()
  return args.map((a) => {
    if (a.param === undefined || a.output) return a
    const name = a.param.name.toUpperCase()
    if (!known.includes(name) && !(NUMBERED.has(base) && /^IN\d+$/.test(name)))
      throw new NetworkRefusal(`the ${base} box has no pin ${a.param.name}${known.length > 0 ? `: its pins are ${known.join(", ")}${NUMBERED.has(base) ? ", IN0, IN1, …" : ""}` : ""}`)
    if (seen.has(name)) throw new NetworkRefusal(`the ${base} box is given its pin ${a.param.name} twice`)
    seen.add(name)
    const { param: _param, ...rest } = a
    return rest
  })
}

/** A marked output's write of `value` to `target`: the negated coil, the set coil, the reset coil. */
export function coilWrite(mark: OutputMark | "NOT" | "S=" | "R=", target: Expr, value: Expr, span: Span): Statement {
  if (mark === "INVERTED" || mark === "NOT") return assign(target, not(value, span), span)
  return ifThen(value, [assign(target, bool(mark === "SET" || mark === "S=", span), span)], [], span)
}

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

  /** A fresh variable of `type` of the network being lowered, at `span`. */
  protected abstract typedTemp(span: Span, type: Type): Expr

  /** The text a span covers, for a refusal's message. */
  protected text(span: Span): string {
    return this.body.tokens.filter((t) => t.span.start >= span.start && t.span.end <= span.end).map((t) => t.text).join("").trim()
  }

  protected box(c: CallExpr): NetworkBox | undefined {
    return networkBox(c, this.scope, this.project)
  }

  /** A box whose text claims what its run does not do has no run to lower to (`misleadingBox`). */
  protected refuseMisleading(box: NetworkBox, at: { consumed: boolean; member: string | undefined }): void {
    const [first] = misleadingBox(box, this.name(box), at)
    if (first !== undefined) throw new NetworkRefusal(first.message)
    const [ambiguous] = box.ambiguous
    if (ambiguous !== undefined) throw new NetworkRefusal(`${ambiguous.param!.name} => on the call ${this.name(box)}, whose callee declares both ${ambiguous.param!.name} and the output its name would mark`)
  }

  protected name(box: NetworkBox): string {
    return box.call.callee.kind === "ident_expr" ? box.call.callee.name : this.text(box.call.callee.span)
  }

  /** A pin's (or EN's) value as the box reads it. */
  protected pin(a: CallArg, pre: Statement[]): Expr {
    return this.expr(a.value!, pre)
  }

  /** The type of the output `name` of `box` (a function's value `OUT` among them). */
  private outputType(box: NetworkBox, name: string): Type {
    const base: Expr = box.instance ?? box.call
    const t = inferExprType({ kind: "member", base, member: { kind: "ident_expr", name, span: box.call.span }, span: box.call.span }, this.scope, this.project)
    if (t.kind === "unknown") throw new NetworkRefusal(`the marked output ${name} of ${this.name(box)} has no type lowering can declare`)
    return t
  }

  /** The box's pins with each marked output bound to a temp, and the writes of those temps to their targets. */
  protected markedOutputs(box: NetworkBox, args: readonly CallArg[], pre: Statement[]): { args: CallArg[]; post: Statement[] } {
    const post: Statement[] = []
    const out = args.map((a): CallArg => {
      if (a.coil === undefined || !a.output || a.value === undefined) return a
      const t = this.typedTemp(a.span, this.outputType(box, a.param!.name))
      post.push(coilWrite(a.coil, this.expr(a.value, pre), t, a.span))
      return { kind: "call_arg", param: a.param, output: true, value: t, span: a.span }
    })
    return { args: out, post }
  }

  /** `X(pins…)` as the value a function box hands back, in a tree. A marked output of the call is written right after
   *  it: the call held in a temp, before the tree that reads it. */
  protected boxValue(box: NetworkBox, args: readonly CallArg[], pre: Statement[]): Expr {
    const marked = this.markedOutputs(box, args, pre)
    const v = this.plainValue(box, marked.args, pre)
    if (marked.post.length === 0) return v
    const t = this.typedTemp(box.call.span, this.valueType(box))
    pre.push(assign(t, v, box.call.span), ...marked.post)
    return t
  }

  /** `X(pins…)` as the value a function box hands back: an operator infix, MOVE the value it moves. */
  protected plainValue(box: NetworkBox, args: readonly CallArg[], pre: Statement[]): Expr {
    const base = this.name(box).toUpperCase()
    const pins = isOperatorBox(box) ? positionalPins(base, args) : [...args]
    if (base === "MOVE" && pins.length === 1 && pins[0]!.param === undefined) return this.pin(pins[0]!, pre)
    if (isInfix(base) || base === "NOT") return this.operator(base, box.call.span, pins.filter((a) => !a.output), pre)
    return this.callOf(box.st, pins, pre)
  }

  private valueType(box: NetworkBox): Type {
    const t = inferExprType({ ...box.call, args: box.call.args.filter((a) => !named(a, "EN")) }, this.scope, this.project)
    if (t.kind === "unknown") throw new NetworkRefusal(`the value of ${this.name(box)} has no type lowering can declare`)
    return t
  }

  /** `X(EN := e, pins…).OUT` read by its value in a tree: an enabled comparison, FALSE when disabled. */
  protected enOnlyRead(box: NetworkBox, pre: Statement[]): Expr {
    const base = this.name(box)
    if (!COMPARISON.has(base.toUpperCase())) throw new NetworkRefusal(`the enabled ${base} box is read by its value other than as an assignment's whole value`)
    const cond = this.pin(box.enable!, pre)
    const value = this.boxValue(box, box.pins.filter((a) => !a.output), pre)
    const t = this.temp(box.call.span)
    pre.push(ifThen(cond, [assign(t, value, box.call.span)], [assign(t, bool(false, box.call.span), box.call.span)], box.call.span))
    return t
  }

  /** An enabled function box: it runs under its EN, its ENO is its EN. Returns the ENO's temp where `read`. A comparison
   *  showing EN and so its ENO holds its target when disabled (live CODESYS 3.5.21.40). */
  protected enabled(box: NetworkBox, pre: Statement[], read: boolean): Expr | undefined {
    const span = box.call.span
    const cond = this.pin(box.enable!, pre)
    const eno = read ? this.temp(span) : undefined
    const outs = box.pins.filter((a) => a.output)
    const result = outs.find((a) => named(a, "OUT"))
    const then: Statement[] = []
    const otherwise: Statement[] = []
    const marked = this.markedOutputs(box, [...box.pins.filter((a) => !a.output), ...outs.filter((a) => a !== result)], pre)
    const value = this.plainValue(box, marked.args, pre)
    if (result !== undefined) {
      const target = this.expr(result.value!, pre)
      then.push(result.coil === undefined ? assign(target, value, span) : coilWrite(result.coil, target, value, span))
    } else if (value.kind === "call") then.push(standing(value)) // an operator's value wired nowhere runs nothing (rule 7)
    then.push(...marked.post)
    if (eno !== undefined) {
      then.push(assign(eno, bool(true, span), span))
      otherwise.push(assign(eno, bool(false, span), span))
    }
    pre.push(ifThen(cond, then, otherwise, span))
    return eno
  }

  /**
   * AN FB BOX: its instance called before the item that reads it, on every scan — under its own EN where shown; read
   * through its ENO (EN shown, no member) its EN, through `.NAME` or by default its first output that output. Returns what
   * the box hands on (undefined at a root).
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
    let value: Expr | undefined
    // EN, then the pins, evaluated on every scan (measured 2.3); the call and its marked outputs' writes under its EN
    const cond = box.enable !== undefined ? this.pin(box.enable, pre) : undefined
    const marked = this.markedOutputs(box, box.pins, pre)
    const run: Statement[] = [standing(this.callOf({ ...box.st, callee: inst }, marked.args, pre)), ...marked.post]
    if (cond !== undefined) {
      const otherwise: Statement[] = []
      if (eno) {
        value = this.temp(span)
        run.push(assign(value, bool(true, span), span))
        otherwise.push(assign(value, bool(false, span), span))
      }
      pre.push(ifThen(cond, run, otherwise, span))
    } else pre.push(...run)
    if (eno || read === undefined) return value
    return member(instance, read, span)
  }

  /** A box read where it stands (`name` the member closing its call): its default output, or the one `name` names. */
  protected boxRead(box: NetworkBox, name: string | undefined, pre: Statement[]): Expr {
    this.refuseMisleading(box, { consumed: true, member: name })
    const flow = name === undefined ? defaultFlow(box) : undefined
    if (name === undefined && flow === undefined) throw new NetworkRefusal(`the ${this.name(box)} box is read, and no declaration names its outputs`)
    if (flow?.kind === "none") throw new NetworkRefusal(`the ${this.name(box)} box is read, and declares no output to read`, NOT_COMPILED)
    const eno = flow?.kind === "eno"
    if (box.instance !== undefined) {
      const read = eno ? undefined : name ?? (flow?.kind === "output" ? flow.name : undefined)
      // an FB read by its ENO hands on the ENO's temp; one that is read always has an instance here
      return this.fb(box, eno, read, pre)!
    }
    if (eno) return this.enabled(box, pre, true)!
    if (box.signature?.shape === "program" && !box.isFunction) {
      // a program box read where it stands: the program runs before the tree, the output read after it
      const read = name ?? (flow?.kind === "output" ? flow.name : undefined)
      if (read === undefined) throw new NetworkRefusal(`the ${this.name(box)} program box is read, and declares no output to read`, NOT_COMPILED)
      const marked = this.markedOutputs(box, box.pins, pre)
      pre.push(standing(this.callOf(box.st, marked.args, pre)), ...marked.post)
      return member(this.expr(box.call.callee, pre), read, box.call.span)
    }
    if (name !== undefined && name.toUpperCase() !== "OUT") throw new NetworkRefusal(`the ${this.name(box)} box is read through its VAR_OUTPUT ${name}`)
    if (box.enable !== undefined) return this.enOnlyRead(box, pre)
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

