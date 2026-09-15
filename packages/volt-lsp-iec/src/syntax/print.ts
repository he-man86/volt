/**
 * AST → text (Layer A): a declared `TypeExpr` and an expression, as ST source. Hover, signature help, the formatter, the
 * code actions and a few diagnostic messages print through these. They lived in `types/render.ts`, though they read
 * only the AST — `types/renderType`, which prints a RESOLVED type, stays there (consolidate-lsp-structure C4).
 */
import type { CallArg, Expr, TypeExpr } from "./ast.js"

/** Render a declared AST `TypeExpr` to display text. */
export function renderTypeExpr(t: TypeExpr): string {
  switch (t.kind) {
    case "named_type": {
      const q = t.qualifiers && t.qualifiers.length > 0 ? `${t.qualifiers.map((i) => i.text).join(".")}.` : ""
      const sub = t.subrange ? `(${exprText(t.subrange.lo)}..${exprText(t.subrange.hi)})` : ""
      // `inst : FB(x := 1)`'s FB_Init arguments — the formatter printed the type without them, deleting them from the file
      const init = t.initArgs ? `(${t.initArgs.map(callArgText).join(", ")})` : ""
      return `${q}${t.name.text}${sub}${init}`
    }
    case "string_type":
      return (t.wide ? "WSTRING" : "STRING") + (t.length ? `(${exprText(t.length)})` : "")
    case "array_type":
      return `ARRAY[${t.dims.map(dimText).join(", ")}] OF ${renderTypeExpr(t.element)}`
    case "pointer_type":
      return `POINTER TO ${renderTypeExpr(t.target)}`
    case "reference_type":
      return `REFERENCE TO ${renderTypeExpr(t.target)}`
    case "implicit_enum_type":
      return `(${t.values.map((v) => (v.value !== undefined ? `${v.name.text} := ${exprText(v.value)}` : v.name.text)).join(", ")})`
  }
}

/** One array dimension as written: `1..10`, or `*` for a dynamic one. */
export function dimText(d: { dynamic: boolean; lower?: Expr; upper?: Expr }): string {
  if (d.dynamic) return "*"
  return `${d.lower ? exprText(d.lower) : ""}..${d.upper ? exprText(d.upper) : ""}`
}

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
