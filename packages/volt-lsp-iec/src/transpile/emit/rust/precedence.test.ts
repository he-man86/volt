import { expect, test } from "bun:test"
import { at, infix, Prec, printed } from "./precedence.js"

const v = (text: string) => printed(text, Prec.Postfix)

// 7.3.8: the parentheses a position needs, and no others — the rules `infix` and `at` hold
test("an operand is parenthesized only where it binds looser, or where Rust or clippy needs it", () => {
  const sum = infix(v("a"), "+", v("b"))
  // a left-associative chain bare on the left, parenthesized on the right
  expect(infix(sum, "+", v("c")).text).toBe("a + b + c")
  expect(infix(v("c"), "-", sum).text).toBe("c - (a + b)")
  // a tighter operator needs none; a looser one does
  expect(infix(v("a"), "+", infix(v("b"), "*", v("c"))).text).toBe("a + b * c")
  expect(infix(sum, "*", v("c")).text).toBe("(a + b) * c")
  // a comparison does not chain
  expect(infix(infix(v("a"), "<", v("b")), "==", v("t")).text).toBe("(a < b) == t")
  // beside a bit or shift operator, another operator keeps its parentheses (clippy's `precedence`); the same one chains
  expect(infix(sum, "&", v("m")).text).toBe("(a + b) & m")
  expect(infix(infix(v("x"), ">>", v("3")), "&", v("1")).text).toBe("(x >> 3) & 1")
  expect(infix(infix(v("a"), "^", v("b")), "^", v("c")).text).toBe("a ^ b ^ c")
  expect(infix(printed("!a", Prec.Unary), "|", v("b")).text).toBe("!a | b")
  // a cast left of `<` reads as a generic
  expect(infix(printed("x as i32", Prec.As), "<", v("y")).text).toBe("(x as i32) < y")
  expect(infix(v("y"), "<", printed("x as i32", Prec.As)).text).toBe("y < x as i32")
  // `&&` beside `||` keeps its grouping
  expect(infix(v("a"), "||", infix(v("b"), "&&", v("c"))).text).toBe("a || (b && c)")
  // a negative literal is an operand bare, a receiver parenthesized
  expect(infix(v("x"), "*", printed("-0.5f64", Prec.Unary)).text).toBe("x * -0.5f64")
  expect(at(printed("-1i32", Prec.Unary), Prec.Postfix)).toBe("(-1i32)")
  expect(at(printed("if g { 1 } else { 2 }", Prec.Block), Prec.Block)).toBe("if g { 1 } else { 2 }")
})
