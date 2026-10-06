/**
 * reserved-keyword (C0543 · names/). A declared identifier named after an IEC 61131-3 keyword CODESYS currently
 * soft-allows — CHAR / WCHAR / USING. CODESYS warns: "The name 'CHAR' is a reserved keyword in the IEC61131-3
 * standard. An error will be reported in future versions." A configurable dialog warning (default warning).
 *
 * The trigger set was harvested live against CODESYS 3.5.21: CHAR / WCHAR / USING warn there. USING was omitted while
 * the lexer read it as a keyword; it is an identifier now (`lex_reserved_unused_keyword_as_name_using` records this
 * warning and nothing else, 2026-09-30). Missing a word only misses a detection — it can never false-positive, since
 * we flag ONLY these exact reserved names. Zero corpus surface (a clean project wouldn't
 * name a var after a reserved word). Scoped to VAR-section names (the verified case).
 */
import type { CheckContext } from "../../pipeline/context.js"
import { forEachDecl } from "../../../frontend/symbols/index.js"
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"

const RESERVED = new Set(["char", "wchar", "using"])

export function checkReservedKeyword(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { decl } of forEachDecl(ctx.parseResult, ctx.project)) {
    for (const name of decl.names) {
      if (!RESERVED.has(name.text.toLowerCase())) continue
      out.push({
        severity: "warning",
        span: name.span,
        source: SOURCE,
        code: "reserved-keyword",
        message: ctx.messages.reservedKeyword(name.text),
      })
    }
  }
}
