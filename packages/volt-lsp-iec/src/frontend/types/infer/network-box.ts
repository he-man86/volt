/**
 * THE BOX A NETWORK CALL IS (openspec network-language; the bridge's `StNetworkReader`): in a plain-ST network body every
 * box is ONE call of its toolbox name, an FB's the call ON ITS INSTANCE (`t1(…)`, its type the instance's declaration);
 * only an FB box with no instance (the vendor's `???`) is the call of its TYPE. `EN :=` written first is the shown EN. A
 * box's DEFAULT output flows on: its ENO whenever EN is shown, else a function's value, an FB's or a program's first
 * output; a member closes the call only where another output flows on. An output's name may carry its mark
 * (`Q_INVERTED => x`, `Q_SET => k`, `Q_RESET => k`). A callee that DECLARES `EN` or `ENO` has them as ordinary pins.
 *
 *   `GT(a, b)`                                 the comparison: its value
 *   `GT(EN := c, a, b, OUT => v)`              EN shown: its ENO, a BOOL, its value on v
 *   `t1(IN := a, PT := T#1S)`                  the FB box: its first output, `t1.Q`
 *   `t1(IN := a, PT := T#1S).ET`               the FB box read through another output: `t1.ET`
 *   `t1(EN := c, IN := a).Q`                   EN shown, read through Q
 *   `TON(IN := a)`                             the FB box with no instance (`???`)
 *   `g(EN := c, a, q => v).OUT`                a function shown with EN, read through its value
 *
 * What the callee declares is the one fact every reading needs (`BoxSignature`): the box's FB (its instance's type, else
 * the type the call names), a function's or a program's own sections, an operator's (one value, no pin of its own named EN
 * or ENO). A callee nothing in reach declares has no signature, and its call is read as written.
 */
import { lookup, lookupLocal, visibleNames, type Scope } from "../../symbols/index.js"
import { type CallArg, type CallExpr, type Expr, type MemberExpr, type OutputMark, type Span, UNNAMED, type VarSection } from "../../syntax/index.js"
import { NETWORK_CONTROLS, NETWORK_ELEMENTS, resolveBareName } from "../names.js"
import { resolveCallee, type CalleeInfo } from "./callee.js"
import { inferExprType } from "./expr.js"

/** The callee's pins, as its declaration states them. */
interface BoxSignature {
  /** `block` an FB, `function` a function or an operator (a value, then its VAR_OUTPUTs), `program` a program (no value). */
  shape: "block" | "function" | "program"
  /** VAR_INPUT and VAR_IN_OUT names, lower-cased. */
  inputs: ReadonlySet<string>
  /** VAR_OUTPUT names as declared. */
  outputs: readonly string[]
}

/** The outputs a consumer can read, as the text names them: a function's value `OUT`, then its declared outputs. */
export function dataOutputs(s: BoxSignature): readonly string[] {
  return s.shape === "function" ? [VALUE, ...s.outputs] : s.outputs
}

export const declaresEn = (s: BoxSignature | undefined): boolean => s?.inputs.has("en") === true
export const declaresEno = (s: BoxSignature | undefined): boolean => s?.outputs.some((o) => o.toUpperCase() === "ENO") === true
/** A function declaring a VAR_OUTPUT named OUT: `.OUT` and `OUT =>` would name its value and that output both. */
export const declaresOut = (s: BoxSignature | undefined): boolean => s?.shape === "function" && s.outputs.some((o) => o.toUpperCase() === VALUE)

/** The name network text gives a function's value: `.OUT`, `OUT => v`. */
export const VALUE = "OUT"

export interface NetworkBox {
  call: CallExpr
  /** An FB box's instance: the call's head where it is an FB instance, the vendor's `???` where the head is an FB type. */
  instance?: Expr
  /** The shown EN's `EN :=`, first, where the callee declares no EN. */
  enable?: CallArg
  /** The pins the callee itself takes: the call's arguments but the shown EN. */
  pins: readonly CallArg[]
  /** The ST call the box is: its instance (an FB) or its callee, called with `pins`. */
  st: CallExpr
  /** The callee's declared pins; undefined where no declaration in reach states them (the call read as written). */
  signature?: BoxSignature
  /** Each output written with a mark in its name where the callee declares both that name and the output it marks
   *  (`Q_SET =>` on a box declaring `Q` and `Q_SET`): the text cannot tell the two apart (network-language rule 9). */
  ambiguous: readonly CallArg[]
  /** A box with no instance whose callee is a FUNCTION — its signature, or a function of its name in any library where no
   *  declaration in reach states one whole (bakon-nano's Standard DELETE beside CAA File's block, `instanceOf`). */
  isFunction: boolean
}

