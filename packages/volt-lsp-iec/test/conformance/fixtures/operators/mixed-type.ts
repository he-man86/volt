/**
 * WHAT TYPE DO TWO DIFFERENT OPERANDS MEET AT? — the `commonType` lattice in `src/types/arith.ts`, asked pair by pair.
 *
 * That function encodes a real rule — REAL absorbs any integer, the wider rank wins, and at equal width the SIGNED
 * type wins — and most of it was inferred rather than measured. One line of it carries the scar: the equal-width tie
 * used to let the LEFT operand win, so `u > d` compared in UDINT, which `same_width_mixed_sign_order` caught. That
 * fixture asked one pair. There are dozens.
 *
 * THE TRICK, as in `unary-operand.ts`: the result is assigned into a `STRING`, which nothing can convert to, so
 * CODESYS has to NAME the type it arrived at in order to complain about it. A correct-looking program would compile
 * and tell us nothing.
 *
 * Both operands come from variables, so nothing folds and the literal-typing rules stay out of the way — a literal
 * takes its type from context and would answer a different question entirely.
 *
 * `+` and `/` are both asked of every pair. They are not the same question: division is where a signed/unsigned
 * meet-type changes the ANSWER and not just the width, and where an integer pair that meets in REAL would stop
 * truncating.
 */
import type { LanguageTest } from "../../types.js"

/**
 * The vendor's verdict on every pair, from the recording — `Cannot convert type '<MEET>' to type 'STRING'`, so the
 * quoted type IS the answer. Read it as a lattice:
 *
 *   equal width, opposite sign        the SIGNED one, in EITHER order  (INT+UINT and UINT+INT are both INT)
 *   bit string vs the integer of its own width   THE INTEGER, with its own signedness: BYTE+SINT is SINT,
 *                                     BYTE+USINT is USINT. A bit string is neutral and defers.
 *   different widths                  the WIDER, and SIGNED if either side is: ULINT + SINT is LINT, not ULINT
 *   any integer vs REAL               REAL — even LINT, which has more bits than a REAL has mantissa
 *   REAL vs LREAL                     LREAL
 */
