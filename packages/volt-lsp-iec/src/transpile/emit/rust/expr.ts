/**
 * EXPRESSIONS AS RUST — the dispatch over the IR's expression kinds, and the ones printed here: a constant, a fresh
 * composite, a load, a unary and a binary; `NOT` flipped where it can be; the outer parentheses a position does not need.
 */
import type { IrExpr, IrPou } from "../../ir/index.js"
import { isReal } from "../../../frontend/types/index.js"
import { exprBuiltin } from "./builtins.js"
import { exprDispatch, exprInvoke, exprSelect } from "./calls.js"
import { exprConvert } from "./convert.js"
import { tmp } from "./names.js"
import { place } from "./place.js"
import { guarded, type Printer } from "./printer.js"
import { isCopy } from "./types.js"
import { initOf, literal } from "./values.js"

/**
 * Drop an outer paren pair the position does not need.
 *
 * The printer parenthesizes every binary, every cast and every unary, which is the only way a printer with no
 * precedence table can be correct — and it means a complete expression arrives at a STATEMENT position already
 * wrapped. `self.q1 = ((self.a as i32) / (self.b as i32));` is what rustc's own `unused_parens` names, and it was
 * emitted 2,722 times across the conformance fixtures.
 *
 * ONLY WHERE THE EXPRESSION STANDS ALONE — an assignment's right-hand side, an `if` condition, a `match` selector.
 * Never at a RECEIVER: `literal()`'s comment above spells out what `(-1i32).max(x)` costs without its parens, and
 * the balanced walk below is what keeps `(a + b).to()` — whose first `(` does not close at the end — untouched.
 */
export function unparen(text: string): string {
  if (!text.startsWith("(") || !text.endsWith(")")) return text
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    // the emitted Rust carries string literals (`panic!`, byte strings), and a paren inside one is not structure
    if (c === '"') {
      while (++i < text.length && text[i] !== '"') if (text[i] === "\\") i++
      continue
    }
    if (c === "(") depth++
    else if (c === ")" && --depth === 0) return i === text.length - 1 ? unparen(text.slice(1, -1)) : text
  }
  return text
}

/**
 * `unparen`, EXCEPT where a bare `{` would be read as the body rather than the scrutinee.
 *
 * An `if` condition and a `match` selector are the one position Rust treats specially: `if { … } { … }` and
 * `match match k { … } { … }` are ambiguous at best. `SEL` prints `({ … })` and `MUX` prints `(match … { … })`,
 * so an `IF SEL(…)` or a `CASE MUX(…)` reaches exactly that — and no fixture writes one, so the suite would not
 * have said. Everywhere else a block-like expression unwraps fine, which is why this is not inside `unparen`:
 * putting it there kept the parentheses on 83 assignment right-hand sides that did not need them.
 */
export function unparenHead(text: string): string {
  const inner = text.startsWith("(") ? text.slice(1, -1).trimStart() : ""
  const blockLike = ["{", "match ", "if ", "unsafe ", "loop ", "while "].some((s) => inner.startsWith(s))
  return blockLike ? text : unparen(text)
}

/** `wrapping_add` and friends — IEC integers wrap at their width; Rust's `+` would panic in debug. */
const WRAPPING: Readonly<Record<string, string>> = { add: "add", sub: "sub", mul: "mul", div: "div", mod: "rem" }

const INFIX: Readonly<Record<string, string>> = {
  eq: "==",
  ne: "!=",
  lt: "<",
  le: "<=",
  gt: ">",
  ge: ">=",
  and_then: "&&",
  or_else: "||",
}

/**
 * The comparison a NEGATED one is. A loop test prints as `if !<cond> { break; }`, and a loop's condition is almost
 * always a comparison — `!(i <= 2)` is what `clippy::nonminimal_bool` names, 39 times across the fixtures, and
 * `i > 2` is the same test. Flipped HERE, on the IR node, rather than by rewriting the printed text.
 */
