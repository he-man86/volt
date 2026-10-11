/**
 * THE STRING → INTEGER TABLE (design.md P3; `cases.ts`; transpile-restructure 6.A.10): every cell CODESYS recorded for the
 * `tr_a10_*` fixtures (`fixtures/semantics/execution.ts`, record:exec 2026-10-10) — a based literal's text ('16#FF', '2#101',
 * '8#17'), a typed one ('INT#5'), underscores, signs, spaces and tabs before them, digits outside the base, bases CODESYS
 * has no literal for, and numbers wider than the target. `input.text` is the string the fixture parsed (its `input`
 * variable), `input.to` the target; `expected` is the recorded value, the parse as the target
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

/**
 * `wstring_parse_widths` (gate 8c, record:exec 2026-10-11): one text parsed into all 12 integer types, by STRING_TO_<type>
 * (`narrow`: `inst.narrow<name><type>` from `inst.s<name>`) or WSTRING_TO_<type> (`wide`: from `inst.w<name>`) — the
 * values in `WIDTH_TYPES` order. A text past the target wraps as a based one does; a NEGATIVE text into an unsigned type
 * is 0, where every signed type wraps it ('-5' into UINT is 0, into INT -5) — the two parses alike.
 */
const WIDTHS = "wstring_parse_widths"
const WIDTH_TYPES = ["SINT", "USINT", "INT", "UINT", "DINT", "UDINT", "LINT", "ULINT", "BYTE", "WORD", "DWORD", "LWORD"] as const
const WIDTH_TEXTS: Readonly<Record<string, string>> = {
  Past32: "9999999999",
  Two32: "4294967296",
  Neg5: "-5",
  Past16: "70000",
  Past8: "300",
  NegPast8: "-129",
  U64Max: "18446744073709551615",
  Past64: "99999999999999999999",
  NegPast64: "-9223372036854775809",
}
const widths = (kind: "narrow" | "wide", name: string, values: readonly bigint[]): Case<ParseIntInput, bigint>[] =>
  WIDTH_TYPES.map((to, i) => ({
    name: `${WIDTHS} ${kind}${name}${to}`,
    input: { text: WIDTH_TEXTS[name]!, to },
    expected: values[i]!,
    recording: { fixture: WIDTHS, variable: `inst.${kind}${name}${to}`, input: `inst.${kind === "narrow" ? "s" : "w"}${name}` },
  }))

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
  // the bit-string targets parse the same way (the fixture's one WSTRING is `WIDE_PARSE_INT_CASES`')
  cell(BITS, "b", "sHex", "16#FF", "BYTE", 255n),
  cell(BITS, "dw", "sWide", "16#FFFFFF", "DWORD", 16777215n),
  cell(BITS, "d", "sWide", "16#FFFFFF", "DINT", 16777215n),
  cell(BITS, "w", "sBin", "2#1010", "WORD", 10n),
  cell(BITS, "dwTyped", "sTyped", "DWORD#16#10", "DWORD", 0n),
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
  // every integer type: past 32 and 64 bits, negative (0 into an unsigned type), past INT and SINT (`wstring_parse_widths`)
  ...widths("narrow", "Past32", [-1n, 255n, -7169n, 58367n, 1410065407n, 1410065407n, 9999999999n, 9999999999n, 255n, 58367n, 1410065407n, 9999999999n]),
  ...widths("narrow", "Two32", [0n, 0n, 0n, 0n, 0n, 0n, 4294967296n, 4294967296n, 0n, 0n, 0n, 4294967296n]),
  ...widths("narrow", "Neg5", [-5n, 0n, -5n, 0n, -5n, 0n, -5n, 0n, 0n, 0n, 0n, 0n]),
  ...widths("narrow", "Past16", [112n, 112n, 4464n, 4464n, 70000n, 70000n, 70000n, 70000n, 112n, 4464n, 70000n, 70000n]),
  ...widths("narrow", "Past8", [44n, 44n, 300n, 300n, 300n, 300n, 300n, 300n, 44n, 300n, 300n, 300n]),
  ...widths("narrow", "NegPast8", [127n, 0n, -129n, 0n, -129n, 0n, -129n, 0n, 0n, 0n, 0n, 0n]),
  ...widths("narrow", "U64Max", [-1n, 255n, -1n, 65535n, -1n, 4294967295n, -1n, 18446744073709551615n, 255n, 65535n, 4294967295n, 18446744073709551615n]),
  ...widths("narrow", "Past64", [-1n, 255n, -1n, 65535n, 1661992959n, 1661992959n, 7766279631452241919n, 7766279631452241919n, 255n, 65535n, 1661992959n, 7766279631452241919n]),
  ...widths("narrow", "NegPast64", [-1n, 0n, -1n, 0n, -1n, 0n, 9223372036854775807n, 0n, 0n, 0n, 0n, 0n]),
]

const GRAMMAR = "wstring_parse_grammar"
/** A WSTRING parsed into a DINT — `wstring_parse_grammar`'s cell `inst.d<name>`, from its text `inst.w<name>`. */
const wide = (name: string, text: string, expected: bigint): Case<ParseIntInput, bigint> => ({
  name: `${GRAMMAR} ${name}`,
  input: { text, to: "DINT" },
  expected,
  recording: { fixture: GRAMMAR, variable: `inst.d${name}`, input: `inst.w${name}` },
})