const REFUSED: Readonly<Record<string, string>> = {
  meet_byte_div_sint: "Cannot convert type 'SINT' to type 'STRING'",
  meet_byte_div_usint: "Cannot convert type 'USINT' to type 'STRING'",
  meet_byte_plus_sint: "Cannot convert type 'SINT' to type 'STRING'",
  meet_byte_plus_usint: "Cannot convert type 'USINT' to type 'STRING'",
  meet_dint_div_lreal: "Cannot convert type 'LREAL' to type 'STRING'",
  meet_dint_div_sint: "Cannot convert type 'DINT' to type 'STRING'",
  meet_dint_div_udint: "Cannot convert type 'DINT' to type 'STRING'",
  meet_dint_plus_lreal: "Cannot convert type 'LREAL' to type 'STRING'",
  meet_dint_plus_sint: "Cannot convert type 'DINT' to type 'STRING'",
  meet_dint_plus_udint: "Cannot convert type 'DINT' to type 'STRING'",
  meet_dword_div_dint: "Cannot convert type 'DINT' to type 'STRING'",
  meet_dword_plus_dint: "Cannot convert type 'DINT' to type 'STRING'",
  meet_int_div_lint: "Cannot convert type 'LINT' to type 'STRING'",
  meet_int_div_real: "Cannot convert type 'REAL' to type 'STRING'",
  meet_int_div_uint: "Cannot convert type 'INT' to type 'STRING'",
  meet_int_plus_lint: "Cannot convert type 'LINT' to type 'STRING'",
  meet_int_plus_real: "Cannot convert type 'REAL' to type 'STRING'",
  meet_int_plus_uint: "Cannot convert type 'INT' to type 'STRING'",
  meet_lint_div_real: "Cannot convert type 'REAL' to type 'STRING'",
  meet_lint_div_ulint: "Cannot convert type 'LINT' to type 'STRING'",
  meet_lint_plus_real: "Cannot convert type 'REAL' to type 'STRING'",
  meet_lint_plus_ulint: "Cannot convert type 'LINT' to type 'STRING'",
  meet_lreal_div_real: "Cannot convert type 'LREAL' to type 'STRING'",
  meet_lreal_plus_real: "Cannot convert type 'LREAL' to type 'STRING'",
  meet_lword_div_lint: "Cannot convert type 'LINT' to type 'STRING'",
  meet_lword_plus_lint: "Cannot convert type 'LINT' to type 'STRING'",
  meet_real_div_int: "Cannot convert type 'REAL' to type 'STRING'",
  meet_real_div_lreal: "Cannot convert type 'LREAL' to type 'STRING'",
  meet_real_plus_int: "Cannot convert type 'REAL' to type 'STRING'",
  meet_real_plus_lreal: "Cannot convert type 'LREAL' to type 'STRING'",
  meet_sint_div_dint: "Cannot convert type 'DINT' to type 'STRING'",
  meet_sint_div_usint: "Cannot convert type 'SINT' to type 'STRING'",
  meet_sint_plus_dint: "Cannot convert type 'DINT' to type 'STRING'",
  meet_sint_plus_usint: "Cannot convert type 'SINT' to type 'STRING'",
  meet_udint_div_dint: "Cannot convert type 'DINT' to type 'STRING'",
  meet_udint_plus_dint: "Cannot convert type 'DINT' to type 'STRING'",
  meet_uint_div_int: "Cannot convert type 'INT' to type 'STRING'",
  meet_uint_plus_int: "Cannot convert type 'INT' to type 'STRING'",
  meet_ulint_div_lint: "Cannot convert type 'LINT' to type 'STRING'",
  meet_ulint_div_lreal: "Cannot convert type 'LREAL' to type 'STRING'",
  meet_ulint_div_sint: "Cannot convert type 'LINT' to type 'STRING'",
  meet_ulint_plus_lint: "Cannot convert type 'LINT' to type 'STRING'",
  meet_ulint_plus_lreal: "Cannot convert type 'LREAL' to type 'STRING'",
  meet_ulint_plus_sint: "Cannot convert type 'LINT' to type 'STRING'",
  meet_usint_div_lint: "Cannot convert type 'LINT' to type 'STRING'",
  meet_usint_div_sint: "Cannot convert type 'SINT' to type 'STRING'",
  meet_usint_plus_lint: "Cannot convert type 'LINT' to type 'STRING'",
  meet_usint_plus_sint: "Cannot convert type 'SINT' to type 'STRING'",
  meet_word_div_int: "Cannot convert type 'INT' to type 'STRING'",
  meet_word_div_uint: "Cannot convert type 'UINT' to type 'STRING'",
  meet_word_plus_int: "Cannot convert type 'INT' to type 'STRING'",
  meet_word_plus_uint: "Cannot convert type 'UINT' to type 'STRING'",
}

function pair(left: string, right: string, op: string, opName: string, why: string): LanguageTest {
  const slug = `meet_${left.toLowerCase()}_${opName}_${right.toLowerCase()}`
  const pou = `FB_LANG_${slug}`
  return {
    name: slug,
    pouName: pou,
    kind: "function_block" as const,
    feature: `the type ${left} ${op} ${right} meets at — ${why}`,
    fromDoc: "05-operators.md",
    ...(REFUSED[slug] !== undefined ? { refused: REFUSED[slug]! } : {}),
    plcPrgVar: `inst : ${pou};`,
    plcPrgBody: "inst();",
    source:
      `FUNCTION_BLOCK ${pou}\nVAR\n\ta : ${left};\n\tb : ${right};\n\tout : STRING;\nEND_VAR\n` +
      `a := 6;\nb := 3;\nout := a ${op} b;\nEND_FUNCTION_BLOCK\n`,
  }
}

