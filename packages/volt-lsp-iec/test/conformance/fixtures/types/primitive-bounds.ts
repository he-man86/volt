/**
 * THE EDGE OF EVERY NUMERIC PRIMITIVE — at the minimum, at the maximum, and one step past each.
 *
 * `operators/overflow.ts` asked this for INT, SINT, BYTE and WORD, which is four of the sixteen numeric types and
 * only ever the TOP end. DWORD, LWORD, DINT, LINT, USINT, UDINT, ULINT, BOOL, BIT, REAL and LREAL had never been
 * asked at all, and nothing had asked what happens BELOW a minimum except one hand-written `si := -129`.
 *
 * Four cases per type, and all four matter for a different reason:
 *
 *   at min / at max     the boundary must be ACCEPTED. A rejection here means our range is wrong, which is why
 *                       these are worth recording even though "of course it compiles".
 *   below min / above max   the boundary must be REFUSED, and the vendor's exact wording is the thing we cannot
 *                       guess — `cc_fp_overflow_untyped` already proved an over-max literal is a conversion
 *                       WARNING in one shape and a hard error in another.
 *
 * THE LITERALS ARE GENERATED FROM `ELEMENTARY_TYPES`, not hand-typed. Sixty-four hand-typed boundary constants is
 * sixty-four chances to typo one, and a typo'd boundary quietly asks a different question. It is also self-checking:
 * if our range for a type is wrong, the "at max" case is REJECTED by CODESYS and says so.
 *
 * BOOL and BIT are included on purpose. `x : BOOL := 0` and `:= 2` are ordinary questions with non-obvious answers —
 * does the vendor take an integer literal for a boolean at all, and where is its edge.
 */
import { ELEMENTARY_TYPES, REAL_MAX_MAGNITUDE } from "../../../../src/types/elementary.js"
import type { LanguageTest } from "../../types.js"

type Edge = "at_min" | "at_max" | "below_min" | "above_max"

const WHY: Record<Edge, string> = {
  at_min: "exactly the minimum — must be accepted",
  at_max: "exactly the maximum — must be accepted",
  below_min: "one below the minimum",
  above_max: "one above the maximum",
}

function bound(type: string, edge: Edge, literal: string): LanguageTest {
  const slug = `bound_${type.toLowerCase()}_${edge}`
  const pou = `FB_LANG_${slug}`
  return {
    name: slug,
    pouName: pou,
    kind: "function_block" as const,
    feature: `${type} := ${literal} — ${WHY[edge]}`,
    fromDoc: "06-data-types.md",
    plcPrgVar: `inst : ${pou};`,
    plcPrgBody: "inst();",
    source: `FUNCTION_BLOCK ${pou}\nVAR\n\tx : ${type} := ${literal};\nEND_VAR\n\nEND_FUNCTION_BLOCK\n`,
  }
}

/** Every type the table gives an exact integer range for, in declaration order. */
const RANGED = [...ELEMENTARY_TYPES.values()].filter((t) => t.range !== undefined)

const integerBounds: LanguageTest[] = RANGED.flatMap((t) => {
  const { min, max } = t.range!
  return [
    bound(t.name, "at_min", String(min)),
    bound(t.name, "at_max", String(max)),
    bound(t.name, "below_min", String(min - 1n)),
    bound(t.name, "above_max", String(max + 1n)),
  ]
})

/**
 * The floating types have no exact bigint range, so the edge is a MAGNITUDE. "One past" is not defined for a float
 * either — the next representable value is not a literal anyone writes — so these use a value clearly outside the
 * documented largest, in both directions, and the recording says whether that is an error or a conversion warning.
 */
const realBounds: LanguageTest[] = [...REAL_MAX_MAGNITUDE].flatMap(([type, largest]) => [
  bound(type, "at_max", String(largest)),
  bound(type, "at_min", `-${largest}`),
  bound(type, "above_max", type === "REAL" ? "3.5E38" : "1.8E308"),
  bound(type, "below_min", type === "REAL" ? "-3.5E38" : "-1.8E308"),
])

export const PRIMITIVE_BOUNDS_TESTS: readonly LanguageTest[] = [...integerBounds, ...realBounds]
