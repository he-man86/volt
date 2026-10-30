/**
 * OBJECTS NAMED PAST ASCII (openspec lsp-field-false-positives 8, class 1). An object's name is read from its document's
 * URI wherever the text does not state it — the signature check's object, a GVL's name in "already defined in '<list>'",
 * a qualified global `<list>.g`, the ambiguity between two lists. A client percent-encodes every character past ASCII, so
 * each of those reads must decode (`syntax/format/source-object.ts` `documentPath`). The replay hands every fixture to
 * the LSP under the URI a client would send (`support/fixture-uri.ts`), so each fixture below asks one such read through
 * the decoding; a matching control and a real mismatch beside them, as `signature-name.ts` has, because a check that is
 * silent on everything is no check. Names in three scripts: CJK, Cyrillic, and Latin-1 with diacritics.
 *
 * RECORDED ON THE "UNICODE IDENTIFIERS" PROJECT. With the project's Compile option "Unicode identifiers" off —
 * CODESYS's default, and the recording project's — the IDE refuses to CREATE each of these objects ("The name
 * 'FB_LANG_主控制' is not valid for this object.", 2026-10-29, as DIALECT C28b measured); the field projects that raised
 * this class have it on. So these are recorded in `CodesysUnicodeMembers.3.5.21.40.project` (volt-cli's fixture: the
 * recording project with the option switched on and saved, `scripts/author-unicode-members-fixture.py`), whose extra
 * objects build clean and are reached by none of these.
 */
import type { LanguageTest } from "../../types.js"

const doc = "openspec lsp-field-false-positives 8 — a name read from a percent-encoded URI"

const fb = (name: string, pouName: string, header: string, feature: string): LanguageTest => ({
  name,
  pouName,
  kind: "function_block",
  feature,
  fromDoc: doc,
  source: `FUNCTION_BLOCK ${header}\nVAR\n\tn : INT;\nEND_VAR\nn := n + 1;\nEND_FUNCTION_BLOCK\n`,
  plcPrgVar: `inst_${name} : ${header};`,
  plcPrgBody: `inst_${name}();`,
})

