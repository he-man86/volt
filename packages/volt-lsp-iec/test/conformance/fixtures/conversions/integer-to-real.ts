/**
 * INTEGER INTO FLOATING POINT, and WHICH WAY A CONVERSION ROUNDS — the two halves of the numeric-conversion topic
 * that the integer and real grids left open.
 *
 * `conversions/integer-to-integer.ts` settled integer→integer (reinterpret at the destination's width) and
 * `real-to-integer.ts` settled real→integer (saturate at the register's width). Neither says anything about the two
 * directions in between.
 *
 * INTEGER -> REAL LOSES BITS AND NOBODY HAD ASKED WHICH ONES. A REAL carries 24 bits of mantissa and an LREAL 53, so
 * a LINT, a ULINT, a DINT and a UDINT all have values neither can hold exactly. Rounding to nearest is the IEEE
 * default and "the compiler emits a hardware convert" is a guess, not a measurement — `loss_dint_to_real` is the one
 * fixture that ever touched this and it checks a WARNING, not a value.
 *
 * WHICH WAY A CONVERSION ROUNDS is stated in `ir/values.ts` as "half away from zero", sourced from
 * `REAL_TO_TIME(2.5) = 3ms`. One value, one direction, one function — and the alternative that fits it equally well
 * is banker's rounding, which differs at 0.5 and 2.5 and agrees at 1.5. So: 0.5, 1.5, 2.5, 3.5 and their negatives,
 * through both `<REAL>_TO_INT` and `TRUNC`, which should NOT agree — truncation is toward zero by definition, and if
 * the two come back identical then one of them is not doing what its name says.
 *
 * Every value is computed in the body, so a constant folded at compile time cannot answer for the runtime.
 */
import { ELEMENTARY_TYPES } from "../../../../src/types/elementary.js"
import type { LanguageTest } from "../../types.js"

const INTEGERS = [...ELEMENTARY_TYPES.values()].filter(
  (t) => t.range !== undefined && t.name !== "BOOL" && t.name !== "BIT",
)

function probe(slug: string, decls: string, setup: string, expr: string, outType: string, feature: string): LanguageTest {
  const pou = `FB_LANG_${slug}`
  return {
    name: slug,
    pouName: pou,
    kind: "function_block" as const,
    feature,
    fromDoc: "06-data-types.md",
    plcPrgVar: `inst : ${pou};`,
    plcPrgBody: "inst();",
    source:
      `FUNCTION_BLOCK ${pou}\nVAR\n${decls}\n\tout : ${outType};\nEND_VAR\n${setup}\nout := ${expr};\nEND_FUNCTION_BLOCK\n`,
  }
}

/** Each integer type's extremes into both floating widths — where the mantissa runs out. */
const widening: LanguageTest[] = INTEGERS.flatMap((src) =>
  ["REAL", "LREAL"].flatMap((real) =>
    (src.range!.min < 0n ? ["max", "min"] : ["max"]).map((edge) =>
      probe(
        `i2r_${src.name.toLowerCase()}_to_${real.toLowerCase()}_${edge}`,
        `\tv : ${src.name};`,
        `v := ${edge === "max" ? src.range!.max : src.range!.min};`,
        `${src.name}_TO_${real}(v)`,
        real,
        `${src.name}_TO_${real} of its ${edge === "max" ? "maximum" : "minimum"} — ${real} holds ${real === "REAL" ? 24 : 53} bits of mantissa`,
      ),
    ),
  ),
)

/** The halves, where "half away from zero" and "half to even" disagree — plus a pair that pins neither. */
const HALVES: readonly [string, string][] = [
  ["0.5", "half_pos_0"],
  ["1.5", "half_pos_1"],
  ["2.5", "half_pos_2"],
  ["3.5", "half_pos_3"],
  ["-0.5", "half_neg_0"],
  ["-1.5", "half_neg_1"],
  ["-2.5", "half_neg_2"],
  ["-3.5", "half_neg_3"],
  ["0.49", "below_half"],
  ["0.51", "above_half"],
  ["-0.49", "neg_below_half"],
  ["-0.51", "neg_above_half"],
]

const rounding: LanguageTest[] = ["REAL", "LREAL"].flatMap((real) =>
  HALVES.flatMap(([value, slug]) => [
    probe(
      `round_${real.toLowerCase()}_to_int_${slug}`,
      `\tseed : ${real} := 1.0;\n\tv : ${real};`,
      `v := seed * ${value};`,
      `${real}_TO_INT(v)`,
      "INT",
      `${real}_TO_INT(${value}) — half away from zero, or half to even?`,
    ),
    probe(
      `round_${real.toLowerCase()}_trunc_${slug}`,
      `\tseed : ${real} := 1.0;\n\tv : ${real};`,
      `v := seed * ${value};`,
      "TRUNC(v)",
      "DINT",
      `TRUNC(${value}) as a ${real} — toward zero, if the name means what it says`,
    ),
  ]),
)

export const INTEGER_TO_REAL_TESTS: readonly LanguageTest[] = [...widening, ...rounding]