const INVERSE: Readonly<Record<string, string>> = { eq: "ne", ne: "eq", lt: "ge", le: "gt", gt: "le", ge: "lt" }

/** `NOT e`, as a comparison flipped where it is one — the loop test's `if !<cond> { break; }`. */
export function negated(p: Printer, e: IrExpr, slots: IrPou["slots"]): string {
  // a comparison flips; `NOT NOT x` is `x`; a constant is the other constant. A REPEAT's test arrives already
  // negated (`UNTIL` is the exit condition), so without the double-negation case every REPEAT printed
  // `if !(!(n > 5)) { break; }` — three of the four `nonminimal_bool` findings left after the first pass.
  //
  // NOT FOR A REAL OPERAND. Flipping an ordering comparison is negation only over a total order, and floats are
  // not one: with a NaN operand every one of `<`, `<=`, `>`, `>=` is false, so `!(r <= 10.0)` is TRUE and
  // `r > 10.0` is FALSE. `WHILE r <= 10.0` over a NaN exits at once in the interpreter and never exits in the
  // emitted Rust — an infinite loop, and a divergence no fixture reaches. `eq`/`ne` are safe (NaN makes `eq`
  // false and `ne` true, which are still each other's negation), and only the four orderings are excluded.
  const ordering = e.kind === "binary" && e.op !== "eq" && e.op !== "ne"
  const overReals = (x: IrExpr): boolean => isReal(x.type)
  if (e.kind === "binary" && INVERSE[e.op] !== undefined && !(ordering && (overReals(e.left) || overReals(e.right))))
    return unparen(expr(p, { ...e, op: INVERSE[e.op] } as IrExpr, slots))
  if (e.kind === "unary" && e.op === "not") return unparen(expr(p, e.operand, slots))
  if (e.kind === "const" && typeof e.value === "boolean") return e.value ? "false" : "true"
  return `!${expr(p, e, slots)}`
}

export function expr(p: Printer, e: IrExpr, slots: IrPou["slots"]): string {
  switch (e.kind) {
    case "const":
      return literal(e.value, e.type)
    // A fresh composite — the emitted twin of the interpreter's `instantiate`, and the same `initOf` a slot's
    // declaration already uses. Only a VAR_TEMP reset reaches it.
    case "fresh":
      return initOf(p.layouts, e.type, e.init)
    case "invoke":
      return exprInvoke(p, e, slots)
    case "dispatch":
      return exprDispatch(p, e, slots)
    case "select":
      return exprSelect(p, e, slots)
    case "load":
      return exprLoad(p, e, slots)
    case "convert":
      return exprConvert(p, e, slots)
    case "builtin":
      return exprBuiltin(p, e, slots)
    case "unary":
      return exprUnary(p, e, slots)
    case "binary":
      return exprBinary(p, e, slots)
  }
}

function exprLoad(p: Printer, e: Extract<IrExpr, { kind: "load" }>, slots: IrPou["slots"]): string {
  const field = place(p, e.place, slots)
  const bit = e.place.path.at(-1)
  // bit 0 needs no shift — `x >> 0` is `clippy::identity_op`, and the mask alone says the same thing
  if (bit?.kind === "bit")
    return guarded(p, e.place, `((${bit.index === 0 ? field : `(${field} >> ${bit.index})`} & 1) != 0)`, slots)
  // a whole struct, instance or array is copied, never moved out of `self` — but only a struct or an FB
  // instance needs `.clone()` to do it. Everything else the emitter prints IS `Copy`: the elementary types,
  // `IecStr` (which derives it), a pointer's `usize`, an interface's tag, and an array of any of those.
  // `.clone()` on a `Copy` value is `clippy::clone_on_copy` and reads as if something were being deep-copied.
  return guarded(p, e.place, isCopy(e.type) ? field : `${field}.clone()`, slots)
}