export const NAMES_PAST_ASCII_TESTS: readonly LanguageTest[] = ([
  // ─── the signature against the object: every POU kind and a DUT, the object named past ASCII ─────────────────────
  fb("upa_fb_cjk", "FB_LANG_主控制", "FB_LANG_主控制", "an FB named `FB_LANG_主控制` whose signature agrees"),
  fb("upa_fb_cyrillic", "FB_LANG_Привод", "FB_LANG_Привод", "an FB named in Cyrillic whose signature agrees"),
  fb("upa_fb_latin1", "FB_LANG_Größe", "FB_LANG_Größe", "an FB named with umlauts and ß whose signature agrees"),
  fb("upa_fb_mismatch", "FB_LANG_主控制甲", "FB_LANG_主控制乙", "an FB named past ASCII whose signature names ANOTHER name — the mismatch is still reported"),
  {
    name: "upa_function_cjk",
    pouName: "F_LANG_计算",
    kind: "function",
    feature: "a FUNCTION named `F_LANG_计算` whose signature agrees",
    fromDoc: doc,
    source: "FUNCTION F_LANG_计算 : INT\nVAR_INPUT\n\tv : INT;\nEND_VAR\nF_LANG_计算 := v * 2;\nEND_FUNCTION\n",
    plcPrgVar: "n_upa_function_cjk : INT;",
    plcPrgBody: "n_upa_function_cjk := F_LANG_计算(2);",
  },
  {
    name: "upa_program_cyrillic",
    pouName: "PRG_LANG_Цикл",
    kind: "program",
    feature: "a PROGRAM named in Cyrillic whose signature agrees",
    fromDoc: doc,
    source: "PROGRAM PRG_LANG_Цикл\nVAR\n\tn : INT;\nEND_VAR\nn := n + 1;\nEND_PROGRAM\n",
    plcPrgVar: "unused_upa_program_cyrillic : INT;",
    plcPrgBody: "PRG_LANG_Цикл();",
  },
  {
    name: "upa_interface_latin1",
    pouName: "ITF_LANG_Schnittstelle_Ä",
    kind: "interface",
    feature: "an INTERFACE named with an umlaut whose signature agrees, held by a variable",
    fromDoc: doc,
    source: "INTERFACE ITF_LANG_Schnittstelle_Ä\nMETHOD Run : INT\nEND_METHOD\nEND_INTERFACE\n",
    plcPrgVar: "i_upa_interface_latin1 : ITF_LANG_Schnittstelle_Ä;",
  },
  {
    name: "upa_dut_cjk",
    pouName: "DUT_LANG_系统常量",
    kind: "dut",
    feature: "a DUT named `DUT_LANG_系统常量` whose TYPE header agrees",
    fromDoc: doc,
    source: "TYPE DUT_LANG_系统常量 :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE\n",
    plcPrgVar: "s_upa_dut_cjk : DUT_LANG_系统常量;",
  },
  // ─── a GVL's name: the duplicate's message names the list, a qualified use names it, two lists make a bare use
  // ambiguous ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    name: "upa_gvl_duplicate",
    pouName: "GVL_LANG_升降",
    kind: "gvl",
    feature: "a GVL named `GVL_LANG_升降` declaring one variable twice — the message names the list",
    fromDoc: doc,
    source: "VAR_GLOBAL\n\tg_upa_dup : INT;\n\tg_upa_dup : INT;\nEND_VAR\n",
    plcPrgVar: "n_upa_gvl_duplicate : INT;",
    plcPrgBody: "n_upa_gvl_duplicate := g_upa_dup;",
  },
  {
    name: "upa_gvl_qualified",
    pouName: "GVL_LANG_Größen",
    kind: "gvl",
    feature: "a GVL named with an umlaut, its variable read qualified by the list's name",
    fromDoc: doc,
    source: "VAR_GLOBAL\n\tg_upa_qualified : INT := 3;\nEND_VAR\n",
    plcPrgVar: "n_upa_gvl_qualified : INT;",
    plcPrgBody: "n_upa_gvl_qualified := GVL_LANG_Größen.g_upa_qualified;",
  },
  {
    name: "upa_gvl_qualified_unknown",
    pouName: "GVL_LANG_Größen_b",
    kind: "gvl",
    feature: "a GVL named with an umlaut, qualified with a variable it does NOT declare",
    fromDoc: doc,
    source: "VAR_GLOBAL\n\tg_upa_qualified_b : INT := 3;\nEND_VAR\n",
    plcPrgVar: "n_upa_gvl_qualified_unknown : INT;",
    plcPrgBody: "n_upa_gvl_qualified_unknown := GVL_LANG_Größen_b.nope;",
  },
  {
    name: "upa_gvl_ambiguous",
    pouName: "FB_LANG_upa_gvl_ambiguous",
    kind: "function_block",
    gvlNames: ["GVL_LANG_Список_a", "GVL_LANG_Список_b"],
    feature: "two GVLs named in Cyrillic declaring the same variable, read bare — ambiguous between the two lists",
    fromDoc: doc,
    source:
      "VAR_GLOBAL\n\tg_upa_amb : INT := 3;\nEND_VAR\n\nTYPE DUT_LANG_upa_gvl_ambiguous_sep :\nSTRUCT\n\tv : INT;\nEND_STRUCT\nEND_TYPE\n\nVAR_GLOBAL\n\tg_upa_amb : INT := 5;\nEND_VAR\n\n" +
      "FUNCTION_BLOCK FB_LANG_upa_gvl_ambiguous\nVAR\n\tout : INT;\nEND_VAR\nout := g_upa_amb;\nEND_FUNCTION_BLOCK\n",
    plcPrgVar: "inst_upa_gvl_ambiguous : FB_LANG_upa_gvl_ambiguous;",
    plcPrgBody: "inst_upa_gvl_ambiguous();",
  },
  {
    name: "upa_gvl_ambiguous_qualified",
    pouName: "FB_LANG_upa_gvl_ambiguous_qualified",
    kind: "function_block",
    gvlNames: ["GVL_LANG_Список_c", "GVL_LANG_Список_d"],
    feature: "the same two lists, the variable read qualified by the Cyrillic list's name — the control",
    fromDoc: doc,
    source:
      "VAR_GLOBAL\n\tg_upa_amb_q : INT := 3;\nEND_VAR\n\nTYPE DUT_LANG_upa_gvl_ambiguous_qualified_sep :\nSTRUCT\n\tv : INT;\nEND_STRUCT\nEND_TYPE\n\nVAR_GLOBAL\n\tg_upa_amb_q : INT := 5;\nEND_VAR\n\n" +
      "FUNCTION_BLOCK FB_LANG_upa_gvl_ambiguous_qualified\nVAR\n\tout : INT;\nEND_VAR\nout := GVL_LANG_Список_c.g_upa_amb_q;\nEND_FUNCTION_BLOCK\n",
    plcPrgVar: "inst_upa_gvl_ambiguous_qualified : FB_LANG_upa_gvl_ambiguous_qualified;",
    plcPrgBody: "inst_upa_gvl_ambiguous_qualified();",
  },
] as LanguageTest[]).map((t) => ({ ...t, unicodeIdentifiers: "on" as const }))
