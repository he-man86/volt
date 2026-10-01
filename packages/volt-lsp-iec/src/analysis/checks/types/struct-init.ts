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
import { exprText, renderTypeExpr, type AggregateElement, type Initializer, type Span } from "../../../frontend/syntax/index.js"
import { resolveTypeExpr, type Type } from "../../../frontend/types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { forEachDecl, hasUnresolvedBase, lookup, lookupMember, type Scope } from "../../../frontend/symbols/index.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

export function checkStructInit(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { decl, scope } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (decl.init === undefined) continue
    const init = decl.init
    if (!isStructInit(init) && !isArrayInit(init)) continue
    const target = resolveTypeExpr(decl.type, ctx.project, 0, ctx.project, ctx.uri)
    if (target.kind === "struct" || target.kind === "array") {
      structValues(ctx, target, init, out)
      continue
    }
    if (!isStructInit(init)) continue
    if (target.kind !== "elementary") continue
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

/**
 * Every struct value `init` gives a `type`, held to its struct by `unknownFields`: the value itself when `type` is a
 * struct, and each element of an array initializer when it is an ARRAY (`decl_struct_init_unknown_field_in_array`,
 * `_in_field_array`, both vendors 2026-10-01: `[(c := 1)]` over an ARRAY OF a struct is the same two errors). An
 * initializer of another shape is another check's.
 */
function structValues(ctx: CheckContext, type: Type, init: Initializer, out: DiagnosticItem[]): void {
  if (type.kind === "struct" && isStructInit(init)) unknownFields(ctx, type.scope, init, out)
  else if (type.kind === "array" && isArrayInit(init)) {
    let element = type.element
    while (element.kind === "array") element = element.element
    for (const value of arrayElementValues(init)) structValues(ctx, element, value, out)
  }
}

/** The values an array initializer's elements hold — a repeat's once — that are themselves initializers. */
function arrayElementValues(init: Initializer): Initializer[] {
  if (init.kind !== "aggregate_init") return []
  const value = (el: AggregateElement): Initializer[] =>
    el.kind === "nested" ? [el.init] : el.kind === "value" ? [el.expr] : el.kind === "repeat" ? value(el.value) : []
  return init.elements.flatMap(value)
}

/**
 * A STRUCT's (or a UNION's) initializer naming a field the type lacks: the name is undefined and no assignment target,
 * on both vendors, and nothing else (`decl_struct_init_unknown_field`, `decl_union_init_unknown_field`, 2026-10-01). A
 * field's own initializer is held to the FIELD's type the same way (`decl_struct_init_nested_unknown_field`), its
 * array value's elements too (`structValues`).
 * Not when the type EXTENDS a base the LSP cannot resolve (a library's): the base could declare the field
 * (`hasUnresolvedBase`).
 */
function unknownFields(ctx: CheckContext, fields: Scope | undefined, init: Initializer, out: DiagnosticItem[]): void {
  if (fields === undefined || hasUnresolvedBase(fields)) return
  for (const { name, span, value } of fieldsOf(init)) {
    const field = lookupMember(fields, name)
    if (field === undefined) {
      for (const message of [ctx.messages.undefinedIdentifier(name), ctx.messages.notAssignmentTarget(name)])
        out.push({ severity: "error", span, source: SOURCE, code: "unknown-struct-field", message })
      continue
    }
    if (value === undefined || field.typeExpr === undefined) continue
    structValues(ctx, resolveTypeExpr(field.typeExpr, ctx.project, 0, ctx.project, field.uri), value, out)
  }
}

/** The fields an initializer assigns at its top level: each name, its element's span, and its value when it has one. */
function fieldsOf(init: Initializer): { name: string; span: Span; value?: Initializer }[] {
  if (init.kind === "aggregate_init")
    return init.elements.flatMap((el) => {
      if (el.kind !== "field") return []
      const value = el.value.kind === "nested" ? el.value.init : el.value.kind === "value" ? el.value.expr : undefined
      return [{ name: el.name, span: el.span, ...(value !== undefined ? { value } : {}) }]
    })
  if (init.kind === "paren" && init.inner.kind === "assign_expr" && init.inner.target.kind === "ident_expr")
    return [{ name: init.inner.target.name, span: init.inner.target.span, value: init.inner.value }]
  return []
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

function isArrayInit(init: Initializer): boolean {
  return init.kind === "aggregate_init" && init.form === "array"
}

function isStructInit(init: Initializer): boolean {
  // A single-field `(p1 := 1)` parses as a paren-wrapped assignment expression; multi-field / `STRUCT(…)`
  // parse as an aggregate whose form is "struct".
  if (init.kind === "paren") return init.inner.kind === "assign_expr"
  return init.kind === "aggregate_init" && init.form === "struct"
}
