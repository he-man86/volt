/**
 * parse-errors (syntax/) — surfaces every syntax error the parser recorded, wherever it recorded it.
 *
 * The syntax layer parses in two passes, each of which *collects* (never throws) its errors on a Cursor:
 *   - the TOP-LEVEL parse — unit headers, VAR sections, TYPE bodies → `parseResult.errors`
 *   - each non-graphical STATEMENT body, parsed on demand → `parseStatements(body).errors`
 * Both streams are the same `ParseError` (a message + a precise span), so this check drains both into one
 * `code:"syntax-error"` diagnostic stream — a missing `THEN`, a missing `;`, a `VAR_INPUT` inside a STRUCT
 * and an unterminated section are all "the parser found bad syntax here", reported at the offending token.
 *
 * (Bodies are captured as opaque tokens at the unit level — the IDE stays authoritative for statement
 * *semantics* — but their *syntax* structure is the parser's to decide, so surfacing it is not a semantics
 * check.)
 *
 * Zero-FP contract: the corpus + conformance replay compile clean, so ANY error here on known-good code is a
 * GRAMMAR GAP to fix, never a shipped false positive — the same gate every semantic check answers to.
 * `scripts/parser-completeness.ts` is the standing proof: both streams record zero errors on the whole corpus.
 */
import { isGraphicalBody, parseStatements, unitBodies, type ParseError } from "../../../syntax/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

export function checkParseErrors(ctx: CheckContext, out: DiagnosticItem[]): void {
  // The parser has no vendor, so one shape it produces arrives as a FACT (`unexpectedToken`) rather than as
  // final text: both compilers report it, and they capitalise it differently (CODESYS "token", TwinCAT
  // "Token" — `echo_*`, measured on both recordings 2026-09-20). Worded here, where the vendor is known.
  const emit = (e: ParseError): void => {
    const message = e.unexpectedToken === undefined ? e.message : ctx.messages.unexpectedToken(e.unexpectedToken)
    out.push({ severity: "error", span: e.span, source: SOURCE, code: "syntax-error", message })
  }
  // Declaration structure — recorded on the top-level parse cursor (unit headers, VAR sections, type decls).
  for (const e of ctx.parseResult.errors) emit(e)
  // Statement bodies — re-parsed here (opaque tokens at the unit level), each on its own cursor.
  for (const unit of ctx.parseResult.units) {
    for (const body of unitBodies(unit)) {
      if (isGraphicalBody(body)) continue
      for (const e of parseStatements(body).errors) emit(e)
    }
  }
}
