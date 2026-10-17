/**
 * THE SHARED VALIDATOR, on the editor's side — the bridge's `NetworkValidator` (`volt-cli/src/Volt.Engine/Format/Network/
 * NetworkValidator.cs`, openspec ld-fbd-coverage 2R.6b, `v2-spec.md` section 7) over the editor's tree: the checks no
 * spelling decides — a vendor fact a build refuses (X3, X10, X12, X13), a split's one definition (X17) and every
 * composition no store, build and run has measured. The same walk in the same order, so the first finding is the bridge's
 * first finding, with its reason (the phrase a push refuses it by) and its code. Checks the text cannot reach (a flag on an
 * output pin, rising with falling, …) are refused by the reader before any tree exists, and are not repeated here.
 */
import type { Span } from "../span.js"
import type {
  NetworkCall,
  NetworkDiagnosticCode,
  NetworkExecute,
  NetworkTarget,
  NetworkTextNetwork,
  NetworkTextStatement,
  NetworkValue,
  NetworkWordBox,
} from "./ast.js"
import { walkValues } from "./ast.js"
import { OPERATOR_WORDS, SPLIT_PREFIX, TWO_INPUT_OPERATORS, isOperatorBox } from "./words.js"

/** One finding: the shape it names, what was found, the code a push refuses it under, and where. */
export interface NetworkFinding {
  reason: string
  detail: string
  code: NetworkDiagnosticCode
  span?: Span
}

class Finding {
  constructor(readonly f: NetworkFinding) {}
}

type Box = NetworkWordBox | NetworkCall | NetworkExecute
interface Flags {
  negated: boolean
  edge?: "rising" | "falling"
}

/** The first finding on the network's items, or undefined when it has none. */
export function validateNetwork(network: NetworkTextNetwork): NetworkFinding | undefined {
  try {
    new Walker(network).run()
    return undefined
  } catch (e) {
    if (e instanceof Finding) return e.f
    throw e
  }
}

function fail(reason: string, detail: string, span: Span | undefined, code: NetworkDiagnosticCode = "NETWORK_UNSUPPORTED"): never {
  throw new Finding({ reason, detail, code, ...(span !== undefined ? { span } : {}) })
}

/** A value under its modifier wrappers: the core node and its flags (the edge around the negation). */
function unwrap(v: NetworkValue): { core: NetworkValue; flags: Flags } {
  let edge: Flags["edge"]
  if (v.kind === "edge") {
    edge = v.rising ? "rising" : "falling"
    v = v.operand
  }
  let negated = false
  if (v.kind === "not") {
    negated = true
    v = v.operand
  }
  return { core: v, flags: { negated, ...(edge !== undefined ? { edge } : {}) } }
}

const flagged = (f: Flags): boolean => f.negated || f.edge !== undefined
const splitId = (text: string): number => Number(text.slice(SPLIT_PREFIX.length))

class Walker {
  private readonly definitions = new Map<number, number>()
  private readonly defining = new Set<number>()

  constructor(private readonly net: NetworkTextNetwork) {}

  run(): void {
    for (const s of this.net.statements) this.count(s)
    for (const s of this.net.statements) this.top(s)
  }

  private count(s: NetworkTextStatement): void {
    const define = (name: string, span: Span): void => {
      const id = splitId(name)
      this.definitions.set(id, (this.definitions.get(id) ?? 0) + 1)
      if (this.definitions.get(id)! > 1)
        fail("a split defined twice", `split${id} is defined twice in network ${this.net.index + 1}: a split is defined once (X17).`, span, "NETWORK_DUPLICATE_NAME")
    }
    if (s.kind === "split_def") define(s.split.text, s.span)
    for (const v of walkValues(s)) if (v.kind === "nested_split") define(v.split.text, v.span)
  }

  private top(s: NetworkTextStatement): void {
    switch (s.kind) {
      case "empty":
        return
      case "assign":
        return this.assign(s.targets, s.value, s.span)
      case "split_def":
        return this.definition(s.split.text, s.value)
      case "value": {
        const { core, flags } = unwrap(s.value)
        if (core.kind === "empty_slot" && flagged(flags)) fail("a flag on an empty item", "an empty item carries a modifier.", s.span)
        return this.value(s.value, false)
      }
    }
  }

