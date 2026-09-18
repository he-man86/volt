/**
 * WHERE EXACTLY DOES A REAL→INT CONVERSION STOP WRAPPING AND START SATURATING? — a magnitude ladder, both signs.
 *
 * `conversions/real-to-integer.ts` asked one magnitude per destination and found something nobody had explained,
 * which is why `real_to_dint_below_range` has sat as a divergence: the behaviour is NOT the same in both directions,
 * and NOT the same at every width.
 *
 *   8- and 16-bit destinations   wrapped, both ways        LREAL_TO_INT(131068) is -4, (-131068) is 4
 *   32-bit destinations          wrapped going UP, saturated going DOWN
 *                                LREAL_TO_DINT(8589935000) is 408 — a plain wrap mod 2^32 —
 *                                but          (-8589935000) is -2147483648, not -408
 *   64-bit destinations          saturated both ways, to 0x8000000000000000
 *
 * One magnitude per direction cannot tell a THRESHOLD from a SIGN RULE. Two readings fit:
 *
 *   (A) below `i32::MIN` the answer is `i32::MIN`, and inside the i64 range going up it wraps
 *   (B) any negative value that does not fit saturates, whatever its size
 *
 * and they differ at `-3000000000`, which is outside i32 but a long way from anything else. So: a ladder of
 * magnitudes on both sides of each of the three interesting widths, from just inside the destination through just
 * outside it, past `i32::MIN`, past `u32::MAX`, and out to where even an i64 cannot hold it.
 *
 * Every value is computed from a seed, never written as a literal — `real_to_dint_runtime_below` exists because a
 * folded constant and a runtime value could have differed, and proving they do not took a second fixture.
 */
import type { LanguageTest } from "../../types.js"

/** A rung: the multiplier applied to a seed of 1.0, and what makes it interesting. */
const RUNGS: readonly [string, string][] = [
  ["1.0E2", "well inside every destination"],
  ["3.2767E4", "just inside INT"],
  ["3.2768E4", "exactly INT's magnitude limit"],
  ["6.5536E4", "one UINT past INT"],
  ["2.147483647E9", "just inside DINT"],
  ["2.147483648E9", "exactly DINT's magnitude limit — i32::MIN going down"],
  ["3.0E9", "outside i32, well short of anything else — where the two readings disagree"],
  ["4.294967296E9", "exactly 2^32"],
  ["8.589935E9", "2^33, the magnitude the first sweep used"],
  ["9.223372036854775E18", "the edge of i64"],
  ["1.0E19", "past i64, inside u64"],
  ["1.0E30", "past u64 entirely — the magnitude `real_to_dint_below_range` records"],
]

function rung(dest: string, mult: string, sign: "pos" | "neg", index: number, why: string): LanguageTest {
  const slug = `r2ilad_${dest.toLowerCase()}_${sign}_${String(index).padStart(2, "0")}`
  const pou = `FB_LANG_${slug}`
  const value = sign === "pos" ? `seed * ${mult}` : `0.0 - (seed * ${mult})`
  return {
    name: slug,
    pouName: pou,
    kind: "function_block" as const,
    feature: `LREAL_TO_${dest} of ${sign === "neg" ? "minus " : ""}${mult} — ${why}`,
    fromDoc: "06-data-types.md",
    plcPrgVar: `inst : ${pou};`,
    plcPrgBody: "inst();",
    source:
      `FUNCTION_BLOCK ${pou}\nVAR\n\tseed : LREAL := 1.0;\n\tv : LREAL;\n\tout : ${dest};\nEND_VAR\n` +
      `v := ${value};\nout := LREAL_TO_${dest}(v);\nEND_FUNCTION_BLOCK\n`,
  }
}

/** INT settles the 16-bit rule, DINT the 32-bit one that matters, LINT the 64-bit end. */
const DESTS = ["INT", "DINT", "LINT"]

export const REAL_TO_INTEGER_LADDER_TESTS: readonly LanguageTest[] = DESTS.flatMap((dest) =>
  RUNGS.flatMap(([mult, why], i) => [rung(dest, mult, "pos", i, why), rung(dest, mult, "neg", i, why)]),
)
