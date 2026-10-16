/**
 * Network-text AST — the textual form of an FBD/LD body (`volt-cli/docs/network-text.html`, openspec ld-fbd-coverage 2R.3,
 * `readability.md`). A body is network text when its line states it — `IMPLEMENTATION FBD` or `IMPLEMENTATION LD`. One
 * statement per vendor network ITEM: the item's lines up to its `;`, a box on an OPEN line (no `;`) reached through the
 * `ENO` that takes it (P3) — so a statement is one tree, as the vendor holds it.
 *
 *   body      = "IMPLEMENTATION" ( "FBD" | "LD" ) NL , { network }
 *   network   = "NETWORK" [LABEL: x] [DISABLED] [TITLE: "…"] NL , { "//" line } , { item } , "END_NETWORK"
 *   item      = { open line } , ( coil | split | jump | value ) ";"   — a lone ";" is the empty item
 *
 * The tree mirrors the bridge reader's (`NetworkTextReader.cs`) closely enough to report its findings live; the operands
 * inside it are ST `Expr`s so the one type engine, resolution, hover and rename apply unchanged. What the text spells
 * that ST has no node for — an empty slot, a parallel, an edge, ENO, an EXECUTE box, `=> v` — is a node of its own here,
 * and `networkValueExpr` says which values have an ST reading at all.
 */
import type { Span } from "../span.js"
import type { Expr, StatementList } from "../ast/nodes/index.js"

export type NetworkLanguage = "FBD" | "LD"

export interface NetworkTextBody {
  kind: "network_body"
  /** The language the body's IMPLEMENTATION line states; undefined for a body whose line states no network language. */
  language?: NetworkLanguage
  networks: NetworkTextNetwork[]
  diagnostics: NetworkTextDiagnostic[]
  span: Span
}

export interface NetworkTextNetwork {
  /** Position in the body, 0-based. The text carries no order number (v1's `NETWORK <n>` is refused). */
  index: number
  /** The network's TITLE — exact, ST string escapes decoded. */
  title?: string
  /** The network's LABEL — the jump target `JMP` resolves against. A property of the network, on its header. */
  label?: NetworkName
  disabled: boolean
  /** The `//` lines between the header and the first statement, joined by `\n`. */
  comment?: string
  /** The network's split points (B6), in definition order: `split<VarId> := value;`, and every reference to each. */
  splits: NetworkSplit[]
  /** `UNSUPPORTED "<shape>";` — the network's trees the text has no spelling for, shown as one line (1b.4). */
  unsupported?: NetworkName
  statements: NetworkTextStatement[]
  span: Span
  headerSpan: Span
}

/** A split point — a vendor Demux (B6): its name IS its VarId, it has no declaration and no type. */
export interface NetworkSplit {
  name: NetworkName
  varId: number
  definition: NetworkSplitDef
  references: NetworkName[]
}

export type NetworkTextStatement = NetworkAssign | NetworkSplitDef | NetworkValueStatement | NetworkJump | NetworkReturn | NetworkEmpty

/** `t1 := t2 S= … tn R= value;` — ONE vendor Assign with its targets in order (a chained assignment). */
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

/** `JMP label;` on the rail, or `JMP label := c;` (B4b). */
export interface NetworkJump {
  kind: "jump"
  target: NetworkName
  condition?: NetworkValue
  span: Span
}

/** `RETURN;` on the rail, or `RETURN := c;` (B4b). */
export interface NetworkReturn {
  kind: "return"
  condition?: NetworkValue
  span: Span
}

/** `;` on its own — the empty item. */
export interface NetworkEmpty {
  kind: "empty"
  span: Span
}

/** An assignment or `=>` target: a token (a name or path, `???`, an address) or backticked text. */
export interface NetworkTarget {
  /** The target as written, backticks stripped. */
  text: string
  /** The target as an ST expression; undefined for `???` and backticked text that is no expression. */
  expr?: Expr
  /** The storage operator an assignment writes it with; absent on a `=>` pin's target, which has none. */
  op?: ":=" | "S=" | "R="
  backticked: boolean
  unnamed: boolean
  span: Span
}

export type NetworkValue =
  | NetworkNestedAssign
  | NetworkEmptySlot
  | NetworkOperand
  | NetworkSplitRef
  | NetworkNot
  | NetworkEdge
  | NetworkWordBox
  | NetworkCall
  | NetworkParallel
  | NetworkExecute
  | NetworkEno

/** `(t1 := t2 S= … value)` — an assignment BELOW the top level (S2): one vendor Assign item, its value passing through. */
export interface NetworkNestedAssign {
  kind: "nested_assign"
  targets: NetworkTarget[]
  value: NetworkValue
  span: Span
}

/** An unconnected position: `f(a, )`, `coil := ;`, `EN` with nothing after it. */
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

/** A reference to a split point the network defines above it (B6). */
export interface NetworkSplitRef {
  kind: "split_ref"
  name: NetworkName
  span: Span
}

/** The negation modifier: `NOT a`, `NOT (a AND b)`. (`NOT(IN := a)` is the NOT box — a call.) */
export interface NetworkNot {
  kind: "not"
  operand: NetworkValue
  span: Span
}

