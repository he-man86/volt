/**
 * THE SIX COMPARISON OPERATORS, where comparing is not obvious: across signedness, and on the values a REAL can
 * hold that are not numbers.
 *
 * `same_width_mixed_sign_order` is the one fixture that ever asked a cross-signedness comparison, and it was written
 * because the answer had been WRONG: the meet let the left operand win, so `u > d` compared in UDINT. One pair, one
 * operator, one width. The rule it proved — that the two sides meet in the SIGNED type, so `UDINT#4294967295` and
 * `DINT#-1` are the same bits and compare EQUAL — has consequences at every width for all six operators, and none of
 * them were checked.
 *
 * And a REAL now has two kinds of value that break the usual laws, both of which turned out to be reachable:
 *
 *   a NaN is not equal to itself, and is neither less than nor greater than anything — so `<=` and `>=` are FALSE
 *   where a naive `NOT (a > b)` would say true;
 *   an infinity compares as an ordinary extreme.
 *
 * `operators/real-overflow.ts` proved both are ordinary values that a scan can produce and carry, so a program can
 * reach these comparisons without doing anything strange. Nothing here has been asked before.
 *
 * Each probe reads a BOOL, so the answer is the value itself rather than a refusal message.
 */
import type { LanguageTest } from "../../types.js"

const OPS: readonly [string, string][] = [
  ["=", "eq"],
  ["<>", "ne"],
  ["<", "lt"],
  [">", "gt"],
  ["<=", "le"],
  [">=", "ge"],
]

function probe(slug: string, decls: string, setup: string, expr: string, feature: string): LanguageTest {
  const pou = `FB_LANG_${slug}`
  return {
    name: slug,
    pouName: pou,
    kind: "function_block" as const,
    feature,
    fromDoc: "05-operators.md",
    plcPrgVar: `inst : ${pou};`,
    plcPrgBody: "inst();",
    source:
      `FUNCTION_BLOCK ${pou}\nVAR\n${decls}\n\tout : BOOL;\nEND_VAR\n${setup}\nout := ${expr};\nEND_FUNCTION_BLOCK\n`,
  }
}

/** The four signed/unsigned pairs, with the unsigned side holding the value whose bits are the signed -1. */
const SIGN_PAIRS: readonly [string, string, string][] = [
  ["SINT", "USINT", "255"],
  ["INT", "UINT", "65535"],
  ["DINT", "UDINT", "4294967295"],
  ["LINT", "ULINT", "18446744073709551615"],
]

const crossSign: LanguageTest[] = SIGN_PAIRS.flatMap(([s, u, max]) =>
  OPS.map(([op, name]) =>
    probe(
      `cmp_sign_${s.toLowerCase()}_${name}`,
      `\ta : ${s};\n\tb : ${u};`,
      `a := 0 - 1;\nb := ${max};`,
      `a ${op} b`,
      `${s} -1 ${op} ${u} ${max} — the same bits; do they meet in the signed type?`,
    ),
  ),
)

/** A NaN and an infinity, both produced at run time so nothing folds. */
const realSpecial: LanguageTest[] = [
  ...OPS.map(([op, name]) =>
    probe(
      `cmp_nan_self_${name}`,
      "\tseed : LREAL := 1.0;\n\tn : LREAL;",
      "n := SQRT(0.0 - seed);",
      `n ${op} n`,
      `a NaN ${op} itself`,
    ),
  ),
  ...OPS.map(([op, name]) =>
    probe(
      `cmp_nan_number_${name}`,
      "\tseed : LREAL := 1.0;\n\tn : LREAL;",
      "n := SQRT(0.0 - seed);",
      `n ${op} seed`,
      `a NaN ${op} 1.0`,
    ),
  ),
  ...OPS.map(([op, name]) =>
    probe(
      `cmp_inf_number_${name}`,
      "\tseed : LREAL := 1.0;\n\tbig : LREAL;\n\tn : LREAL;",
      "big := 1.0E308;\nn := big * big;",
      `n ${op} seed`,
      `an infinity ${op} 1.0`,
    ),
  ),
  probe(
    "cmp_inf_self_eq",
    "\tbig : LREAL;\n\tn : LREAL;\n\tm : LREAL;",
    "big := 1.0E308;\nn := big * big;\nm := big * big;",
    "n = m",
    "two infinities from different computations — equal?",
  ),
  probe(
    "cmp_negzero_eq_zero",
    "\tseed : LREAL := 1.0;\n\tz : LREAL;\n\tnz : LREAL;",
    "z := seed - seed;\nnz := 0.0 - z;",
    "z = nz",
    "negative zero equals positive zero — IEEE says yes, and nothing had asked",
  ),
]

/** Every integer type's own minimum against its own maximum — the baseline each cross-type answer is read against. */
// The signed minima are written as LITERALS, not as `0 - 128`. That form was tried and CODESYS refuses it —
// "Cannot convert type 'INT' to type 'SINT'" — because `0 - 128` is an INT EXPRESSION and an implicit narrowing is
// not allowed even though -128 is perfectly in range for a SINT. A real fact, recorded by `types/primitive-bounds.ts`
// where it belongs; here it was only getting in the way of the question being asked.
const SELF_BOUNDS: readonly [string, string, string][] = [
  ["SINT", "-128", "127"],
  ["INT", "-32768", "32767"],
  ["DINT", "-2147483648", "2147483647"],
  ["LINT", "-9223372036854775808", "9223372036854775807"],
  ["USINT", "0", "255"],
  ["UINT", "0", "65535"],
  ["UDINT", "0", "4294967295"],
  ["ULINT", "0", "18446744073709551615"],
  ["BYTE", "0", "255"],
  ["WORD", "0", "65535"],
  ["DWORD", "0", "4294967295"],
  ["LWORD", "0", "18446744073709551615"],
]

const selfBounds: LanguageTest[] = SELF_BOUNDS.map(([t, min, max]) =>
  probe(
    `cmp_self_${t.toLowerCase()}_lt`,
    `\ta : ${t};\n\tb : ${t};`,
    `a := ${min};\nb := ${max};`,
    "a < b",
    `${t} minimum < ${t} maximum — the baseline`,
  ),
)

export const COMPARISON_TESTS: readonly LanguageTest[] = [...crossSign, ...realSpecial, ...selfBounds]
