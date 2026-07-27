/**
 * string-constant-too-long (C0198 · types/). A string-literal initializer longer than its declared `STRING(n)`
 * destination (`str : STRING(4) := '12345'`).
 *
 * Zero-FP: the length compared is the DECODED character count — IEC `$` escapes (`$T` tab, `$$`, `$0D` hex, …)
 * are one character each, so `STRING(1) := '$T'` is fine. Only a narrow `STRING(n)` with a const-foldable length
 * and a string-literal init fires, on a strict over-length; a sizeless `STRING` and any `WSTRING` are skipped.
 */
import { constEval, renderTypeExpr } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, forEachDecl, type DiagnosticItem } from "../_shared.js"

export function checkStringConstant(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { decl, scope } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (decl.type.kind !== "string_type" || decl.type.wide || decl.type.length === undefined) continue
    const init = decl.init
    if (init === undefined || init.kind !== "literal" || typeof init.value !== "string") continue
    const size = constEval(decl.type.length, scope)
    if (typeof size !== "bigint" || BigInt(decodedLength(init.value)) <= size) continue
    out.push({
      severity: "error",
      span: init.span,
      source: SOURCE,
      code: "string-constant-too-long",
      message: ctx.messages.stringConstantTooLong(init.value, renderTypeExpr(decl.type)),
    })
  }
}

/** Character count of an IEC string literal body, treating `$` escapes as one char (`$T`, `$$`, `$0D` hex). */
function decodedLength(s: string): number {
  let n = 0
  const hex = (c: string | undefined) => c !== undefined && /[0-9A-Fa-f]/.test(c)
  for (let i = 0; i < s.length; i++, n++) {
    if (s[i] === "$" && i + 1 < s.length) i += hex(s[i + 1]) && hex(s[i + 2]) ? 2 : 1 // $XX hex vs $<named>
  }
  return n
}
