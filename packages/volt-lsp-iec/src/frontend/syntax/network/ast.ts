/**
 * Network-text AST — the textual form of an FBD/LD body (`volt-cli/docs/network-text.html`, openspec ld-fbd-coverage
 * 2R.6b, `v2-spec.md`). A body is network text when its line states it — `%LANGUAGE FBD` or `%LANGUAGE LD`. One
 * statement per vendor network ITEM, ending with `;`: one tree, written root first, as the vendor holds it.
 *
 *   body      = "%LANGUAGE" ( "FBD" | "LD" ) NL , { network }
 *   network   = "NETWORK" [LABEL: x] [DISABLED] [TITLE: "…"] NL , { "//" line } , ( unsupported | { item } ) , "END_NETWORK"
 *   item      = [ coil { coil } slot | split := slot | slot ] ";"
 *
 * The tree mirrors the bridge reader's (`NetworkTextReader.cs`) closely enough to report its findings live; the operands
 * inside it are ST `Expr`s so the one type engine, resolution, hover and rename apply unchanged. What the text spells that
 * ST has no node for — an empty slot, a parallel, an edge, an EXECUTE box, `=> v` — is a node of its own here, and
 * `networkValueExpr` says which values have an ST reading at all.
 */
import type { Span } from "../span.js"
import type { Expr, StatementList } from "../ast/nodes/index.js"

export type NetworkLanguage = "FBD" | "LD"

export interface NetworkTextBody {
  kind: "network_body"
  /** The language the body's %LANGUAGE line states; undefined for a body whose line states no network language. */
  language?: NetworkLanguage
  networks: NetworkTextNetwork[]
  diagnostics: NetworkTextDiagnostic[]
  span: Span
}

export interface NetworkTextNetwork {
  /** Position in the body, 0-based. */
  index: number
  /** The network's TITLE — exact, IEC's escapes decoded. */
  title?: string
  /** The network's LABEL — the jump target `JMP` resolves against. */
  label?: NetworkName
  disabled: boolean
  /** The `//` lines between the header and the first item, joined by `\n`. */
  comment?: string
  /** The network's split points, in definition order, and every reference to each. */
  splits: NetworkSplit[]
  /** `UNSUPPORTED "<shape>" #<hash>;` — the network's trees the text has no spelling for, shown as one line. */
  unsupported?: NetworkName
  /** The UNSUPPORTED line's hash: the stored network's, 8 hex digits. */
  unsupportedHash?: string
  statements: NetworkTextStatement[]
  span: Span
  headerSpan: Span
}

/** A split point — a vendor Demux: its name IS its VarId, it has no declaration and no type. Its definition is an item of
 *  its own, or nested where a value stands (`x := (split1 := a AND b);`); a reference may stand above it (the stored order,
 *  which reads the previous scan). */
export interface NetworkSplit {
  name: NetworkName
  varId: number
  definition: NetworkSplitDef | NetworkNestedSplit
  references: NetworkName[]
}

export type NetworkTextStatement = NetworkAssign | NetworkSplitDef | NetworkValueStatement | NetworkEmpty

/** `t1 := t2 S= … tn R= value;` — ONE vendor Assign with its coils in order; a jump or a return is a coil (`JMP l := c;`,
 *  `RETURN := ;`). */
export interface NetworkAssign {
  kind: "assign"
  targets: NetworkTarget[]
  value: NetworkValue
  span: Span
}

/** `split1 := value;` — the definition of a split point. */
export interface NetworkSplitDef {
  kind: "split_def"
  split: NetworkName
  value: NetworkValue
  span: Span
}

/** `value;` — a top-level item whose output goes nowhere (a box, a leaf, a split reference, a parallel). */
export interface NetworkValueStatement {
  kind: "value"
  value: NetworkValue
  span: Span
}

/** `;` on its own — the empty item. */
export interface NetworkEmpty {
  kind: "empty"
  span: Span
}

/** An assignment or `=>` target: a token (a name or path, `???`, an address) or backticked text — or, on a coil, a jump
 *  (`JMP l`, its label the text) or a return. */
export interface NetworkTarget {
  /** The target as written, backticks stripped; a jump's label; `RETURN` for a return. */
  text: string
  /** The target as an ST expression; undefined for `???`, a jump, a return and backticked text that is no expression. */
  expr?: Expr
  /** The storage operator a coil writes it with; absent on a `=>` pin's target, which has none. */
  op?: ":=" | "S=" | "R="
  /** `JMP l :=` — the coil is a jump to the label `text`. */
  jump?: true
  /** `RETURN :=` — the coil is a return. */
  ret?: true
  /** The coil's own modifiers, written before it: `NOT x :=`, `R_EDGE x :=`. */
  negated?: true
  edge?: "rising" | "falling"
  backticked: boolean
  unnamed: boolean
  span: Span
}