/**
 * THE WSTRING → INTEGER TABLE (transpile-restructure 8.2, design.md §7.2 Decision step 8c): every cell CODESYS recorded for
 * `wstring_parse_grammar` (record:exec 2026-10-11) — the wide twin of each STRING cell above, plain decimals and what may
 * stand before or after them — and `tr_a10_string_to_bits_literal_forms`'s one WSTRING. A WSTRING parse reads what the
 * STRING parse reads, and answers it only when that is the WHOLE text: a character it stops at ('12abc', '1 0', '5 ',
 * '16#1FZ', '8#19', '-16#F', '3#12') makes it 0, where the STRING parse answers the digits before it. `parse.test.ts` runs
 * them through `parseIntegerWide` then `fit`; the twin harness against the Rust runtime's `iec_parse_int_wide`.
 */
export const WIDE_PARSE_INT_CASES: readonly Case<ParseIntInput, bigint>[] = [
  // the based and typed forms: read in full, or not at all
  wide("Hex", "16#FF", 255n),
  wide("Bin", "2#101", 5n),
  wide("Oct", "8#17", 15n),
  wide("Typed", "INT#5", 0n),
  wide("TypedHex", "INT#16#1F", 0n),
  wide("LowerHex", "16#ff", 255n),
  wide("Under", "1_000", 1000n),
  wide("NegHex", "-16#F", 0n),
  wide("SpaceHex", " 16#FF", 255n),
  wide("BadHex", "16#G", 0n),
  // where a number stops: an underscore anywhere is skipped, any other character it stops at makes the parse 0
  wide("HexUnder", "16#FF_FF", 65535n),
  wide("DoubleUnder", "1__0", 10n),
  wide("LeadUnder", "_5", 5n),
  wide("TrailUnder", "5_", 5n),
  wide("NoDigits", "16#", 0n),
  wide("OctNine", "8#19", 0n),
  wide("PlusHex", "+16#F", 0n),
  wide("Base3", "3#12", 0n),
  wide("Base10", "10#99", 0n),
  wide("HexTail", "16#1FZ", 0n),
  wide("ZeroHex", "016#F", 0n),
  // signs, spaces and tabs before the digits, underscores among them
  wide("NegUnder", "-1_0", -10n),
  wide("PlusLead", "+_5", 5n),
  wide("SpaceLead", " _5", 5n),
  wide("Only", "_", 0n),
  wide("NegLead", "-_5", -5n),
  wide("HexLead", "16#_F", 15n),
  wide("BinUnder", "2#1_0", 2n),
  wide("DoubleLead", "__5", 5n),
  wide("SpaceInside", "1 0", 0n),
  wide("TabLead", "\t16#F", 15n),
  // a plain decimal, and what may stand before or after it
  wide("Plain", "5", 5n),
  wide("Neg", "-5", -5n),
  wide("Plus", "+5", 5n),
  wide("Lead", " 5", 5n),
  wide("TabPlain", "\t7", 7n),
  wide("Letters", "12abc", 0n),
  wide("SpaceSign", "- 5", 0n),
  wide("Empty", "", 0n),
  wide("TrailSpace", "5 ", 0n),
  wide("TrailTab", "5\t", 0n),
  wide("TrailLetter", "5a", 0n),
  wide("Big", "99999", 99999n),
  wide("HexTrailSpace", "16#FF ", 0n),
  wide("Alpha", "abc", 0n),
  // a WSTRING into an INT, beside the STRING cells of the same fixture
  cell(BITS, "iWide", "wHex", "16#FF", "INT", 255n),
  // every integer type, as the STRING parse reaches it — a negative text into an unsigned type 0 (`wstring_parse_widths`)
  ...widths("wide", "Past32", [-1n, 255n, -7169n, 58367n, 1410065407n, 1410065407n, 9999999999n, 9999999999n, 255n, 58367n, 1410065407n, 9999999999n]),
  ...widths("wide", "Two32", [0n, 0n, 0n, 0n, 0n, 0n, 4294967296n, 4294967296n, 0n, 0n, 0n, 4294967296n]),
  ...widths("wide", "Neg5", [-5n, 0n, -5n, 0n, -5n, 0n, -5n, 0n, 0n, 0n, 0n, 0n]),
  ...widths("wide", "Past16", [112n, 112n, 4464n, 4464n, 70000n, 70000n, 70000n, 70000n, 112n, 4464n, 70000n, 70000n]),
  ...widths("wide", "Past8", [44n, 44n, 300n, 300n, 300n, 300n, 300n, 300n, 44n, 300n, 300n, 300n]),
  ...widths("wide", "NegPast8", [127n, 0n, -129n, 0n, -129n, 0n, -129n, 0n, 0n, 0n, 0n, 0n]),
  ...widths("wide", "U64Max", [-1n, 255n, -1n, 65535n, -1n, 4294967295n, -1n, 18446744073709551615n, 255n, 65535n, 4294967295n, 18446744073709551615n]),
  ...widths("wide", "Past64", [-1n, 255n, -1n, 65535n, 1661992959n, 1661992959n, 7766279631452241919n, 7766279631452241919n, 255n, 65535n, 1661992959n, 7766279631452241919n]),
  ...widths("wide", "NegPast64", [-1n, 0n, -1n, 0n, -1n, 0n, 9223372036854775807n, 0n, 0n, 0n, 0n, 0n]),
]
