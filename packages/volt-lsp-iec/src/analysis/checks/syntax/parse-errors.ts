/**
 * parse-errors (syntax/) — surfaces every syntax error the parser recorded, wherever it recorded it.
 *
 * The syntax layer parses in two passes, each of which *collects* (never throws) its errors on a Cursor:
 *   - the TOP-LEVEL parse — unit headers, VAR sections, TYPE bodies → `parseResult.errors`
 *   - each ST STATEMENT body (`isStBody`), parsed on demand → `parseStatements(body).errors`
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
import { isStBody, parseStatements, unitBodies, type ParseError } from "../../../frontend/syntax/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"
import type { Vendor } from "../../config.js"

/**
 * Whether `vendor`'s compiler reports this parse error at all. The parser has no vendor, so a shape the two compilers
 * answer differently arrives as a FACT: a global missing its `;` (`globalMissingSemicolon`) is reported by TwinCAT and
 * passed over in silence by CODESYS (`pwh_gvl_missing_semicolon`, 2026-09-30). Every path that hands a parse error to a
 * client asks this — the semantic pass here and the server's own parse-error stream.
 */
export function vendorReportsParseError(e: ParseError, vendor: Vendor): boolean {
  return !(e.globalMissingSemicolon === true && vendor === "codesys")
}

/**
 * A parse error's text as `messages`' vendor words it. The parser has no vendor, so the shapes the two compilers
 * capitalise differently arrive as FACTS rather than as final text — "Unexpected token" (CODESYS) / "Unexpected Token"
 * (TwinCAT, `echo_*`, measured on both recordings 2026-09-20), and an operator's operand count ("operands" / "Operands").
 * Every path that shows a parse error words it here.
 */
export function parseErrorMessage(e: ParseError, messages: CheckContext["messages"]): string {
  if (e.unexpectedToken !== undefined) return messages.unexpectedToken(e.unexpectedToken)
  if (e.directAddressExpected !== undefined) return messages.directAddressExpectedAt(e.directAddressExpected)
  if (e.operandCount !== undefined) {
    const { operator, count, atLeast } = e.operandCount
    return atLeast ? messages.operatorNeedsAtLeast(operator, count) : messages.operatorNeedsExactly(operator, count)
  }
  return e.message
}

export function checkParseErrors(ctx: CheckContext, out: DiagnosticItem[]): void {
  const emit = (e: ParseError): void => {
    if (!vendorReportsParseError(e, ctx.config.vendor)) return
    out.push({ severity: "error", span: e.span, source: SOURCE, code: "syntax-error", message: parseErrorMessage(e, ctx.messages) })
  }
  // Declaration structure — recorded on the top-level parse cursor (unit headers, VAR sections, type decls).
  for (const e of ctx.parseResult.errors) emit(e)
  // Statement bodies — re-parsed here (opaque tokens at the unit level), each on its own cursor.
  for (const unit of ctx.parseResult.units) {
    for (const body of unitBodies(unit)) {
      if (!isStBody(body)) continue
      for (const e of parseStatements(body).errors) emit(e)
    }
  }
}