  private definition(name: string, value: NetworkValue): void {
    const id = splitId(name)
    this.defining.add(id)
    try {
      this.value(value, true)
    } finally {
      this.defining.delete(id)
    }
  }

  private value(v: NetworkValue, consumed: boolean): void {
    const { core, flags } = unwrap(v)
    switch (core.kind) {
      case "operand":
        return
      case "empty_slot":
        if (flags.edge !== undefined) fail("a flag on an empty slot", "an unconnected slot carries an edge.", v.span)
        if (flags.negated)
          fail("a negated empty slot outside a lone coil value", "a negated empty slot is measured as the value of one plain coil only, `x := NOT;` (2R.5 #6a).", v.span)
        return
      case "nested_assign":
        return this.assign(core.targets, core.value, core.span)
      case "nested_split":
        return this.definition(core.split.text, core.value)
      case "split_ref": {
        const id = splitId(core.name.text)
        if (!this.definitions.has(id))
          fail("a split referenced and never defined", `split${id} is read and network ${this.net.index + 1} defines it nowhere.`, core.span, "NETWORK_BAD_EXPRESSION")
        if (this.defining.has(id))
          fail("a split read inside its own definition", `split${id} is read inside the value that defines it: a split that feeds itself is not measured.`, core.span)
        return
      }
      case "parallel":
        if (core.branches.length < 2)
          fail(
            core.branches.length === 0 ? "a Parallel with no branch" : "a Parallel with one branch",
            `a parallel holds ${core.branches.length} branch(es), and the build refuses fewer than two (C0023, X13).`,
            core.span,
          )
        if (core.input !== undefined && unwrap(core.input).core.kind === "empty_slot")
          fail(
            "a Parallel fed by the empty terminator",
            "a parallel fed by an unconnected slot (`NOT BRANCH (…)`) is not measured; an unfed parallel has no feed.",
            core.span,
          )
        if (core.input !== undefined) this.value(core.input, true)
        for (const b of core.branches) this.value(b, true)
        return
      case "word":
      case "call":
      case "execute":
        return this.box(core, flags, consumed)
      case "not":
      case "edge":
        // A modifier after a modifier is refused by the reader; a tree holding one is no tree it builds.
        return
    }
  }

  private assign(targets: readonly NetworkTarget[], value: NetworkValue, span: Span): void {
    const lone = targets.length <= 1
    for (const t of targets) {
      this.coil(t, span)
      if (!lone && (t.negated === true || t.edge !== undefined))
        fail(
          "a modified coil beside another coil",
          `the coil '${t.text}' is modified beside another coil: not measured — a negated or edge coil is measured alone on its item.`,
          span,
        )
    }
    const { core, flags } = unwrap(value)
    if (core.kind === "empty_slot" && flags.negated && flags.edge === undefined) {
      const only = targets.length === 1 ? targets[0]! : undefined
      const plain = only !== undefined && (only.op ?? ":=") === ":=" && only.negated === undefined && only.edge === undefined &&
        only.jump === undefined && only.ret === undefined
      if (!plain)
        fail("a negated empty slot outside a lone coil value", "`NOT;` beside another coil, or on a modified coil, is not measured — `x := NOT;` is (2R.5 #6a).", value.span)
      return
    }
    this.value(value, true)
  }

  private coil(t: NetworkTarget, span: Span): void {
    const flow = t.jump === true || t.ret === true
    if (flow && (t.negated === true || t.edge !== undefined || t.op === "R="))
      fail("a modified jump or return", "the jump or return coil is modified: not measured — `JMP l :=`, `JMP l S=` and `RETURN :=` are.", span)
    if (t.edge !== undefined && (t.op === "S=" || t.op === "R="))
      fail("an edge beside a set or reset coil", `the coil '${t.text}' carries an edge beside its storage: an edge beside S= or R= is not measured.`, span)
  }

