/**
 * `AND` / `OR` / `XOR` PER TYPE, AND THE FOUR SHIFTS — including the shift count nobody asks about until it bites.
 *
 * Neither had ever been asked per type. `AND`, `OR` and `XOR` appear in fixtures as BOOL logic and in a handful of
 * bit-string cases; `SHL`, `SHR`, `ROL` and `ROR` appear at all only in passing. The interesting cells are:
 *
 *   THE SAME OPERATOR ON A BOOL AND ON AN INTEGER. `logic` in `ir/values.ts` branches on the operand type —
 *   boolean on BOOLs, bitwise on integers — which is right for IEC and worth having recorded per type rather than
 *   per branch.
 *
 *   A SHIFT COUNT AT OR PAST THE OPERAND'S WIDTH. `SHL(x, 32)` on a DWORD is where C leaves it undefined, Rust
 *   PANICS in debug, and x86 silently masks the count to 5 bits — three different answers from three layers we
 *   emit through, and no recording said which one the vendor gives. A count of 0, 1, W-1, W and W+1 pins it.
 *
 *   ROTATE VERSUS SHIFT at the same counts, since a rotate has no "past the width" at all — it wraps by
 *   definition — so if the two disagree about a count of W, the masking theory is the one that survives.
 *
 * Every operand is written by the body, so nothing folds.
 */
import type { LanguageTest } from "../../types.js"

function probe(slug: string, decls: string, setup: string, expr: string, outType: string, feature: string): LanguageTest {
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
      `FUNCTION_BLOCK ${pou}\nVAR\n${decls}\n\tout : ${outType};\nEND_VAR\n${setup}\nout := ${expr};\nEND_FUNCTION_BLOCK\n`,
  }
}

/** Bit patterns chosen so each operator gives a different answer: 12 AND 10 = 8, OR = 14, XOR = 6. */
const LOGIC_TYPES = ["BYTE", "WORD", "DWORD", "LWORD", "SINT", "INT", "DINT", "LINT", "USINT", "UINT", "UDINT", "ULINT"]

const logic: LanguageTest[] = LOGIC_TYPES.flatMap((t) =>
  (["AND", "OR", "XOR"] as const).map((op) =>
    probe(
      `bit_${op.toLowerCase()}_${t.toLowerCase()}`,
      `\ta : ${t};\n\tb : ${t};`,
      "a := 12;\nb := 10;",
      `a ${op} b`,
      t,
      `${t} 12 ${op} 10 — bitwise on an integer, not boolean`,
    ),
  ),
)

/** The BOOL forms of the same three operators — the other branch of `logic`. */
const boolLogic: LanguageTest[] = (["AND", "OR", "XOR"] as const).map((op) =>
  probe(
    `bit_${op.toLowerCase()}_bool`,
    "\ta : BOOL;\n\tb : BOOL;",
    "a := TRUE;\nb := FALSE;",
    `a ${op} b`,
    "BOOL",
    `BOOL TRUE ${op} FALSE — boolean, not bitwise`,
  ),
)

/** Width of each shiftable type, for the counts that matter. */
const SHIFT_TYPES: readonly [string, number][] = [
  ["BYTE", 8],
  ["WORD", 16],
  ["DWORD", 32],
  ["LWORD", 64],
]

const shifts: LanguageTest[] = SHIFT_TYPES.flatMap(([t, w]) =>
  (["SHL", "SHR", "ROL", "ROR"] as const).flatMap((op) =>
    [0, 1, w - 1, w, w + 1].map((count) =>
      probe(
        `bit_${op.toLowerCase()}_${t.toLowerCase()}_${count}`,
        `\ta : ${t};\n\tn : USINT;`,
        // A pattern with a bit at each end, so a shift in either direction is visible, and the count in a variable
        // so the compiler cannot fold the call away.
        `a := 129;\nn := ${count};`,
        `${op}(a, n)`,
        t,
        `${op} a ${t} by ${count}${count === w ? " — exactly its width" : count === w + 1 ? " — one past its width" : ""}`,
      ),
    ),
  ),
)

export const BITWISE_TESTS: readonly LanguageTest[] = [...logic, ...boolLogic, ...shifts]
