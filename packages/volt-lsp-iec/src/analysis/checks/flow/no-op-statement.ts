/**
 * no-op-statement (C0139 · flow/). A WARNING for an expression statement with no side effect (`i;`) — a bare
 * reference / member / index whose value is computed and discarded.
 *
 * Zero-FP: a genuine call is a `call_stmt`, not an `expr_stmt`; an `expr_stmt` whose expression tree contains
 * ANY call (`foo().x;`) is skipped (the call may have effects); and the expression must RESOLVE to a known type
 * — an unresolved bare name (gibberish, or code inside a stripped `{IF defined(…)}` branch the IDE never
 * compiles) is not a "no effect" case (CODESYS reports it as undefined, or strips it), so it must not fire here.
 *
 * …and no-valid-statement (C0020): a BINARY OPERATION as a statement is no no-op but an ERROR, echoed as the compiler
 * echoes an expression (`expr-echo`) with the `;` and the line break — "'(a + 1);\r\n' is no valid statement",
 * "'(out = a);\r\n' …" (`stmt_bare_binary`, `stmt_bare_comparison`, `stmt_case_nonconst_label`, `stmt_ref_eq_spaced`,
 * both vendors 2026-10-02: the `=` for `:=` typo is this, not a no-op). Unlike a no-op it needs nothing resolved.
 *
 * …and function-without-parens: a FUNCTION's name alone as a statement is "FUNCTION 'F' referenced without parentheses
 * '()'", an error, beside the no-op warning (`stmt_bare_function_name`, both vendors 2026-10-02) — but not inside
 * that FUNCTION, where the name is its return variable (`stmt_function_own_name_bare`). Only the statement is measured.
 */
import { isStBody, KEYWORDS, bodyStatements, unitBodies, walkStatements, walkExpr } from "../../../frontend/syntax/index.js"
import { bodies, bodyConditionWorld, lookup } from "../../../frontend/symbols/index.js"
import { inferExprType } from "../../../frontend/types/index.js"
import type { Expr, Statement } from "../../../frontend/syntax/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"
import { compilerExprText } from "../../expr-echo.js"

export function checkNoOpStatement(ctx: CheckContext, out: DiagnosticItem[]): void {
  const warn = (s: Extract<Statement, { kind: "expr_stmt" }>): void => {
    out.push({
      severity: "warning",
      span: s.expr.span,
      source: SOURCE,
      // Mirror the IDE: it echoes the whole statement source (incl. the `;`), not just the expression — and the
      // LINE BREAK that ends it, which is in the recorded message (conformance `cc5_no_op_statement`).
      code: "no-op-statement",
      message: ctx.messages.codeHasNoEffect(
        s.unterminated ? `${ctx.source.slice(s.span.start, s.span.end)};${lineBreakOf(ctx.source)}` : withLineEnd(ctx.source, s.span.start, s.span.end),
      ),
    })
  }
  const invalid = (s: Extract<Statement, { kind: "expr_stmt" }>): void => {
    const br = s.unterminated ? lineBreakOf(ctx.source) : withLineEnd(ctx.source, s.span.end, s.span.end)
    out.push({
      severity: "error",
      span: s.expr.span,
      source: SOURCE,
      code: "no-valid-statement",
      message: ctx.messages.noValidStatement(`${compilerExprText(s.expr)};${br}`),
    })
  }
  for (const { unit, scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    // inside a FUNCTION its own name is its return variable, a name like any other: the no-op alone
    // (`stmt_function_own_name_bare`, CODESYS 2026-10-02)
    const ownName = unit.kind === "function" ? unit.name.text.toLowerCase() : undefined
    walkStatements(statements, (s) => {
      if (s.kind !== "expr_stmt" || containsCall(s.expr)) return
      if (s.expr.kind === "binary") return invalid(s)
      if (
        s.expr.kind === "ident_expr" &&
        s.expr.name.toLowerCase() !== ownName &&
        lookup(scope, s.expr.name)?.symbol.kind === "function"
      ) {
        out.push({
          severity: "error",
          span: s.expr.span,
          source: SOURCE,
          code: "function-without-parens",
          message: ctx.messages.functionWithoutParens(s.expr.name),
        })
        return warn(s)
      }
      if (inferExprType(s.expr, scope, ctx.project).kind === "unknown") return // unresolved → not a no-op (see header)
      warn(s)
    })
  }
  // A statement the parser RESUMED at after a refused token (`ExprStatement.resumed`: `NS;` in `t := T#5NS;`) is warned
  // although nothing resolves it — the body did not parse, so the vendor resolves nothing in it and warns all the same
  // (`cc_time_nanosecond_literal`, `lit_bool_typed_true`). Only such a body holds one, and `bodies()` skips it. So is
  // one that STANDS without its `;` (`ExprStatement.unterminated`: `rn` in `rn REF = m;`, `stmt_ref_eq_spaced`, both
  // vendors 2026-10-02).
  for (const unit of ctx.parseResult.units)
    for (const body of unitBodies(unit)) {
      if (!isStBody(body)) continue
      const parsed = bodyStatements(body, bodyConditionWorld(ctx.project, unit, body))
      if (parsed.ok) continue
      walkStatements(parsed.statements, (s) => {
        if (s.kind !== "expr_stmt" || !(s.resumed === true || s.unterminated === true) || containsCall(s.expr)) return
        // …but a call operator that took the next token for its `(` (`__delete := 1;`) is a refused call, no name standing
        // (`lex_keyword_assigned_sys_delete`: no "no effect" on either vendor)
        if (s.resumed !== true && s.expr.kind === "ident_expr" && KEYWORD_NAMES.has(s.expr.name.toUpperCase())) return
        if (s.expr.kind === "binary") invalid(s)
        else warn(s)
      })
    }
}

/**
 * The statement's source, plus the line break that ends its line — what the IDE quotes, in the document's OWN
 * spelling: a CRLF file (which is what CODESYS stores, so what the recording shows) quotes `\r\n`.
 */
function withLineEnd(source: string, start: number, end: number): string {
  const tail = source.slice(end)
  const upTo = tail.search(/\S/)
  const gap = upTo < 0 ? tail : tail.slice(0, upTo)
  const br = /\r?\n/.exec(gap)
  return source.slice(start, end) + (br?.[0] ?? "")
}

/**
 * The line break the vendor ends a quote of a statement WITHOUT its `;` with — the `;` it supplied and the FILE's own
 * break (`ExprStatement.unterminated`: "The code 'b;\r\n' has no effect", `expr_power_right_assoc`, both vendors).
 */
const lineBreakOf = (source: string): string => (source.includes("\r\n") ? "\r\n" : "\n")

const KEYWORD_NAMES: ReadonlySet<string> = new Set(KEYWORDS)

function containsCall(e: Expr): boolean {
  let found = false
  walkExpr(e, (x) => {
    if (x.kind === "call") found = true
  })
  return found
}
