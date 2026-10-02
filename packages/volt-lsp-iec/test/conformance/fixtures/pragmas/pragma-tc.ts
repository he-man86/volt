/**
 * TwinCAT-only `Tc*` attribute-pragma conformance catalog.
 *
 * These are the 20 Beckhoff `Tc`-prefixed attribute pragmas the LSP tags
 * `vendor: "twincat"` in `src/reference/pragmas.ts`. They drive the
 * `wrong-vendor-pragma` check: a CODESYS project that pastes one should be
 * warned, a TwinCAT project must NOT be. Until now that tag was doc-verified
 * only (design.md "Findings → Pragmas" caveat). These fixtures make it
 * RECORDING-verified: each pushes the attribute to a live TwinCAT build and
 * records that TC accepts it (`expectTcAccepts: true`) — the same evidence
 * standard the `__`-operators already meet.
 *
 * All are `recordIsolated` (one push+build each). The BUILD recording needs no PLC_PRG instantiation — an attribute
 * is validated when its POU's declaration compiles, independent of task reachability — but each fixture declares one
 * anyway, because the EXECUTION recorder reads `PLC_PRG.<path>` and had nothing to read. What that measures is worth
 * having: CODESYS ignores an attribute it does not know, and the instance proves it leaves the INITIALIZATION alone
 * too, which is the only thing about a Beckhoff pragma the transpiler can get wrong on this vendor.
 *
 * Source of the attribute list: Beckhoff InfoSys "Attribute pragmas".
 */

import type { LanguageTest } from "../../types.js"

/** FB carrying `{attribute 'Name'}` (optionally with `:= value`) above a single variable. */
function varAttr(slug: string, attr: string, varDecl: string, note?: string): LanguageTest {
  const pou = `FB_LANG_${slug}`
  return {
    name: slug,
    pouName: pou,
    kind: "function_block",
    feature: `{attribute '${attr}'} on a variable is a TwinCAT-only Tc attribute`,
    fromDoc: "07-pragmas.md#tc-attributes",
    ...(note ? { note } : {}),
    plcPrgVar: `inst : ${pou};`,
    source: `FUNCTION_BLOCK ${pou}\nVAR\n\t{attribute '${attr}'}\n\t${varDecl}\nEND_VAR\n\nEND_FUNCTION_BLOCK\n`,
  }
}

/** FB carrying `{attribute 'Name'}` above a method. */
function methodAttr(slug: string, attr: string): LanguageTest {
  const pou = `FB_LANG_${slug}`
  return {
    name: slug,
    pouName: pou,
    kind: "function_block",
    feature: `{attribute '${attr}'} on a method is a TwinCAT-only Tc attribute`,
    fromDoc: "07-pragmas.md#tc-attributes",
    plcPrgVar: `inst : ${pou};\n	done : BOOL;`,
    plcPrgBody: "done := inst.DoRpc();",
    source:
      `FUNCTION_BLOCK ${pou}\nVAR\nEND_VAR\n\nEND_FUNCTION_BLOCK\n\n` +
      `{attribute '${attr}'}\nMETHOD DoRpc : BOOL\nVAR_INPUT\nEND_VAR\nDoRpc := TRUE;\nEND_METHOD\n`,
  }
}

/** DUT (STRUCT) carrying `{attribute 'Name'}` above the type. */
function structAttr(slug: string, attr: string): LanguageTest {
  const dut = `DUT_LANG_${slug}`
  return {
    name: slug,
    pouName: dut,
    kind: "dut",
    feature: `{attribute '${attr}'} on a DUT is a TwinCAT-only Tc attribute`,
    fromDoc: "07-pragmas.md#tc-attributes",
    plcPrgVar: `inst : ${dut};`,
    source: `{attribute '${attr}'}\nTYPE ${dut} :\nSTRUCT\n\ta : INT;\n\tb : INT;\nEND_STRUCT\nEND_TYPE\n`,
  }
}

