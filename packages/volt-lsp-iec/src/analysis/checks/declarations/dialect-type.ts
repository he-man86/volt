/**
 * dialect-type (declarations/). A declared type the PROJECT'S DIALECT does not have.
 *
 * There is no general "unknown type" check and there should not be: a name the LSP cannot resolve is usually a
 * library type it cannot see, which is the library floor every other check respects. This one is narrow enough to
 * be safe — it fires only for the handful of names measured as CODESYS-only (`types/elementary.ts`), which no
 * library can supply because they are ELEMENTARY types: `LDATE`, `LTOD`/`LTIME_OF_DAY`, `LDT`/`LDATE_AND_TIME`.
 *
 * TwinCAT answers "Unknown type: 'LDATE'" for the declaration and "Identifier 'DATE_TO_LDATE' not defined" for
 * the conversions that carry them — 39 messages across 13 fixtures in its recording, none in CODESYS's
 * (2026-09-20). The second half falls out of `nameResolves`; this is the first.
 */
import { forEachDecl } from "../../../symbols/index.js"
import { dialectMissingType } from "../../resolution.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

export function checkDialectType(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { decl } of forEachDecl(ctx.parseResult, ctx.project)) {
    const name = dialectMissingType(ctx.project, decl.type)
    if (name === undefined) continue
    for (const at of decl.names)
      out.push({ severity: "error", span: at.span, source: SOURCE, code: "unknown-type", message: ctx.messages.unknownType(name) })
  }
}
