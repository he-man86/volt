/**
 * Advanced-type conformance tests — ARRAY / POINTER / REFERENCE /
 * VAR_TEMP / parameterized STRING.
 *
 * Source: 02-variables.md, 06-data-types.md.
 *
 * Same LanguageTest shape as pragmas — see `test/conformance/types.ts` (`LanguageTest`) for field docs.
 */
import type { LanguageTest } from "../../types.js"

export const ADVANCED_TYPE_TESTS: readonly LanguageTest[] = [
  // ========================================================================
  // Category: 06-data-types.md — compound type declarations + access
  // ========================================================================

  {
    name: "type_array_of_int",
    pouName: "FB_LANG_type_array_of_int",
    kind: "function_block",
    feature: "ARRAY[0..9] OF INT — declaration + indexed access",
    fromDoc: "06-data-types.md",
    plcPrgVar: "fb_arr : FB_LANG_type_array_of_int;",
    plcPrgBody: "fb_arr.Init();",
    source: `FUNCTION_BLOCK FB_LANG_type_array_of_int
VAR
	aBuffer : ARRAY[0..9] OF INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Init
aBuffer[0] := 42;
END_METHOD
`,
  },

  {
    name: "type_array_2d",
    pouName: "FB_LANG_type_array_2d",
    kind: "function_block",
    feature: "ARRAY[0..3, 0..3] OF REAL — 2-dimensional array",
    fromDoc: "06-data-types.md",
    plcPrgVar: "fb_arr2 : FB_LANG_type_array_2d;",
    plcPrgBody: "fb_arr2.Init();",
    source: `FUNCTION_BLOCK FB_LANG_type_array_2d
VAR
	mMatrix : ARRAY[0..3, 0..3] OF REAL;
END_VAR

END_FUNCTION_BLOCK

METHOD Init
mMatrix[0, 0] := 1.0;
END_METHOD
`,
  },

  {
    name: "type_pointer_to_int",
    pouName: "FB_LANG_type_pointer_to_int",
    kind: "function_block",
    feature: "POINTER TO INT — declaration + ADR / ^ dereference",
    fromDoc: "06-data-types.md",
    plcPrgVar: "fb_ptr : FB_LANG_type_pointer_to_int;",
    plcPrgBody: "fb_ptr.Init();",
    source: `FUNCTION_BLOCK FB_LANG_type_pointer_to_int
VAR
	iValue : INT := 7;
	pInt : POINTER TO INT;
	iCopy : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Init
pInt := ADR(iValue);
iCopy := pInt^;
END_METHOD
`,
  },

  {
    name: "type_reference_to_int",
    pouName: "FB_LANG_type_reference_to_int",
    kind: "function_block",
    feature: "REFERENCE TO INT — declaration + REF= binding",
    fromDoc: "06-data-types.md",
    plcPrgVar: "fb_ref : FB_LANG_type_reference_to_int;",
    plcPrgBody: "fb_ref.Init();",
    source: `FUNCTION_BLOCK FB_LANG_type_reference_to_int
VAR
	iValue : INT := 7;
	rInt : REFERENCE TO INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Init
rInt REF= iValue;
END_METHOD
`,
  },

  {
    name: "type_string_n",
    pouName: "FB_LANG_type_string_n",
    kind: "function_block",
    feature: "STRING(64) — parameterized-length string",
    fromDoc: "06-data-types.md",
    plcPrgVar: "fb_strn : FB_LANG_type_string_n;",
    plcPrgBody: "fb_strn.Init();",
    source: `FUNCTION_BLOCK FB_LANG_type_string_n
VAR
	sShort : STRING(8);
	sLong  : STRING(255);
END_VAR

END_FUNCTION_BLOCK

METHOD Init
sShort := 'hello';
sLong := 'longer string';
END_METHOD
`,
  },

  {
    name: "type_var_temp_in_method",
    pouName: "FB_LANG_type_var_temp_in_method",
    kind: "function_block",
    feature: "VAR_TEMP inside a METHOD body — TC rejects (placement restriction)",
    fromDoc: "02-variables.md",
    note: "DISCOVERY: VAR_TEMP is not allowed in a METHOD body — both vendors: 'VAR_TEMP declaration not allowed in this place'. Nor in a FUNCTION (`type_var_temp_in_function`, 2026-10-09; this note said 'allowed in PROGRAM / FUNCTION'): a PROGRAM or FUNCTION_BLOCK holds VAR_TEMP. The LSP's var-section-placement checks both.",
    plcPrgVar: "fb_vtmp : FB_LANG_type_var_temp_in_method;",
    plcPrgBody: "fb_vtmp.Compute();",
    source: `FUNCTION_BLOCK FB_LANG_type_var_temp_in_method
VAR
	iResult : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Compute
VAR_TEMP
	iScratch : INT;
END_VAR
iScratch := 10;
iResult := iScratch + 5;
END_METHOD
`,
  },
  {
    name: "type_var_temp_in_function",
    pouName: "F_LANG_type_var_temp_in_function",
    kind: "function",
    feature: "VAR_TEMP directly in a FUNCTION — allowed, or refused as in a METHOD? (transpile-restructure gate 5a review)",
    fromDoc: "02-variables.md",
    note: "LIVE (2026-10-09): refused on both vendors — CODESYS 'VAR_TEMP declaration not allowed in this place' (record:language and record:exec), TwinCAT \"'VAR_TEMP' declaration not allowed in this place\"; a FUNCTION's temporaries are its VAR. The LSP's var-section-placement said 'allowed in FUNCTION (live-calibrated)' with no recording behind it; fixed in the same step.",
    plcPrgVar: "res : INT;",
    plcPrgBody: "res := F_LANG_type_var_temp_in_function(k := 4);",
    source: `FUNCTION F_LANG_type_var_temp_in_function : INT
VAR_INPUT
	k : INT;
END_VAR
VAR_TEMP
	t : INT;
END_VAR
t := k + 1;
F_LANG_type_var_temp_in_function := t;
END_FUNCTION
`,
  },

  {
    name: "type_var_constant",
    pouName: "FB_LANG_type_var_constant",
    kind: "function_block",
    feature: "VAR CONSTANT — constants inside an FB",
    fromDoc: "02-variables.md",
    plcPrgVar: "fb_vc : FB_LANG_type_var_constant;",
    plcPrgBody: "fb_vc.Use();",
    source: `FUNCTION_BLOCK FB_LANG_type_var_constant
VAR CONSTANT
	C_LIMIT : INT := 100;
END_VAR
VAR
	iCount : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Use
iCount := C_LIMIT;
END_METHOD
`,
  },

  // ─── Negative: pointer-deref on non-pointer ─────────────────────────

  {
    name: "type_deref_non_pointer",
    pouName: "FB_LANG_type_deref_non_pointer",
    kind: "function_block",
    feature: "Dereferencing a non-pointer variable with ^ — TC should error",
    fromDoc: "06-data-types.md",
    note: "Applying ^ to an INT (not POINTER TO ...) is invalid. TC errors. LSP doesn't currently model pointer-deref validity — TC-only gap.",
    plcPrgVar: "fb_dnp : FB_LANG_type_deref_non_pointer;",
    plcPrgBody: "fb_dnp.Execute();",
    source: `FUNCTION_BLOCK FB_LANG_type_deref_non_pointer
VAR
	iValue : INT;
	iOther : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Execute
iOther := iValue^;
END_METHOD
`,
  },
]