/** Every pair worth asking, with the reason it is interesting. */
const PAIRS: readonly [string, string, string][] = [
  // equal width, opposite sign — the tie the lattice resolves in favour of SIGNED, and the one that was wrong once
  ["SINT", "USINT", "equal width, opposite sign"],
  ["INT", "UINT", "equal width, opposite sign"],
  ["DINT", "UDINT", "equal width, opposite sign"],
  ["LINT", "ULINT", "equal width, opposite sign"],
  // and the same pairs the other way round: the answer must not depend on which side is written first
  ["USINT", "SINT", "the same tie, operands swapped"],
  ["UINT", "INT", "the same tie, operands swapped"],
  ["UDINT", "DINT", "the same tie, operands swapped"],
  ["ULINT", "LINT", "the same tie, operands swapped"],
  // a bit string against the signed integer of its own width — two families, one width
  ["BYTE", "SINT", "bit string against the signed integer of its width"],
  ["WORD", "INT", "bit string against the signed integer of its width"],
  ["DWORD", "DINT", "bit string against the signed integer of its width"],
  ["LWORD", "LINT", "bit string against the signed integer of its width"],
  // a bit string against the UNSIGNED integer of its own width — same width, same signedness, different family
  ["BYTE", "USINT", "bit string against the unsigned integer of its width"],
  ["WORD", "UINT", "bit string against the unsigned integer of its width"],
  // narrow against wide, both directions
  ["SINT", "DINT", "narrow against wide"],
  ["DINT", "SINT", "wide against narrow"],
  ["INT", "LINT", "narrow against wide"],
  ["USINT", "LINT", "narrow unsigned against wide signed"],
  ["ULINT", "SINT", "wide unsigned against narrow signed — no signed type holds every ULINT"],
  // integer against floating point — the rank rule says REAL absorbs any integer, including a 64-bit one it
  // cannot represent exactly
  ["INT", "REAL", "integer against REAL"],
  ["REAL", "INT", "REAL against integer"],
  ["DINT", "LREAL", "integer against LREAL"],
  ["LINT", "REAL", "a 64-bit integer against a 32-bit REAL — more bits than the float has"],
  ["ULINT", "LREAL", "a 64-bit unsigned against LREAL"],
  ["REAL", "LREAL", "the two floating types"],
  ["LREAL", "REAL", "the two floating types, swapped"],
  // TWO BIT STRINGS OF DIFFERENT WIDTHS. The first round left these out and that was the one guess in it: every
  // measured pair had an INT-family operand to defer to, so "the result is never a bit string" was consistent with
  // the evidence and completely untested. If BYTE + WORD is WORD, the rule is about width alone; if it is UINT, a
  // bit string really does become an integer whenever it meets anything.
  ["BYTE", "WORD", "two bit strings, different widths"],
  ["WORD", "DWORD", "two bit strings, different widths"],
  ["BYTE", "LWORD", "two bit strings, far apart"],
  ["BYTE", "BYTE", "two bit strings of the SAME width — the baseline the others are read against"],
  // a bit string against an integer of a DIFFERENT width, both directions
  ["BYTE", "DINT", "narrow bit string against a wide signed integer"],
  ["DWORD", "SINT", "wide bit string against a narrow signed integer"],
  ["DWORD", "USINT", "wide bit string against a narrow unsigned integer"],
  // a bit string against a real
  ["DWORD", "REAL", "bit string against REAL"],
  // and BOOL, which is its own family and has no rank at all
  ["BOOL", "INT", "BOOL against an integer — BOOL has no rank in the table"],
]

export const MIXED_TYPE_TESTS: readonly LanguageTest[] = PAIRS.flatMap(([l, r, why]) => [
  pair(l, r, "+", "plus", why),
  pair(l, r, "/", "div", why),
])
