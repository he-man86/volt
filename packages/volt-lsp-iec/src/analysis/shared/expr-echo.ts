/**
 * expr-echo — an expression as the COMPILER echoes it back in a message, which is not how it was written: every
 * binary operation is parenthesized, so `one + two` comes back `(one + two)` and `a + b + c` comes back
 * `((a + b) + c)` (conformance `cc3_multiple_inheritance`, `cc2_constant_and_external`). The general display form is
 * `syntax/print`'s `exprText`; this is the message form, which is why it lives here and not there.
 *
 * The compiler also TYPES a bare integer literal inside an arithmetic expression, to the type the operation meets at
 * (`depth - 1` with `depth : INT` comes back `(depth - INT#1)`, conformance `cc2_call_recursion`) — `typeOf` supplies
 * that. It does NOT do so elsewhere: an index echoes `plain[1]` and an aggregate `STRUCT(x := 1, y := 2)`.
 */
import { addressShape, exprText, type AggregateElement, type Expr, type Initializer } from "../../frontend/syntax/index.js"

/** The type of the zero a negation of an UNTYPED operand is echoed with — measured, not a default (`lit_enum_typed_under_minus`). */
const UNTYPED_NEGATION_ZERO = "INT"

export function compilerExprText(e: Expr, typeOf: (e: Expr) => string | undefined = () => undefined): string {
  const text = (x: Expr): string => compilerExprText(x, typeOf)
  switch (e.kind) {
    case "binary": {
      // the operation's own type, or — when an untyped literal leaves the inference without one — the type of the
      // operand that is not the literal, which is what the compiler meets at
      const met = typeOf(e) ?? typeOf(e.left.kind === "literal" ? e.right : e.left)
      const operand = (x: Expr): string =>
        met !== undefined && x.kind === "literal" && /^\d+$/.test(x.text) ? `${met}#${x.text}` : text(x)
      return `(${operand(e.left)} ${e.op} ${operand(e.right)})`
    }
    case "unary":
      // `NOT x` comes back as a call, `NOT(x)`, and `-x` as a subtraction from a typed zero, `(INT#0 - x)` — with an
      // operand of NO type the zero is INT's (`lit_address_unsized_under_not`, `lit_enum_typed_under_minus`, CODESYS
      // 2026-10-01); with a typed one it is the operation's type, as a binary operation's literal is
      if (e.op === "NOT") return `NOT(${text(e.operand)})`
      if (e.op === "-") return `(${typeOf(e) ?? UNTYPED_NEGATION_ZERO}#0 - ${text(e.operand)})`
      return exprText(e)
    case "paren":
      // the operation inside brings its own parentheses; a parenthesized name keeps none
      return text(e.inner)
    case "member":
      return `${text(e.base)}.${e.member.name}`
    case "index":
      return `${text(e.base)}[${e.indices.map(text).join(", ")}]`
    case "deref":
      return `${text(e.base)}^`
    case "call":
      // an argument is echoed the same way — `F_C2_loop(depth := (depth - INT#1))`
      return `${text(e.callee)}(${e.args.map((a) => (a.param === undefined ? "" : `${a.param.name} ${a.output ? "=>" : ":="} `) + (a.value === undefined ? "" : text(a.value))).join(", ")})`
    case "ident_expr":
      // THIS and SUPER come back UPPER-case however they were written (conformance `cc_self_super_in_program`,
      // where the source says `super` and the IDE answers 'SUPER')
      return /^(this|super)$/i.test(e.name) ? e.name.toUpperCase() : e.name
    case "literal": {
      // a malformed ADDRESS comes back with a `?` where its size letter is missing — 'Unknown type: '%M?0.1''
      // (`lit_address_unsized_in_body`, both vendors 2026-10-01)
      const shape = e.literalKind === "address" ? addressShape(e.text) : undefined
      return shape?.kind === "malformed" ? shape.echo : exprText(e)
    }
    default:
      return exprText(e)
  }
}

/** `STRUCT(x := 1, y := 2)` — the compiler's name for an initializer it could not attach to a type. */
export function structEcho(init: Initializer): string {
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

/** `[1, 2]` — the compiler's name for an ARRAY literal it could not attach to a type (`arrinit_on_scalar`, both vendors
 *  2026-10-06); undefined unless every element is a plain literal, the only shape recorded. */
export function arrayEcho(init: Initializer): string | undefined {
  if (init.kind !== "aggregate_init" || init.form !== "array") return undefined
  const texts = init.elements.map((el) => (el.kind === "value" && el.expr.kind === "literal" ? el.expr.text : undefined))
  return texts.every((t): t is string => t !== undefined) ? `[${texts.join(", ")}]` : undefined
}
