/**
 * the fixtures of `data-type.ts` — part B: CODESYS extension types (platform-dependent); Implicit Enumeration (inline VAR-section variant); Coverage extension for the old dut parser, lines 211-218 (alias init body).
 *
 * One slice of `data-type.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"

export const DATA_TYPE_TESTS_B: readonly LanguageTest[] = [
  // ─── CODESYS extension types (platform-dependent) ──────────────────

  {
    name: "type_codesys_xint",
    pouName: "FB_LANG_codesys_xint",
    kind: "function_block",
    feature: "__XINT — CODESYS platform-portable signed integer (16 / 32 / 64-bit per target)",
    fromDoc: "06-data-types.md",
    note: "CODESYS-only extension. TC support is platform-dependent — catalog records actual behavior.",
    plcPrgVar: "fb_xi : FB_LANG_codesys_xint;",
    plcPrgBody: "fb_xi.Compute();",
    source: `FUNCTION_BLOCK FB_LANG_codesys_xint
VAR
	xValue : __XINT;
END_VAR

END_FUNCTION_BLOCK

METHOD Compute
xValue := 42;
END_METHOD
`,
  },
  {
    name: "type_codesys_uxint",
    pouName: "FB_LANG_codesys_uxint",
    kind: "function_block",
    feature: "__UXINT — CODESYS platform-portable unsigned integer",
    fromDoc: "06-data-types.md",
    note: "CODESYS-only extension. TC support platform-dependent.",
    plcPrgVar: "fb_ux : FB_LANG_codesys_uxint;",
    plcPrgBody: "fb_ux.Compute();",
    source: `FUNCTION_BLOCK FB_LANG_codesys_uxint
VAR
	uxValue : __UXINT;
END_VAR

END_FUNCTION_BLOCK

METHOD Compute
uxValue := 42;
END_METHOD
`,
  },
  {
    name: "type_codesys_xword",
    pouName: "FB_LANG_codesys_xword",
    kind: "function_block",
    feature: "__XWORD — CODESYS platform-portable bitstring (pointer-sized)",
    fromDoc: "06-data-types.md",
    note: "CODESYS-only extension. Width matches platform pointer width.",
    plcPrgVar: "fb_xw : FB_LANG_codesys_xword;",
    plcPrgBody: "fb_xw.Compute();",
    source: `FUNCTION_BLOCK FB_LANG_codesys_xword
VAR
	xwValue : __XWORD;
END_VAR

END_FUNCTION_BLOCK

METHOD Compute
xwValue := 16#FF;
END_METHOD
`,
  },
  {
    name: "type_codesys_vector",
    pouName: "FB_LANG_codesys_vector",
    kind: "function_block",
    feature: "__VECTOR — CODESYS-only SIMD type; TC rejects",
    fromDoc: "06-data-types.md",
    note: "DISCOVERY (verified live 2026-05-29): TC rejects `__VECTOR[N] OF T` with 'Type definition expected instead of __VECTOR'. CODESYS-only extension; TC has no SIMD primitive — use plain ARRAY[0..N-1] OF T. The LSP agrees since frontend-conformance 2.1.4 (rule L11): `__VECTOR` is a keyword only in the CODESYS dialect, and `parse/type-expr` refuses the identifier on TwinCAT with the vendor's words, the declaration dropped, so the uses are 'not defined' as TwinCAT says.",
    plcPrgVar: "fb_v : FB_LANG_codesys_vector;",
    plcPrgBody: "fb_v.Compute();",
    source: `FUNCTION_BLOCK FB_LANG_codesys_vector
VAR
	vec4 : __VECTOR[4] OF REAL;
END_VAR

END_FUNCTION_BLOCK

METHOD Compute
vec4[0] := 1.0;
END_METHOD
`,
  },
  {
    name: "type_codesys_version",
    pouName: "FB_LANG_codesys_version",
    kind: "function_block",
    feature: "VERSION — CODESYS library/POU version-metadata type",
    fromDoc: "06-data-types.md",
    note: "CODESYS metadata type. TC support depends on library-package machinery.",
    plcPrgVar: "fb_ver : FB_LANG_codesys_version;",
    plcPrgBody: "fb_ver.Inspect();",
    source: `FUNCTION_BLOCK FB_LANG_codesys_version
VAR
	vTag : VERSION;
END_VAR

END_FUNCTION_BLOCK

METHOD Inspect
;
END_METHOD
`,
  },
  // ─── Implicit Enumeration (inline VAR-section variant) ─────────────

  {
    name: "type_implicit_enum_inline",
    pouName: "FB_LANG_implicit_enum",
    kind: "function_block",
    feature: "Implicit ENUM declared inline in a VAR section — no TYPE block",
    fromDoc: "06-data-types.md",
    note: "CODESYS 'Implicit Enumeration' — inline `(Idle, Running, Halted)` as a variable's type. No TYPE/END_TYPE wrapper; the enum values are scoped to the FB.",
    plcPrgVar: "fb_ie : FB_LANG_implicit_enum;",
    plcPrgBody: "fb_ie.Step();",
    source: `FUNCTION_BLOCK FB_LANG_implicit_enum
VAR
	eState : (Idle, Running, Halted) := Idle;
END_VAR

END_FUNCTION_BLOCK

METHOD Step
eState := Running;
END_METHOD
`,
  },
  {
    name: "type_dut_struct_with_bit_fields",
    pouName: "DUT_LANG_struct_bit_fields",
    kind: "dut",
    feature: "STRUCT with BIT fields — packed flags",
    fromDoc: "06-data-types.md",
    note: "BIT is only allowed in STRUCT field declarations (not standalone VAR), per the CODESYS BIT page.",
    plcPrgVar: "dut_flags : DUT_LANG_struct_bit_fields;",
    plcPrgBody: "dut_flags.bFlagA := TRUE;",
    source: `TYPE DUT_LANG_struct_bit_fields :
STRUCT
	bFlagA : BIT;
	bFlagB : BIT;
	bFlagC : BIT;
END_STRUCT
END_TYPE
`,
  },
  // ─── Coverage extension for the old dut parser, lines 211-218 (alias init body) ──
  // STRUCT EXTENDS is already covered by `type_dut_struct_extends`
  // above; remaining gap in that parser is the alias-with-init path.

  {
    name: "type_dut_alias_with_init",
    pouName: "DUT_LANG_alias_with_init",
    kind: "dut",
    feature: "TYPE alias with initial value — alias body init path in DUT parser",
    fromDoc: "06-data-types.md",
    plcPrgVar: "dut_awi : DUT_LANG_alias_with_init;",
    plcPrgBody: "dut_awi := dut_awi + 1;",
    source: `TYPE DUT_LANG_alias_with_init : INT := 42;
END_TYPE
`,
  },
]
