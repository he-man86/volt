/**
 * unexpected-struct-init (C0076 · types/). A struct-literal initializer `(field := …)` on a variable whose
 * declared type is elementary (`st1 : INT := (p1 := 1)`). Sibling of C0074 (array literal on non-array).
 *
 * The struct-init form is one of: a `paren` wrapping an `assign_expr` (single field `(p1:=1)`); an
 * `aggregate_init` led by `STRUCT` (explicit `STRUCT(…)`); or an `aggregate_init` led by `(` that contains a
 * `:=` (multi-field `(p1:=1, p2:=2)`). Zero-FP: fires ONLY when the target resolves to a concrete ELEMENTARY
 * type — a struct/FB/union/enum target legitimately takes `(…)` initialization, and unresolved/library types
 * collapse to `unknown` → skipped.
 */
import type { Initializer } from "../../../syntax/index.js"
import { resolveTypeExpr } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkStructInit(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    if (!("varSections" in unit)) continue
    for (const section of unit.varSections) {
      for (const decl of section.decls) {
        if (decl.init === undefined || !isStructInit(decl.init)) continue
        if (resolveTypeExpr(decl.type, ctx.project).kind !== "elementary") continue
        out.push({
          severity: "error",
          span: decl.init.span,
          source: SOURCE,
          code: "unexpected-struct-init",
          message: ctx.messages.unexpectedStructInit(),
        })
      }
    }
  }
}

function isStructInit(init: Initializer): boolean {
  // A single-field `(p1 := 1)` parses as a paren-wrapped assignment expression; multi-field / `STRUCT(…)`
  // parse as an aggregate whose form is "struct".
  if (init.kind === "paren") return init.inner.kind === "assign_expr"
  return init.kind === "aggregate_init" && init.form === "struct"
}
