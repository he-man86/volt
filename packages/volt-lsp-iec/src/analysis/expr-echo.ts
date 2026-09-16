/**
 * expr-echo — an expression as the COMPILER echoes it back in a message, which is not how it was written: every
 * binary operation is parenthesized, so `one + two` comes back `(one + two)` and `a + b + c` comes back
 * `((a + b) + c)` (conformance `cc3_multiple_inheritance`, `cc2_constant_and_external`). The general display form is
 * `syntax/print`'s `exprText`; this is the message form, which is why it lives here and not there.
 *
 * Not modelled: the compiler TYPES an integer literal inside an arithmetic expression when it echoes it
 * (`(depth - INT#1)`, conformance `cc2_call_recursion`). No fixture needs it yet.
 */
import { exprText, type Expr } from "../syntax/index.js"

export function compilerExprText(e: Expr): string {
  switch (e.kind) {
    case "binary":
      return `(${compilerExprText(e.left)} ${e.op} ${compilerExprText(e.right)})`
    case "paren":
      // the operation inside brings its own parentheses; a parenthesized name keeps none
      return compilerExprText(e.inner)
    case "member":
      return `${compilerExprText(e.base)}.${e.member.name}`
    case "index":
      return `${compilerExprText(e.base)}[${e.indices.map(compilerExprText).join(", ")}]`
    case "deref":
      return `${compilerExprText(e.base)}^`
    case "ident_expr":
      // THIS and SUPER come back UPPER-case however they were written (conformance `cc_self_super_in_program`,
      // where the source says `super` and the IDE answers 'SUPER')
      return /^(this|super)$/i.test(e.name) ? e.name.toUpperCase() : e.name
    default:
      return exprText(e)
  }
}
