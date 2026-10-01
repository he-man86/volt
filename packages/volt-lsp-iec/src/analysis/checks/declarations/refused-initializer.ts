/**
 * refused-initializer (declarations/). A declaration whose initializer the PARSER refused — a malformed literal in it
 * (`VarDecl.refusedInit`, `Token.malformed`: `"$41"`, `T#1500` before `US`) — has the compiler's placeholder where the
 * literal stood, and its type check fails on the value the compiler kept:
 *
 *   t : TIME := T#1500US;
 *     ';' expected instead of 'T#1500'                                       the parser
 *     Expression expected instead of 'T#1500'                                the parser
 *     Cannot convert type 'Unknown type: '!!!'ERROR'!!!'' to type 'TIME'      this check
 *
 *   v : INT := 1 + 3#12;
 *     … the parser's pair on '3#', then
 *     Cannot convert type 'Unknown type: '(1 + !!!'ERROR'!!!)'' to type 'INT' this check
 *     Unknown type: '!!!'ERROR'!!!'                                          this check — the operand, as `unknown-source`
 *
 * Both vendors, every recorded cell (`cc_time_microsecond_literal`, `esc_wstring_hex_41`, `_ff`, `_pair`, `hex3`,
 * `lit_init_bool_typed_true`, `lit_init_malformed_not_leading`). Inside an aggregate the compiler keeps no value and says
 * nothing here (`lit_init_malformed_in_aggregate`: `RefusedInit.value` absent). The first two messages were
 * `time-literal-unit` and `wstring-escape`, analysis checks that re-lexed the tokens to find the literal the lexer now
 * refuses itself (frontend-conformance 2.2.3, 2.2.5; design.md P7).
 */
import { compilerExprText } from "../../expr-echo.js"
import { REFUSED_PLACEHOLDER, renderTypeExpr, walkExpr, type Expr } from "../../../frontend/syntax/index.js"
import { forEachDecl } from "../../../frontend/symbols/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

const isPlaceholder = (e: Expr): boolean => e.kind === "ident_expr" && e.name === REFUSED_PLACEHOLDER

export function checkRefusedInitializer(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { decl } of forEachDecl(ctx.parseResult, ctx.project)) {
    const value = decl.refusedInit?.value
    if (value === undefined) continue
    const error = (message: string, e: Expr): void => {
      out.push({ severity: "error", span: e.span, source: SOURCE, code: "refused-initializer", message })
    }
    error(ctx.messages.cannotConvert(ctx.messages.unknownType(compilerExprText(value)), renderTypeExpr(decl.type)), value)
    walkExpr(value, (x) => {
      if (x.kind !== "binary") return
      for (const operand of [x.left, x.right]) if (isPlaceholder(operand)) error(ctx.messages.unknownType(REFUSED_PLACEHOLDER), operand)
    })
  }
}