/** The marks an output's name carries, by their suffix. */
const OUTPUT_MARKS: readonly { suffix: string; mark: OutputMark }[] = [
  { suffix: "_INVERTED", mark: "INVERTED" }, { suffix: "_SET", mark: "SET" }, { suffix: "_RESET", mark: "RESET" },
]

/** An output binding read against the callee's outputs (undefined: no declaration in reach states them): a name the
 *  callee declares as it stands is that output, unmarked; else a suffix marks the output it ends. `ambiguous` where it
 *  reads two ways — the callee declares both the name and its stem, or no declaration states which (rule 9). */
function readOutput(a: CallArg, outputs: readonly string[] | undefined): { arg: CallArg; ambiguous: boolean } {
  if (!a.output || a.param === undefined) return { arg: a, ambiguous: false }
  const name = a.param.name.toUpperCase()
  const found = OUTPUT_MARKS.find(({ suffix }) => name.endsWith(suffix) && name.length > suffix.length)
  if (found === undefined) return { arg: a, ambiguous: false }
  const has = (n: string) => outputs?.some((o) => o.toUpperCase() === n) === true
  const stem = a.param.name.slice(0, a.param.name.length - found.suffix.length)
  if (outputs === undefined || (has(stem.toUpperCase()) && has(name))) return { arg: a, ambiguous: true }
  if (has(name)) return { arg: a, ambiguous: false }
  return { arg: { ...a, param: { ...a.param, name: stem }, coil: found.mark }, ambiguous: false }
}

/** What a box hands on read by no member: its ENO where EN is shown, else a function's value, an FB's or a program's
 *  first output (`none` where it declares none); undefined where no declaration states its outputs. */
export function defaultFlow(box: NetworkBox): { kind: "eno" } | { kind: "value" } | { kind: "output"; name: string } | { kind: "none" } | undefined {
  if (box.enable !== undefined) return { kind: "eno" }
  if (box.isFunction) return { kind: "value" }
  const s = box.signature
  if (s === undefined) return undefined
  const first = s.outputs[0]
  return first === undefined ? { kind: "none" } : { kind: "output", name: first }
}

function inNetwork(scope: Scope): boolean {
  for (let s: Scope | undefined = scope; s !== undefined; s = s.parent) if (s.network === true) return true
  return false
}

/** The variable kinds a call head names an instance through. */
const VARIABLES: ReadonlySet<string> = new Set(["var", "gvl_var", "method_param"])

/**
 * WHAT A CALL HEAD NAMES (the bridge's `StNetworkReader` `Callee`): an FB instance — a variable (a path, an element of an
 * array, `SUPER^`) whose type is a function block, or no type the LSP can see (a library's) — the box's instance; an FB
 * TYPE, the vendor's unnamed instance `???` (a FUNCTION of that name in any library wins over a block of it: bakon-nano's
 * Standard DELETE beside CAA File's, as the bridge's scope answers it); anything else no instance.
 */
function instanceOf(call: CallExpr, scope: Scope, project: Scope): Expr | undefined {
  const head = call.callee
  if (head.kind === "ident_expr") {
    const sym = lookup(scope, head.name)?.symbol
    if (sym?.kind === "function_block" && !lookupLocal(project, head.name).some((s) => s.kind === "function"))
      return { kind: "ident_expr", name: UNNAMED, span: head.span }
    if (sym === undefined || !VARIABLES.has(sym.kind)) return undefined
  } else if (head.kind !== "member" && head.kind !== "index" && head.kind !== "deref") return undefined
  const typed = inferExprType(head, scope, project).kind
  if (typed === "function_block") return head
  return head.kind === "ident_expr" && typed === "unknown" ? head : undefined
}

/** THE BOX A VALUE STANDING ALONE IS, consumed by nothing (`INVERT(AND(a, b));`, `RISING(INVERT(t1(…)));`, `EXECUTE(…);`): its
 *  call and the member closing it (the `.NAME` of its main slot), the value marks around it — as the bridge's reader reads a root
 *  (`StNetworkReader.RootValue`); undefined where the value is no box (an operand, contacts, a branch, the rail). */
