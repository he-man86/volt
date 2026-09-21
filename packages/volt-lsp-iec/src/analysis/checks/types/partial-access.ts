/**
 * partial-access (types/). `dwSource.%W1` — a byte, word or double-word slice of an unsigned integer — is a
 * CODESYS EXTENSION, and TwinCAT has no such operand form. It reads the `.` as an ordinary member access, finds
 * `%` where a component name belongs, and leaves the width+index standing as a statement of its own:
 *
 *   'dwSource.%W1' →  '%' is no component of 'dwSource'   ·   ';' expected instead of 'W1'   ·   W1; has no effect
 *
 * Measured on both live IDEs 2026-09-21, at ALL FOUR widths. `.%W` and `.%B` had been recorded since 2026-05-29
 * and `.%X`/`.%D` were only ever asserted in a note beside them, which is the shape of a claim that turns out to
 * have an exception. It does not: `.%X3` out of a DWORD and `.%D1` out of an LWORD answer exactly the same three
 * messages, and CODESYS compiles all four clean.
 *
 * <p>The LSP's grammar keeps the form for both vendors on purpose — a TwinCAT engineer opening CODESYS code
 * should see the slice highlighted and navigable, with the vendor's error on it, not a parse cascade.</p>
 */
import { stmtExprs, walkExpr, walkStatements } from "../../../syntax/index.js"
import { bodies } from "../../../symbols/index.js"
import { compilerExprText } from "../../expr-echo.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"
import { leftoverStatement } from "../../resync.js"

/** `%X3` / `%B0` / `%W1` / `%D1` — the member name the parser builds for a partial access. */
const PARTIAL = /^%([XBWD])(\d+)$/i

// TwinCAT-only, and the REGISTRY says so (`TWINCAT_ONLY` in `analysis/diagnostics`) rather than an early
// return here — which is the shape C6 replaced and which this check had grown back.
export function checkPartialAccess(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { statements } of bodies(ctx.parseResult.units, ctx.project))
    walkStatements(statements, (s) => {
      for (const e of stmtExprs(s))
        walkExpr(e, (x) => {
          if (x.kind !== "member" || !PARTIAL.test(x.member.name)) return
          // the SPECIFIER without its `%` — the compiler has already spent the `%` on the member name
          const spec = x.member.name.slice(1)
          const specStart = x.member.span.end - spec.length
          const error = (message: string): void => {
            out.push({ severity: "error", span: x.span, source: SOURCE, code: "partial-access", message })
          }
          error(ctx.messages.percentNotAMember(compilerExprText(x.base)))
          error(ctx.messages.semicolonExpectedInsteadOf(spec))
          // …and the specifier is then an ordinary identifier standing alone, which reads a variable and does
          // nothing with it. `resync` quotes it exactly as the compiler does, line break included.
          const statement = leftoverStatement(ctx.source, specStart)
          if (statement !== undefined)
            out.push({ severity: "warning", span: x.member.span, source: SOURCE, code: "partial-access", message: ctx.messages.codeHasNoEffect(statement) })
        })
    })
}
