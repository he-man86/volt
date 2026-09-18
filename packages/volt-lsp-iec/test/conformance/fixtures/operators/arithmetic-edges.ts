/**
 * EVERY INTEGER TYPE, PUSHED OVER ITS OWN EDGE AT RUN TIME — and divided by a zero, and by minus one.
 *
 * `types/primitive-bounds.ts` asked what a DECLARATION does at the edge, which the compiler answers by folding. This
 * asks what the RUNNING PROGRAM does, which is a different question with a different answer: `x : SINT := 128` is a
 * constant conversion CODESYS performs at compile time, while `x := max; out := x + 1` reaches the CPU.
 *
 * Six cases per type, and the arithmetic-width rule makes each of them a real question rather than an obvious one.
 * `arith.ts` says an operand narrower than 32 bits computes in DINT, so `SINT#127 + 1` is 128 as a DINT and only
 * becomes -128 when it is STORED. Which means:
 *
 *   add_over / sub_under / mul_over   does the store wrap, and at the SLOT's width or the promoted one?
 *   div_by_zero                       stops the task, for every width and signedness (measured for two so far)
 *   mod_by_zero                       `mod_by_zero` says 0 for the types it asked; the rest are assumed
 *   div_min_by_minus_one              the classic trap: -128 / -1 is 128, which a SINT cannot hold. Rust PANICS on
 *                                     this one in debug, so whatever CODESYS does, the emitter has to match it
 *                                     deliberately rather than inherit a panic.
 *
 * Nothing is folded: every operand comes from a variable the body wrote in an earlier statement.
 */
import { ELEMENTARY_TYPES } from "../../../../src/types/elementary.js"
import type { LanguageTest } from "../../types.js"

function edge(type: string, kind: string, decls: string, body: string, feature: string): LanguageTest {
  const slug = `arithedge_${type.toLowerCase()}_${kind}`
  const pou = `FB_LANG_${slug}`
  return {
    name: slug,
    pouName: pou,
    kind: "function_block" as const,
    feature,
    fromDoc: "05-operators.md",
    plcPrgVar: `inst : ${pou};`,
    plcPrgBody: "inst();",
    source: `FUNCTION_BLOCK ${pou}\nVAR\n${decls}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n`,
  }
}

/** The integer and bit-string types — every type with an exact range, minus BOOL and BIT which cannot do arithmetic. */
const INTEGERS = [...ELEMENTARY_TYPES.values()].filter(
  (t) => t.range !== undefined && t.name !== "BOOL" && t.name !== "BIT",
)

export const ARITHMETIC_EDGE_TESTS: readonly LanguageTest[] = INTEGERS.flatMap((t) => {
  const { min, max } = t.range!
  const v = `\tx : ${t.name};\n\tout : ${t.name};`
  const withZero = `\tx : ${t.name};\n\tz : ${t.name};\n\tout : ${t.name};`
  const cases: LanguageTest[] = [
    edge(t.name, "add_over", v, `x := ${max};\nout := x + 1;`, `${t.name} at its maximum, plus one, at run time`),
    edge(t.name, "sub_under", v, `x := ${min};\nout := x - 1;`, `${t.name} at its minimum, minus one, at run time`),
    edge(t.name, "mul_over", v, `x := ${max};\nout := x * 2;`, `${t.name} at its maximum, doubled, at run time`),
    edge(
      t.name,
      "div_by_zero",
      withZero,
      `x := ${max};\nz := x - x;\nout := x / z;`,
      `${t.name} divided by a zero the body computed`,
    ),
    edge(
      t.name,
      "mod_by_zero",
      withZero,
      `x := ${max};\nz := x - x;\nout := x MOD z;`,
      `${t.name} modulo a zero the body computed`,
    ),
  ]
  // `min / -1` only asks something where the minimum HAS no positive counterpart, which is the signed types.
  if (t.signed)
    cases.push(
      edge(
        t.name,
        "div_min_by_minus_one",
        `\tx : ${t.name};\n\td : ${t.name};\n\tout : ${t.name};`,
        `x := ${min};\nd := 0 - 1;\nout := x / d;`,
        `${t.name} at its minimum divided by minus one — the result does not fit the type`,
      ),
    )
  return cases
})
