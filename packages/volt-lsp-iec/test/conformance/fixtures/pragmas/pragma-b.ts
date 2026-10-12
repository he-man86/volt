/**
 * the fixtures of `pragma.ts` — part B: More variable + POU attributes (batch 2); Additional message pragmas: positive emission cases; More variable + POU attributes (batch 3).
 *
 * One slice of `pragma.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"

export const PRAGMA_TESTS_B: readonly LanguageTest[] = [
  // ─── More variable + POU attributes (batch 2) ────────────────────

  {
    name: "enable_dynamic_creation",
    pouName: "FB_LANG_enable_dynamic_creation",
    kind: "function_block",
    feature: "{attribute 'enable_dynamic_creation'} required for __NEW operator on FB",
    fromDoc: "07-pragmas.md#enable_dynamic_creation",
    plcPrgVar: "fb_edc : FB_LANG_enable_dynamic_creation;",
    plcPrgBody: "fb_edc();",
    source: `{attribute 'enable_dynamic_creation'}
FUNCTION_BLOCK FB_LANG_enable_dynamic_creation
VAR
	iVar : INT;
END_VAR

END_FUNCTION_BLOCK
`,
  },
  {
    name: "const_replaced",
    pouName: "FB_LANG_const_replaced",
    kind: "function_block",
    feature: "{attribute 'const_replaced'} forces a constant to be inlined",
    fromDoc: "07-pragmas.md#const_replaced--const_non_replaced",
    plcPrgVar: "fb_cr : FB_LANG_const_replaced;",
    plcPrgBody: "fb_cr();",
    source: `FUNCTION_BLOCK FB_LANG_const_replaced
VAR CONSTANT
	{attribute 'const_replaced'}
	C_MAX : INT := 100;
END_VAR
VAR
	iLocal : INT;
END_VAR
iLocal := C_MAX;
END_FUNCTION_BLOCK
`,
  },
  {
    name: "const_non_replaced",
    pouName: "FB_LANG_const_non_replaced",
    kind: "function_block",
    feature: "{attribute 'const_non_replaced'} keeps a constant as a symbol",
    fromDoc: "07-pragmas.md#const_replaced--const_non_replaced",
    plcPrgVar: "fb_cnr : FB_LANG_const_non_replaced;",
    plcPrgBody: "fb_cnr();",
    source: `FUNCTION_BLOCK FB_LANG_const_non_replaced
VAR CONSTANT
	{attribute 'const_non_replaced'}
	C_LIMIT : INT := 200;
END_VAR
VAR
	iLocal : INT;
END_VAR
iLocal := C_LIMIT;
END_FUNCTION_BLOCK
`,
  },
  {
    name: "global_init_slot",
    pouName: "FB_LANG_global_init_slot",
    kind: "function_block",
    feature: "{attribute 'global_init_slot' := '49000'} overrides init order",
    fromDoc: "07-pragmas.md#global_init_slot",
    plcPrgVar: "fb_gis : FB_LANG_global_init_slot;",
    plcPrgBody: "fb_gis();",
    source: `{attribute 'global_init_slot' := '49000'}
FUNCTION_BLOCK FB_LANG_global_init_slot
VAR
	iVar : INT;
END_VAR

END_FUNCTION_BLOCK
`,
  },
  {
    name: "monitoring_display",
    pouName: "FB_LANG_monitoring_display",
    kind: "function_block",
    feature: "{attribute 'monitoring_display' := '<member>'} shows member in monitor",
    fromDoc: "07-pragmas.md#monitoring_display",
    plcPrgVar: "fb_md : FB_LANG_monitoring_display;",
    plcPrgBody: "fb_md.iStatus := 1;",
    source: `{attribute 'monitoring_display' := 'iStatus'}
FUNCTION_BLOCK FB_LANG_monitoring_display
VAR
	iStatus : INT;
END_VAR

END_FUNCTION_BLOCK
`,
  },
  {
    name: "monitoring_encoding",
    pouName: "FB_LANG_monitoring_encoding",
    kind: "function_block",
    feature: "{attribute 'monitoring_encoding' := 'UTF8'} marks a STRING as UTF-8",
    fromDoc: "07-pragmas.md#monitoring_encoding",
    plcPrgVar: "fb_me : FB_LANG_monitoring_encoding;",
    plcPrgBody: "fb_me.sValue := 'hello';",
    source: `FUNCTION_BLOCK FB_LANG_monitoring_encoding
VAR
	{attribute 'monitoring_encoding' := 'UTF8'}
	sValue : STRING;
END_VAR

END_FUNCTION_BLOCK
`,
  },
  {
    name: "subsequent",
    pouName: "FB_LANG_subsequent",
    kind: "function_block",
    feature: "{attribute 'subsequent'} allocates VAR section contiguously",
    fromDoc: "07-pragmas.md#subsequent",
    plcPrgVar: "fb_sub : FB_LANG_subsequent;",
    plcPrgBody: "fb_sub.iA := 1; fb_sub.iB := 2;",
    source: `FUNCTION_BLOCK FB_LANG_subsequent
{attribute 'subsequent'}
VAR
	iA : INT;
	iB : INT;
	iC : INT;
END_VAR

END_FUNCTION_BLOCK
`,
  },
  {
    name: "suppress_warning",
    pouName: "FB_LANG_suppress_warning",
    kind: "function_block",
    feature: "{attribute 'suppress_warning' := '<id>'} hides specific TC warnings within the POU",
    fromDoc: "07-pragmas.md#suppress_warning",
    plcPrgVar: "fb_sw : FB_LANG_suppress_warning;",
    plcPrgBody: "fb_sw();",
    source: `{attribute 'suppress_warning' := '0125'}
FUNCTION_BLOCK FB_LANG_suppress_warning
VAR
	iVar : INT;
END_VAR

END_FUNCTION_BLOCK
`,
  },
  {
    name: "conditionalshow",
    pouName: "FB_LANG_conditionalshow",
    kind: "function_block",
    feature: "{attribute 'conditionalshow' := '<text>'} hides identifiers conditionally",
    fromDoc: "07-pragmas.md#conditionalshow",
    plcPrgVar: "fb_cs : FB_LANG_conditionalshow;",
    plcPrgBody: "fb_cs.iHidden := 1;",
    source: `FUNCTION_BLOCK FB_LANG_conditionalshow
VAR
	{attribute 'conditionalshow' := 'maintainer_only'}
	iHidden : INT;
END_VAR

END_FUNCTION_BLOCK
`,
  },
  {
    name: "pingroup",
    pouName: "FB_LANG_pingroup",
    kind: "function_block",
    feature: "{attribute 'pingroup' := '<name>'} groups FB pins in graphical editors",
    fromDoc: "07-pragmas.md#pingroup",
    plcPrgVar: "fb_pg : FB_LANG_pingroup;",
    plcPrgBody: "fb_pg(iInputA := 1, iInputB := 2);",
    source: `FUNCTION_BLOCK FB_LANG_pingroup
VAR_INPUT
	{attribute 'pingroup' := 'control'}
	iInputA : INT;
	{attribute 'pingroup' := 'control'}
	iInputB : INT;
END_VAR

END_FUNCTION_BLOCK
`,
  },
  // ─── Additional message pragmas: positive emission cases ──────────

  {
    name: "info_message",
    pouName: "FB_LANG_info_message",
    kind: "function_block",
    feature: "{info 'msg'} emits a TC informational message (filterable)",
    fromDoc: "07-pragmas.md#message-pragmas",
    plcPrgVar: "fb_info : FB_LANG_info_message;",
    plcPrgBody: "fb_info();",
    note: "TC should accept and emit an info-level diagnostic.",
    source: `FUNCTION_BLOCK FB_LANG_info_message
VAR
	iVar : INT;
END_VAR
{info 'this is a deliberate test info'}
iVar := iVar + 1;
END_FUNCTION_BLOCK
`,
  },
  {
    name: "text_message",
    pouName: "FB_LANG_text_message",
    kind: "function_block",
    feature: "{text 'msg'} emits a TC plain-text message (no severity)",
    fromDoc: "07-pragmas.md#message-pragmas",
    plcPrgVar: "fb_text : FB_LANG_text_message;",
    plcPrgBody: "fb_text();",
    source: `FUNCTION_BLOCK FB_LANG_text_message
VAR
	iVar : INT;
END_VAR
{text 'this is a deliberate test text'}
iVar := iVar + 1;
END_FUNCTION_BLOCK
`,
  },
  // ─── More variable + POU attributes (batch 3) ────────────────────

  {
    name: "instance_path_with_reflection",
    pouName: "FB_LANG_instance_path_with_reflection",
    kind: "function_block",
    feature: "{attribute 'instance-path'} STRING var inside a {attribute 'reflection'} FB",
    fromDoc: "07-pragmas.md#instance-path",
    note: "Compound attribute setup: instance-path requires reflection on the FB + noinit on the STRING.",
    deferred: {
      transpile:
        "the path is taken from the project tree, Device.Application.PLC_PRG.fb_ipr — the simulator's reads Device.Sim.Device.Application…, a segment the tree does not hold (user decision 2026-09-15)",
    },
    plcPrgVar: "fb_ipr : FB_LANG_instance_path_with_reflection;",
    plcPrgBody: "fb_ipr();",
    source: `{attribute 'reflection'}
FUNCTION_BLOCK FB_LANG_instance_path_with_reflection
VAR
	{attribute 'instance-path'}
	{attribute 'noinit'}
	sMyPath : STRING(255);
END_VAR

END_FUNCTION_BLOCK
`,
  },
  {
    name: "displaymode_bin",
    pouName: "FB_LANG_displaymode_bin",
    kind: "function_block",
    feature: "{attribute 'displaymode' := 'bin'} variant value",
    fromDoc: "07-pragmas.md#displaymode",
    plcPrgVar: "fb_dmb : FB_LANG_displaymode_bin;",
    plcPrgBody: "fb_dmb.iBits := 2#1010;",
    source: `FUNCTION_BLOCK FB_LANG_displaymode_bin
VAR
	{attribute 'displaymode' := 'bin'}
	iBits : BYTE;
END_VAR

END_FUNCTION_BLOCK
`,
  },
  {
    name: "displaymode_dec",
    pouName: "FB_LANG_displaymode_dec",
    kind: "function_block",
    feature: "{attribute 'displaymode' := 'dec'} variant value (the default, made explicit)",
    fromDoc: "07-pragmas.md#displaymode",
    plcPrgVar: "fb_dmd : FB_LANG_displaymode_dec;",
    plcPrgBody: "fb_dmd.iDec := 42;",
    source: `FUNCTION_BLOCK FB_LANG_displaymode_dec
VAR
	{attribute 'displaymode' := 'dec'}
	iDec : INT;
END_VAR

END_FUNCTION_BLOCK
`,
  },
  {
    name: "displaymode_invalid_value",
    pouName: "FB_LANG_displaymode_invalid_value",
    kind: "function_block",
    feature: "{attribute 'displaymode' := 'xyz'} invalid value — should warn",
    fromDoc: "07-pragmas.md#displaymode",
    note: "Only valid values are bin/binary/dec/decimal/hex/hexadecimal. TC may silently ignore; LSP could validate the value enum.",
    plcPrgVar: "fb_dmi : FB_LANG_displaymode_invalid_value;",
    plcPrgBody: "fb_dmi.iVal := 1;",
    source: `FUNCTION_BLOCK FB_LANG_displaymode_invalid_value
VAR
	{attribute 'displaymode' := 'xyz'}
	iVal : INT;
END_VAR

END_FUNCTION_BLOCK
`,
  },
  {
    name: "suppress_warning_multi",
    pouName: "FB_LANG_suppress_warning_multi",
    kind: "function_block",
    feature: "{attribute 'suppress_warning' := '<id1>','<id2>'} with multiple warning IDs",
    fromDoc: "07-pragmas.md#suppress_warning",
    plcPrgVar: "fb_swm : FB_LANG_suppress_warning_multi;",
    plcPrgBody: "fb_swm();",
    source: `{attribute 'suppress_warning' := '0125','0033'}
FUNCTION_BLOCK FB_LANG_suppress_warning_multi
VAR
	iVar : INT;
END_VAR

END_FUNCTION_BLOCK
`,
  },
  {
    name: "no_init_aliases",
    pouName: "FB_LANG_no_init_aliases",
    kind: "function_block",
    feature: "noinit / no_init / no-init — all three alias forms",
    fromDoc: "07-pragmas.md#noinit",
    note: "Per docs, three spellings of the same attribute. TC + LSP must accept all three identically.",
    plcPrgVar: "fb_nia : FB_LANG_no_init_aliases;",
    plcPrgBody: "fb_nia.iA := fb_nia.iA + 1;",
    source: `FUNCTION_BLOCK FB_LANG_no_init_aliases
VAR
	{attribute 'noinit'}
	iA : INT;
	{attribute 'no_init'}
	iB : INT;
	{attribute 'no-init'}
	iC : INT;
END_VAR

END_FUNCTION_BLOCK
`,
  },
  {
    name: "linkalways_with_unused_pou",
    pouName: "FB_LANG_linkalways_with_unused_pou",
    kind: "function_block",
    feature: "{attribute 'linkalways'} on an FB that PLC_PRG doesn't call",
    fromDoc: "07-pragmas.md#linkalways",
    note: "The whole point of linkalways: force compile even when uncalled. PLC_PRG entry intentionally absent.",
    plcPrgVar: undefined,
    plcPrgBody: undefined,
    source: `{attribute 'linkalways'}
FUNCTION_BLOCK FB_LANG_linkalways_with_unused_pou
VAR
	iVar : INT;
END_VAR

END_FUNCTION_BLOCK
`,
  },
]
