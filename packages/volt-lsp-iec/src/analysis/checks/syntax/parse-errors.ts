/**
 * parse-errors (syntax/) — surfaces STATEMENT-level syntax errors as diagnostics.
 *
 * The ST statement parser already detects and precisely locates these (a missing `THEN`, a missing `;`, a
 * `FOR` with no `:=` initializer …) — it records them on its cursor via `expect*`, then historically threw
 * them away (design D3: "never surface statement-parse errors"). This surfaces them, held to the same
 * zero-FP corpus/conformance gate as every other check: an error here on clean code is a GRAMMAR GAP to fix,
 * not a shipped false positive. Measured basis: `parseStatements` parses 1938/1938 corpus ST bodies with
 * zero errors, so this emits nothing on known-good code today.
 *
 * Phase-1 conservatism: only the *recorded* `expect*` errors are surfaced (a definite "X expected here"),
 * NOT the "parser stopped with no recorded error" fallback — that ambiguous case is where an unmodeled-but-
 * valid construct would false-positive, so it stays silent until the resilient-recovery work (phase 2).
 */
import { isGraphicalBody, parseStatements, unitBodies } from "../../../syntax/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkParseErrors(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    for (const body of unitBodies(unit)) {
      if (isGraphicalBody(body)) continue
      for (const e of parseStatements(body).errors) {
        out.push({
          severity: "error",
          span: e.span,
          source: SOURCE,
          code: "syntax-error",
          message: e.message,
        })
      }
    }
  }
}
