/**
 * NAMES PAST ASCII WITH "UNICODE IDENTIFIERS" OFF (openspec lsp-field-followups 2; lsp-field-false-positives 8.1.1).
 *
 * The project's Compile option "Unicode identifiers" decides whether a name may hold a character past ASCII (DIALECT
 * C28b). It is OFF in CODESYS's default and in the recording project, so these fixtures are what the build says of such a
 * name where nothing creates an object by it: a variable, a member, a type named, a name used, an enum value, a label —
 * each in CJK, Cyrillic, Latin-1 and an Arabic-Indic digit, and a name that opens in ASCII and goes on past it. A name in a
 * comment or a string is no name (the control). With the option ON (`cross-object/names-past-ascii.ts`, the `upa_*`
 * fixtures, recorded on volt-cli's `CodesysUnicodeMembers.3.5.21.40.project`) the same names build clean.
 */
import type { LanguageTest } from "../../types.js"

const doc = "openspec lsp-field-followups 2 — a name past ASCII with the project's \"Unicode identifiers\" off"
const ST = "%LANGUAGE ST\n"

const fb = (name: string, feature: string, decls: string, body: string): LanguageTest => ({
  name,
  pouName: `FB_LANG_${name}`,
  kind: "function_block",
  feature,
  fromDoc: doc,
  source: `FUNCTION_BLOCK FB_LANG_${name}\nVAR\n\tk : INT;\n${decls}END_VAR\n${ST}${body}\nEND_FUNCTION_BLOCK\n`,
  plcPrgVar: `inst_${name} : FB_LANG_${name};`,
  plcPrgBody: `inst_${name}();`,
})

export const UNICODE_IDENTIFIERS_OFF_TESTS: readonly LanguageTest[] = [
  // ─── a variable's name ───────────────────────────────────────────────────────────────────────────────────────────
  fb("uoff_var_cjk", "a variable named in CJK", "\t计数 : INT;\n", "k := 1;"),
  fb("uoff_var_cyrillic", "a variable named in Cyrillic", "\tсчёт : INT;\n", "k := 1;"),
  fb("uoff_var_latin1", "a variable named with an umlaut and ß", "\tgröße : INT;\n", "k := 1;"),
  fb("uoff_var_digit", "a variable whose name goes on in an Arabic-Indic digit", "\ta٣ : INT;\n", "k := 1;"),
  fb("uoff_var_ascii_then_cjk", "a variable whose name opens in ASCII and goes on in CJK", "\tn计数 : INT;\n", "k := 1;"),
  fb("uoff_var_middle", "a variable whose name holds one letter past ASCII between ASCII ones", "\tabäcd : INT;\n", "k := 1;"),
  // ─── a name used ───────────────────────────────────────────────────────────────────────────────────────────────
  fb("uoff_use_read", "a name past ASCII read in an expression", "", "k := 计数;"),
  fb("uoff_use_target", "a name past ASCII as an assignment's target", "", "计数 := 1;"),
  fb("uoff_use_call_argument", "a name past ASCII as a call's argument", "", "k := ABS(größe);"),
  // ─── a type named, a member, an enum value, a label ──────────────────────────────────────────────────────────────
  fb("uoff_type_named", "a variable whose type is named past ASCII", "\tv : 类型;\n", "k := 1;"),
  {
    name: "uoff_struct_member",
    pouName: "DUT_LANG_uoff_struct_member",
    kind: "dut",
    feature: "a STRUCT member named past ASCII",
    fromDoc: doc,
    source: "TYPE DUT_LANG_uoff_struct_member :\nSTRUCT\n\ta : INT;\n\tпункт : INT;\nEND_STRUCT\nEND_TYPE\n",
    plcPrgVar: "s_uoff_struct_member : DUT_LANG_uoff_struct_member;",
  },
  fb("uoff_member_access", "a member past ASCII read off a struct", "\trec : DUT_LANG_uoff_access;\n", "k := rec.пункт;"),
  {
    name: "uoff_enum_value",
    pouName: "DUT_LANG_uoff_enum_value",
    kind: "dut",
    feature: "an enum value named past ASCII",
    fromDoc: doc,
    source: "TYPE DUT_LANG_uoff_enum_value :\n(\n\tgrün,\n\tblue\n);\nEND_TYPE\n",
    plcPrgVar: "e_uoff_enum_value : DUT_LANG_uoff_enum_value;",
  },
  fb("uoff_label", "a jump label named past ASCII", "", "标签:\nk := 1;"),
  {
    name: "uoff_global",
    pouName: "GVL_LANG_uoff_global",
    kind: "gvl",
    feature: "a global variable named past ASCII",
    fromDoc: doc,
    source: "VAR_GLOBAL\n\tg_uoff : INT;\n\tg_größe : INT;\nEND_VAR\n",
    plcPrgVar: "k_uoff_global : INT;",
    plcPrgBody: "k_uoff_global := g_uoff;",
  },
  // ─── the controls: past ASCII where no name stands ──────────────────────────────────────────────────────────────
  fb("uoff_comment_control", "text past ASCII in a line and a block comment — no name, the build is clean", "\tn : INT; // 计数 счёт\n", "(* größe *)\nk := n;"),
  {
    ...fb("uoff_wstring_control", "text past ASCII in a WSTRING literal — no name", "\tw : WSTRING := \"größe\";\n", "k := LEN(WSTRING_TO_STRING(w));"),
    // CODESYS narrows "größe" to SEVEN units (record:exec 2026-10-30: its UTF-8 bytes); both backends narrow unit for unit,
    // 5 — the prelude's `narrow` was measured on ASCII alone. The class (the reverse widen, a cut at the capacity inside a
    // character, a unit no encoding holds) is lsp-field-followups task 4's sweep.
    deferred: {
      transpile: "WSTRING_TO_STRING of a character past ASCII is its UTF-8 bytes in CODESYS (k = 7), one unit per unit here (5) — openspec lsp-field-followups 4",
    },
  },
  // the DUT `uoff_member_access` reads its member off — ASCII, so only the read is past ASCII
  {
    name: "uoff_access_type",
    pouName: "DUT_LANG_uoff_access",
    kind: "dut",
    feature: "the struct `uoff_member_access` reads — every name ASCII (support)",
    fromDoc: doc,
    source: "TYPE DUT_LANG_uoff_access :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE\n",
    plcPrgVar: "s_uoff_access_type : DUT_LANG_uoff_access;",
  },
]
