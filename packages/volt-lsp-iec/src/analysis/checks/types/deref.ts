/**
 * deref-non-pointer (D.2 · types/). `x^` where `x` is not a pointer → error "Dereference requires a
 * pointer" (CODESYS) / "Dereference requires Pointer" (TwinCAT). Mirrors the compilers, which reject `^`
 * on a non-pointer operand.
 *
 * Zero-FP: only the UNAMBIGUOUS non-pointer kinds are flagged — `elementary` (`iValue^`) and `array`
 * (`arr^`). Everything the type engine treats as derefable-or-undecidable is skipped: `pointer`/`reference`
 * (the legal cases), `function_block`/`struct`/`enum` (infer folds `THIS^` and reference-target derefs to
 * identity), and `unknown` (unresolved / computed base — can't decide). The corpus compiles clean, so any
 * flag on it is a false positive; skipping the fold cases is what keeps `THIS^`/ref derefs quiet.
 */
import { walkAllExprs } from "../../../syntax/index.js"
import { bodies } from "../../../symbols/index.js"
import { inferExprType } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkDeref(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkAllExprs(statements, (e) => {
      if (e.kind !== "deref") return
      const base = inferExprType(e.base, scope, ctx.project)
      if (base.kind !== "elementary" && base.kind !== "array") return // derefable or undecidable → skip
      out.push({
        severity: "error",
        span: e.span,
        source: SOURCE,
        code: "deref-non-pointer",
        message: ctx.messages.dereferenceRequiresPointer(),
      })
    })
  }
}
