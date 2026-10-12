/**
 * no-op-statement (C0139 · flow/). A WARNING for an expression statement with no side effect (`i;`) — a bare
 * reference / member / index whose value is computed and discarded.
 *
 * Zero-FP: a genuine call is a `call_stmt`, not an `expr_stmt`; an `expr_stmt` whose expression tree contains
 * a call (`foo().x;`) is skipped (the call may have effects) — except an array element indexed by one (`list[F()];`),
 * which both vendors warn (`callsInSubscriptOnly`); and the expression must RESOLVE to a known type
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
import { bodies, bodyConditionWorld, lookup, visibleNames, type Scope } from "../../../frontend/symbols/index.js"
import { inferExprType, resolveMemberChain } from "../../../frontend/types/index.js"
import type { Expr, Function, Statement } from "../../../frontend/syntax/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { SOURCE, withFixes, type DiagnosticItem, type Fix } from "../../shared/diagnostic-item.js"
import { addParensFix, fixOf, insertText, removeConstruct } from "../../shared/fixes.js"
import { compilerExprText } from "../../shared/expr-echo.js"

export function checkNoOpStatement(ctx: CheckContext, out: DiagnosticItem[]): void {
  const warn = (s: Extract<Statement, { kind: "expr_stmt" }>, fixes?: readonly (Fix | undefined)[]): void => {
    out.push(
      withFixes(
        {
          severity: "warning",
          span: s.expr.span,
          source: SOURCE,
          // Mirror the IDE: it echoes the whole statement source (incl. the `;`), not just the expression — and the
          // LINE BREAK that ends it, which is in the recorded message (conformance `cc5_no_op_statement`).
          code: "no-op-statement",
          message: ctx.messages.codeHasNoEffect(
            s.unterminated ? `${ctx.source.slice(s.span.start, s.span.end)};${lineBreakOf(ctx.source)}` : withLineEnd(ctx.source, s.span.start, s.span.end),
          ),
        },
        fixes,
      ),
    )
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
      if (s.kind !== "expr_stmt" || (containsCall(s.expr) && !callsInSubscriptOnly(s.expr))) return
      if (s.expr.kind === "binary") return invalid(s)
      const fn = s.expr.kind === "ident_expr" && s.expr.name.toLowerCase() !== ownName ? lookup(scope, s.expr.name)?.symbol : undefined
      if (s.expr.kind === "ident_expr" && fn?.kind === "function") {
        out.push(
          withFixes(
            { severity: "error", span: s.expr.span, source: SOURCE, code: "function-without-parens", message: ctx.messages.functionWithoutParens(s.expr.name) },
            [addParensFix(ctx.source, s.expr.span.end, fn.ast as Function)],
          ),
        )
        return warn(s)
      }
      if (inferExprType(s.expr, scope, ctx.project).kind === "unknown") return // unresolved → not a no-op (see header)
      warn(s, noOpFixes(ctx, s, scope))
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
 * The fixes of a no-op statement (design.md §4 F2), both choices — a stray name may be a typo for something else — so
 * neither is `preferred`:
 * - "Remove the statement" — only on a COMPLETE statement (the parse-recovery leftovers are warned by the second walk
 *   above and get no fix: the repair is the root syntax error's, §3) whose expression CALLS nothing and READS no property
 *   (`t.P;` runs the getter, so removing it changes what the program does — `flw_noop_property_read`;
 *   `list[F()];` calls — `qf_c0139_absent_call`). Recorded: `qf_c0139_remove`, `_remove_instance`.
 * - "Call '<instance>()'" — when the expression names a function block INSTANCE whose type has no VAR_IN_OUT (a call
 *   without the argument one needs is refused: `qf_c0139_before_instance_inout`). Recorded: `qf_c0139_call_instance`.
 */
function noOpFixes(ctx: CheckContext, s: Extract<Statement, { kind: "expr_stmt" }>, scope: Scope): (Fix | undefined)[] {
  if (s.resumed === true || s.unterminated === true) return []
  const quiet = !containsCall(s.expr) && !readsProperty(s.expr, scope, ctx.project)
  const remove = quiet ? fixOf("Remove the statement", [removeConstruct(ctx.source, s.span.start, s.span.end)]) : undefined
  const t = inferExprType(s.expr, scope, ctx.project)
  const instance = (s.expr.kind === "ident_expr" || s.expr.kind === "member") && t.kind === "function_block" && t.byName !== true
  const callable = instance && t.scope !== undefined && ![...visibleNames(t.scope, false)].some((sym) => sym.varSection === "VAR_IN_OUT")
  const written = ctx.source.slice(s.expr.span.start, s.expr.span.end)
  const call = callable ? fixOf(`Call '${written}()'`, [insertText(ctx.source, s.expr.span.end, "()")]) : undefined
  return [remove, call]
}

/** Does `e` read a PROPERTY anywhere — a name or a member that denotes one (its getter runs)? */
function readsProperty(e: Expr, scope: Scope, project: Scope): boolean {
  let found = false
  walkExpr(e, (x) => {
    if (x.kind !== "ident_expr" && x.kind !== "member") return
    const kind = resolveMemberChain(x, scope, project)?.kind
    if (kind === "property" || kind === "interface_property") found = true
  })
  return found
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

/**
 * An array element whose only calls are in its SUBSCRIPTS, at any depth (`list[F()];`, `m[F()][1];`, `m[1][F()];`): the
 * vendors warn it has no effect all the same (`qf_c0139_absent_call`, `qf_c0139_absent_call_nested`, both vendors
 * 2026-10-12) — the array it indexes, the innermost base, calls nothing. Every other expression holding a call stays
 * unwarned — unmeasured.
 */
function callsInSubscriptOnly(e: Expr): boolean {
  let array: Expr = e
  while (array.kind === "index") array = array.base
  return array !== e && !containsCall(array)
}

function containsCall(e: Expr): boolean {
  let found = false
  walkExpr(e, (x) => {
    if (x.kind === "call") found = true
  })
  return found
}