export function rootBox(e: Expr): { call: CallExpr; member: MemberExpr | undefined } | undefined {
  const box = (x: Expr) => {
    const inner = x.kind === "unary" && x.op.toUpperCase() === "NOT" ? x.operand : x
    const member = inner.kind === "member" && inner.base.kind === "call" ? inner : undefined
    const call = member?.base.kind === "call" ? member.base : inner.kind === "call" ? inner : undefined
    const head = call?.callee.kind === "ident_expr" ? call.callee.name.toUpperCase() : undefined
    return call === undefined || (head !== undefined && (NETWORK_ELEMENTS.has(head) || NETWORK_CONTROLS.has(head))) ? undefined : { call, member }
  }
  const edgeCall = e.kind === "call" && e.callee.kind === "ident_expr" && ["RISING", "FALLING"].includes(e.callee.name.toUpperCase()) ? e : undefined
  const edge = edgeCall?.args[0]?.value
  return (edge === undefined ? undefined : box(edge)) ?? box(e)
}

/** The box `call` is, in a network body; undefined outside one and for the text's own elements and controls (`BRANCH`,
 *  `RISING`, `RAIL`, `JMP`, …) and the Execute box. */
export function networkBox(call: CallExpr, scope: Scope, project: Scope): NetworkBox | undefined {
  if (!inNetwork(scope)) return undefined
  const head = call.callee.kind === "ident_expr" ? call.callee.name.toUpperCase() : undefined
  if (head !== undefined && (NETWORK_ELEMENTS.has(head) || NETWORK_CONTROLS.has(head) || head === "EXECUTE")) return undefined
  const instance = instanceOf(call, scope, project)
  let at = 0
  const signature = signatureOf(call, instance, scope, project)
  const en = call.args[at]
  let enable: CallArg | undefined
  if (!declaresEn(signature) && en !== undefined && !en.output && en.param?.name.toUpperCase() === "EN") {
    enable = en
    at++
  }
  // `OUT => v` is the box's next unnamed output slot (the bridge's writer), where its callee declares no output OUT: a
  // FUNCTION's value pin, which the ST call the box is returns, or an extra slot the IDE stores past a block's or a
  // program's declared outputs (`p(OUT => ???)`), which holds nothing the callee has — no pin of it at all
  const unnamed = (a: CallArg) =>
    signature !== undefined && a.output && a.param?.name.toUpperCase() === VALUE && !signature.outputs.some((o) => o.toUpperCase() === VALUE)
  // an output's name carrying its mark, read against what the callee declares (a function's value `OUT` among them)
  const outputs = signature === undefined ? undefined : instance === undefined ? dataOutputs(signature) : signature.outputs
  const read = call.args.slice(at).map((a) => readOutput(a, outputs))
  const ambiguous = read.filter((r) => r.ambiguous).map((r) => r.arg)
  const pins = read.map((r) => r.arg).filter((a) => signature?.shape === "function" || !unnamed(a))
  const args = pins.filter((a) => !unnamed(a))
  const isFunction = instance === undefined &&
    (signature?.shape === "function" || (call.callee.kind === "ident_expr" && lookupLocal(project, call.callee.name).some((s) => s.kind === "function")))
  return { call, instance, enable, pins, st: { kind: "call", callee: instance ?? call.callee, args, span: call.span }, signature, ambiguous, isFunction }
}

/** The member closing a box's call, `<box>.NAME` (or the retired `.ENO`, which the check refuses): the box and the name;
 *  undefined for any other member. */
export function boxMember(e: MemberExpr, scope: Scope, project: Scope): { box: NetworkBox; name: string; eno: boolean } | undefined {
  if (e.base.kind !== "call") return undefined
  // the Execute box closed by `.ENO`, its one output (network-text-one-to-one F13): a box of no callee, its EN its only pin
  const call = e.base
  if (call.callee.kind === "ident_expr" && call.callee.name.toUpperCase() === "EXECUTE" && e.member.name.toUpperCase() === "ENO" && inNetwork(scope)) {
    const enable = call.args[0] !== undefined && !call.args[0].output && call.args[0].param?.name.toUpperCase() === "EN" ? call.args[0] : undefined
    return { box: { call, ...(enable !== undefined ? { enable } : {}), pins: [], st: call, ambiguous: [], isFunction: false }, name: e.member.name, eno: true }
  }
  const box = networkBox(e.base, scope, project)
  if (box === undefined) return undefined
  const name = e.member.name
  return { box, name, eno: name.toUpperCase() === "ENO" && !declaresEno(box.signature) }
}

