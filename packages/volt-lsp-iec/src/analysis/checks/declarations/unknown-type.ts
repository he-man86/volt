/**
 * unknown-type (declarations/, C0077). A declared type that names nothing: "Unknown type: '<name>'".
 *
 * Two cases, one message, one verdict (`unknownTypeName` in `analysis/resolution.ts`):
 *   - a bare type name nothing declares — no project object, no referenced library, no compiler built-in. Measured on
 *     both vendors (2026-09-30, conformance `objects/written-as-sent.ts`): an FB or a DUT whose object's text declares
 *     nothing — a never-closed `(*`, an empty or prose text, prose above its TYPE — which the push now writes as sent;
 *   - a CODESYS-only ELEMENTARY type on TwinCAT (`LDATE`, `LTOD`/`LTIME_OF_DAY`, `LDT`/`LDATE_AND_TIME`) — 39 messages
 *     across 13 fixtures in its recording, none in CODESYS's (2026-09-20). The conversions that carry them fall out of
 *     `nameResolves`.
 *
 * This file was `dialect-type`, whose header said a general unknown-type check should not exist because "a name the
 * LSP cannot resolve is usually a library type it cannot see". That was true before libraries were materialized; since
 * then `unresolved-identifier` makes exactly this bet for identifiers, and the corpus gate (every error ⊆ the project's
 * own recorded build) holds this one to it for types.
 */
import { forEachDecl } from "../../../symbols/index.js"
import { unknownTypeName } from "../../resolution.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

export function checkUnknownType(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { decl } of forEachDecl(ctx.parseResult, ctx.project)) {
    const name = unknownTypeName(ctx.project, decl.type)
    if (name === undefined) continue
    for (const at of decl.names)
      out.push({ severity: "error", span: at.span, source: SOURCE, code: "unknown-type", message: ctx.messages.unknownType(name) })
  }
}
