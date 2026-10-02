/**
 * AST → text (Layer A): a declared `TypeExpr` and an expression, as ST source. Hover, signature help, the formatter and
 * the code actions print a type as written (`renderTypeExpr`); a diagnostic message names it in the vendor's spelling
 * (`compilerTypeText`). They lived in `types/render.ts`, though they read only the AST — `types/renderType`, which prints
 * a RESOLVED type, stays there (consolidate-lsp-structure C4).
 */
import type { CallArg, Expr, StringType, TypeExpr, VarDecl } from "./ast/nodes.js"
import { BINARY_PRECEDENCE } from "./parse/expression.js"

/**
 * The operator written before a declaration's initializer, with the space after it: `:= `, `REF= `, or nothing for an
 * FB array's `[(…), (…)]` list written straight after the type (`VarDecl.initOp`).
 */
export function initOperatorText(op: VarDecl["initOp"]): string {
  return op === "FB_Init" ? "" : `${op ?? ":="} `
}

/**
 * Render a declared AST `TypeExpr` as written — the formatter, hover and signature help: a STRING length keeps the
 * delimiters the engineer wrote (`STRING[80]`, PR2). A diagnostic message names a type through `compilerTypeText`.
 */
export function renderTypeExpr(t: TypeExpr): string {
  return typeText(t, "written")
}

/**
 * A declared AST `TypeExpr` in the compiler's spelling — what a vendor-worded diagnostic message echoes. It differs from
 * `renderTypeExpr` in one place: the vendors normalise a STRING length's delimiters to `(…)` (`decl_string_brackets`
 * records 'STRING(5)' for `STRING[5]`, `decl_string_length_constant_brackets` 'STRING(N)' for `STRING[N]`, both vendors).
 */
export function compilerTypeText(t: TypeExpr): string {
  return typeText(t, "compiler")
}

type TypeSpelling = "written" | "compiler"

function typeText(t: TypeExpr, spelling: TypeSpelling): string {
  const inner = (u: TypeExpr): string => typeText(u, spelling)
  switch (t.kind) {
    case "named_type": {
      const q = t.qualifiers && t.qualifiers.length > 0 ? `${t.qualifiers.map((i) => i.text).join(".")}.` : ""
      const sub = t.subrange ? `(${exprText(t.subrange.lo)}..${exprText(t.subrange.hi)})` : ""
      // `inst : FB(x := 1)`'s FB_Init arguments — the formatter printed the type without them, deleting them from the file
      const init = t.initArgs ? `(${t.initArgs.map(callArgText).join(", ")})` : ""
      // `inst : FB<6>` — a VAR_GENERIC instance's values
      const generic = t.genericArgs ? `<${t.genericArgs.map(exprText).join(", ")}>` : ""
      return `${q}${t.name.text}${generic}${sub}${init}`
    }
    case "string_type":
      return (t.wide ? "WSTRING" : "STRING") + stringLengthText(t, spelling)
    case "array_type":
      return t.vector !== undefined
        ? `__VECTOR[${t.vector.size !== undefined ? exprText(t.vector.size) : ""}] OF ${inner(t.element)}`
        : `ARRAY[${t.dims.map(dimText).join(", ")}] OF ${inner(t.element)}`
    case "pointer_type":
      return `POINTER TO ${inner(t.target)}`
    case "reference_type":
      return `REFERENCE TO ${inner(t.target)}`
    case "implicit_enum_type":
      return `(${t.values.map((v) => (v.value !== undefined ? `${v.name.text} := ${exprText(v.value)}` : v.name.text)).join(", ")})${t.baseType !== undefined ? ` ${inner(t.baseType)}` : ""}`
  }
}

