/**
 * unexpected-struct-init (C0076 · types/). A struct-literal initializer `(field := …)` on a variable whose
 * declared type is elementary (`st1 : INT := (p1 := 1)`). Sibling of C0074 (array literal on non-array).
 *
 * The struct-init form is one of: a `paren` wrapping an `assign_expr` (single field `(p1:=1)`); an
 * `aggregate_init` led by `STRUCT` (explicit `STRUCT(…)`); or an `aggregate_init` led by `(` that contains a
 * `:=` (multi-field `(p1:=1, p2:=2)`). Zero-FP: fires ONLY when the target resolves to a concrete ELEMENTARY
 * type — a struct/FB/union/enum target legitimately takes `(…)` initialization, and unresolved/library types
 * collapse to `unknown` → skipped.
 *
 * The compiler does not stop there. It resolves each FIELD NAME against the POU's own scope, where a struct's field
 * names are not, so each one is undefined and each one is an assignment it cannot make; and the initializer itself
 * then has no type, which the declaration's destination cannot take (conformance `cc3_unexpected_struct_init`:
 * `otherWay : INT := (x := 1, y := 2)` is six errors, of which the LSP had one).
 */
import { exprText, renderTypeExpr, type AggregateElement, type Initializer } from "../../../syntax/index.js"
import { resolveTypeExpr } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { forEachDecl, lookup, type Scope } from "../../../symbols/index.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

export function checkStructInit(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { decl, scope } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (decl.init === undefined || !isStructInit(decl.init)) continue
    if (resolveTypeExpr(decl.type, ctx.project, 0, ctx.project, ctx.uri).kind !== "elementary") continue
    const init = decl.init
    out.push({
      severity: "error",
      span: init.span,
      source: SOURCE,
      code: "unexpected-struct-init",
      message: ctx.messages.unexpectedStructInit(),
    })
    for (const name of unresolvedFieldNames(init, scope)) {
      for (const message of [ctx.messages.undefinedIdentifier(name), ctx.messages.notAssignmentTarget(name)])
        out.push({ severity: "error", span: init.span, source: SOURCE, code: "unexpected-struct-init", message })
    }
    out.push({
      severity: "error",
      span: init.span,
      source: SOURCE,
      code: "unexpected-struct-init",
      message: ctx.messages.cannotConvert(ctx.messages.unknownType(structEcho(init)), renderTypeExpr(decl.type)),
    })
  }
}

/** The field names the POU's own scope does not have — which is all of them, for a struct's fields. */
function unresolvedFieldNames(init: Initializer, scope: Scope): string[] {
  const names: string[] = []
  const visit = (el: AggregateElement): void => {
    if (el.kind !== "field") return
    if (lookup(scope, el.name) === undefined) names.push(el.name)
  }
  if (init.kind === "aggregate_init") init.elements.forEach(visit)
  else if (init.kind === "paren" && init.inner.kind === "assign_expr" && init.inner.target.kind === "ident_expr") {
    const name = init.inner.target.name
    if (lookup(scope, name) === undefined) names.push(name)
  }
  return names
}

/** `STRUCT(x := 1, y := 2)` — the compiler's name for an initializer it could not attach to a type. */
function structEcho(init: Initializer): string {
  const element = (el: AggregateElement): string => {
    if (el.kind === "field") return `${el.name} := ${element(el.value)}`
    if (el.kind === "value") return el.expr.kind === "literal" ? el.expr.text : "?"
    return "?"
  }
  if (init.kind === "aggregate_init") return `STRUCT(${init.elements.map(element).join(", ")})`
  // the single-field form parses as a paren-wrapped assignment; the compiler names it the same way
  if (init.kind === "paren" && init.inner.kind === "assign_expr") return `STRUCT(${exprText(init.inner)})`
  return "STRUCT(?)"
}

function isStructInit(init: Initializer): boolean {
  // A single-field `(p1 := 1)` parses as a paren-wrapped assignment expression; multi-field / `STRUCT(…)`
  // parse as an aggregate whose form is "struct".
  if (init.kind === "paren") return init.inner.kind === "assign_expr"
  return init.kind === "aggregate_init" && init.form === "struct"
}
