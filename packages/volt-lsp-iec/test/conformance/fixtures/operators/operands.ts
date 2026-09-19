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
import type { LanguageTest } from "../../types.js"

export const OPERANDS_TESTS: readonly LanguageTest[] = [
  // ─── Bit access on integer variables ────────────────────────────────

  {
    name: "operand_bit_access_byte",
    pouName: "FB_LANG_operand_bit_byte",
    kind: "function_block",
    feature: "Indexed bit access on a BYTE — `wValue.0` reads bit 0",
    fromDoc: "05-operands.md",
    plcPrgVar: "fb_bit : FB_LANG_operand_bit_byte;",
    plcPrgBody: "fb_bit.Inspect();",
    source: `FUNCTION_BLOCK FB_LANG_operand_bit_byte
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
    plcPrgVar: "fb_ba : FB_LANG_operand_bit_assign;",
    plcPrgBody: "fb_ba.Flip();",
    source: `FUNCTION_BLOCK FB_LANG_operand_bit_assign
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
    note: "DISCOVERY (verified live 2026-05-29): TC rejects `.%X<n>` / `.%B<n>` / `.%W<n>` / `.%D<n>` partial-variable access syntax with `'%' is no component of '<var>'`. The syntax is in the CODESYS 05-operands.md docs but is a CODESYS-only extension; TC engineers must use SHR/SHL + AND-mask or a UNION DUT to extract sub-word slices.",
    plcPrgVar: "fb_pa : FB_LANG_operand_partial;",
    plcPrgBody: "fb_pa.Extract();",
    source: `FUNCTION_BLOCK FB_LANG_operand_partial
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
    note: "TC accepts the AT-binding syntax declaration; mapping to actual hardware is a separate IO-configuration step that this test doesn't depend on.",
    plcPrgVar: "fb_hw : FB_LANG_operand_hw_marker;",
    plcPrgBody: "fb_hw.Read();",
    source: `FUNCTION_BLOCK FB_LANG_operand_hw_marker
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
    note: "DISCOVERY (verified live 2026-05-29): TC rejects `UCHAR#'A'` typed-literal syntax with `Unexpected Token 'UCHAR#' found`. CODESYS-only extension; in TC use the explicit numeric form like `BYTE#16#41` or read the byte via `STRING_TO_BYTE` / direct array indexing.",
    plcPrgVar: "fb_uc : FB_LANG_operand_uchar;",
    plcPrgBody: "fb_uc.Pick();",
    source: `FUNCTION_BLOCK FB_LANG_operand_uchar
VAR
	bChar : BYTE;
END_VAR

END_FUNCTION_BLOCK

METHOD Pick
bChar := UCHAR#'A';
END_METHOD
`,
  },
  // ─── THE CONSTRUCTS THE INDEX SAYS NOTHING COVERED ─────────────────────────────────────────────────
  // `construct-index.test.ts` reads the vendor's own operator list and requires every entry to resolve to a fixture
  // or a stated gap. These were the stated gaps — nine operators nothing exercised, so nothing knew whether CODESYS
  // even accepts the spelling, let alone what it answers. Recording them costs a build each and turns nine unknowns
  // into nine facts; a REFUSAL by the vendor is as useful an answer as a value, because it tells us the construct
  // needs no lowering at all.
  {
    name: "operand_indexof",
    refused: "The operator INDEXOF is no longer supported. Use ADR instead. ADR on a POU name returns a pointer to a pointer to the function code.",
    pouName: "FB_LANG_operand_indexof",
    kind: "function_block" as const,
    feature: "INDEXOF(<POU>) — accepted, and what does it answer?",
    fromDoc: "03-operators.md",
    plcPrgVar: "inst_operand_indexof : FB_LANG_operand_indexof;",
    plcPrgBody: "inst_operand_indexof();",
    source: "FUNCTION_BLOCK FB_LANG_operand_indexof\nVAR\n\tidx : DINT;\nEND_VAR\nidx := INDEXOF(FB_LANG_operand_indexof);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "operand_bitadr",
    refused: "Operation 'BitAdr' is not possible on type 'BIT'",
    pouName: "FB_LANG_operand_bitadr",
    kind: "function_block" as const,
    feature: "BITADR(<bit-var>) — the bit address of a bit-addressed variable",
    fromDoc: "03-operators.md",
    plcPrgVar: "inst_operand_bitadr : FB_LANG_operand_bitadr;",
    plcPrgBody: "inst_operand_bitadr();",
    source: "FUNCTION_BLOCK FB_LANG_operand_bitadr\nVAR\n\tw : WORD;\n\taddr : DWORD;\nEND_VAR\naddr := BITADR(w.3);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "operand_querypointer",
    refused: "First operand of __QueryPointer must be an interface reference or the instance of a function block",
    pouName: "FB_LANG_operand_querypointer",
    kind: "function_block" as const,
    feature: "__QUERYPOINTER — the runtime cast to POINTER TO, beside __QUERYINTERFACE which IS lowered",
    fromDoc: "03-operators.md",
    plcPrgVar: "inst_operand_querypointer : FB_LANG_operand_querypointer;",
    plcPrgBody: "inst_operand_querypointer();",
    source: "FUNCTION_BLOCK FB_LANG_operand_querypointer\nVAR\n\tsrc_ : POINTER TO INT;\n\tdst : POINTER TO DINT;\n\tok : BOOL;\nEND_VAR\nok := __QUERYPOINTER(src_, dst);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "operand_position",
    refused: "';' expected instead of end of POU",
    pouName: "FB_LANG_operand_position",
    kind: "function_block" as const,
    feature: "__POSITION — the source position the implicit-parameter pragma uses",
    note:
      "The FIRST of the seven `sysop_position_*` probes and the one that showed the message describes nothing: " +
      "CODESYS names the token AFTER `__POSITION`, never `__POSITION` itself. It is a STRING-returning call whose " +
      "parentheses the compiler eats a token in place of.",
    fromDoc: "03-operators.md",
    plcPrgVar: "inst_operand_position : FB_LANG_operand_position;",
    plcPrgBody: "inst_operand_position();",
    source: "FUNCTION_BLOCK FB_LANG_operand_position\nVAR\n\there : DINT;\nEND_VAR\nhere := __POSITION;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "operand_compare_and_swap",
    refused: "Cannot convert type 'DINT' to type 'POINTER TO LWORD'",
    pouName: "FB_LANG_operand_compare_and_swap",
    kind: "function_block" as const,
    feature: "__COMPARE_AND_SWAP — an atomic, whose meaning under a single-task simulator is the question",
    fromDoc: "03-operators.md",
    plcPrgVar: "inst_operand_compare_and_swap : FB_LANG_operand_compare_and_swap;",
    plcPrgBody: "inst_operand_compare_and_swap();",
    source: "FUNCTION_BLOCK FB_LANG_operand_compare_and_swap\nVAR\n\tvalue : DINT := 1;\n\tswapped : BOOL;\nEND_VAR\nswapped := __COMPARE_AND_SWAP(value, 1, 2);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "operand_xadd",
    refused: "Cannot convert type 'DINT' to type 'POINTER TO DINT'",
    pouName: "FB_LANG_operand_xadd",
    kind: "function_block" as const,
    feature: "__XADD — atomic exchange-and-add",
    fromDoc: "03-operators.md",
    plcPrgVar: "inst_operand_xadd : FB_LANG_operand_xadd;",
    plcPrgBody: "inst_operand_xadd();",
    source: "FUNCTION_BLOCK FB_LANG_operand_xadd\nVAR\n\tvalue : DINT := 1;\n\tprevious : DINT;\nEND_VAR\nprevious := __XADD(value, 5);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "operand_test_and_set",
    refused: "Cannot convert type 'DWORD' to type 'BOOL'",
    pouName: "FB_LANG_operand_test_and_set",
    kind: "function_block" as const,
    feature: "TEST_AND_SET — atomic test-and-set",
    fromDoc: "03-operators.md",
    plcPrgVar: "inst_operand_test_and_set : FB_LANG_operand_test_and_set;",
    plcPrgBody: "inst_operand_test_and_set();",
    source: "FUNCTION_BLOCK FB_LANG_operand_test_and_set\nVAR\n\tflag : DWORD;\n\twas : BOOL;\nEND_VAR\nwas := TEST_AND_SET(flag);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "operand_ini_deprecated",
    pouName: "FB_LANG_operand_ini_deprecated",
    kind: "function_block" as const,
    feature: "INI — the V2.3 initialisation operator, which the reference says is REPLACED by FB_Init (a warning?)",
    fromDoc: "03-operators.md",
    plcPrgVar: "inst_operand_ini_deprecated : FB_LANG_operand_ini_deprecated;",
    plcPrgBody: "inst_operand_ini_deprecated();",
    source: "FUNCTION_BLOCK FB_LANG_ini_target\nVAR\n\tn : INT;\nEND_VAR\nn := n + 1;\nEND_FUNCTION_BLOCK\n\nFUNCTION_BLOCK FB_LANG_operand_ini_deprecated\nVAR\n\theld : FB_LANG_ini_target;\n\tok : BOOL;\nEND_VAR\nok := INI(held, TRUE);\nEND_FUNCTION_BLOCK\n",
  },
]