/** `R_EDGE(x)` / `F_EDGE(x)` — an edge FLAG on its operand, never a box. */
export interface NetworkEdge {
  kind: "edge"
  rising: boolean
  operand: NetworkValue
  span: Span
}

/** A box written as its WORD (B1, B2): `a ADD b ADD c`, `MOVE b`, each with its `=> v` pins and its `EN` tail. */
export interface NetworkWordBox {
  kind: "word"
  /** The word, upper case: a box word of the table, or MOVE. */
  word: string
  /** The word as written — its span is where the box is named. */
  head: NetworkName
  operands: NetworkValue[]
  outputs: NetworkTarget[]
  /** The enable after the box (B3); an empty slot for `EN` with nothing after it. */
  en?: NetworkValue
  enSpan?: Span
  span: Span
}

/** A call box: `head(pins)`, `??? : TYPE(pins)`, optionally `.name` and an `EN` tail. */
export interface NetworkCall {
  kind: "call"
  /** The head as written: a BoxType or an FB instance (backticks stripped). */
  head: NetworkName
  /** The head as an ST expression — an instance may be a path (`GVL.timers.t1`); undefined where it is none. */
  headExpr?: Expr
  backticked: boolean
  /** `??? : TYPE(…)` — the vendor's unnamed instance, which carries its type because no declaration can. */
  unnamedType?: NetworkName
  /** The box's TYPE as the reader decided it — an instance's FB (from the declarations), an unnamed instance's written
   *  type, else the head. */
  boxType: string
  pins: NetworkPin[]
  /** `fb(…).name` — consumed through its output of that name, a main output that is not the box's first slot (S4). */
  output?: NetworkName
  /** The head is an FB instance the declarations name (an unnamed instance `??? : TYPE` is not one). */
  instance?: true
  /** An operator written in its call form (P5): `ADD(a)`, `MOVE()`, `AND(a, NOT IN2 := b)`, `NOT(IN := a)`. */
  operatorCall?: true
  en?: NetworkValue
  enSpan?: Span
  span: Span
}

export type NetworkPin = NetworkInputPin | NetworkOutputPin

/** `F := v` or a positional `v`. `NOT F := v` negates the PIN (S6), where `F := NOT v` negates the value. */
export interface NetworkInputPin {
  kind: "input"
  name?: NetworkName
  value: NetworkValue
  negated?: true
  span: Span
}

/** `F => v` or a positional `=> v`; a bare `=>` passes a slot over; `ENO => v` the named ENO pin (P5). */
export interface NetworkOutputPin {
  kind: "output"
  name?: NetworkName
  target?: NetworkTarget
  span: Span
}

/** `[feed] BRANCH (b1, b2, …) [SHORTCIRCUIT]` — the LD BoxTreeParallel (B8). */
export interface NetworkParallel {
  kind: "parallel"
  input?: NetworkValue
  branches: NetworkValue[]
  /** The old short-circuit mode; the editor's Sequential is written as nothing (B7). */
  shortCircuit: boolean
  /** The word BRANCH. */
  branchWord: Span
  span: Span
}

/** `EXECUTE [EN [c]]` … verbatim ST … `END_EXECUTE` (P8). Its lines are ST, parsed as such. */
export interface NetworkExecute {
  kind: "execute"
  en?: NetworkValue
  enSpan?: Span
  statements: StatementList
  ok: boolean
  span: Span
}

/** `ENO` — the enable output of the oldest open line above it not yet taken (B4, P3): that line's box. */
export interface NetworkEno {
  kind: "eno"
  box: NetworkWordBox | NetworkCall | NetworkExecute
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

/** The values a statement holds at its top: an assign's or a split's value, a jump's condition, a value statement. */
export function statementValues(s: NetworkTextStatement): NetworkValue[] {
  switch (s.kind) {
    case "assign":
    case "split_def":
    case "value":
      return [s.value]
    case "jump":
    case "return":
      return s.condition !== undefined ? [s.condition] : []
    case "empty":
      return []
  }
}

/** A value's direct sub-values, in text order. */
export function valueChildren(v: NetworkValue): NetworkValue[] {
  switch (v.kind) {
    case "not":
    case "edge":
      return [v.operand]
    case "nested_assign":
      return [v.value]
    case "word":
      return [...v.operands, ...(v.en !== undefined ? [v.en] : [])]
    case "call":
      return [...v.pins.flatMap((p) => (p.kind === "input" ? [p.value] : [])), ...(v.en !== undefined ? [v.en] : [])]
    case "parallel":
      return [...(v.input !== undefined ? [v.input] : []), ...v.branches]
    case "execute":
      return v.en !== undefined ? [v.en] : []
    case "eno":
      return [v.box]
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

/** Every target a statement writes: an assign's targets, a nested assignment's, and every `=>` pin's. */
export function* statementTargets(s: NetworkTextStatement): Generator<NetworkTarget> {
  if (s.kind === "assign") yield* s.targets
  for (const v of walkValues(s)) {
    if (v.kind === "nested_assign") yield* v.targets
    if (v.kind === "word") yield* v.outputs
    if (v.kind === "call") for (const p of v.pins) if (p.kind === "output" && p.target !== undefined) yield p.target
  }
}
