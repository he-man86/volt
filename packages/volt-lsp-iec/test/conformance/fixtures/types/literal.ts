/**
 * Literal / operand conformance tests.
 *
 * Sources: 05-operands.md, 06-data-types.md. Validates that TC and LSP
 * agree on the various numeric, time, date, and string literal forms
 * IEC 61131-3 supports. Most are positive cases.
 *
 * Same LanguageTest shape as pragmas — see pragma-tests.ts for field docs.
 */
import type { LanguageTest } from "../../types.js"

export const LITERAL_TESTS: readonly LanguageTest[] = [
  // ========================================================================
  // Category: 05-operands.md + 06-data-types.md — literal forms
  // ========================================================================

  // ─── Numeric literal bases ──────────────────────────────────────────

  {
    name: "literal_hex",
    pouName: "FB_LANG_literal_hex",
    kind: "function_block",
    feature: "Hex literal 16#FF assigned to WORD",
    fromDoc: "05-operands.md",
    plcPrgVar: "fb_lh : FB_LANG_literal_hex;",
    plcPrgBody: "fb_lh.Init();",
    source: `FUNCTION_BLOCK FB_LANG_literal_hex
VAR
	wValue : WORD;
END_VAR

END_FUNCTION_BLOCK

METHOD Init
wValue := 16#FF;
END_METHOD
`,
  },

  {
    name: "literal_binary",
    pouName: "FB_LANG_literal_binary",
    kind: "function_block",
    feature: "Binary literal 2#1010 assigned to BYTE",
    fromDoc: "05-operands.md",
    plcPrgVar: "fb_lb : FB_LANG_literal_binary;",
    plcPrgBody: "fb_lb.Init();",
    source: `FUNCTION_BLOCK FB_LANG_literal_binary
VAR
	bValue : BYTE;
END_VAR

END_FUNCTION_BLOCK

METHOD Init
bValue := 2#10101010;
END_METHOD
`,
  },

  {
    name: "literal_octal",
    pouName: "FB_LANG_literal_octal",
    kind: "function_block",
    feature: "Octal literal 8#77 assigned to BYTE",
    fromDoc: "05-operands.md",
    plcPrgVar: "fb_lo : FB_LANG_literal_octal;",
    plcPrgBody: "fb_lo.Init();",
    source: `FUNCTION_BLOCK FB_LANG_literal_octal
VAR
	bValue : BYTE;
END_VAR

END_FUNCTION_BLOCK

METHOD Init
bValue := 8#77;
END_METHOD
`,
  },

  {
    name: "literal_typed_int_hash",
    pouName: "FB_LANG_literal_typed_int_hash",
    kind: "function_block",
    feature: "Typed-literal form INT#42 (explicit numeric type prefix)",
    fromDoc: "05-operands.md",
    plcPrgVar: "fb_lti : FB_LANG_literal_typed_int_hash;",
    plcPrgBody: "fb_lti.Init();",
    source: `FUNCTION_BLOCK FB_LANG_literal_typed_int_hash
VAR
	iValue : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Init
iValue := INT#42;
END_METHOD
`,
  },

  {
    name: "literal_real_scientific",
    pouName: "FB_LANG_literal_real_scientific",
    kind: "function_block",
    feature: "REAL literal in scientific notation: 1.5e3",
    fromDoc: "06-data-types.md",
    plcPrgVar: "fb_lrs : FB_LANG_literal_real_scientific;",
    plcPrgBody: "fb_lrs.Init();",
    source: `FUNCTION_BLOCK FB_LANG_literal_real_scientific
VAR
	rValue : REAL;
END_VAR

END_FUNCTION_BLOCK

METHOD Init
rValue := 1.5e3;
END_METHOD
`,
  },

  // ─── Time / date / TOD ──────────────────────────────────────────────

  {
    name: "literal_time",
    pouName: "FB_LANG_literal_time",
    kind: "function_block",
    feature: "TIME literal T#5s500ms",
    fromDoc: "06-data-types.md",
    plcPrgVar: "fb_lt : FB_LANG_literal_time;",
    plcPrgBody: "fb_lt.Init();",
    source: `FUNCTION_BLOCK FB_LANG_literal_time
VAR
	tValue : TIME;
END_VAR

END_FUNCTION_BLOCK

METHOD Init
tValue := T#5s500ms;
END_METHOD
`,
  },

  {
    name: "literal_date",
    pouName: "FB_LANG_literal_date",
    kind: "function_block",
    feature: "DATE literal D#2024-12-25",
    fromDoc: "06-data-types.md",
    plcPrgVar: "fb_ld : FB_LANG_literal_date;",
    plcPrgBody: "fb_ld.Init();",
    source: `FUNCTION_BLOCK FB_LANG_literal_date
VAR
	dValue : DATE;
END_VAR

END_FUNCTION_BLOCK

METHOD Init
dValue := D#2024-12-25;
END_METHOD
`,
  },

  {
    name: "literal_tod",
    pouName: "FB_LANG_literal_tod",
    kind: "function_block",
    feature: "TIME_OF_DAY literal TOD#12:30:45",
    fromDoc: "06-data-types.md",
    plcPrgVar: "fb_ltod : FB_LANG_literal_tod;",
    plcPrgBody: "fb_ltod.Init();",
    source: `FUNCTION_BLOCK FB_LANG_literal_tod
VAR
	todValue : TOD;
END_VAR

END_FUNCTION_BLOCK

METHOD Init
todValue := TOD#12:30:45;
END_METHOD
`,
  },

  // ─── Strings ────────────────────────────────────────────────────────

  {
    name: "literal_string_single_quoted",
    pouName: "FB_LANG_literal_string_single_quoted",
    kind: "function_block",
    feature: "STRING literal 'hello' (single-quoted)",
    fromDoc: "06-data-types.md",
    plcPrgVar: "fb_lssq : FB_LANG_literal_string_single_quoted;",
    plcPrgBody: "fb_lssq.Init();",
    source: `FUNCTION_BLOCK FB_LANG_literal_string_single_quoted
VAR
	sValue : STRING;
END_VAR

END_FUNCTION_BLOCK

METHOD Init
sValue := 'hello';
END_METHOD
`,
  },

  {
    name: "literal_wstring_double_quoted",
    pouName: "FB_LANG_literal_wstring_double_quoted",
    kind: "function_block",
    feature: 'WSTRING literal "hello" (double-quoted)',
    fromDoc: "06-data-types.md",
    plcPrgVar: "fb_lwdq : FB_LANG_literal_wstring_double_quoted;",
    plcPrgBody: "fb_lwdq.Init();",
    source: `FUNCTION_BLOCK FB_LANG_literal_wstring_double_quoted
VAR
	wsValue : WSTRING;
END_VAR

END_FUNCTION_BLOCK

METHOD Init
wsValue := "hello";
END_METHOD
`,
  },

  // ─── Negative: string-to-INT assignment ─────────────────────────────

  {
    name: "literal_string_to_int_assignment",
    pouName: "FB_LANG_literal_string_to_int_assignment",
    kind: "function_block",
    feature: "STRING literal assigned to INT — TC should error",
    fromDoc: "06-data-types.md",
    note: "Mismatched literal type. Marked recordIsolated because the parse-style error may otherwise short-circuit other tests in the batch.",
    plcPrgVar: "fb_lsia : FB_LANG_literal_string_to_int_assignment;",
    plcPrgBody: "fb_lsia.Init();",
    source: `FUNCTION_BLOCK FB_LANG_literal_string_to_int_assignment
VAR
	iValue : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Init
iValue := 'oops';
END_METHOD
`,
  },
  // ─── CHARACTERS OUTSIDE THE MEASURED SET ───────────────────────────────────────────────────────────
  // `string-non-ascii` and `wstring-surrogate` were registered as `not-measured` only once the registry gate was
  // widened to see a code written as a TERNARY — before that the corpus emitted them and the registry knew neither.
  // Nothing records what CODESYS stores for a character past ASCII, so lowering refuses both; these ask. Written with
  // `$` hex escapes, which are ST's own spelling and keep this file pure ASCII — `$C3$A9` is the UTF-8 for an
  // e-acute, so the answer to LEN() also says whether a STRING counts BYTES or characters.
  {
    name: "string_non_ascii_bytes",
    pouName: "FB_LANG_string_non_ascii_bytes",
    kind: "function_block" as const,
    feature: "a STRING literal holding non-ASCII bytes ($C3$A9) — accepted, and does LEN count bytes or characters?",
    fromDoc: "06-data-types.md",
    plcPrgVar: "inst_string_non_ascii_bytes : FB_LANG_string_non_ascii_bytes;",
    plcPrgBody: "inst_string_non_ascii_bytes();",
    source: "FUNCTION_BLOCK FB_LANG_string_non_ascii_bytes\nVAR\n\ttext : STRING := 'caf$C3$A9';\n\tlength : INT;\n\tfirstByte : BYTE;\nEND_VAR\nlength := LEN(text);\nfirstByte := text[0];\nEND_FUNCTION_BLOCK\n",
  },
  {
    // RESOLVED 2026-09-19. The reading was right and the evidence was one fixture: `strings/escapes.ts` walked the
    // whole escape table and every form at or above 0x80 is two bytes, which is the UTF-8 encoding of U+00XX.
    // `literal-value.ts` stores those bytes now, one JS char each, so LEN counts them and a slice cuts on a byte.
    name: "string_high_byte_escape",
    pouName: "FB_LANG_string_high_byte_escape",
    kind: "function_block" as const,
    feature: "a single byte past 7F in a STRING ($FF) — stored as itself?",
    fromDoc: "06-data-types.md",
    plcPrgVar: "inst_string_high_byte_escape : FB_LANG_string_high_byte_escape;",
    plcPrgBody: "inst_string_high_byte_escape();",
    source: "FUNCTION_BLOCK FB_LANG_string_high_byte_escape\nVAR\n\ttext : STRING := '$FF';\n\tlength : INT;\nEND_VAR\nlength := LEN(text);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "wstring_non_ascii",
    refused: "Cannot convert type 'WSTRING' to type 'STRING(255)'",
    pouName: "FB_LANG_wstring_non_ascii",
    kind: "function_block" as const,
    feature: "a WSTRING holding a non-ASCII code unit ($00E9) — one unit, and what does LEN say?",
    fromDoc: "06-data-types.md",
    plcPrgVar: "inst_wstring_non_ascii : FB_LANG_wstring_non_ascii;",
    plcPrgBody: "inst_wstring_non_ascii();",
    source: "FUNCTION_BLOCK FB_LANG_wstring_non_ascii\nVAR\n\ttext : WSTRING := \"caf$00E9\";\n\tlength : INT;\nEND_VAR\nlength := LEN(text);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "wstring_surrogate_pair",
    refused: "Cannot convert type 'WSTRING' to type 'STRING(255)'",
    pouName: "FB_LANG_wstring_surrogate_pair",
    kind: "function_block" as const,
    feature: "a WSTRING holding a character past the BMP, written as a SURROGATE PAIR — one character or two units?",
    fromDoc: "06-data-types.md",
    plcPrgVar: "inst_wstring_surrogate_pair : FB_LANG_wstring_surrogate_pair;",
    plcPrgBody: "inst_wstring_surrogate_pair();",
    source: "FUNCTION_BLOCK FB_LANG_wstring_surrogate_pair\nVAR\n\ttext : WSTRING := \"a$D83D$DE00b\";\n\tlength : INT;\nEND_VAR\nlength := LEN(text);\nEND_FUNCTION_BLOCK\n",
  },
]
