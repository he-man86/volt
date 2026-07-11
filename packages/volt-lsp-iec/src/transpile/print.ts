/**
 * AST → ST printer (transpiler foundation).
 *
 * A transpiler needs to render the AST back to source; the same printer, fed `parse(src)`, is also a
 * **parser data-loss oracle** — `tokens(print(node)) === tokens(source.slice(node.span))` proves the AST
 * captured every meaningful token (complements `parser-completeness.ts`, which only proves the parser doesn't
 * *error* on valid code). This seed covers the fully-structural declaration core — the `TypeExpr` family —
 * which is both the bug-prone part of the parser and the type emitter every transpile target needs.
 *
 * Scope (grow deliberately, not speculatively): types are reconstructed from AST structure. The atomic bound
 * *expressions* inside them (subrange `lo..hi`, array dims, `STRING(n)` length) pass through as source slices —
 * so this also validates that the type parser delimited those spans correctly, while leaving full Expr
 * printing to when a transpiler actually needs to transform expressions.
 *
 * ponytail: TypeExpr only. Add printVarSection / printUnit / printStatement here as a transpiler needs them —
 * each new printer is one more round-trip-tested slice of the AST, not a rewrite.
 */
import type { TypeExpr, Expr } from "../syntax/index.js"

/** Render one type expression as ST. `source` is the original text (for the atomic bound expressions). */
export function printType(t: TypeExpr, source: string): string {
  const expr = (e: Expr): string => source.slice(e.span.start, e.span.end)
  switch (t.kind) {
    case "named_type": {
      const name = [...(t.qualifiers ?? []).map((q) => q.text), t.name.text].join(".")
      return t.subrange === undefined ? name : `${name}(${expr(t.subrange.lo)}..${expr(t.subrange.hi)})`
    }
    case "array_type": {
      const dims = t.dims
        .map((d) => (d.dynamic ? "*" : `${expr(d.lower!)}..${expr(d.upper!)}`))
        .join(", ")
      return `ARRAY[${dims}] OF ${printType(t.element, source)}`
    }
    case "pointer_type":
      return `POINTER TO ${printType(t.target, source)}`
    case "reference_type":
      return `REFERENCE TO ${printType(t.target, source)}`
    case "string_type": {
      const kw = t.wide ? "WSTRING" : "STRING"
      return t.length === undefined ? kw : `${kw}(${expr(t.length)})`
    }
    case "implicit_enum_type":
      return `(${t.values.map((v) => (v.value === undefined ? v.name.text : `${v.name.text} := ${expr(v.value)}`)).join(", ")})`
  }
}
