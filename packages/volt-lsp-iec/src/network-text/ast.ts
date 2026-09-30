/**
 * Network-text AST — the textual form of an FBD/LD body, v2 (`volt-cli/docs/network-text.html`, openspec
 * network-text-literal-nwl). A body is network text when its line states it — `IMPLEMENTATION FBD` or
 * `IMPLEMENTATION LD` (`syntax/format/implementation-line`, `syntax/isGraphicalBody`). One statement per vendor network item:
 *
 *   body      = "IMPLEMENTATION" ( "FBD" | "LD" ) NL , { network }
 *   network   = "NETWORK" [LABEL: x] [TITLE: "…"] [DISABLED] NL , { "//" line } , [ VAR_TEMP wires END_VAR ] ,
 *               { statement } , "END_NETWORK"
 *   statement = ( assign | jump | IF c THEN jump ; END_IF | value ) ";"   — a lone ";" is the empty item
 *
 * The tree mirrors the bridge reader's (`NetworkTextReader.cs`) closely enough to report its structural findings live;
 * the operands inside it are ST `Expr`s so the one type engine, resolution, hover and rename apply unchanged. What
 * the text spells that ST has no node for — an empty slot, `PARALLEL`, an edge, `.ENO`, an EXECUTE box, `=> v` — is a
 * node of its own here, and `networkValueExpr` says which values have an ST reading at all.
 */
import type { Expr, Span, StatementList, TypeExpr } from "../frontend/syntax/index.js"

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
  /** The network's TITLE — free text, ST string escapes decoded. */
  title?: string
  /** The network's LABEL — the jump target `JMP` resolves against. A property of the network, on its header. */
  label?: NetworkName
  disabled: boolean
  /** The `//` lines between the header and the wire block or first statement, joined by `\n`. */
  comment?: string
  /** The network's `VAR_TEMP` wire declarations, in source order. */
  wires: NetworkWire[]
  statements: NetworkTextStatement[]
  span: Span
  headerSpan: Span
}

/** A wire — a vendor Demux — declared in the network's `VAR_TEMP` block. `g<digits>`, carrying the VarId. */
export interface NetworkWire {
  name: NetworkName
  /** The declared type as written (layout collapsed), and parsed where it parses. */
  typeText: string
  type?: TypeExpr
  /** The declaration: `g1 : BOOL;` (the names of a shared declaration share its span). */
  span: Span
  /** The wire's definition `g1 := value;`, once read. */
  definition?: NetworkWireDef
  /** Set when the declared type contradicts the producer (spec "a hand-edited type"; the push refuses it): the
   *  declaration is then no fact to type the wire's uses by. */
  typeRefused?: true
  /** Set when the producer rule names the declared type exactly (an edge, `.ENO`, a comparison, a boolean leaf, a wire
   *  of that type): only then is the declaration the type a build gives the wire's uses. Otherwise the push takes the
   *  declaration as written and the vendor, whose Demux holds no type, compiles the consumer against the producer. */
  typeConfirmed?: true
}

export type NetworkTextStatement =
  | NetworkAssign
  | NetworkWireDef
  | NetworkValueStatement
  | NetworkJump
  | NetworkReturn
  | NetworkEmpty

/** `t1 := t2 S= … tn R= value;` — ONE vendor Assign with its targets in order (a chained assignment). */
export interface NetworkAssign {
  kind: "assign"
  targets: NetworkTarget[]
  value: NetworkValue
  span: Span
}

/** `g1 := value;` — the definition of a wire declared in the network's `VAR_TEMP`. */
export interface NetworkWireDef {
  kind: "wire_def"
  wire: NetworkName
  value: NetworkValue
  span: Span
}

/** `value;` — a top-level item whose output goes nowhere (a box, a leaf, a wire reference, a Parallel). */
export interface NetworkValueStatement {
  kind: "value"
  value: NetworkValue
  span: Span
}

