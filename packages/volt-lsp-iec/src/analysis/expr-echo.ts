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
import { exprText, type Expr } from "../syntax/index.js"

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
    default:
      return exprText(e)
  }
}
