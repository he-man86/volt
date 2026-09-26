/**
 * THE STANDARD STRING FUNCTIONS AT THEIR EDGES — position 0, position past the end, a negative count, an empty
 * string, and a result too long for where it is going.
 *
 * `ir/values.ts` states the rules and sources them from `string_*` and `string_positions_*`: positions are
 * 1-based, a count clamps to the string, `LEFT('abc', 5)` is 'abc' and `LEFT('abc', -1)` is '', `MID` and `DELETE`
 * select nothing below position 1 or at a length of zero or less, `INSERT` at 0 prepends. That is a real set of
 * measurements — and it is one or two cases per function, chosen by whoever wrote them.
 *
 * Nine functions, each asked at every edge it has:
 *
 *   LEN       empty, one character, and a string holding escapes — where `string_high_byte_escape` already
 *             diverges, because a CODESYS STRING is UTF-8 BYTES and LEN counts them
 *   LEFT      RIGHT   count 0, 1, exactly the length, past it, and negative
 *   MID       position 0, 1, the last, past the end; length 0, negative, longer than what remains
 *   CONCAT    an empty side, and a result longer than the destination can hold
 *   INSERT    at 0, at 1, at the end, past the end
 *   DELETE    at 0, at 1, past the end; length 0 and longer than what remains
 *   REPLACE   a replacement longer and shorter than what it replaces, and at position 0
 *   FIND      present, absent, empty needle, needle longer than the haystack
 *
 * The operands are written by the body, so a constant folded at compile time cannot stand in for the runtime.
 *
 * The haystack is `text` and not `s`: `S` is an IL operator and CODESYS refuses it as a variable name outright —
 * `Unexpected token 's'`, `docs/reserved-il-operators.md`. Thirteen fixtures were once written that way and recorded
 * a parse error in place of an answer, which is a trap this file walked straight into before renaming.
 */
import type { LanguageTest } from "../../types.js"

function probe(slug: string, expr: string, outType: string, feature: string, decls = ""): LanguageTest {
  const pou = `FB_LANG_${slug}`
  return {
    name: slug,
    pouName: pou,
    kind: "function_block" as const,
    feature,
    fromDoc: "06-data-types.md#string",
    plcPrgVar: `inst : ${pou};`,
    plcPrgBody: "inst();",
    source:
      `FUNCTION_BLOCK ${pou}\nVAR\n\ttext : STRING;\n\tins : STRING;${decls}\n\tout : ${outType};\nEND_VAR\n` +
      `text := 'abcde';\nins := 'XY';\nout := ${expr};\nEND_FUNCTION_BLOCK\n`,
  }
}

const COUNTS: readonly [string, string][] = [
  ["0", "zero"],
  ["1", "one"],
  ["5", "exactly_the_length"],
  ["9", "past_the_end"],
  ["-1", "negative"],
]

const lefts: LanguageTest[] = COUNTS.flatMap(([n, slug]) => [
  probe(`str_left_${slug}`, `LEFT(text, ${n})`, "STRING", `LEFT('abcde', ${n})`),
  probe(`str_right_${slug}`, `RIGHT(text, ${n})`, "STRING", `RIGHT('abcde', ${n})`),
])

const POSITIONS: readonly [string, string][] = [
  ["0", "at_zero"],
  ["1", "at_one"],
  ["5", "at_the_last"],
  ["9", "past_the_end"],
]

const mids: LanguageTest[] = POSITIONS.flatMap(([p, slug]) => [
  probe(`str_mid_${slug}`, `MID(text, 2, ${p})`, "STRING", `MID('abcde', 2, ${p}) — two characters from ${p}`),
  probe(`str_mid_len0_${slug}`, `MID(text, 0, ${p})`, "STRING", `MID('abcde', 0, ${p}) — a length of zero`),
  probe(`str_mid_lenneg_${slug}`, `MID(text, -1, ${p})`, "STRING", `MID('abcde', -1, ${p}) — a negative length`),
  probe(`str_delete_${slug}`, `DELETE(text, 2, ${p})`, "STRING", `DELETE('abcde', 2, ${p})`),
  probe(`str_insert_${slug}`, `INSERT(text, ins, ${p})`, "STRING", `INSERT('abcde', 'XY', ${p})`),
  probe(`str_replace_${slug}`, `REPLACE(text, ins, 2, ${p})`, "STRING", `REPLACE('abcde', 'XY', 2, ${p})`),
])

const lens: LanguageTest[] = [
  probe("str_len_empty", "LEN(empty)", "INT", "LEN of an empty string", "\n\tempty : STRING;"),
  probe("str_len_five", "LEN(text)", "INT", "LEN of 'abcde'"),
  // The initializer is on the DECLARATION, not in the body: `probe` only appends declarations, and a `small` the
  // body never wrote would have measured LEN of an empty STRING(3) while claiming to measure truncation.
  probe("str_len_after_truncation", "LEN(small)", "INT", "LEN of a STRING(3) declared with five characters", "\n\tsmall : STRING(3) := 'abcde';"),
]

const concats: LanguageTest[] = [
  probe("str_concat_both", "CONCAT(text, ins)", "STRING", "CONCAT of two non-empty strings"),
  probe("str_concat_empty_left", "CONCAT(empty, text)", "STRING", "CONCAT with an empty left side", "\n\tempty : STRING;"),
  probe("str_concat_into_short", "CONCAT(text, text)", "STRING(4)", "CONCAT whose result is longer than the destination holds"),
]

const finds: LanguageTest[] = [
  probe("str_find_present", "FIND(text, needle)", "INT", "FIND a substring that is there", "\n\tneedle : STRING := 'cd';"),
  probe("str_find_absent", "FIND(text, ins)", "INT", "FIND a substring that is not"),
  probe("str_find_empty_needle", "FIND(text, empty)", "INT", "FIND an empty needle", "\n\tempty : STRING;"),
  probe("str_find_longer_needle", "FIND(ins, text)", "INT", "FIND a needle longer than the haystack"),
]

/** Assigning past a STRING(n)'s length — the truncation rule `fit` states, asked at each edge. */
const truncation: LanguageTest[] = [
  probe("str_assign_into_shorter", "text", "STRING(3)", "a five-character string into a STRING(3)"),
  probe("str_assign_into_exact", "text", "STRING(5)", "a five-character string into a STRING(5)"),
  probe("str_assign_into_longer", "text", "STRING(9)", "a five-character string into a STRING(9)"),
]

export const STRING_EDGE_TESTS: readonly LanguageTest[] = [
  ...lens,
  ...lefts,
  ...mids,
  ...concats,
  ...finds,
  ...truncation,
]
