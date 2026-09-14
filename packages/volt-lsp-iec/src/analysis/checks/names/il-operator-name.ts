/**
 * il-operator-name (names/). CODESYS reserves the instruction-list operators as names: a variable called `r`, `s`, `ld`,
 * `st`, `ret`, `cal` … does not compile, and it fails as a PARSE error on the name — `ld : INT;` reports
 * `Unexpected token 'ld' found`, echoing the name as written, then cascades. Every USE is reported the same way
 * (recorded live: conformance `cc_reserved_name_r`, `cc_reserved_name_s_upper`, `cc_reserved_name_s_string`,
 * `cc_il_name_*`).
 *
 * Why nothing caught it: the lexer reads these as identifiers (`R`/`S` only become `R=`/`S=` before an `=`), so the
 * parser accepted the declaration; the reserved-name handling covers the keyword table (`LIMIT`, `MIN` …, which CODESYS
 * echoes UPPER-case — a different mechanism); no fixture declared one; and no real project does. `CAL` sat in the
 * keyword table, so `cal` was reported as 'CAL' with a false "Identifier 'cal' not defined" on its use.
 *
 * Not here: `CALC` — CODESYS parses `calc : INT;` as a conditional call and says other things ("Second parameter of
 * conditional call must be a valid call statement" …), unmodelled. The comparison and arithmetic IL operators (`LT`,
 * `ADD` …) are ST keywords already.
 *
 * CODESYS-only: TwinCAT is unmeasured, and a guess there would be a new false positive.
 */
import { stmtExprs, walkExpr, walkStatements, type Span } from "../../../syntax/index.js"
import { bodies, forEachDecl } from "../../../symbols/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

const IL_OPERATOR_NAMES: ReadonlySet<string> = new Set([
  "r", "s", "ld", "ldn", "st", "stn", "ret", "retc", "retcn", "jmpc", "jmpcn", "cal", "calcn", "andn", "orn", "xorn",
])

export function checkIlOperatorName(ctx: CheckContext, out: DiagnosticItem[]): void {
  if (ctx.config.vendor !== "codesys") return
  const flag = (text: string, span: Span): void => {
    if (!IL_OPERATOR_NAMES.has(text.toLowerCase())) return
    out.push({ severity: "error", span, source: SOURCE, code: "il-operator-name", message: ctx.messages.unexpectedToken(text) })
  }
  for (const { decl } of forEachDecl(ctx.parseResult, ctx.project)) for (const name of decl.names) flag(name.text, name.span)
  // Bare identifiers only: `S=`/`R=` are operator tokens, and a member name (`fb.S`) was not measured.
  for (const { statements } of bodies(ctx.parseResult.units, ctx.project))
    walkStatements(statements, (s) => {
      for (const e of stmtExprs(s))
        walkExpr(e, (x) => {
          if (x.kind === "ident_expr") flag(x.name, x.span)
        })
    })
}
