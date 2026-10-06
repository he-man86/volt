/**
 * initializer — what a declaration's initializer READS and which fields it NAMES, the one reading the checks of an
 * initializer share (inout-initializer, fb-init-inout, inout-access — analysis-conformance 3.4/3.6). A single-field
 * struct or FB initializer `(f := v)` parses as a parenthesized assignment, a multi-field one as an aggregate; both are
 * a field list here.
 */
import type { AggregateElement, Expr, Initializer, Span } from "../../frontend/syntax/index.js"

/** The value expressions an initializer reads: a plain expression whole, a `(field := value)`'s value, an aggregate's
 *  values (nested, repeated and by field), a repeat's count — never a field's NAME. */
export function initializerValues(init: Initializer): Expr[] {
  if (init.kind !== "aggregate_init") return isFieldInit(init) ? [init.inner.value] : [init]
  const out: Expr[] = []
  const element = (el: AggregateElement): void => {
    if (el.kind === "value") out.push(el.expr)
    else if (el.kind === "nested") out.push(...initializerValues(el.init))
    else if (el.kind === "field") element(el.value)
    else if (el.kind === "repeat") {
      out.push(el.count)
      element(el.value)
    }
  }
  for (const el of init.elements) element(el)
  return out
}

/** The fields a struct / FB initializer names — `(f := v)` or `(f := v, g := w)` — each with the value it is given where
 *  that is one expression. */
export function initializerFields(init: Initializer): { name: string; span: Span; value: Expr | undefined }[] {
  if (isFieldInit(init) && init.inner.target.kind === "ident_expr") return [{ name: init.inner.target.name, span: init.inner.target.span, value: init.inner.value }]
  if (init.kind === "aggregate_init" && init.form === "struct")
    return init.elements.flatMap((el) => (el.kind === "field" ? [{ name: el.name, span: el.span, value: el.value.kind === "value" ? el.value.expr : undefined }] : []))
  return []
}

/** Whether an initializer is a LIST — an aggregate, or the single field `(f := v)` — and not one expression. */
export function isListInitializer(init: Initializer): boolean {
  return init.kind === "aggregate_init" || isFieldInit(init)
}

function isFieldInit(init: Initializer): init is Expr & { kind: "paren"; inner: Expr & { kind: "assign_expr" } } {
  return init.kind === "paren" && init.inner.kind === "assign_expr"
}