/** A pin's own modifiers, written before its name — `NOT IN := v`, `R_EDGE IN1 := c`, `NOT EN c`. */
export interface NetworkPinFlags {
  negated?: true
  edge?: "rising" | "falling"
}

export type NetworkValue =
  | NetworkNestedAssign
  | NetworkNestedSplit
  | NetworkEmptySlot
  | NetworkOperand
  | NetworkSplitRef
  | NetworkNot
  | NetworkEdge
  | NetworkWordBox
  | NetworkCall
  | NetworkParallel
  | NetworkExecute

/** `(t1 := t2 S= … value)` — an assignment below the top level: one vendor Assign item, its value passing through. */
export interface NetworkNestedAssign {
  kind: "nested_assign"
  targets: NetworkTarget[]
  value: NetworkValue
  span: Span
}

/** `(split1 := value)` — a split's definition below the top level, its value passing through. */
export interface NetworkNestedSplit {
  kind: "nested_split"
  split: NetworkName
  value: NetworkValue
  span: Span
}

/** An unconnected position: `MUL a MUL 6`, `coil := ;`, `EN` with nothing after it. */
export interface NetworkEmptySlot {
  kind: "empty_slot"
  span: Span
}

/** A leaf: a token (name, path, literal, address, `???`) or backticked text, which stays ONE operand. */
export interface NetworkOperand {
  kind: "operand"
  text: string
  backticked: boolean
  unnamed: boolean
  /** The operand as an ST expression (backticked text parsed as one); undefined for `???` or text that is none. */
  expr?: Expr
  span: Span
}

/** A reference to a split point the network defines. */
export interface NetworkSplitRef {
  kind: "split_ref"
  name: NetworkName
  span: Span
}

/** The negation modifier: `NOT a`, `NOT (a AND b)`, `NOT f(a)`, a negated empty slot `x := NOT;`. */
export interface NetworkNot {
  kind: "not"
  operand: NetworkValue
  span: Span
}

/** `R_EDGE x` / `F_EDGE x` — an edge FLAG on its operand (around a negation, `R_EDGE NOT x`), never a box. */
export interface NetworkEdge {
  kind: "edge"
  rising: boolean
  operand: NetworkValue
  span: Span
}

/** What every box carries after its outputs: its ENO where shown, its EN last — and how its consumer reads it. */
export interface NetworkPinState {
  /** `ENO` shown after the outputs, and `ENO => v` where the ENO pin is wired. */
  eno?: { span: Span; target?: NetworkTarget }
  /** The enable after the box; an empty slot for `EN` with nothing after it. */
  en?: NetworkValue
  enSpan?: Span
  /** The EN pin's own modifiers, `NOT EN c`. */
  enFlags?: NetworkPinFlags
  /** Whether the box has an ENO output: shown, an EXECUTE box's, or an FB's declared one read with nothing after its call. */
  hasEno: boolean
  /** How a consumer reads the box: through its ENO, by its value, or by an FB's `.name`; undefined at the top level. */
  readBy?: "eno" | "value" | "name"
}

/** A box written as its WORD: `a ADD b ADD c`, `MOVE b`, each with its `=> v` pins and its pin state. */
export interface NetworkWordBox extends NetworkPinState {
  kind: "word"
  /** The word, upper case: a box word of the table, or MOVE. */
  word: string
  /** The word as written — the box's type as stored, and its span where the box is named. */
  head: NetworkName
  operands: NetworkValue[]
  outputs: NetworkTarget[]
  span: Span
}

/** A call box: `f(pins)`, `inst : TYPE(pins)`, `??? : TYPE(pins)`, `` `NOT`(a) ``, optionally `.name` and its pin state. */
export interface NetworkCall extends NetworkPinState {
  kind: "call"
  /** The head as written: a callee, or an FB instance (backticks stripped). */
  head: NetworkName
  /** The head as an ST expression — an instance may be a path (`GVL.timers.t1`); undefined where it is none. */
  headExpr?: Expr
  backticked: boolean
  /** `inst : TYPE(…)` — the FB type the call names. */
  type?: NetworkName
  /** The box's TYPE: an FB call's written type, else the head. */
  boxType: string
  pins: NetworkPin[]
  /** `fb(…).name` — read through its output of that name. */
  output?: NetworkName
  /** An FB call (`inst : TYPE(…)`), named or unnamed. */
  instance?: true
  /** `??? : TYPE(…)` — the vendor's unnamed instance. */
  unnamed: boolean
  /** An operator in its backticked call form: `` `NOT`(a) ``, `` `AND`(IN1 := a, NOT IN2 := b) ``. */
  operatorCall?: true
  span: Span
}