  private box(b: Box, flags: Flags, consumed: boolean): void {
    const isExecute = b.kind === "execute"
    const isFb = b.kind === "call" && b.instance === true
    const type = b.kind === "word" ? b.head.text : b.kind === "call" ? b.boxType : "EXECUTE"
    const what = isExecute ? "the EXECUTE box" : `the '${type}' box`

    if (isExecute && flagged(flags)) fail("a flag on an Execute box", `${what} carries a modifier: a modifier on an Execute box is not measured.`, b.span)
    if (b.enFlags?.edge !== undefined) fail("an edge on the EN pin", `${what} has an edge on its EN pin: not measured — \`NOT EN c\` is.`, b.span)

    const inputs = b.kind === "word" ? b.operands : b.kind === "call" ? b.pins.flatMap((p) => (p.kind === "input" ? [p.value] : [])) : []
    if (!isFb && !isExecute) {
      const t = type.toUpperCase()
      if (TWO_INPUT_OPERATORS.has(t) && inputs.length > 2)
        fail(
          "a two input operator box with more inputs",
          `${what} holds ${inputs.length} inputs, and ${t} takes two (the build refuses it: "needs exactly '2' operands", X13).`,
          b.span,
        )
      if (OPERATOR_WORDS.has(t) && inputs.length < 2)
        fail(
          "an operator box with fewer than two inputs",
          `${what} holds ${inputs.length} input(s), and ${t} takes at least two (the build refuses it: "needs at least '2' operands", X13).`,
          b.span,
        )
      if (t === "MOVE" && inputs.length !== 1) fail("a MOVE with no input or two", `${what} holds ${inputs.length} inputs: a MOVE with 0 or 2 inputs is not measured.`, b.span)
    }

    // The ENO pin: `ENO => v` after the outputs, or an output pin named ENO.
    // Shown on an enabled box, or a function's (its ENO without EN builds: `rcc_network_eno_function_without_en`).
    const enoShown = b.hasEno && (b.en !== undefined || (b.kind === "call" && b.instance === undefined && !isOperatorBox(b.boxType)))
    const enoPins: NetworkTarget[] = [
      ...(b.eno?.target !== undefined ? [b.eno.target] : []),
      ...(b.kind === "call" ? b.pins.flatMap((p) => (p.kind === "output" && p.name?.text.toUpperCase() === "ENO" && p.target !== undefined ? [p.target] : [])) : []),
    ]
    if (!isFb)
      for (const pin of enoPins) {
        if (!enoShown) fail("an ENO output pin on a box without ENO", `${what} wires an output named ENO to '${pin.text}' and shows no ENO.`, b.span)
        if (consumed)
          fail(
            "an ENO pin wired beside a consumer",
            `${what} wires its ENO to '${pin.text}' and a consumer reads it: it stores and does not build ("ENO output is not used as main output", X12).`,
            b.span,
          )
      }

    if (consumed) this.connection(b, what, isFb, isExecute, type)

    if (b.en !== undefined) this.value(b.en, true)
    for (const v of inputs) this.value(v, true)
  }

  /** How a consumer reads the box — the connection the IDE stores, checked against what builds. */
  private connection(b: Box, what: string, isFb: boolean, isExecute: boolean, type: string): void {
    if (b.readBy === "eno") {
      // X3 (3c): an operator box with EN read through its ENO writes its value somewhere, or it stores and does not build.
      const dataOutputs = b.kind === "word" ? b.outputs.length : b.kind === "call" ? b.pins.filter((p) => p.kind === "output" && p.target !== undefined && p.name?.text.toUpperCase() !== "ENO").length : 0
      if (b.en !== undefined && !isFb && !isExecute && isOperatorBox(type) && dataOutputs === 0)
        fail(
          "an operator box read through its ENO with no output wired",
          `${what} is read through its ENO and writes its value nowhere: it stores and does not build (X3) — wire it, \`=> t\`.`,
          b.span,
        )
      return
    }
    if (b.en !== undefined && b.hasEno)
      fail(
        "a box with EN and ENO read by its value",
        `${what} has EN and an ENO output, and its consumer reads another output: it stores and does not build ("ENO output is not used as main output", X10).`,
        b.span,
      )
    if (isFb && b.kind === "call" && b.output?.text.toUpperCase() === "ENO")
      fail(
        "an FB read through .ENO",
        `${what} is read through an output named ENO: an FB's ENO is read with no \`.name\` (its declared ENO) or through its shown ENO (X9).`,
        b.span,
      )
  }
}