/** The first operator pin named out of its place (`NetworkSpelling.OperatorPinOutOfPlace`): `G`, `K` and `MN`, `IN`, `MX` have
 *  their place, and numbered pins ascend. */
function operatorPinOutOfPlace(type: string, pins: readonly CallArg[]): CallArg | undefined {
  const upper = type.toUpperCase()
  let last = -1
  for (const [k, a] of pins.entries()) {
    const name = a.param?.name.toUpperCase()
    if (name === undefined) continue
    const place = upper === "LIMIT" ? ({ MN: 0, IN: 1, MX: 2 } as Record<string, number>)[name] : upper === "SEL" && name === "G" ? 0 : upper === "MUX" && name === "K" ? 0 : undefined
    if (place !== undefined) {
      if (place !== k) return a
      continue
    }
    const numbered = /^IN(\d+)$/.exec(name)
    if (numbered === null) continue
    if (Number(numbered[1]) <= last) return a
    last = Number(numbered[1])
  }
  return undefined
}

/**
 * WHAT A BOX'S TEXT CLAIMS AND ITS RUN DOES NOT DO, OR A SECOND SPELLING OF WHAT IT DOES (live CODESYS 3.5.21.40, openspec
 * nwl-box-storage-map; network-language rule 4), in the bridge reader's words (`StNetworkReader` `CallBox`): the network
 * check refuses each, and neither lowering nor the twin runs a meaning the text does not have. `head` is the call's head as
 * written; `at` where it stands: read by a consumer, and the member closing it.
 */
export function misleadingBox(box: NetworkBox, head: string, at: { consumed: boolean; member: string | undefined }): { span: Span; message: string }[] {
  const out: { span: Span; message: string }[] = []
  const shown = box.enable !== undefined
  const member = at.member?.toUpperCase()
  const misplaced = box.signature === OPERATOR ? operatorPinOutOfPlace(head, box.pins.filter((a) => !a.output)) : undefined
  if (misplaced !== undefined)
    out.push({ span: misplaced.span, message: `the box ${head} names its pin ${misplaced.param!.name} out of place: an operator runs its pins by position, whatever their names say. Write them in order` })
  if (member === "ENO" && !declaresEno(box.signature))
    out.push({ span: box.call.span, message: `.ENO is no network text: ENO is the flow of a box showing EN, written as the call alone, ${head}(EN := …)` })
  if (at.consumed && shown && member === undefined && declaresEno(box.signature))
    out.push({ span: box.call.span, message: `the box ${head} shows EN, and ${head} declares an output ENO of its own: which one flows on, the text cannot tell` })
  // the first output, the default, named: by a consumer it flows on with no member; at a root no closer is it
  const first = box.signature === undefined ? undefined : (box.instance !== undefined ? box.signature.outputs : dataOutputs(box.signature))[0]
  if (member !== undefined && member !== "ENO" && first?.toUpperCase() === member && !(at.consumed && shown))
    out.push({ span: box.call.span, message: at.consumed
      ? `the box ${head} is closed by .${at.member}, its default output: the default flows on with no member, ${head}(…)`
      : `the box ${head} stands at a root closed by .${at.member}, the first output of ${head}: a root with no closer is its first output, so it names none` })
  // the value pin as the box reads it (`OUT_INVERTED =>` marks it), or the unnamed slot past a block's outputs
  const value = [...box.pins, ...box.call.args].find((a) => a.output && a.param?.name.toUpperCase() === VALUE)
  const readByValue = at.consumed && (member === VALUE || (member === undefined && !shown))
  if (readByValue && value !== undefined && box.instance === undefined && box.signature !== undefined && box.signature.shape !== "program")
    out.push({ span: value.span, message: `the box ${head} is read by its value and wires OUT =>: the IDE writes no second target. Two targets are ASSIGN's, ASSIGN(${head}(…), Q => x, Q => y)` })
  if (!at.consumed && !shown && at.member === undefined && value !== undefined && box.signature?.shape === "function" && box.signature !== OPERATOR && !declaresOut(box.signature))
    out.push({ span: value.span, message: `the function box ${head} wires OUT => at a root: the IDE does not write it. Read its value, ASSIGN(${head}(…), Q => x)` })
  if (value !== undefined && (box.signature?.shape === "block" || box.signature?.shape === "program") && !box.signature.outputs.some((o) => o.toUpperCase() === VALUE) &&
      !(value.value?.kind === "ident_expr" && value.value.name === UNNAMED))
    out.push({ span: value.span, message: `the call ${head} wires OUT =>, and ${head} declares no output OUT: the IDE does not write it` })
  if (at.consumed && shown && member === undefined && box.signature === OPERATOR && value === undefined)
    out.push({ span: box.call.span, message: `the operator box ${head} hands on its ENO and wires its value nowhere. Wire it, ${head}(EN := …, …, OUT => v)` })
  if (box.instance !== undefined || box.signature?.shape === "program") {
    const positional = box.pins.find((a) => !a.output && a.param === undefined)
    if (positional !== undefined)
      out.push({ span: positional.span, message: `the call ${head} passes a pin by position: the box of an FB or a program passes only named pins, and the IDE drops the rest. Name it, ${head}(<pin> := value)` })
  }
  if (box.signature !== undefined && !declaresEno(box.signature)) {
    const pin = box.call.args.find((a) => a.output && a.param?.name.toUpperCase() === "ENO")
    if (pin !== undefined)
      out.push({ span: pin.span, message: `the call ${head} wires ENO =>: the IDE never writes a variable on the ENO pin. ENO is the flow of a box showing EN, ASSIGN(${head}(EN := …), Q => v)` })
  }
  const wired = new Set<string>()
  for (const a of box.pins) {
    if (!a.output || a.param === undefined) continue
    const name = a.param.name.toUpperCase()
    if (wired.has(name)) out.push({ span: a.span, message: `the call ${head} wires ${a.param.name} => twice: the IDE writes no second target. Two targets are one ASSIGN, ASSIGN(${head}(…), Q => x, Q => y)` })
    wired.add(name)
  }
  return out
}

