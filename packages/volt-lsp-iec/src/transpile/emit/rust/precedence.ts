/**
 * PRECEDENCE — an expression printed with how tightly it binds, so a position adds the parentheses it needs and no others
 * (transpile-restructure 7.3.8, lean 3). The printer used to parenthesize every binary, cast and unary and strip the outer
 * pair again where an expression stood alone (`unparen`, `unparenHead`, a negative literal's special case beside an
 * operator); each printed form now says what it is, and its position decides.
 */

/** Rust's binding strengths, loosest first (the Reference's expression precedence table). */
export const enum Prec {
  /** `if … {} else {}`, `match … {}` — an operand anywhere but a statement's whole value needs them parenthesized */
  Block = 0,
  Range,
  LogOr,
  LogAnd,
  Compare,
  BitOr,
  BitXor,
  BitAnd,
  Shift,
  Add,
  Mul,
  As,
  Unary,
  /** a path, a literal, a call, a method call, a field, an index, a parenthesized or braced block */
  Postfix,
}

/** An expression as Rust text, with how tightly it binds. */
export interface Printed {
  readonly text: string
  readonly prec: Prec
}

export const printed = (text: string, prec: Prec): Printed => ({ text, prec })

/** `r` where at least `min` binds: parenthesized when it binds looser. */
export const at = (r: Printed, min: Prec): string => (r.prec < min ? `(${r.text})` : r.text)

/** Each infix operator's strength. */
const INFIX: Readonly<Record<string, Prec>> = {
  "||": Prec.LogOr,
  "&&": Prec.LogAnd,
  "==": Prec.Compare,
  "!=": Prec.Compare,
  "<": Prec.Compare,
  "<=": Prec.Compare,
  ">": Prec.Compare,
  ">=": Prec.Compare,
  "|": Prec.BitOr,
  "^": Prec.BitXor,
  "&": Prec.BitAnd,
  "<<": Prec.Shift,
  ">>": Prec.Shift,
  "+": Prec.Add,
  "-": Prec.Add,
  "*": Prec.Mul,
  "/": Prec.Mul,
  "%": Prec.Mul,
}

/** The bit and shift operators: an operand that is itself another operator keeps its parentheses beside one — `(a + b) &
 *  m`, `(x >> 3) & 1` — which is what clippy's `precedence` asks; only the same operator chains bare (`a ^ b ^ c`). */
const BITWISE: ReadonlySet<Prec> = new Set([Prec.BitOr, Prec.BitXor, Prec.BitAnd, Prec.Shift])

/**
 * `l op r`, each operand parenthesized only where Rust (or clippy) needs it: an operator binding looser than `op`, the
 * right operand of the same strength (every Rust infix operator is left-associative; a comparison does not chain at all),
 * another operator beside a bit or shift operator, and a cast left of `<` or `<<` (`x as i32 < y` reads a generic).
 */
export function infix(l: Printed, op: string, r: Printed): Printed {
  const prec = INFIX[op]
  if (prec === undefined) throw new Error(`emit: no precedence for the operator ${op}`)
  const operator = (x: Printed): boolean => x.prec >= Prec.Range && x.prec < Prec.As
  // an `&&` beside an `||` keeps its parentheses too: legal bare, but the grouping is the point of reading it
  const mixed = (x: Printed): boolean => prec === Prec.LogOr && x.prec === Prec.LogAnd
  const left = (l.prec < prec || (prec === Prec.Compare && l.prec === prec) || (BITWISE.has(prec) && operator(l) && l.prec !== prec) ||
    mixed(l) || (l.prec === Prec.As && (op === "<" || op === "<<" || op === "<=")))
    ? `(${l.text})`
    : l.text
  const right = r.prec <= prec || (BITWISE.has(prec) && operator(r)) || mixed(r) ? `(${r.text})` : r.text
  return printed(`${left} ${op} ${right}`, prec)
}