/** `JMP label;` or `IF c THEN JMP label; END_IF;`. */
export interface NetworkJump {
  kind: "jump"
  target: NetworkName
  condition?: NetworkValue
  span: Span
}

/** `RETURN;` or `IF c THEN RETURN; END_IF;`. */
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
  | NetworkEmptySlot
  | NetworkOperand
  | NetworkWireRef
  | NetworkNot
  | NetworkEdge
  | NetworkGroup
  | NetworkCall
  | NetworkParallel
  | NetworkExecute

/** An unconnected position: `f(a, )`, `coil := ;`, `( * x)`. */
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

/** A reference to a wire the network declares. */
export interface NetworkWireRef {
  kind: "wire_ref"
  name: NetworkName
  span: Span
}

/** The negation modifier: `NOT a`, `NOT (a AND b)`. (`NOT(a)` is the NOT box — a call.) */
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

/** `(a OP b …)` — one operator box, one operator kind. */
export interface NetworkGroup {
  kind: "group"
  /** The operator as written (`AND`, `+`, `>=`). */
  op: string
  operands: NetworkValue[]
  span: Span
}

/** A call box: `head(pins)`, `??? : TYPE(pins)`, optionally `.ENO`. */
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
   *  type, else the head: a function or operator box is named by its type. On the node, never re-derived from the head,
   *  which for an instance is its NAME. */
  boxType: string
  pins: NetworkPin[]
  /** Consumed through its ENO output. */
  eno: boolean
  span: Span
}

export type NetworkPin = NetworkInputPin | NetworkOutputPin

/** `F := v` or a positional `v`; `EN := c` is the enable. */
export interface NetworkInputPin {
  kind: "input"
  name?: NetworkName
  value: NetworkValue
  span: Span
}

/** `F => v` or a positional `=> v`; a bare `=>` passes a slot over. */
export interface NetworkOutputPin {
  kind: "output"
  name?: NetworkName
  target?: NetworkTarget
  span: Span
}

/** `PARALLEL([MODE := m,] [IN := feed,] b1, b2, …)` — the LD BoxTreeParallel. */
export interface NetworkParallel {
  kind: "parallel"
  mode?: NetworkName
  input?: NetworkValue
  branches: NetworkValue[]
  span: Span
}

/** `EXECUTE[(EN := c)]` … verbatim ST … `END_EXECUTE`, `.ENO` where consumed. Its lines are ST, parsed as such. */
export interface NetworkExecute {
  kind: "execute"
  en?: NetworkValue
  statements: StatementList
  ok: boolean
  eno: boolean
  span: Span
}

export interface NetworkName {
  text: string
  span: Span
}

/**
 * The structural codes the LSP reports live — the bridge gate's `NETWORK_*` vocabulary (`ConflictCodes`), each raised
 * where the bridge reader raises it. `NETWORK_NOT_CANONICAL` is not among them: it needs the writer.
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

/** The values a statement holds at its top: an assign's or a wire's value, a jump's condition, a value statement. */
export function statementValues(s: NetworkTextStatement): NetworkValue[] {
  switch (s.kind) {
    case "assign":
    case "wire_def":
    case "value":
      return [s.value]
    case "jump":
    case "return":
      return s.condition !== undefined ? [s.condition] : []
    case "empty":
      return []
  }
}

/** A value's direct sub-values. */
export function valueChildren(v: NetworkValue): NetworkValue[] {
  switch (v.kind) {
    case "not":
    case "edge":
      return [v.operand]
    case "group":
      return v.operands
    case "call":
      return v.pins.flatMap((p) => (p.kind === "input" ? [p.value] : []))
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

/** Every target a statement writes: an assign's targets and every `=>` pin's. */
export function* statementTargets(s: NetworkTextStatement): Generator<NetworkTarget> {
  if (s.kind === "assign") yield* s.targets
  for (const v of walkValues(s))
    if (v.kind === "call") for (const p of v.pins) if (p.kind === "output" && p.target !== undefined) yield p.target
}