const OPERATOR: BoxSignature = { shape: "function", inputs: new Set(), outputs: [] }

/** Is the box an IEC operator's or a built-in's (`MOVE`, `GT`, `LIMIT`): one value, no pin of its own named EN or ENO? */
export const isOperatorBox = (box: NetworkBox): boolean => box.signature === OPERATOR

function signatureOf(call: CallExpr, instance: Expr | undefined, scope: Scope, project: Scope): BoxSignature | undefined {
  if (instance !== undefined) {
    // the FB the instance is, with what it inherits; the unnamed instance (`???`) by the type the call names
    const unnamed = instance.kind === "ident_expr" && instance.name === UNNAMED
    const callee = resolveCallee({ kind: "call", callee: unnamed ? call.callee : instance, args: [], span: call.span }, scope, project)
    return callee !== undefined && callee.sym.kind === "function_block" && callee.complete ? fromCallee(callee, "block") : undefined
  }
  if (call.callee.kind !== "ident_expr") return undefined
  if (lookup(scope, call.callee.name) === undefined && resolveBareName(scope, call.callee.name).kind === "builtin") return OPERATOR
  const callee = resolveCallee(call, scope, project)
  if (callee === undefined || !callee.complete) return undefined
  return callee.sym.kind === "function" ? fromCallee(callee, "function") : callee.sym.kind === "program" ? fromCallee(callee, "program") : undefined
}

function fromCallee(callee: CalleeInfo, shape: BoxSignature["shape"]): BoxSignature {
  const inputs = new Set<string>()
  const outputs: string[] = []
  if (callee.scope !== undefined)
    for (const sym of visibleNames(callee.scope, false)) {
      if (sym.varSection === "VAR_INPUT" || sym.varSection === "VAR_IN_OUT") inputs.add(sym.name.toLowerCase())
      if (sym.varSection === "VAR_OUTPUT" && !outputs.some((o) => o.toLowerCase() === sym.name.toLowerCase())) outputs.push(sym.name)
    }
  else
    for (const s of (callee.sym.ast as { varSections?: readonly VarSection[] }).varSections ?? [])
      for (const d of s.decls)
        for (const n of d.names) {
          if (s.sectionKind === "VAR_INPUT" || s.sectionKind === "VAR_IN_OUT") inputs.add(n.text.toLowerCase())
          if (s.sectionKind === "VAR_OUTPUT") outputs.push(n.text)
        }
  return { shape, inputs, outputs }
}
