/**
 * Network-text AST — the textual form of an FBD/LD body (Layer F, F.2). A body is network text when its
 * first meaningful token is `NETWORK` (`syntax/isGraphicalBody`). Grammar (network-text.md §4):
 *   body    = { network }
 *   network = "NETWORK" int LANG [string] ["DISABLED"] , { statement } , "END_NETWORK"
 *   stmt    = wire-def | sink | fb-call | control-flow | comment
 *   wire    = "LET" name ":=" producer     · sink = lvalue ":=" operand
 *
 * ponytail: this LEAN model keeps operands/lvalues as raw token slices (with identifiers extracted for
 * nav/checks) rather than the full NetworkGroup/NetworkOperand tree — enough for structure diagnostics, outline,
 * and identifier nav. The full operand tree + graphical type inference is a noted follow-on.
 */
import type { Expr, Span, StatementList, Token } from "../../syntax/index.js"

export type NetworkLanguage = "FBD" | "LD" | "CFC" | "SFC" | "UNKNOWN"

export interface NetworkTextBody {
  kind: "network_body"
  networks: NetworkTextNetwork[]
  diagnostics: NetworkTextDiagnostic[]
  span: Span
}

export interface NetworkTextNetwork {
  index?: number
  language: NetworkLanguage
  /**
   * The network's TITLE — the quoted string in the header, `NETWORK 0 LD "interlock"`.
   *
   * Named `label` until 2026-09-03, which was wrong and actively misleading: a network's LABEL is a separate
   * thing entirely — a `name:` STATEMENT, the jump target `JMP` resolves against — and the two are distinct
   * fields on the vendor model too (`Network.Title` vs `Network.Label`). One name for two concepts is how a
   * later check gets written against the wrong one.
   */
  title?: string
  disabled: boolean
  statements: NetworkTextStatement[]
  span: Span
  headerSpan: Span
}

export type NetworkTextStatement =
  | NetworkWireDef
  | NetworkSink
  | NetworkFbCall
  | NetworkEnEnoIf
  | NetworkExecute
  | NetworkLabel
  | NetworkJump
  | NetworkReturn
  | NetworkComment
  | NetworkUnknownStmt

/**
 * Operands are parsed into ST `Expr` (the reuse decision — network-text operands ARE fully-parenthesised ST
 * expressions), so the one type engine / resolveMemberChain / nav / hover apply unchanged. `undefined`
 * when the slice doesn't parse cleanly (conservative-skip, like a non-parsing ST body).
 */

/** `LET name := <producer>` — an internal wire (network text-only; stripped on push). `en` bindings feed IF boxes. */
export interface NetworkWireDef {
  kind: "wire_def"
  name: NetworkName
  isEnBinding: boolean
  producer?: Expr
  span: Span
}
/** `lvalue := <operand>` — a value sink (a coil / outVariable). */
export interface NetworkSink {
  kind: "sink"
  target?: Expr
  value?: Expr
  span: Span
}
/** `inst(PIN := arg, …)` — an FB-instance / function box with no result binding. */
export interface NetworkFbCall {
  kind: "fb_call"
  call?: Expr
  span: Span
}
/** `IF <en> THEN <statements> END_IF` — an EN/ENO box; its body is faithful network text. */
export interface NetworkEnEnoIf {
  kind: "en_eno_if"
  en?: Expr
  body: NetworkTextStatement[]
  span: Span
}
/** `EXECUTE <inline ST> END_EXECUTE` — an inline-ST action box; its body is ordinary ST, parsed as such. */
export interface NetworkExecute {
  kind: "execute"
  statements: StatementList
  ok: boolean
  span: Span
}
export interface NetworkLabel {
  kind: "label"
  name: NetworkName
  span: Span
}
export interface NetworkJump {
  kind: "jump"
  target: NetworkName
  condition?: Expr
  span: Span
}
export interface NetworkReturn {
  kind: "return"
  condition?: Expr
  span: Span
}
export interface NetworkComment {
  kind: "comment"
  text: string
  span: Span
}
export interface NetworkUnknownStmt {
  kind: "unknown_stmt"
  tokens: Token[]
  span: Span
}

export interface NetworkName {
  text: string
  span: Span
}

/**
 * The LSP-ownable subset of the bridge's network text diagnostic codes (network-text-diagnostics.md). The canonical /
 * round-trip gate (NETWORK_NOT_CANONICAL, NETWORK_PLCOPEN_DRIFT, NETWORK_LEAF_FANOUT, NETWORK_LEAF_REFERENCES_TEMP) needs
 * the writer + PLCopen and stays the BRIDGE's domain. These four are pure-text structural facts the LSP
 * can surface live. ponytail: messages are PROVISIONAL — no network text recordings yet, so wording is
 * bridge-gated (locked at the live-bridge record pass), same as the D.3 overflow/subrange messages.
 */
export type NetworkDiagnosticCode =
  | "NETWORK_PARSE"
  | "NETWORK_NOT_CLOSED"
  | "NETWORK_DUPLICATE_NETWORK"
  | "NETWORK_DUPLICATE_NAME"

export interface NetworkTextDiagnostic {
  code: NetworkDiagnosticCode
  message: string
  span: Span
}
