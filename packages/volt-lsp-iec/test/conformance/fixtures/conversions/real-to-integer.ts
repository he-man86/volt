/**
 * `REAL_TO_<INT>` AND `LREAL_TO_<INT>` FOR EVERY INTEGER TYPE, with every value an integer cannot hold.
 *
 * This is the grid the two oldest divergences sit in. `real_to_dint_below_range` records `LREAL_TO_DINT(-1.0E30)`
 * answering -2147483648 where the model that fits the other four says 0, and `real_to_dint_runtime_below` proved it
 * is not constant folding — the same magnitudes behind arithmetic no compiler can fold give the same answer. Only
 * the SIGN differs between the case that fits the model and the case that does not, and one type was ever asked.
 *
 * So: both real types, all fourteen integer types, five value classes.
 *
 *   above_max   a value past the destination's maximum
 *   below_min   past its minimum — the direction the known divergence is in
 *   nan         `SQRT(-1)`, now known to be an ordinary value that completes a scan
 *   pos_inf     an overflow product, also now known to be ordinary (`operators/real-overflow.ts`)
 *   neg_inf     and its negative
 *
 * EVERY VALUE IS COMPUTED, never written as a literal. `real_to_dint_runtime_below` exists precisely because a
 * folded constant and a runtime value could have answered differently, and proving they do not took a second
 * fixture. Here it is the default: each probe multiplies or subtracts its way to the value in the body.
 *
 * The rule under test is `emit/rust/emit.ts`'s REAL→int model (through a 64-bit register, `i64::MIN` on overflow or
 * NaN, then wrap) and its interpreter twin. Four measurements fit it. This asks a hundred and forty.
 */
import { ELEMENTARY_TYPES } from "../../../../src/types/elementary.js"
import type { LanguageTest } from "../../types.js"

type Klass = "above_max" | "below_min" | "nan" | "pos_inf" | "neg_inf"

/** How the body reaches each value, given `seed` holding 1.0 and `big` holding a large finite number. */
const HOW: Record<Klass, (real: string, over: string) => string> = {
  above_max: (real, over) => `v := ${over};`,
  below_min: (real, over) => `v := 0.0 - (${over});`,
  nan: () => `v := SQRT(0.0 - seed);`,
  pos_inf: () => `v := big * big;`,
  neg_inf: () => `v := 0.0 - (big * big);`,
}

const WHY: Record<Klass, string> = {
  above_max: "a value past the destination's maximum",
  below_min: "a value past the destination's minimum",
  nan: "a NaN",
  pos_inf: "a positive infinity",
  neg_inf: "a negative infinity",
}

function probe(real: string, dest: string, klass: Klass, over: string): LanguageTest {
  const slug = `r2i_${real.toLowerCase()}_to_${dest.toLowerCase()}_${klass}`
  const pou = `FB_LANG_${slug}`
  // `big` is finite in both real widths and squares to an infinity in both.
  const big = real === "REAL" ? "3.0E38" : "1.0E308"
  return {
    name: slug,
    pouName: pou,
    kind: "function_block" as const,
    feature: `${real}_TO_${dest} of ${WHY[klass]}`,
    fromDoc: "06-data-types.md",
    plcPrgVar: `inst : ${pou};`,
    plcPrgBody: "inst();",
    source:
      `FUNCTION_BLOCK ${pou}\nVAR\n\tseed : ${real} := 1.0;\n\tbig : ${real};\n\tv : ${real};\n\tout : ${dest};\nEND_VAR\n` +
      `big := ${big};\n${HOW[klass](real, over)}\nout := ${real}_TO_${dest}(v);\nEND_FUNCTION_BLOCK\n`,
  }
}

/** Every integer and bit-string type — the destinations a real can be converted into. */
const DESTS = [...ELEMENTARY_TYPES.values()].filter(
  (t) => t.range !== undefined && t.name !== "BOOL" && t.name !== "BIT",
)

export const REAL_TO_INTEGER_TESTS: readonly LanguageTest[] = ["REAL", "LREAL"].flatMap((real) =>
  DESTS.flatMap((d) => {
    // A value comfortably past the destination's edge, built from `seed` so nothing folds. The magnitude is the
    // destination's own maximum scaled up, which keeps every probe in its own type's neighbourhood rather than
    // using one huge constant everywhere — an 8-bit destination and a 64-bit one are different questions.
    const over = `seed * ${(Number(d.range!.max) * 4).toExponential(6)}`
    return (["above_max", "below_min", "nan", "pos_inf", "neg_inf"] as Klass[]).map((k) => probe(real, d.name, k, over))
  }),
)
