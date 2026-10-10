/**
 * THE STRING → INTEGER TABLE (design.md P3; `cases.ts`; transpile-restructure 6.A.10): every cell CODESYS recorded for the
 * `tr_a10_*` fixtures (`fixtures/semantics/execution.ts`, record:exec 2026-10-10) — a based literal's text ('16#FF', '2#101',
 * '8#17'), a typed one ('INT#5'), underscores, signs, spaces and tabs before them, digits outside the base, bases CODESYS
 * has no literal for, and numbers wider than the target. `input.text` is the string the fixture parsed (its `input`
 * variable; a WSTRING's narrowed text), `input.to` the target; `expected` is the recorded value, the parse as the target
 * stores it. `parse.test.ts` runs them through `parseInteger` then `fit`; the twin harness (`test/conformance/runtime-twins.test.ts`)
 * runs them against the Rust runtime's `iec_parse_int` and holds every cell and its input to `codesys.run.json`.
 */
import type { Case } from "./cases.js"

/** A string parsed into an integer or bit-string target. */
export interface ParseIntInput {
  readonly text: string
  readonly to: string
}

const cell = (fixture: string, variable: string, input: string, text: string, to: string, expected: bigint): Case<ParseIntInput, bigint> => ({
  name: `${fixture} ${variable}`,
  input: { text, to },
  expected,
  recording: { fixture, variable, input },
})

const FORMS = "tr_a10_string_to_int_literal_forms"
const BITS = "tr_a10_string_to_bits_literal_forms"
const EDGES = "tr_a10_string_to_dint_based_edges"
const WIDER = "tr_a10_string_to_int_based_wider_than_target"
const SIGNS = "tr_a10_string_to_dint_underscore_sign_edges"
const WIDE64 = "tr_a10_string_to_64bit_based"

/** The recorded STRING → integer cells. */
export const PARSE_INT_CASES: readonly Case<ParseIntInput, bigint>[] = [
  // a based literal's text is read in its base — only 2#, 8# and 16#, and only with no sign before it
  cell(FORMS, "iHex", "sHex", "16#FF", "INT", 255n),
  cell(FORMS, "iBin", "sBin", "2#101", "INT", 5n),
  cell(FORMS, "iOct", "sOct", "8#17", "INT", 15n),
  cell(FORMS, "iTyped", "sTyped", "INT#5", "INT", 0n),
  cell(FORMS, "iTypedHex", "sTypedHex", "INT#16#1F", "INT", 0n),
  cell(FORMS, "iLowerHex", "sLowerHex", "16#ff", "INT", 255n),
  cell(FORMS, "iUnder", "sUnder", "1_000", "INT", 1000n),
  cell(FORMS, "iNegHex", "sNegHex", "-16#F", "INT", -16n),
  cell(FORMS, "iSpaceHex", "sSpaceHex", " 16#FF", "INT", 255n),
  cell(FORMS, "iBadHex", "sBadHex", "16#G", "INT", 0n),
  // the bit-string targets parse the same way, and a WSTRING's text as its narrowed STRING
  cell(BITS, "b", "sHex", "16#FF", "BYTE", 255n),
  cell(BITS, "dw", "sWide", "16#FFFFFF", "DWORD", 16777215n),
  cell(BITS, "d", "sWide", "16#FFFFFF", "DINT", 16777215n),
  cell(BITS, "w", "sBin", "2#1010", "WORD", 10n),
  cell(BITS, "dwTyped", "sTyped", "DWORD#16#10", "DWORD", 0n),
  cell(BITS, "iWide", "wHex", "16#FF", "INT", 255n),
  // where a based number stops: an underscore anywhere among the digits is skipped, any other character ends them
  cell(EDGES, "dHexUnder", "sHexUnder", "16#FF_FF", "DINT", 65535n),
  cell(EDGES, "dDoubleUnder", "sDoubleUnder", "1__0", "DINT", 10n),
  cell(EDGES, "dLeadUnder", "sLeadUnder", "_5", "DINT", 5n),
  cell(EDGES, "dTrailUnder", "sTrailUnder", "5_", "DINT", 5n),
  cell(EDGES, "dNoDigits", "sNoDigits", "16#", "DINT", 0n),
  cell(EDGES, "dOctNine", "sOctNine", "8#19", "DINT", 1n),
  cell(EDGES, "dPlusHex", "sPlusHex", "+16#F", "DINT", 16n),
  cell(EDGES, "dBase3", "sBase3", "3#12", "DINT", 3n),
  cell(EDGES, "dBase10", "sBase10", "10#99", "DINT", 10n),
  cell(EDGES, "dHexTail", "sHexTail", "16#1FZ", "DINT", 31n),
  cell(EDGES, "dZeroHex", "sZeroHex", "016#F", "DINT", 16n),
  // a based number wider than its target wraps, as a decimal one does (`xf_string_to_int_far_too_large`)
  cell(WIDER, "i1", "sFFFF", "16#FFFF", "INT", -1n),
  cell(WIDER, "i2", "s8000", "16#8000", "INT", -32768n),
  cell(WIDER, "u1", "sFFFF", "16#FFFF", "UINT", 65535n),
  cell(WIDER, "si", "sFFFF", "16#FFFF", "SINT", -1n),
  cell(WIDER, "d1", "sBig", "16#123456789", "DINT", 591751049n),
  // an underscore after a sign or a space, alone, first among a based number's digits; a space inside the digits; a tab
  cell(SIGNS, "dNegUnder", "sNegUnder", "-1_0", "DINT", -10n),
  cell(SIGNS, "dPlusLead", "sPlusLead", "+_5", "DINT", 5n),
  cell(SIGNS, "dSpaceLead", "sSpaceLead", " _5", "DINT", 5n),
  cell(SIGNS, "dOnly", "sOnly", "_", "DINT", 0n),
  cell(SIGNS, "dNegLead", "sNegLead", "-_5", "DINT", -5n),
  cell(SIGNS, "dHexLead", "sHexLead", "16#_F", "DINT", 15n),
  cell(SIGNS, "dBinUnder", "sBinUnder", "2#1_0", "DINT", 2n),
  cell(SIGNS, "dDoubleLead", "sDoubleLead", "__5", "DINT", 5n),
  cell(SIGNS, "dSpaceInside", "sSpaceInside", "1 0", "DINT", 1n),
  cell(SIGNS, "dTabLead", "sTabLead", "\t16#F", "DINT", 15n),
  // the 64-bit targets: a based number that fills 64 bits, sets the sign bit, passes 64 bits; ULINT's largest in decimal
  cell(WIDE64, "lw", "sAllOnes", "16#FFFFFFFFFFFFFFFF", "LWORD", 18446744073709551615n),
  cell(WIDE64, "ul", "sAllOnes", "16#FFFFFFFFFFFFFFFF", "ULINT", 18446744073709551615n),
  cell(WIDE64, "li", "sSign", "16#8000000000000000", "LINT", -9223372036854775808n),
  cell(WIDE64, "lPast", "sPast", "16#1FFFFFFFFFFFFFFFF", "LWORD", 18446744073709551615n),
  cell(WIDE64, "ulDec", "sDecMax", "18446744073709551615", "ULINT", 18446744073709551615n),
  cell(WIDE64, "liDec", "sDecMax", "18446744073709551615", "LINT", -1n),
]
