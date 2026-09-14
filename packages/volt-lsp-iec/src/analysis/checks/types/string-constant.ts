/**
 * string-constant-too-long (C0198 · types/). A string-literal initializer longer than its declared `STRING(n)`
 * destination (`str : STRING(4) := '12345'`).
 *
 * Zero-FP: the length compared is the DECODED character count — IEC `$` escapes (`$T` tab, `$$`, `$0D` hex, …)
 * are one character each, so `STRING(1) := '$T'` is fine. Only a narrow `STRING(n)` with a const-foldable length
 * and a string-literal init fires, on a strict over-length; a sizeless `STRING` and any `WSTRING` are skipped.
 */
import { decodeStringLiteral } from "../../../syntax/index.js"
import { constEval, renderTypeExpr } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { forEachDecl } from "../../../symbols/index.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkStringConstant(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { decl, scope } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (decl.type.kind !== "string_type" || decl.type.wide || decl.type.length === undefined) continue
    const init = decl.init
    if (init === undefined || init.kind !== "literal" || typeof init.value !== "string") continue
    const size = constEval(decl.type.length, scope)
    // the shared decoder's length — an escape it does not know has no measured length, so nothing is reported
    const decoded = decodeStringLiteral(init.value)
    if (typeof size !== "bigint" || decoded === undefined || BigInt(decoded.length) <= size) continue
    out.push({
      // a WARNING, recorded twice (`cc_string_plain_init_too_long`, `cc_string_escape_init_too_long`) — the documentation
      // catalog this check was written from said error
      severity: "warning",
      span: init.span,
      source: SOURCE,
      code: "string-constant-too-long",
      // the literal as written (quotes and escapes included) — the compiler prints a prefix of that text, not the value
      message: ctx.messages.stringConstantTooLong(init.text, Number(size), renderTypeExpr(decl.type)),
    })
  }
}
