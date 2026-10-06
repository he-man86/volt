/**
 * constant-too-large (C0001 · types/). A literal constant whose value CANNOT be represented by its own
 * type — the zero-FP subset that needs no type inference of the assignment target:
 *   (a) a typed literal past its own prefix type       — `INT#123456`  → type `INT`
 *   (b) an untyped integer past the widest IEC integer — `999…911`     → type `ANY_INT`
 *   (c) a real literal past LREAL magnitude            — `10E500`      → type `ANY_REAL`
 *
 * We deliberately do NOT flag "fits some type but not the assignment target" (that is C0032, ambiguous and
 * target-dependent). Only provable overflows are reported, so it stays quiet on the corpus. Message is the
 * literal's own text (`INT#123456`, `10E500`), matching the compiler.
 */
import { literalCapacityType } from "../../../frontend/types/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { forEachExpr } from "../../../frontend/symbols/index.js"
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"


export function checkConstantOverflow(ctx: CheckContext, out: DiagnosticItem[]): void {
  forEachExpr(ctx.parseResult, ctx.project, (e) => {
    if (e.kind !== "literal") return
    const type = literalCapacityType(e)
    if (type === undefined) return
    out.push({
      severity: "error",
      span: e.span,
      source: SOURCE,
      code: "constant-too-large",
      message: ctx.messages.constantTooLarge(e.text, type),
    })
  })
}

