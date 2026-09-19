/**
 * WHAT ORDERS TWO STRINGS — the cells `string_max` and its three neighbours leave open.
 *
 * Those four say MAX('abc','abd') is 'abd', MIN is 'abc', MAX('abc','ABC') is 'abc' and LIMIT picks the middle —
 * all of which a plain byte-by-byte comparison explains, and so does half a dozen other orders. Lowering MAX over
 * a STRING on that much would have been fitting, so `transpile/lower` refused it as `value-string-order` until
 * these answered. ANSWERED 2026-09-19, and the refusal is gone: UNSIGNED, byte by byte, a prefix losing.
 *
 * The cells that actually separate the candidates:
 *
 *   PREFIX      'ab' against 'abc' — does the shorter one lose, or does LENGTH come first?
 *   EMPTY       '' against 'a' — the prefix question at its limit
 *   HIGH BYTE   '$FF' against 'a' — SIGNED bytes make 0xFF negative and 'a' the winner, UNSIGNED the reverse
 *   TWO HIGH    '$FE' against '$FF' — the same question without an ASCII byte to hide behind
 *   LENGTH      'b' against 'abc' — a shorter string whose FIRST byte is larger
 *   EQUAL       'abc' against 'abc' — MAX of two equal strings has nothing to choose, and must still answer
 *
 * Each is asked of MAX and of `<`, because an order for the FUNCTION and an order for the OPERATOR need not be
 * the same thing — that is why `string_compare_operators` exists beside `string_max`.
 */
import type { LanguageTest } from "../../types.js"

function probe(slug: string, decls: string, body: string, feature: string): LanguageTest {
  const pou = `FB_LANG_${slug}`
  return {
    name: slug,
    pouName: pou,
    kind: "function_block" as const,
    feature,
    fromDoc: "string-order",
    plcPrgVar: `inst : ${pou};`,
    plcPrgBody: "inst();",
    source: `FUNCTION_BLOCK ${pou}\nVAR\n${decls}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n`,
  }
}

/** One pair, asked twice: which one MAX returns, and which way `<` answers. */
function pair(slug: string, left: string, right: string, feature: string): LanguageTest[] {
  const decls = `\ta : STRING := '${left}';\n\tb : STRING := '${right}';\n\tbigger : STRING;\n\tsmaller : STRING;\n\tlessThan : BOOL;\n\tgreaterThan : BOOL;\n\tequal : BOOL;`
  return [
    probe(
      `strord_${slug}`,
      decls,
      "bigger := MAX(a, b);\nsmaller := MIN(a, b);\nlessThan := a < b;\ngreaterThan := a > b;\nequal := a = b;",
      `'${left}' against '${right}' — ${feature}`,
    ),
  ]
}

/**
 * And ONE more question the pairs above cannot ask, because they declare both operands the same width: what
 * CAPACITY does MAX answer with when the two differ? `commonType` keeps the FIRST operand's, which would cut
 * 'abc' back to 'ab' — a wrong answer rather than a refusal, so it is measured rather than reasoned about.
 */
const capacity: LanguageTest[] = [
  probe(
    "strord_capacity_shorter_first",
    "\ta : STRING(2) := 'ab';\n\tb : STRING(8) := 'abc';\n\tbigger : STRING;\n\tsize : INT;",
    "bigger := MAX(a, b);\nsize := LEN(bigger);",
    "MAX of a STRING(2) and a STRING(8) — which capacity does the result have?",
  ),
  probe(
    "strord_capacity_longer_first",
    "\ta : STRING(8) := 'abc';\n\tb : STRING(2) := 'ab';\n\tbigger : STRING;\n\tsize : INT;",
    "bigger := MAX(a, b);\nsize := LEN(bigger);",
    "the same pair the other way round, so ORDER is held separate from WIDTH",
  ),
]

export const STRING_ORDER_TESTS: readonly LanguageTest[] = [
  ...pair("prefix", "ab", "abc", "the shorter string is a PREFIX of the longer"),
  ...pair("empty", "", "a", "the prefix question at its limit"),
  ...pair("high_byte", "$FF", "a", "a high byte against an ASCII one — signed or unsigned?"),
  ...pair("two_high", "$FE", "$FF", "two high bytes, with no ASCII byte to hide behind"),
  ...pair("length_vs_first", "b", "abc", "a SHORTER string whose first byte is larger"),
  ...pair("equal", "abc", "abc", "two equal strings — MAX must still answer with one of them"),
  ...capacity,
]
