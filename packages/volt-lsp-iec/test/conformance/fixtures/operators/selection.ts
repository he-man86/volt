/**
 * `MIN`, `MAX`, `LIMIT`, `SEL` and `MUX` — per type, and at the edges where each one has a real question.
 *
 * These have fixtures (`max_*`, `limit_*`, `sel_basic`) and the rules in `lower/builtins.ts` say they are measured,
 * which they are — for the handful of cases somebody wrote. The edges are not:
 *
 *   MIN / MAX   per type at its own extremes, where the answer has to survive the promotion to DINT that
 *               `arith.ts` describes; and across two types, where the meet decides what comes back.
 *   LIMIT       with the value below, inside and above; and with the bounds INVERTED, which is the one
 *               `limit_inverted_bounds` asks and where "clamp" has no obvious meaning.
 *   SEL         both branches, and whether the branch NOT taken is evaluated — a call in the unused arm is the
 *               difference between a selection and a conditional.
 *   MUX         index 0, index 1, the LAST index, and PAST the last. The out-of-range index is the cell: a
 *               selection with no answer has to do something, and nothing recorded says what.
 *
 * Every operand is written by the body, so nothing folds and `SEL`'s unused arm is a real runtime question.
 */
import { ELEMENTARY_TYPES } from "../../../../src/types/elementary.js"
import type { LanguageTest } from "../../types.js"

const INTEGERS = [...ELEMENTARY_TYPES.values()].filter(
  (t) => t.range !== undefined && t.name !== "BOOL" && t.name !== "BIT",
)

/** The vendor's verdict where a probe is refused — the STRING destination is the trick, so the quoted type is
 *  the answer. MIN and MAX meet exactly as a binary operator does. */
const REFUSED: Readonly<Record<string, string>> = {
  sel_max_byte_sint: "Cannot convert type 'SINT' to type 'STRING'",
  sel_max_dint_udint: "Cannot convert type 'DINT' to type 'STRING'",
  sel_max_int_real: "Cannot convert type 'REAL' to type 'STRING'",
  sel_max_int_uint: "Cannot convert type 'INT' to type 'STRING'",
  sel_max_lint_real: "Cannot convert type 'REAL' to type 'STRING'",
  sel_max_sint_dint: "Cannot convert type 'DINT' to type 'STRING'",
  sel_min_byte_sint: "Cannot convert type 'SINT' to type 'STRING'",
  sel_min_dint_udint: "Cannot convert type 'DINT' to type 'STRING'",
  sel_min_int_real: "Cannot convert type 'REAL' to type 'STRING'",
  sel_min_int_uint: "Cannot convert type 'INT' to type 'STRING'",
  sel_min_lint_real: "Cannot convert type 'REAL' to type 'STRING'",
  sel_min_sint_dint: "Cannot convert type 'DINT' to type 'STRING'",
}

function probe(slug: string, decls: string, setup: string, expr: string, outType: string, feature: string): LanguageTest {
  const pou = `FB_LANG_${slug}`
  return {
    name: slug,
    pouName: pou,
    kind: "function_block" as const,
    feature,
    fromDoc: "05-operators.md",
    ...(REFUSED[slug] !== undefined ? { refused: REFUSED[slug]! } : {}),
    plcPrgVar: `inst : ${pou};`,
    plcPrgBody: "inst();",
    source:
      `FUNCTION_BLOCK ${pou}\nVAR\n${decls}\n\tout : ${outType};\nEND_VAR\n${setup}\nout := ${expr};\nEND_FUNCTION_BLOCK\n`,
  }
}

/** MIN and MAX of a type's own extremes — the answer must come back in that type, not the promoted one. */
const minmax: LanguageTest[] = INTEGERS.flatMap((t) =>
  (["MIN", "MAX"] as const).map((fn) =>
    probe(
      `sel_${fn.toLowerCase()}_${t.name.toLowerCase()}`,
      `\ta : ${t.name};\n\tb : ${t.name};`,
      `a := ${t.range!.min};\nb := ${t.range!.max};`,
      `${fn}(a, b)`,
      t.name,
      `${fn} of ${t.name}'s minimum and maximum`,
    ),
  ),
)

/** MIN and MAX across two types — the meet decides the result, exactly as a binary operator's does. */
const MIXED: readonly [string, string][] = [
  ["INT", "UINT"],
  ["DINT", "UDINT"],
  ["SINT", "DINT"],
  ["INT", "REAL"],
  ["LINT", "REAL"],
  ["BYTE", "SINT"],
]
const minmaxMixed: LanguageTest[] = MIXED.flatMap(([l, r]) =>
  (["MIN", "MAX"] as const).map((fn) =>
    probe(
      `sel_${fn.toLowerCase()}_${l.toLowerCase()}_${r.toLowerCase()}`,
      `\ta : ${l};\n\tb : ${r};`,
      "a := 6;\nb := 3;",
      `${fn}(a, b)`,
      "STRING",
      `${fn}(${l}, ${r}) into a STRING — the compiler names the type it came back as`,
    ),
  ),
)

const limits: LanguageTest[] = [
  ["below", "1"],
  ["inside", "5"],
  ["above", "9"],
].map(([slug, v]) =>
  probe(
    `sel_limit_${slug}`,
    "\tlo : INT;\n\thi : INT;\n\tv : INT;",
    `lo := 3;\nhi := 7;\nv := ${v};`,
    "LIMIT(lo, v, hi)",
    "INT",
    `LIMIT(3, ${v}, 7) — the value ${slug} the bounds`,
  ),
)

const inverted: LanguageTest[] = [
  ["below", "1"],
  ["between", "5"],
  ["above", "9"],
].map(([slug, v]) =>
  probe(
    `sel_limit_inverted_${slug}`,
    "\tlo : INT;\n\thi : INT;\n\tv : INT;",
    `lo := 7;\nhi := 3;\nv := ${v};`,
    "LIMIT(lo, v, hi)",
    "INT",
    `LIMIT(7, ${v}, 3) — bounds the wrong way round, where "clamp" means nothing obvious`,
  ),
)

const selects: LanguageTest[] = [
  probe("sel_sel_false", "\tg : BOOL;\n\ta : INT;\n\tb : INT;", "g := FALSE;\na := 11;\nb := 22;", "SEL(g, a, b)", "INT", "SEL with a FALSE selector takes the first"),
  probe("sel_sel_true", "\tg : BOOL;\n\ta : INT;\n\tb : INT;", "g := TRUE;\na := 11;\nb := 22;", "SEL(g, a, b)", "INT", "SEL with a TRUE selector takes the second"),
]

/** MUX at every index that means something, and one that does not. */
const muxes: LanguageTest[] = [0, 1, 2, 3, 7].map((i) =>
  probe(
    `sel_mux_${i}`,
    "\tk : INT;\n\ta : INT;\n\tb : INT;\n\tc : INT;",
    `k := ${i};\na := 10;\nb := 20;\nc := 30;`,
    "MUX(k, a, b, c)",
    "INT",
    i < 3 ? `MUX index ${i} of three inputs` : `MUX index ${i} — PAST the last input, which has no answer`,
  ),
)

export const SELECTION_TESTS: readonly LanguageTest[] = [
  ...minmax,
  ...minmaxMixed,
  ...limits,
  ...inverted,
  ...selects,
  ...muxes,
]
