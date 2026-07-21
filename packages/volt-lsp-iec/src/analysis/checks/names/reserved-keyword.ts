/**
 * reserved-keyword (C0543 · names/). A declared identifier named after an IEC 61131-3 keyword CODESYS currently
 * soft-allows — CHAR / WCHAR / USING. CODESYS warns: "The name 'CHAR' is a reserved keyword in the IEC61131-3
 * standard. An error will be reported in future versions." A configurable dialog warning (default warning).
 *
 * The trigger set was harvested live against CODESYS 3.5.21: CHAR / WCHAR / USING warn there. USING is omitted
 * here because our parser already treats it as a hard keyword (a var named `USING` is a parse error, not an
 * identifier), so the var-decl path can't reach it. Missing a word only misses a detection — it can never
 * false-positive, since we flag ONLY these exact reserved names. Zero corpus surface (a clean project wouldn't
 * name a var after a reserved word). Scoped to VAR-section names (the verified case).
 */
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

const RESERVED = new Set(["char", "wchar"])

export function checkReservedKeyword(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    if (!("varSections" in unit)) continue
    for (const section of unit.varSections) {
      for (const decl of section.decls) {
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
  }
}
