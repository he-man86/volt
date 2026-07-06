/**
 * render — the ONE type/expression renderer (Layer C, C.5). `renderType` displays a resolved `Type`;
 * `renderTypeExpr` displays a declared AST `TypeExpr` (hover of a declaration). Both share `exprText`
 * for bound/length expressions.
 *
 * Note: compiler-EXACT message forms (e.g. a string literal shown as `STRING(INT#4)`) are diagnostic
 * wording and live in `analysis/messages`, not here — this renderer is the general, human display form.
 */
import type { CallArg, Expr, TypeExpr } from "../syntax/index.js"
import type { Type } from "./type.js"

/** Render a resolved `Type` to display text. */
export function renderType(t: Type): string {
  switch (t.kind) {
    case "elementary":
    case "enum":
    case "struct":
    case "function_block":
      return t.name
    case "array":
      return `ARRAY[${t.dims.map(renderDim).join(", ")}] OF ${renderType(t.element)}`
    case "pointer":
      return `POINTER TO ${renderType(t.target)}`
    case "reference":
      return `REFERENCE TO ${renderType(t.target)}`
    case "unknown":
      return "?"
  }
}

/** Render a declared AST `TypeExpr` to display text. */
export function renderTypeExpr(t: TypeExpr): string {
  switch (t.kind) {
    case "named_type": {
      const q = t.qualifiers && t.qualifiers.length > 0 ? `${t.qualifiers.map((i) => i.text).join(".")}.` : ""
      const sub = t.subrange ? `(${exprText(t.subrange.lo)}..${exprText(t.subrange.hi)})` : ""
      return `${q}${t.name.text}${sub}`
    }
    case "string_type":
      return (t.wide ? "WSTRING" : "STRING") + (t.length ? `(${exprText(t.length)})` : "")
    case "array_type":
      return `ARRAY[${t.dims.map(renderExprDim).join(", ")}] OF ${renderTypeExpr(t.element)}`
    case "pointer_type":
      return `POINTER TO ${renderTypeExpr(t.target)}`
    case "reference_type":
      return `REFERENCE TO ${renderTypeExpr(t.target)}`
    case "implicit_enum_type":
      return `(${t.values.map((v) => (v.value !== undefined ? `${v.name.text} := ${exprText(v.value)}` : v.name.text)).join(", ")})`
  }
}

function renderDim(d: { dynamic: boolean; lower?: Expr; upper?: Expr }): string {
  if (d.dynamic) return "*"
  return `${d.lower ? exprText(d.lower) : ""}..${d.upper ? exprText(d.upper) : ""}`
}
const renderExprDim = renderDim

/**
 * Minimal expression-to-text for bounds/lengths (literals, names, member access, simple binary/unary).
 * A full source-faithful printer is the formatter's job (E.3); this covers the const-expr forms bounds use.
 */
export function exprText(e: Expr): string {
  switch (e.kind) {
    case "literal":
      return e.text
    case "ident_expr":
      return e.name
    case "member":
      return `${exprText(e.base)}.${e.member.name}`
    case "unary":
      // A word operator (NOT) needs a space so it doesn't glue onto the operand (`NOTx` → an ident);
      // a symbol operator (-, +, &) binds tight.
      return `${e.op}${/^[A-Za-z]/.test(e.op) ? " " : ""}${exprText(e.operand)}`
    case "binary":
      return `${exprText(e.left)} ${e.op} ${exprText(e.right)}`
    case "paren":
      return `(${exprText(e.inner)})`
    case "index":
      return `${exprText(e.base)}[${e.indices.map(exprText).join(", ")}]`
    case "deref":
      return `${exprText(e.base)}^`
    case "call":
      return `${exprText(e.callee)}(${e.args.map(callArgText).join(", ")})`
    case "assign_expr":
      return `${exprText(e.target)} := ${exprText(e.value)}`
  }
}

function callArgText(a: CallArg): string {
  const val = a.value !== undefined ? exprText(a.value) : ""
  if (a.param !== undefined) return `${a.param.name} ${a.output ? "=>" : ":="} ${val}`.trimEnd()
  return val
}
