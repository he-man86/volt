/**
 * set-reset-name (names/). A variable named `R` or `S` does not compile in CODESYS — they are the set/reset
 * assignment keywords — and it fails as a PARSE error on the name: `r : INT;` reports `Unexpected token 'r' found`,
 * echoing the name as written, then cascades (recorded live: conformance `cc_reserved_name_r`,
 * `cc_reserved_name_s_upper`).
 *
 * Why nothing caught it: the lexer reads a bare `r`/`s` as an identifier (it only becomes `R=`/`S=` before an `=`),
 * so the parser accepted the declaration; the reserved-name handling covers the keyword table (`LIMIT`, `MIN` …),
 * which R/S are not in; no fixture declared one; and no real project does, so the corpus could not surface it.
 *
 * CODESYS-only: TwinCAT is unmeasured, and a guess there would be a new false positive.
 */
import { stmtExprs, walkExpr, walkStatements, type Span } from "../../../syntax/index.js"
import { bodies } from "../../../symbols/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, forEachDecl, type DiagnosticItem } from "../_shared.js"

const SET_RESET = /^[rs]$/i

export function checkSetResetName(ctx: CheckContext, out: DiagnosticItem[]): void {
  if (ctx.config.vendor !== "codesys") return
  const flag = (text: string, span: Span): void => {
    out.push({ severity: "error", span, source: SOURCE, code: "set-reset-name", message: ctx.messages.unexpectedToken(text) })
  }
  for (const { decl } of forEachDecl(ctx.parseResult, ctx.project))
    for (const name of decl.names) if (SET_RESET.test(name.text)) flag(name.text, name.span)
  // A USE is an error too — `s := 'abc';` reports `Unexpected token 's' found` on the `s` (cc_reserved_name_s_string).
  // Bare identifiers only: `S=`/`R=` are operator tokens, and a member name (`fb.S`) was not measured.
  for (const { statements } of bodies(ctx.parseResult.units, ctx.project))
    walkStatements(statements, (s) => {
      for (const e of stmtExprs(s))
        walkExpr(e, (x) => {
          if (x.kind === "ident_expr" && SET_RESET.test(x.name)) flag(x.name, x.span)
        })
    })
}
