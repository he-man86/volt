/**
 * `<SRC>_TO_<DST>` FOR EVERY ORDERED PAIR OF INTEGER TYPES, carrying a value the destination may not be able to hold.
 *
 * Conversions are the largest surface in the language and the most ad-hoc part of the fixture set: 92 fixtures
 * mention one, named things like `conversion_int_to_real_valid`, and not one of them is part of a grid. The two
 * oldest divergences lived in this topic until `conversions/real-to-integer.ts` measured its 192 cells; this is the
 * integer half.
 *
 * Two values per ordered pair, both computed by the body so nothing folds:
 *
 *   from_max   the source's maximum. Exact into a wider destination; into a narrower or differently-signed one it
 *              is the question — wrap, saturate, or refuse?
 *   from_min   the source's minimum. Only interesting for a SIGNED source, where it is negative and every unsigned
 *              destination has to do something with it.
 *
 * "Exact into a wider destination" is stated above as the expectation and asked anyway. That is the point: every
 * assumption in this file is one the recording either confirms or kills, and the ones that seemed too obvious to
 * ask are precisely where `BYTE + BYTE is USINT` and `-SINT widens to INT` were hiding.
 */
import { ELEMENTARY_TYPES } from "../../../../src/types/elementary.js"
import type { LanguageTest } from "../../types.js"

/** Every integer and bit-string type — the sources and the destinations alike. */
const INTEGERS = [...ELEMENTARY_TYPES.values()].filter(
  (t) => t.range !== undefined && t.name !== "BOOL" && t.name !== "BIT",
)

function probe(src: string, dst: string, edge: "from_max" | "from_min", literal: string): LanguageTest {
  const slug = `i2i_${src.toLowerCase()}_to_${dst.toLowerCase()}_${edge}`
  const pou = `FB_LANG_${slug}`
  return {
    name: slug,
    pouName: pou,
    kind: "function_block" as const,
    feature: `${src}_TO_${dst} of ${src}'s ${edge === "from_max" ? "maximum" : "minimum"}`,
    fromDoc: "06-data-types.md",
    plcPrgVar: `inst : ${pou};`,
    plcPrgBody: "inst();",
    // `v` is written in the body, not initialized, so the conversion happens at run time.
    source:
      `FUNCTION_BLOCK ${pou}\nVAR\n\tv : ${src};\n\tout : ${dst};\nEND_VAR\n` +
      `v := ${literal};\nout := ${src}_TO_${dst}(v);\nEND_FUNCTION_BLOCK\n`,
  }
}

export const INTEGER_TO_INTEGER_TESTS: readonly LanguageTest[] = INTEGERS.flatMap((src) =>
  INTEGERS.filter((dst) => dst.name !== src.name).flatMap((dst) => {
    const probes = [probe(src.name, dst.name, "from_max", String(src.range!.max))]
    // A minimum of zero asks nothing an unsigned maximum does not already answer.
    if (src.range!.min < 0n) probes.push(probe(src.name, dst.name, "from_min", String(src.range!.min)))
    return probes
  }),
)