function exprUnary(p: Printer, e: Extract<IrExpr, { kind: "unary" }>, slots: IrPou["slots"]): string {
  const operand = expr(p, e.operand, slots)
  if (e.op === "not") return `(!${operand})`
  // An integer's minimum has no positive counterpart in its own width, and Rust's `-` PANICS on it in a debug
  // build — found by the differential test (conformance `unary_minus_at_the_edge`, a DINT at its minimum).
  return isReal(e.type) ? `(-${operand})` : `${operand}.wrapping_neg()`
}

function exprBinary(p: Printer, e: Extract<IrExpr, { kind: "binary" }>, slots: IrPou["slots"]): string {
  const l = expr(p, e.left, slots)
  const r = expr(p, e.right, slots)
  const infix = INFIX[e.op]
  if (infix !== undefined) return `(${l} ${infix} ${r})`
  // Rust's `&`/`|` on bool evaluate both sides, as AND/OR do in the interpreter; `&&`/`||` are AND_THEN/OR_ELSE.
  // BOOL AND printed `&&`, so a call on the right ran in one backend and not the other (transpiler review 2026-09-15).
  if (e.op === "and" || e.op === "or" || e.op === "xor") return `(${l} ${e.op === "and" ? "&" : e.op === "or" ? "|" : "^"} ${r})`
  const wrapping = WRAPPING[e.op]
  const real = isReal(e.type)
  // MOD by zero is 0, measured (`mod_by_zero`), where Rust's `%` panics; each operand is evaluated once, left first.
  //
  // THE BINDINGS CARRY THE RESERVED PREFIX, and that is not cosmetic. They were `a` and `d`, and a routine's
  // parameters are Rust LOCALS: in `FUNCTION F : INT VAR_INPUT a : INT; b : INT; END_VAR F := b MOD a;` the
  // emitted `let a = b` SHADOWED the parameter `a`, so the very next binding — `let d = a` — read the left
  // operand instead of the right, and `7 MOD 3` compiled to `7 % 7` = 0 where the interpreter answers 1.
  // A silent wrong answer, and one no recorded case caught because no fixture names a parameter `a`.
  if (e.op === "mod" && !real)
    return `({ let ${tmp("mod_l")} = ${unparen(l)}; let ${tmp("mod_r")} = ${unparen(r)}; if ${tmp("mod_r")} == 0 { 0 } else { ${tmp("mod_l")}.wrapping_rem(${tmp("mod_r")}) } })`
  // INTEGER DIVISION IS NOT WRAPPING. `wrapping_div` returns the minimum for `MIN / -1` and carries on, and
  // CODESYS STOPS THE TASK there (`arithedge_dint_div_min_by_minus_one`, `arithedge_lint_*`). Plain `/` panics
  // on exactly the two cases the vendor stops on — a zero divisor and that one overflow — so it is both the
  // simpler emission and the correct one. `+`, `-` and `*` really do wrap and keep their helpers.
  // the argument of a call needs no parentheses of its own — `wrapping_add((x as i32))` is one pair too many
  if (wrapping !== undefined && !real && e.op !== "div") return `${l}.wrapping_${wrapping}(${unparen(r)})`
  const plain = e.op === "add" ? "+" : e.op === "sub" ? "-" : e.op === "mul" ? "*" : e.op === "div" ? "/" : "%"
  // A REAL DIVISION BY ZERO STOPS THE TASK, and nothing else about an infinity does. This wrapped EVERY real
  // operation in a finiteness check, on the reading that an infinite RESULT is what stops it; `real-overflow.ts`
  // measured `1.0E38 / 1.0E-38` overflowing to `REAL#Infinity` with the scan completing, so the result was
  // never the rule. Rust's `f32`/`f64` division answers `inf` for a zero divisor instead of panicking the way
  // integer division does, so the divisor is checked explicitly — the emitted twin of `arith` in `semantics/arith.ts`.
  return real && e.op === "div" ? `iec_div(${unparen(l)}, ${unparen(r)})` : `(${l} ${plain} ${r})`
}