export const PRAGMA_TC_TESTS: readonly LanguageTest[] = [
  // ── var-above: memory / symbol / fieldbus attributes ────────────────────
  varAttr("tc_retain", "TcRetain", "rData : INT;"),
  varAttr("tc_persistent", "TcPersistent", "pData : INT;"),
  varAttr("tc_ignore_persistent", "TcIgnorePersistent", "iVal : INT;"),
  varAttr("tc_init_on_reset", "TcInitOnReset", "iVal : INT;"),
  varAttr("tc_no_symbol", "TcNoSymbol", "iHidden : INT;"),
  varAttr("tc_encoding", "TcEncoding' := 'UTF-8", "sText : STRING;"),
  varAttr("tc_display_scale", "TcDisplayScale' := '1.0", "rScaled : REAL;"),
  varAttr("tc_swap_word", "TcSwapWord", "wVal : WORD;"),
  varAttr("tc_swap_dword", "TcSwapDWord", "dwVal : DWORD;"),
  varAttr("tc_context_id", "TcContextId' := '1", "iShared : INT;"),
  varAttr("tc_context_name", "TcContextName' := 'PlcTask", "iShared : INT;"),
  varAttr("tc_init_symbol", "TcInitSymbol' := 'initSym", "iVal : INT;"),
  varAttr(
    "tc_link_to",
    "TcLinkTo' := 'TIID^Device^Input",
    "bIn : BOOL;",
    "Symbolic hardware link — may report an UNRESOLVED-link warning (not error) in a project with no matching I/O; the recording is the arbiter.",
  ),
  varAttr(
    "tc_link_to_oso",
    "TcLinkToOSO' := 'TIID^Device^Input",
    "bIn : BOOL;",
    "One-side-only variant of TcLinkTo; same unresolved-link caveat.",
  ),
  {
    ...varAttr(
      "tc_nc_axis",
      "TcNcAxis' := '0",
      "axis : AXIS_REF;",
      "AXIS_REF comes from Tc2_MC2. Both BUILD recordings compile it, so the bridge's CODESYS project references a library that supplies the type.",
    ),
    // THE TWO CODESYS PROJECTS ARE NOT THE SAME PROJECT. `codesys.build.json` says this compiles; the exec oracle runs
    // against `volt-cli/test/fixtures/CodesysTestProject.project`, which references no motion library, and answers
    // "Unknown type: 'AXIS_REF'". That is a fact about the fixture project, not about the attribute, and recording it
    // as a refusal would be recording the wrong thing. Closing it means adding the library reference to the committed
    // project — which changes the environment every other recording was taken in, so it is a deliberate change of its
    // own, not a fix to make in passing.
    execSkip:
      "the exec-oracle project (CodesysTestProject.project) references no motion library, so AXIS_REF is unknown there — a gap in the RECORDING PROJECT, closable by adding the reference, not by changing the fixture",
  },

  // ── method-top ──────────────────────────────────────────────────────────
  methodAttr("tc_rpc_enable", "TcRpcEnable"),
  methodAttr("tc_call_after_output_update", "TcCallAfterOutputUpdate"),

  // ── struct-top ──────────────────────────────────────────────────────────
  structAttr("tc_global_data_type", "TcGlobalDataType"),
  structAttr("tc_hide_sub_items", "TcHideSubItems"),

  // ── gvl-top ─────────────────────────────────────────────────────────────
  {
    name: "tc2_gvl_var_names",
    plcPrgVar: "gvlTc2 : INT;",
    plcPrgBody: "gvlTc2 := GVL_LANG_tc2_gvl_var_names.gVal;",
    pouName: "GVL_LANG_tc2_gvl_var_names",
    kind: "gvl",
    feature: "{attribute 'Tc2GvlVarNames'} on a GVL is a TwinCAT-only Tc attribute",
    fromDoc: "07-pragmas.md#tc-attributes",
    source: `{attribute 'Tc2GvlVarNames'}\nVAR_GLOBAL\n\tgVal : INT;\nEND_VAR\n`,
  },
]
