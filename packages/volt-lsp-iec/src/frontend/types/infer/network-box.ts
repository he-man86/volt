/**
 * THE BOX A NETWORK CALL IS (openspec network-output-member; the bridge's `StNetworkReader`): in a plain-ST network body
 * every box is ONE call of its toolbox name, an FB's the call ON ITS INSTANCE (`t1(…)`, its type the instance's
 * declaration); only an FB box with no instance (the vendor's `???`) is the call of its TYPE. `EN :=` written first is the
 * shown EN, and two members close a call — `.ENO` the shown ENO, `.NAME` the output a consumer reads where the callee
 * declares more than one. A callee that DECLARES `EN` or `ENO` has them as ordinary pins.
 *
 *   `GT(EN := c, a, b)`                        the comparison, EN shown: its value
 *   `MOVE(EN := c, 1, OUT => x).ENO`           EN and ENO shown: its ENO, a BOOL
 *   `t1(IN := a, PT := T#1S).Q`                the FB box, read through Q: `t1.Q`
 *   `r1(CLK := a)`                             an FB with one output: that output
 *   `TON(IN := a)`                             the FB box with no instance (`???`)
 *   `g(a, Q => v).OUT`                         a function with a VAR_OUTPUT, read through its value
 *
 * What the callee declares is the one fact every reading needs (`BoxSignature`): the box's FB (its instance's type, else
 * the type the call names), a function's or a program's own sections, an operator's (one value, no pin of its own named EN
 * or ENO). A callee nothing in reach declares has no signature, and its call is read as written.
 */
import { lookup, lookupLocal, visibleNames, type Scope } from "../../symbols/index.js"
import { type CallArg, type CallExpr, type Expr, type MemberExpr, UNNAMED, type VarSection } from "../../syntax/index.js"
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

/** The box `call` is, in a network body; undefined outside one and for the text's own elements and controls (`BRANCH`,
 *  `R_EDGE`, `JMP`, …) and the Execute box. */
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
  const pins = call.args.slice(at)
  return { call, instance, enable, pins, st: { kind: "call", callee: instance ?? call.callee, args: [...pins], span: call.span }, signature }
}

/** The member closing a box's call, `<box>.ENO` / `<box>.NAME`: the box and the name; undefined for any other member. */
export function boxMember(e: MemberExpr, scope: Scope, project: Scope): { box: NetworkBox; name: string; eno: boolean } | undefined {
  if (e.base.kind !== "call") return undefined
  const box = networkBox(e.base, scope, project)
  if (box === undefined) return undefined
  const name = e.member.name
  return { box, name, eno: name.toUpperCase() === "ENO" && !declaresEno(box.signature) }
}

const OPERATOR: BoxSignature = { shape: "function", inputs: new Set(), outputs: [] }

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