export type NetworkPin = NetworkInputPin | NetworkOutputPin

/** `F := v` or a positional `v`. `NOT F := v` negates the PIN, where `F := NOT v` negates the value. */
export interface NetworkInputPin {
  kind: "input"
  name?: NetworkName
  value: NetworkValue
  negated?: true
  edge?: "rising" | "falling"
  span: Span
}

/** `F => v` or a positional `=> v`; a bare `=>` passes a slot over. */
export interface NetworkOutputPin {
  kind: "output"
  name?: NetworkName
  target?: NetworkTarget
  span: Span
}

/** `[feed] BRANCH (b1, b2, …) [SHORTCIRCUIT]` — the LD BoxTreeParallel. */
export interface NetworkParallel {
  kind: "parallel"
  input?: NetworkValue
  branches: NetworkValue[]
  /** The short-circuit mode; the editor's Sequential is written as nothing. */
  shortCircuit: boolean
  /** The word BRANCH. */
  branchWord: Span
  span: Span
}

/** `EXECUTE` ⏎ verbatim ST ⏎ `END_EXECUTE` and its pin state. Its lines are ST, parsed as such. */
export interface NetworkExecute extends NetworkPinState {
  kind: "execute"
  statements: StatementList
  ok: boolean
  span: Span
}

export interface NetworkName {
  text: string
  span: Span
}

/**
 * The structural codes the LSP reports live — the bridge gate's `NETWORK_*` vocabulary (`ConflictCodes`), each raised
 * where the bridge reader raises it.
 */
export type NetworkDiagnosticCode =
  | "NETWORK_PARSE"
  | "NETWORK_NOT_CLOSED"
  | "NETWORK_DUPLICATE_NAME"
  | "NETWORK_BAD_EXPRESSION"
  | "NETWORK_UNSUPPORTED"
  | "NETWORK_UNKNOWN_OPERATOR"

export interface NetworkTextDiagnostic {
  code: NetworkDiagnosticCode
  message: string
  span: Span
}

// ─── walks ────────────────────────────────────────────────────────────────────

/** The values a statement holds at its top: an assign's or a split's value, a value statement. */
export function statementValues(s: NetworkTextStatement): NetworkValue[] {
  return s.kind === "empty" ? [] : [s.value]
}

/** A value's direct sub-values, in text order (a box's EN last). */
export function valueChildren(v: NetworkValue): NetworkValue[] {
  switch (v.kind) {
    case "not":
    case "edge":
      return [v.operand]
    case "nested_assign":
    case "nested_split":
      return [v.value]
    case "word":
      return [...v.operands, ...(v.en !== undefined ? [v.en] : [])]
    case "call":
      return [...v.pins.flatMap((p) => (p.kind === "input" ? [p.value] : [])), ...(v.en !== undefined ? [v.en] : [])]
    case "parallel":
      return [...(v.input !== undefined ? [v.input] : []), ...v.branches]
    case "execute":
      return v.en !== undefined ? [v.en] : []
    default:
      return []
  }
}

/** Every value in a statement, depth first, parents before children. */
export function* walkValues(s: NetworkTextStatement): Generator<NetworkValue> {
  const stack = [...statementValues(s)].reverse()
  while (stack.length > 0) {
    const v = stack.pop()!
    yield v
    stack.push(...valueChildren(v).reverse())
  }
}

/** Every target a statement writes: an assign's coils, a nested assignment's, every `=> v` pin and every `ENO => v`. */
export function* statementTargets(s: NetworkTextStatement): Generator<NetworkTarget> {
  if (s.kind === "assign") yield* s.targets
  for (const v of walkValues(s)) {
    if (v.kind === "nested_assign") yield* v.targets
    if (v.kind === "word") yield* v.outputs
    if (v.kind === "call") for (const p of v.pins) if (p.kind === "output" && p.target !== undefined) yield p.target
    if ((v.kind === "word" || v.kind === "call" || v.kind === "execute") && v.eno?.target !== undefined) yield v.eno.target
  }
}

/** Every jump a statement makes — a jump coil at the top or nested (`JMP l := c;`, `y := (JMP l := c);`): each label, at
 *  its span. */
export function* statementJumps(s: NetworkTextStatement): Generator<NetworkName> {
  if (s.kind === "assign") for (const t of s.targets) if (t.jump === true) yield { text: t.text, span: t.span }
  for (const v of walkValues(s))
    if (v.kind === "nested_assign") for (const t of v.targets) if (t.jump === true) yield { text: t.text, span: t.span }
}