/** A STRING's length clause as written (`[80]`, `(80]` — PR2) or in the compiler's `(80)`, or nothing. */
function stringLengthText(t: StringType, spelling: TypeSpelling): string {
  if (t.length === undefined) return ""
  if (spelling === "compiler") return `(${exprText(t.length)})`
  if (t.delimiters === undefined) throw new Error("a STRING length without its delimiters: the parser records both")
  return `${t.delimiters[0]}${exprText(t.length)}${t.delimiters[1] ?? ""}`
}

/** One array dimension as written: `1..10`, or `*` for a dynamic one. */
export function dimText(d: { dynamic: boolean; lower?: Expr; upper?: Expr }): string {
  if (d.dynamic) return "*"
  return `${d.lower ? exprText(d.lower) : ""}..${d.upper ? exprText(d.upper) : ""}`
}

/**
 * Minimal expression-to-text for bounds/lengths (literals, names, member access, simple binary/unary).
 * A full source-faithful printer is the formatter's job (E.3); this covers the const-expr forms bounds use.
 *
 * A parsed tree holds its parentheses (`paren`); a tree built by a code action does not, so a child its parent would
 * capture is parenthesized by the parser's own precedence (PR3): a binary operand of a lower level, or of the same level
 * on the right (every level is left-associative); a binary or an inline assignment under a unary or a postfix; an inline
 * assignment under a binary. A parsed tree never meets the rule — its parentheses are already there.
 */
export function exprText(e: Expr): string {
  switch (e.kind) {
    case "literal":
      return e.text
    case "ident_expr":
      return e.name
    case "member":
      return `${operand(e.base, POSTFIX)}.${e.member.name}`
    case "unary":
      // A word operator (NOT) needs a space so it doesn't glue onto the operand (`NOTx` → an ident);
      // a symbol operator (-, +) binds tight.
      return `${e.op}${/^[A-Za-z]/.test(e.op) ? " " : ""}${operand(e.operand, UNARY)}`
    case "binary": {
      const level = binaryLevel(e.op)
      return `${operand(e.left, level)} ${e.op} ${operand(e.right, level + 1)}`
    }
    case "paren":
      return `(${exprText(e.inner)})`
    case "index":
      return `${operand(e.base, POSTFIX)}[${e.indices.map(exprText).join(", ")}]`
    case "deref":
      return `${operand(e.base, POSTFIX)}^`
    case "call":
      return `${operand(e.callee, POSTFIX)}(${e.args.map(callArgText).join(", ")})`
    case "assign_expr":
      return `${exprText(e.target)} := ${exprText(e.value)}`
    case "global_expr":
      return `.${e.name.name}`
  }
}

/** Binding levels above the binary table's: a unary operator, then postfix (`.` `[]` `^` `()`), the tightest. */
const UNARY = Math.max(...BINARY_PRECEDENCE.map((row) => row.prec)) + 1
const POSTFIX = UNARY + 1
const LEVEL: ReadonlyMap<string, number> = new Map(BINARY_PRECEDENCE.flatMap((row) => row.ops.map((op) => [op, row.prec] as const)))

function binaryLevel(op: string): number {
  const level = LEVEL.get(op)
  if (level === undefined) throw new Error(`'${op}' is no binary operator of the precedence table`)
  return level
}

/** How tightly `e` binds as an operand: an inline assignment loosest (0), a binary by its level, a unary, else postfix. */
function bindingOf(e: Expr): number {
  if (e.kind === "assign_expr") return 0
  if (e.kind === "binary") return binaryLevel(e.op)
  if (e.kind === "unary") return UNARY
  return POSTFIX
}

/** `e` as an operand that must bind at least `min` tightly — parenthesized when it binds looser. */
function operand(e: Expr, min: number): string {
  return bindingOf(e) < min ? `(${exprText(e)})` : exprText(e)
}

function callArgText(a: CallArg): string {
  const val = a.value !== undefined ? exprText(a.value) : ""
  if (a.param !== undefined) return `${a.param.name} ${a.output ? "=>" : ":="} ${val}`.trimEnd()
  return val
}
