/**
 * EXPRESSIONS AS RUST — the dispatch over the IR's expression kinds, and the ones printed here: a constant, a fresh
 * composite, a load, a unary and a binary; `NOT` flipped where it can be. Every printer answers a `Printed` — its text and
 * how tightly it binds (`precedence.ts`, 7.3.8) — and its POSITION adds the parentheses it needs: a receiver
 * (`Prec.Postfix`), an operand (`infix`), or a statement's whole value (`Prec.Block`, none at all). The printer used to
 * parenthesize every binary, cast and unary and strip the outer pair again where an expression stood alone
 * (`unparen`: 2,722 `unused_parens` across the fixtures before it), which a receiver must never get wrong:
 * `(-1i32).max(x)` without its parentheses is `-(1.max(x))`.
 */
import type { IrExpr, IrPou } from "../../ir/index.js"
import { holdsCall, sameNode } from "../../ir/walk.js"
import { isBoolValued, isReal } from "../../../frontend/types/index.js"
import { exprBuiltin } from "./builtins.js"
import { exprDispatch, exprInvoke, exprSelect } from "./calls.js"
import { exprConvert } from "./convert.js"
import { tmp } from "./names.js"
import { placeExpr } from "./place.js"
import { at, infix, Prec, printed, type Printed } from "./precedence.js"
import { guarded, holdsString, type Printer, use } from "./printer.js"
import { isCopy } from "./types.js"
import { initOf, literal } from "./values.js"
import { imageAddress, loadImage } from "./image.js"

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
export function negated(p: Printer, e: IrExpr, slots: IrPou["slots"]): Printed {
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
    return print(p, { ...e, op: INVERSE[e.op] } as IrExpr, slots)
  if (e.kind === "unary" && e.op === "not") return print(p, e.operand, slots)
  if (e.kind === "const" && typeof e.value === "boolean") return printed(e.value ? "false" : "true", Prec.Postfix)
  // DE MORGAN (7.5.7): NOT (a AND b) is NOT a OR NOT b — each side negated by these same rules, the dual operator of the
  // same kind: eager stays eager (both sides still run, in order), a short-circuit stays one (the right side runs exactly
  // when it ran before) — so `!((i < n) & (i < last))` is `(i >= n) | (i >= last)`
  const dual = e.kind === "binary" && isBoolValued(e.type) ? DUAL[e.op] : undefined
  if (e.kind === "binary" && dual !== undefined) return infix(negated(p, e.left, slots), dual, negated(p, e.right, slots))
  return printed(`!${prefixed("!", print(p, e, slots))}`, Prec.Unary)
}

/** The operator a negated BOOL AND / OR turns into, by De Morgan. */
const DUAL: Readonly<Record<string, string>> = { and: "|", or: "&", and_then: "||", or_else: "&&" }

/** `e` as Rust text where at least `min` binds — a receiver by default (`Prec.Postfix`), parenthesized when it binds
 *  looser; `Prec.Block` where it stands alone (a statement's value, an argument, a `let`'s initializer). */
export function expr(p: Printer, e: IrExpr, slots: IrPou["slots"], min: Prec = Prec.Postfix): string {
  return at(print(p, e, slots), min)
}

