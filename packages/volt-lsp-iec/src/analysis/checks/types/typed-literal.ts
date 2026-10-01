/**
 * typed-literal (types/). A `<word>#<operand>` that is no literal — `CHAR#'A'`, `WCHAR#"A"`, `CHAR#65`, `XYZ#'abc'`,
 * `UCHAR#"A"`, `UTF8#"a"` — is read by CODESYS as a COMPONENT of the word, and refused as one:
 *
 *   v := CHAR#'A';   →   ''A'' is no component of 'CHAR'
 *
 * one error, whatever the target, the word and the operand as written (`lit_char_typed*`, `lit_wchar_typed*`,
 * `lit_unknown_prefix_quoted*`, `lit_uchar_double_quote`, `lit_utf8_double_quote`, CODESYS 2026-10-01). Which pairs
 * these are is `syntax/literal/value`'s `typedLiteralForm`. An ENUM type's `Type#Value` is not one of them: it is a
 * value of unknown type (`analysis/hole`). TwinCAT refuses every such word in its lexer, so it never reaches here.
 *
 * Wherever an expression stands: a body, a declaration's initializer and every element of an aggregate one, a STRUCT
 * field's initializer, an enum value's (`lit_char_typed_in_array_init`, `_in_struct_field`, `_in_enum_value`, CODESYS
 * 2026-10-01 — each says this message first).
 */
import { stmtExprs, typedLiteralForm, walkExpr, walkStatements, type AggregateElement, type Expr, type Initializer } from "../../../frontend/syntax/index.js"
import { bodies, forEachDecl } from "../../../frontend/symbols/index.js"
import { enumTypedLiteral } from "../../hole.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

export function checkTypedLiteral(ctx: CheckContext, out: DiagnosticItem[]): void {
  const visit = (x: Expr): void => {
    if (x.kind !== "literal" || x.literalKind !== "typed") return
    const form = typedLiteralForm(x.text)
    if (form.kind !== "component" || enumTypedLiteral(x.text, ctx.project)) return
    out.push({ severity: "error", span: x.span, source: SOURCE, code: "typed-literal", message: ctx.messages.notAMember(form.operand, form.prefix) })
  }
  const initializer = (init: Initializer | undefined): void => {
    if (init === undefined) return
    if (init.kind !== "aggregate_init") walkExpr(init, visit)
    else for (const el of init.elements) element(el)
  }
  const element = (el: AggregateElement): void => {
    if (el.kind === "value") walkExpr(el.expr, visit)
    else if (el.kind === "nested") initializer(el.init)
    else if (el.kind === "field") element(el.value)
    else if (el.kind === "repeat") element(el.value)
  }
  for (const { decl } of forEachDecl(ctx.parseResult, ctx.project)) initializer(decl.init)
  for (const unit of ctx.parseResult.units) {
    if (unit.kind !== "type_decl") continue
    const body = unit.body
    if (body.kind === "struct" || body.kind === "union") for (const field of body.fields) initializer(field.init)
    if (body.kind === "enum") for (const v of body.values) if (v.value !== undefined) walkExpr(v.value, visit)
  }
  for (const { statements } of bodies(ctx.parseResult.units, ctx.project))
    walkStatements(statements, (s) => {
      for (const e of stmtExprs(s)) walkExpr(e, visit)
    })
}
