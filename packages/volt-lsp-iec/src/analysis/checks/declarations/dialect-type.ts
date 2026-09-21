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
import { renderTypeExpr, type TypeExpr } from "../../../syntax/index.js"
import { forEachDecl } from "../../../symbols/index.js"
import { CODESYS_ONLY_TYPES } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

export function checkDialectType(ctx: CheckContext, out: DiagnosticItem[]): void {
  if (ctx.config.vendor !== "twincat") return
  for (const { decl } of forEachDecl(ctx.parseResult, ctx.project)) {
    const name = namedType(decl.type)
    if (name === undefined || !CODESYS_ONLY_TYPES.has(name.toUpperCase())) continue
    for (const at of decl.names)
      out.push({
        severity: "error",
        span: at.span,
        source: SOURCE,
        code: "unknown-type",
        message: ctx.messages.unknownType(renderTypeExpr(decl.type)),
      })
  }
}

/** The type's own name — an ARRAY OF or POINTER TO wrapper is a different shape and is left alone. */
function namedType(t: TypeExpr | undefined): string | undefined {
  return t?.kind === "named_type" ? t.name.text : undefined
}