/** `e` printed, with how tightly it binds. */
export function print(p: Printer, e: IrExpr, slots: IrPou["slots"]): Printed {
  switch (e.kind) {
    case "const": {
      if (holdsString(e.type)) use(p, "string")
      // a negative literal is a unary minus: a receiver parenthesizes it (`(-1i32).max(x)`), an operand need not
      const text = literal(e.value, e.type)
      return text.startsWith("(-") ? printed(text.slice(1, -1), Prec.Unary) : printed(text, Prec.Postfix)
    }
    // A fresh composite — the emitted twin of the interpreter's `instantiate`, and the same `initOf` a slot's
    // declaration already uses. Only a VAR_TEMP reset reaches it.
    case "fresh":
      if (holdsString(e.type)) use(p, "string")
      return printed(initOf(p.layouts, e.type, e.init), Prec.Postfix)
    case "invoke":
      return exprInvoke(p, e, slots)
    case "dispatch":
      return exprDispatch(p, e, slots)
    case "select":
      return exprSelect(p, e, slots)
    case "load":
      return exprLoad(p, e, slots)
    // `ADR(x)` of a variable in the image: the address its place reaches (`image.ts`)
    case "address":
      return imageAddress(p, e.place, slots)
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

function exprLoad(p: Printer, e: Extract<IrExpr, { kind: "load" }>, slots: IrPou["slots"]): Printed {
  if (e.place.root === "image") return guarded(p, e.place, loadImage(p, e.place, slots), slots)
  const field = placeExpr(p, e.place, slots)
  const bit = e.place.path.at(-1)
  // bit 0 needs no shift — `x >> 0` is `clippy::identity_op`, and the mask alone says the same thing
  if (bit?.kind === "bit") {
    const word = at(field, Prec.Postfix)
    return guarded(p, e.place, printed(`(${bit.index === 0 ? word : `(${word} >> ${bit.index})`} & 1) != 0`, Prec.Compare), slots)
  }
  // a whole struct, instance or array is copied, never moved out of `self` — but only a struct or an FB
  // instance needs `.clone()` to do it. Everything else the emitter prints IS `Copy`: the elementary types,
  // `IecStr` (which derives it), a pointer's `usize`, an interface's tag, and an array of any of those.
  // `.clone()` on a `Copy` value is `clippy::clone_on_copy` and reads as if something were being deep-copied.
  return guarded(p, e.place, isCopy(e.type) ? field : printed(`${at(field, Prec.Postfix)}.clone()`, Prec.Postfix), slots)
}

/** A prefix operator's operand: one that starts with the same sign keeps its parentheses (`-(-5.0f32)`, `!(!x)`) — `--x`
 *  is clippy's `double_neg`. */
const prefixed = (sign: string, r: Printed): string => (r.text.startsWith(sign) ? `(${r.text})` : at(r, Prec.Unary))

function exprUnary(p: Printer, e: Extract<IrExpr, { kind: "unary" }>, slots: IrPou["slots"]): Printed {
  // NOT of a BOOL negates by `negated`'s rules (a comparison flipped, De Morgan, 7.5.7); of an integer it is the bitwise `!`
  if (e.op === "not" && isBoolValued(e.type)) return negated(p, e.operand, slots)
  const operand = print(p, e.operand, slots)
  if (e.op === "not") return printed(`!${prefixed("!", operand)}`, Prec.Unary)
  // An integer's minimum has no positive counterpart in its own width, and Rust's `-` PANICS on it in a debug
  // build — found by the differential test (conformance `unary_minus_at_the_edge`, a DINT at its minimum).
  return isReal(e.type) ? printed(`-${prefixed("-", operand)}`, Prec.Unary) : printed(`${at(operand, Prec.Postfix)}.wrapping_neg()`, Prec.Postfix)
}

function exprBinary(p: Printer, e: Extract<IrExpr, { kind: "binary" }>, slots: IrPou["slots"]): Printed {
  const range = rangeTest(p, e, slots)
  if (range !== undefined) return range
  const l = print(p, e.left, slots)
  const r = print(p, e.right, slots)
  const operator = INFIX[e.op]
  if (operator !== undefined) return infix(l, operator, r)
  // Rust's `&`/`|` on bool evaluate both sides, as AND/OR do in the interpreter; `&&`/`||` are AND_THEN/OR_ELSE.
  // BOOL AND printed `&&`, so a call on the right ran in one backend and not the other (transpiler review 2026-09-15).
  if (e.op === "and" || e.op === "or" || e.op === "xor") return infix(l, e.op === "and" ? "&" : e.op === "or" ? "|" : "^", r)
  const wrapping = WRAPPING[e.op]
  const real = isReal(e.type)
  // MOD by zero is 0, measured (`mod_by_zero`), where Rust's `%` panics; each operand is evaluated once, left first.
  //
  // THE BINDINGS CARRY THE RESERVED PREFIX, and that is not cosmetic. They were `a` and `d`, and a routine's
  // parameters are Rust LOCALS: in `FUNCTION F : INT VAR_INPUT a : INT; b : INT; END_VAR F := b MOD a;` the
  // emitted `let a = b` SHADOWED the parameter `a`, so the very next binding — `let d = a` — read the left
  // operand instead of the right, and `7 MOD 3` compiled to `7 % 7` = 0 where the interpreter answers 1.
  // A silent wrong answer, and one no recorded case caught because no fixture names a parameter `a`.
  //
  // AND `%`, NOT `wrapping_rem`: `MIN MOD -1` stops the task as `MIN / -1` does (6.A.3, x86's `idiv` computes both), and
  // Rust's `%` panics on exactly that overflow where `wrapping_rem` answered 0.
  // …and by a constant lowering proved harmless (`IrBinary.nonzeroDivisor`, 7.2.6) it is plain `%`: no zero to answer
  if (e.op === "mod" && !real && e.nonzeroDivisor === true) return infix(l, "%", r)
  if (e.op === "mod" && !real)
    return printed(`{ let ${tmp("mod_l")} = ${at(l, Prec.Block)}; let ${tmp("mod_r")} = ${at(r, Prec.Block)}; if ${tmp("mod_r")} == 0 { 0 } else { ${tmp("mod_l")} % ${tmp("mod_r")} } }`, Prec.Postfix)
  // INTEGER DIVISION IS NOT WRAPPING. `wrapping_div` returns the minimum for `MIN / -1` and carries on, and
  // CODESYS STOPS THE TASK there (`arithedge_dint_div_min_by_minus_one`, `arithedge_lint_*`). Plain `/` panics
  // on exactly the two cases the vendor stops on — a zero divisor and that one overflow — so it is both the
  // simpler emission and the correct one. `+`, `-` and `*` really do wrap and keep their helpers.
  // …and a product lowering proved fits (`IrBinary.noWrap`, 7.3.10) is plain `*`: nothing to wrap
  if (e.op === "mul" && e.noWrap === true && !real) return infix(l, "*", r)
  if (wrapping !== undefined && !real && e.op !== "div") return printed(`${at(l, Prec.Postfix)}.wrapping_${wrapping}(${at(r, Prec.Block)})`, Prec.Postfix)
  const plain = e.op === "add" ? "+" : e.op === "sub" ? "-" : e.op === "mul" ? "*" : e.op === "div" ? "/" : "%"
  // A REAL DIVISION BY ZERO STOPS THE TASK, and nothing else about an infinity does. This wrapped EVERY real
  // operation in a finiteness check, on the reading that an infinite RESULT is what stops it; `real-overflow.ts`
  // measured `1.0E38 / 1.0E-38` overflowing to `REAL#Infinity` with the scan completing, so the result was
  // never the rule. Rust's `f32`/`f64` division answers `inf` for a zero divisor instead of panicking the way
  // integer division does, so the divisor is checked explicitly — the emitted twin of `arith` in `semantics/arith.ts`.
  // (a constant divisor lowering proved nonzero needs no check: `IrBinary.nonzeroDivisor`, 7.2.6)
  if (real && e.op === "div" && e.nonzeroDivisor !== true) return printed(`${use(p, "iec_div")}(${at(l, Prec.Block)}, ${at(r, Prec.Block)})`, Prec.Postfix)
  return infix(l, plain, r)
}

/**
 * `x >= lo AND x <= hi` (or `< hi`, AND or AND_THEN) over one pure `x` as `(lo..=hi).contains(&x)` — clippy's
 * `manual_range_contains`, which the narrow comparisons (7.3.3) made visible: compared in the operand's own type, the two
 * tests are its bounds. The same answer, a NaN included (every test false, no range holds it); `x` holds no call, so
 * reading it once is reading it twice.
 */
function rangeTest(p: Printer, e: Extract<IrExpr, { kind: "binary" }>, slots: IrPou["slots"]): Printed | undefined {
  if (e.op !== "and" && e.op !== "and_then") return undefined
  const [lo, hi] = [e.left, e.right]
  if (lo.kind !== "binary" || hi.kind !== "binary" || lo.op !== "ge" || (hi.op !== "le" && hi.op !== "lt")) return undefined
  if (lo.right.kind !== "const" || hi.right.kind !== "const" || holdsCall(lo.left) || !sameNode(lo.left, hi.left)) return undefined
  const bound = (c: IrExpr): string => expr(p, c, slots, Prec.Unary)
  return printed(`(${bound(lo.right)}..${hi.op === "le" ? "=" : ""}${bound(hi.right)}).contains(&${expr(p, lo.left, slots, Prec.Unary)})`, Prec.Postfix)
}

/**
 * `r` heading an `if` or a `match`: a block-like value (`if`, `match`, a block not followed by a method call) there would
 * be read as the statement's body, so it is parenthesized — the one position Rust treats specially; anything else bare.
 */
export function head(r: Printed): string {
  if (r.prec === Prec.Block) return `(${r.text})`
  if (!r.text.startsWith("{")) return r.text
  return r.text[closingBrace(r.text) + 1] === "." ? r.text : `(${r.text})`
}

/** Where the brace `text` opens with closes (string literals skipped), or -1. */
function closingBrace(text: string): number {
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      while (++i < text.length && text[i] !== '"') if (text[i] === "\\") i++
      continue
    }
    if (c === "{") depth++
    else if (c === "}" && --depth === 0) return i
  }
  return -1
}
