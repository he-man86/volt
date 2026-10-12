/**
 * THE AST'S STATEMENTS — the statement tree of a body. One family of `ast/nodes/` (openspec lsp-same-standard design.md
 * §8).
 */
import type { Span } from "../../span.js"
import type { Expr, CallExpr, Identifier } from "./expressions.js"

// ─── statement tree ──────────────────────────────────────────────────────────

export type Statement =
  | Assignment
  | CallStatement
  | IfStatement
  | CaseStatement
  | ForStatement
  | WhileStatement
  | RepeatStatement
  | ReturnStatement
  | ExitStatement
  | ContinueStatement
  | TryStatement
  | JmpStatement
  | LabelStatement
  | ExprStatement
  | EmptyStatement
export type StatementList = Statement[]

export interface Assignment {
  kind: "assign"
  target: Expr
  value: Expr
  op?: "S=" | "R=" | "REF=" // IEC set/reset/reference-rebind; undefined for `:=` — the operator after `target`
  chained?: Expr[] // intermediate l-values of `a := b := c` / `a S= b R= c`
  /** The operator AFTER each `chained[i]` (undefined for `:=`), parallel to `chained`. A chain can MIX operators —
   *  `a S= b R= c` compiles in CODESYS (conformance `set_reset_chained`) — so one `op` for the whole chain is not
   *  enough, and the formatter printing that one `op` for every link silently rewrote `R=` into `S=`. */
  chainOps?: ("S=" | "R=" | "REF=" | undefined)[]
  span: Span
}
export interface CallStatement {
  kind: "call_stmt"
  call: CallExpr
  span: Span
}
export interface ExprStatement {
  kind: "expr_stmt"
  expr: Expr
  /**
   * The statement the vendor RESUMED at after refusing a token before it — `NS;` in `t := T#5NS;`, `RUE;` in
   * `b := BOOL#TRUE;` (`parse/errors.ts` `reportStatementCascade`). Both vendors warn it has no effect although nothing
   * declares the name: a body that did not parse is never resolved, and the warning does not need it
   * (`cc_time_nanosecond_literal`, `lit_bool_typed_true`).
   */
  resumed?: true
  /**
   * Its `;` is MISSING: the vendor takes the statement as ended there (`parse/statements` `resyncAfterMissingSemicolon`)
   * and quotes it with the `;` it supplied — `b ** c;` holds the statement `b`, "The code 'b;' has no effect"
   * (`expr_power_right_assoc`, both vendors).
   */
  unterminated?: true
  span: Span
}
export interface TryStatement {
  // __TRY … __CATCH(e) … __FINALLY … __ENDTRY
  kind: "try"
  tryBody: StatementList
  catchVar?: Expr
  catchBody?: StatementList
  finallyBody?: StatementList
  span: Span
}
export interface IfStatement {
  kind: "if"
  branches: IfBranch[]
  elseBody?: StatementList
  span: Span
}
export interface IfBranch {
  kind: "if_branch"
  cond: Expr
  body: StatementList
  span: Span
}
export interface CaseStatement {
  kind: "case"
  selector: Expr
  arms: CaseArm[]
  elseBody?: StatementList
  span: Span
}
export interface CaseArm {
  kind: "case_arm"
  labels: CaseLabel[]
  body: StatementList
  span: Span
}
export interface CaseLabel {
  kind: "case_label"
  value: Expr
  upper?: Expr // `1..5`
  span: Span
}
export interface ForStatement {
  kind: "for"
  controlVar: Expr
  from: Expr
  to: Expr
  by?: Expr
  body: StatementList
  span: Span
}
export interface WhileStatement {
  kind: "while"
  cond: Expr
  body: StatementList
  span: Span
}
export interface RepeatStatement {
  kind: "repeat"
  body: StatementList
  until: Expr
  span: Span
}
export interface ReturnStatement {
  kind: "return"
  span: Span
}
export interface ExitStatement {
  kind: "exit"
  span: Span
}
export interface ContinueStatement {
  kind: "continue"
  span: Span
}
export interface EmptyStatement {
  kind: "empty"
  span: Span
}
/** `JMP <label>;` — CODESYS/TwinCAT jump. `target` is a bare IdentExpr for a real label; anything else
 *  (a numeric literal, an expression) is an invalid destination (C0114) the label check flags. */
export interface JmpStatement {
  kind: "jmp"
  target: Expr
  /** The token the vendor took for the destination where no label stands — `JMP;` takes its `;` (`rec_jmp_without_label`);
   *  `target` is then the refused placeholder. The analysis words it (`checks/flow/jump-labels`). */
  refusedDestination?: string
  span: Span
}
/** A jump label `<name>:` at statement start (distinct from `:=` assignment and CASE labels). */
export interface LabelStatement {
  kind: "label"
  name: Identifier
  span: Span
}
