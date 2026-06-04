/**
 * Operands conformance tests — variable-access forms documented in
 * 05-operands.md that aren't already exercised elsewhere:
 *   - Bit access on integer variables (`wValue.0`)
 *   - Partial variable access (`dwValue.%X3`)
 *   - Hardware addresses (`%I*`, `%Q*`, `%M*`)
 *   - Character literals (`UCHAR#`)
 *
 * Hardware-address tests rely on the bridge's TC project having no
 * IO mapping — they test the SYNTAX, not actual IO. TC accepts the
 * declaration; mapping resolution is a different layer.
 *
 * Same LanguageTest shape as pragmas — see pragma-tests.ts for field docs.
 */
import type { LanguageTest } from "../types.js";

export const OPERANDS_TESTS: readonly LanguageTest[] = [
	// ─── Bit access on integer variables ────────────────────────────────

	{
		name: "operand_bit_access_byte",
		pouName: "FB_LANG_operand_bit_byte",
		kind: "function_block",
		feature: "Indexed bit access on a BYTE — `wValue.0` reads bit 0",
		fromDoc: "05-operands.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_bit : FB_LANG_operand_bit_byte;",
		plcPrgBody: "fb_bit.Inspect();",
		source:
`FUNCTION_BLOCK FB_LANG_operand_bit_byte
VAR
	bValue : BYTE := 16#A5;
	bBit0 : BOOL;
	bBit7 : BOOL;
END_VAR

END_FUNCTION_BLOCK

METHOD Inspect
bBit0 := bValue.0;
bBit7 := bValue.7;
END_METHOD
`,
	},

	{
		name: "operand_bit_assign_word",
		pouName: "FB_LANG_operand_bit_assign",
		kind: "function_block",
		feature: "Indexed bit ASSIGNMENT on a WORD — `wValue.3 := TRUE`",
		fromDoc: "05-operands.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_ba : FB_LANG_operand_bit_assign;",
		plcPrgBody: "fb_ba.Flip();",
		source:
`FUNCTION_BLOCK FB_LANG_operand_bit_assign
VAR
	wValue : WORD;
END_VAR

END_FUNCTION_BLOCK

METHOD Flip
wValue.0 := TRUE;
wValue.3 := TRUE;
END_METHOD
`,
	},

	// ─── Partial variable access (`.%TYPE<idx>`) ────────────────────────

	{
		name: "operand_partial_word_in_dword",
		pouName: "FB_LANG_operand_partial",
		kind: "function_block",
		feature: "Partial variable access — CODESYS-only `.%W1` / `.%B3` syntax; TC rejects",
		fromDoc: "05-operands.md",
		expectTcAccepts: false,
		recordIsolated: true,
		note: "DISCOVERY (verified live 2026-05-29): TC rejects `.%X<n>` / `.%B<n>` / `.%W<n>` / `.%D<n>` partial-variable access syntax with `'%' is no component of '<var>'`. The syntax is in the CODESYS 05-operands.md docs but is a CODESYS-only extension; TC engineers must use SHR/SHL + AND-mask or a UNION DUT to extract sub-word slices.",
		plcPrgVar: "fb_pa : FB_LANG_operand_partial;",
		plcPrgBody: "fb_pa.Extract();",
		source:
`FUNCTION_BLOCK FB_LANG_operand_partial
VAR
	dwSource : DWORD := 16#DEADBEEF;
	wHighWord : WORD;
	bHighByte : BYTE;
END_VAR

END_FUNCTION_BLOCK

METHOD Extract
wHighWord := dwSource.%W1;
bHighByte := dwSource.%B3;
END_METHOD
`,
	},

	// ─── Hardware addresses (%I, %Q, %M) ────────────────────────────────

	{
		name: "operand_hw_address_marker",
		pouName: "FB_LANG_operand_hw_marker",
		kind: "function_block",
		feature: "AT %M* — flag variable bound to marker memory address",
		fromDoc: "05-operands.md",
		expectTcAccepts: true,
		note: "TC accepts the AT-binding syntax declaration; mapping to actual hardware is a separate IO-configuration step that this test doesn't depend on.",
		plcPrgVar: "fb_hw : FB_LANG_operand_hw_marker;",
		plcPrgBody: "fb_hw.Read();",
		source:
`FUNCTION_BLOCK FB_LANG_operand_hw_marker
VAR
	bFlag AT %MX0.0 : BOOL;
	wRegister AT %MW10 : WORD;
END_VAR

END_FUNCTION_BLOCK

METHOD Read
wRegister := wRegister + 1;
END_METHOD
`,
	},

	// ─── Character literal (UCHAR#) ─────────────────────────────────────

	{
		name: "operand_uchar_literal",
		pouName: "FB_LANG_operand_uchar",
		kind: "function_block",
		feature: "UCHAR#'A' — CODESYS-only character literal; TC rejects",
		fromDoc: "05-operands.md",
		expectTcAccepts: false,
		recordIsolated: true,
		note: "DISCOVERY (verified live 2026-05-29): TC rejects `UCHAR#'A'` typed-literal syntax with `Unexpected Token 'UCHAR#' found`. CODESYS-only extension; in TC use the explicit numeric form like `BYTE#16#41` or read the byte via `STRING_TO_BYTE` / direct array indexing.",
		plcPrgVar: "fb_uc : FB_LANG_operand_uchar;",
		plcPrgBody: "fb_uc.Pick();",
		source:
`FUNCTION_BLOCK FB_LANG_operand_uchar
VAR
	bChar : BYTE;
END_VAR

END_FUNCTION_BLOCK

METHOD Pick
bChar := UCHAR#'A';
END_METHOD
`,
	},
];
