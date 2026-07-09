/**
 * constant-context (declarations/) — declaration positions that require a compile-time constant, flagged via
 * `constancyOf` (so an enum member / `VAR CONSTANT` is fine; only a genuine mutable variable is flagged):
 *   C0161 array-bound-non-const — a non-constant array dimension bound (`ARRAY[1..i]`).
 *   C0227 const-init-non-const  — a `VAR CONSTANT` variable initialized with a non-constant (`k : INT := i`).
 *
 * Zero-FP: only a `variable` verdict fires; literals, constants, and unresolved/library names never do.
 */
import { scopeForUnit } from "../../../symbols/index.js"
import { constancyOf } from "../../../types/index.js"
import type { Expr, Span } from "../../../syntax/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkConstantContext(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    if (!("varSections" in unit)) continue
    const scope = scopeForUnit(ctx.project, unit) ?? ctx.project
    const bound = (e: Expr | undefined) => {
      if (e !== undefined && constancyOf(e, scope) === "variable")
        push(out, e.span, "array-bound-non-const", ctx.messages.arrayBoundNonConst(text(ctx.source, e.span)))
    }
    for (const section of unit.varSections) {
      for (const decl of section.decls) {
        if (decl.type.kind === "array_type")
          for (const dim of decl.type.dims) {
            bound(dim.lower) // C0161
            bound(dim.upper)
          }
        if (
          section.constant === true &&
          decl.init !== undefined &&
          decl.init.kind !== "aggregate_init" &&
          constancyOf(decl.init, scope) === "variable"
        )
          for (const name of decl.names)
            push(out, name.span, "const-init-non-const", ctx.messages.constInitNonConst(name.text)) // C0227
        // C0526 — a VAR_INPUT default that is a mutable variable. NOT a plain "is it a call" test: `STRUCT(…)`,
        // `SIZEOF(…)`, `ADR(…)` are compile-time constants that also parse as calls, so only a `variable`
        // constancy (a definite mutable reference) is flagged; call/unknown defaults are left alone (zero-FP).
        if (
          section.sectionKind === "VAR_INPUT" &&
          decl.init !== undefined &&
          decl.init.kind !== "aggregate_init" &&
          constancyOf(decl.init, scope) === "variable"
        )
          push(out, decl.init.span, "default-not-constant", ctx.messages.defaultNotConstant())
      }
    }
  }
}

function push(out: DiagnosticItem[], span: Span, code: string, message: string): void {
  out.push({ severity: "error", span, source: SOURCE, code, message })
}

const text = (source: string, span: Span): string => source.slice(span.start, span.end)
