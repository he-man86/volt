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
import { isTrivia, lex, stmtExprs, walkExpr, walkStatements, type Span } from "../../../syntax/index.js"
import { bodies, forEachDecl } from "../../../symbols/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"
import { elementaryType } from "../../../types/index.js"

const IL_OPERATOR_NAMES: ReadonlySet<string> = new Set([
  "r", "s", "ld", "ldn", "st", "stn", "ret", "retc", "retcn", "jmpc", "jmpcn", "cal", "calcn", "andn", "orn", "xorn",
])

export function checkIlOperatorName(ctx: CheckContext, out: DiagnosticItem[]): void {
  // An elementary TYPE name is reserved exactly as an IL operator name is, and fails the same way: `bit : BOOL;` is
  // `Unexpected token 'bit' found`, echoing the name as written, and so is `byte : INT;` (conformance
  // `cc4_type_name_bit_as_variable`, `cc4_type_name_byte_as_variable`). The lexer reads a type name the parser does
  // not treat as a keyword — BIT and BYTE among them — as an ordinary identifier, so the declaration was accepted.
  const report = (text: string, span: Span): void => {
    out.push({ severity: "error", span, source: SOURCE, code: "il-operator-name", message: ctx.messages.unexpectedToken(text) })
    cascadeAfter(ctx, out, "il-operator-name", span.end)
  }
  // An IL operator name is reported at its declaration AND at every use; an elementary TYPE name only at a
  // DECLARATION, because a type name is a legitimate ARGUMENT — `XSIZEOF(DINT)` is not a reserved-name error.
  const flag = (text: string, span: Span): void => {
    if (IL_OPERATOR_NAMES.has(text.toLowerCase())) report(text, span)
  }
  for (const { decl } of forEachDecl(ctx.parseResult, ctx.project))
    for (const name of decl.names) {
      if (IL_OPERATOR_NAMES.has(name.text.toLowerCase()) || elementaryType(name.text) !== undefined) report(name.text, name.span)
    }
  // Bare identifiers only: `S=`/`R=` are operator tokens, and a member name (`fb.S`) was not measured.
  for (const { statements } of bodies(ctx.parseResult.units, ctx.project))
    walkStatements(statements, (s) => {
      for (const e of stmtExprs(s))
        walkExpr(e, (x) => {
          if (x.kind === "ident_expr") flag(x.name, x.span)
        })
    })
}

/**
 * The IDE's parse-error CASCADE after a bad identifier. CODESYS reports the name, then resyncs by demanding a `;`:
 * for every token up to the next one it emits `';' expected instead of 'T'` and `Unexpected token 'T' found`, in that
 * order (conformance `cc_reserved_name_r`, `cc4_type_name_bit_as_variable` — `bit : BOOL;` is five errors, not one).
 * Only the first was emitted here, so 22 fixtures whose every IDE error is part of such a cascade could never agree.
 */
function cascadeAfter(ctx: CheckContext, out: DiagnosticItem[], code: string, from: number): void {
  for (const token of lex(ctx.source.slice(from))) {
    if (isTrivia(token.kind)) continue
    if (token.text === ";") return
    const span = { ...token.span, start: token.span.start + from, end: token.span.end + from }
    for (const message of [ctx.messages.semicolonExpectedInsteadOf(token.text), ctx.messages.unexpectedToken(token.text)])
      out.push({ severity: "error", span, source: SOURCE, code, message })
  }
}
