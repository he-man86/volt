/**
 * The network-text OPERAND checks (`network-analysis.ts` runs them per network): every ST expression the network
 * carries, EXECUTE boxes' ST included, resolved and typed by the ST checks' own per-node rules — an undeclared name, an
 * unknown member, a binary operator's operands, a conversion's argument.
 */
import { type Expr, type NetworkTextStatement, executeBoxes, statementExprs, stmtExprs, walkExpr, walkStatements } from "../../../frontend/syntax/index.js"
import type { Scope } from "../../../frontend/symbols/index.js"
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"
import { binaryOpError, conversionArgError } from "../../shared/rules.js"
import { unresolvedInExprs, unresolvedMembers } from "../../shared/resolution.js"
import type { Messages } from "../../messages/index.js"

/**
 * network-undeclared-identifier + network-unknown-member: resolve every operand identifier in the network against its
 * POU+wire scope (bare names), then type-check every member access (`a.b`) against the base's type — the SAME
 * `unresolvedInExprs`/`unresolvedMembers` the ST check uses, so network text matches ST byte-for-byte.
 *
 * No word of the text reaches it as an identifier any more: an edge is `R_EDGE(x)`, a flag on `x` that reads as an
 * opaque BOOL whose operand is still resolved (`syntax/network/exprs`), where v1 left a trailing `RISING`/`FALLING` in
 * the operand for this check to skip by name.
 */
export function checkUndeclared(
  statements: readonly NetworkTextStatement[],
  scope: Scope,
  project: Scope,
  messages: Messages,
  out: DiagnosticItem[],
): void {
  const exprs = operandExprs(statements)
  for (const ref of unresolvedInExprs(exprs, scope)) {
    out.push({
      severity: "error",
      span: ref.span,
      source: SOURCE,
      code: "network-undeclared-identifier",
      message: messages.undefinedIdentifier(ref.name),
    })
  }
  for (const ref of unresolvedMembers(exprs, scope, project)) {
    out.push({
      severity: "error",
      span: ref.span,
      source: SOURCE,
      code: "network-unknown-member",
      message: messages.notAMember(ref.member, ref.typeName),
    })
  }
}

/** Every ST expression the network's statements carry, EXECUTE boxes' ST included. */
function operandExprs(statements: readonly NetworkTextStatement[]): Expr[] {
  const out: Expr[] = []
  for (const s of statements) {
    out.push(...statementExprs(s))
    for (const x of executeBoxes(s)) if (x.ok) walkStatements(x.statements, (st) => out.push(...stmtExprs(st)))
  }
  return out
}

/** vg binary-operator-type-mismatch: run the shared per-node rule on every binary node in the operands. */
export function checkBinaryOps(
  statements: readonly NetworkTextStatement[],
  scope: Scope,
  project: Scope,
  messages: Messages,
  out: DiagnosticItem[],
): void {
  for (const e of operandExprs(statements)) {
    walkExpr(e, (x) => {
      if (x.kind !== "binary") return
      const d = binaryOpError(x, scope, project, messages)
      if (d !== undefined) out.push(d)
    })
  }
}

/** vg conversion-argument narrowing/sign-change: an operand `<SRC>_TO_<DST>(arg)` implicitly converts `arg` to
 *  `<SRC>` — the SAME C0195/C0197 the ST check emits, so a graphical `UINT_TO_WORD(anINT)` operand warns exactly
 *  as textual code would. (Sink narrowing is already covered by `checkPair`; this closes the operand case.) */
export function checkConversionArgs(
  statements: readonly NetworkTextStatement[],
  scope: Scope,
  project: Scope,
  messages: Messages,
  out: DiagnosticItem[],
): void {
  for (const e of operandExprs(statements)) {
    walkExpr(e, (x) => {
      const d = conversionArgError(x, scope, project, messages)
      if (d !== undefined) out.push(d)
    })
  }
}
