/**
 * A GLOBAL FB OR STRUCT INSTANCE HANDED TO ANOTHER FB, AND NAMES A GLOBAL SHARES — the shapes a generated scene uses: a
 * model is an FB type, each scene object a global instance of it, and a user FB drives one through a parameter
 * (Sim-Assist, 2026-11-07). Each case has its own global, so no run sees another's writes.
 *
 *   sio_inout_global_fb / _struct   a global FB / struct instance bound to a VAR_IN_OUT, written through it
 *   sio_ref_input_global           the same through a VAR_INPUT REFERENCE TO
 *   sio_var_named_type / _case     a variable named after its own FB type (exact case, other case)
 *   sio_user_ton                   a user FB named TON beside the Standard library's
 *   sio_program_global_name        a PROGRAM and a global of the same name
 */
import type { LanguageTest } from "../../types.js"

const doc = "08-pous.md"

/** The case's FB, then its own global list (`gvlNames`): a global becomes a dependency only through a type or a
 *  VAR_EXTERNAL, so each case declares the instance it hands over. */
const zone = (name: string, param: string, body: string, global: string): string =>
  `FUNCTION_BLOCK FB_LANG_${name}\n${param}\n${body}\nEND_FUNCTION_BLOCK\n\nVAR_GLOBAL\n\t${global};\nEND_VAR\n`

export const SCENE_IO_TESTS: readonly LanguageTest[] = [
  {
    name: "sio_conv",
    pouName: "FB_LANG_sio_conv",
    kind: "function_block",
    feature: "a scene model: an FB type with a command input and a readout output (support)",
    fromDoc: doc,
    source:
      "FUNCTION_BLOCK FB_LANG_sio_conv\nVAR_INPUT\n\tVelocity : REAL;\nEND_VAR\nVAR_OUTPUT\n\tActive : BOOL;\nEND_VAR\nActive := Velocity > 0.0;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "sio_pos",
    pouName: "DUT_LANG_sio_pos",
    kind: "dut",
    feature: "a struct a global instance is declared of (support)",
    fromDoc: doc,
    source: "TYPE DUT_LANG_sio_pos :\nSTRUCT\n\tx : INT;\n\ty : INT;\nEND_STRUCT\nEND_TYPE\n",
  },
  {
    name: "sio_inout_global_fb",
    pouName: "FB_LANG_sio_inout_global_fb",
    kind: "function_block",
    feature: "a global FB instance bound to a VAR_IN_OUT and written through it",
    fromDoc: doc,
    source: zone("sio_inout_global_fb", "VAR_IN_OUT\n\tConv : FB_LANG_sio_conv;\nEND_VAR", "Conv.Velocity := 2.5;\nConv();", "g_sio_inout_fb : FB_LANG_sio_conv"),
    gvlNames: ["GVL_LANG_sio_inout_global_fb"],
    plcPrgVar: "z_sio_inout_fb : FB_LANG_sio_inout_global_fb;\n\tv_sio_inout_fb : REAL;\n\ta_sio_inout_fb : BOOL;",
    plcPrgBody: "z_sio_inout_fb(Conv := g_sio_inout_fb);\nv_sio_inout_fb := g_sio_inout_fb.Velocity;\na_sio_inout_fb := g_sio_inout_fb.Active;",
  },
  {
    name: "sio_inout_global_struct",
    pouName: "FB_LANG_sio_inout_global_struct",
    kind: "function_block",
    feature: "a global struct instance bound to a VAR_IN_OUT and written through it",
    fromDoc: doc,
    source: zone("sio_inout_global_struct", "VAR_IN_OUT\n\tp : DUT_LANG_sio_pos;\nEND_VAR", "p.x := 7;\np.y := p.x + 1;", "g_sio_inout_struct : DUT_LANG_sio_pos"),
    gvlNames: ["GVL_LANG_sio_inout_global_struct"],
    plcPrgVar: "z_sio_inout_struct : FB_LANG_sio_inout_global_struct;\n\tx_sio_inout_struct : INT;\n\ty_sio_inout_struct : INT;",
    plcPrgBody: "z_sio_inout_struct(p := g_sio_inout_struct);\nx_sio_inout_struct := g_sio_inout_struct.x;\ny_sio_inout_struct := g_sio_inout_struct.y;",
  },
  {
    name: "sio_ref_input_global",
    pouName: "FB_LANG_sio_ref_input_global",
    kind: "function_block",
    feature: "a global FB instance bound to a VAR_INPUT REFERENCE TO and written through it",
    fromDoc: doc,
    source: zone("sio_ref_input_global", "VAR_INPUT\n\tConv : REFERENCE TO FB_LANG_sio_conv;\nEND_VAR", "Conv.Velocity := 3.0;\nConv();", "g_sio_ref_fb : FB_LANG_sio_conv"),
    gvlNames: ["GVL_LANG_sio_ref_input_global"],
    plcPrgVar: "z_sio_ref : FB_LANG_sio_ref_input_global;\n\tv_sio_ref : REAL;\n\ta_sio_ref : BOOL;",
    plcPrgBody: "z_sio_ref(Conv := g_sio_ref_fb);\nv_sio_ref := g_sio_ref_fb.Velocity;\na_sio_ref := g_sio_ref_fb.Active;",
  },
  {
    name: "sio_lamp",
    pouName: "SioLamp",
    kind: "function_block",
    feature: "an FB type a variable is named after (support)",
    fromDoc: doc,
    source: "FUNCTION_BLOCK SioLamp\nVAR_INPUT\n\tOn : BOOL;\nEND_VAR\nVAR_OUTPUT\n\tLit : BOOL;\nEND_VAR\nLit := On;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "sio_var_named_type",
    pouName: "FB_LANG_sio_var_named_type",
    kind: "function_block",
    feature: "a variable named exactly as its own FB type (`SioLamp : SioLamp;`), called and read",
    fromDoc: doc,
    source:
      "FUNCTION_BLOCK FB_LANG_sio_var_named_type\nVAR\n\tSioLamp : SioLamp;\n\tlit : BOOL;\nEND_VAR\nSioLamp.On := TRUE;\nSioLamp();\nlit := SioLamp.Lit;\nEND_FUNCTION_BLOCK\n",
    plcPrgVar: "inst_sio_var_named_type : FB_LANG_sio_var_named_type;",
    plcPrgBody: "inst_sio_var_named_type();",
  },
  {
    name: "sio_var_named_type_case",
    pouName: "FB_LANG_sio_var_named_type_case",
    kind: "function_block",
    feature: "a variable named as its own FB type in another case (`sioLamp : SioLamp;`), called and read",
    fromDoc: doc,
    source:
      "FUNCTION_BLOCK FB_LANG_sio_var_named_type_case\nVAR\n\tsioLamp : SioLamp;\n\tlit : BOOL;\nEND_VAR\nsioLamp(On := TRUE);\nlit := sioLamp.Lit;\nEND_FUNCTION_BLOCK\n",
    plcPrgVar: "inst_sio_var_named_type_case : FB_LANG_sio_var_named_type_case;",
    plcPrgBody: "inst_sio_var_named_type_case();",
  },
  {
    name: "sio_user_ton",
    pouName: "TON",
    kind: "function_block",
    feature: "a user FB named TON beside the Standard library's TON: which one does a declaration take?",
    fromDoc: doc,
    source: "FUNCTION_BLOCK TON\nVAR_INPUT\n\tIN : BOOL;\nEND_VAR\nVAR_OUTPUT\n\tMine : INT;\nEND_VAR\nMine := 42;\nEND_FUNCTION_BLOCK\n",
    plcPrgVar: "t_sio_user_ton : TON;\n\tk_sio_user_ton : INT;",
    plcPrgBody: "t_sio_user_ton(IN := TRUE);\nk_sio_user_ton := t_sio_user_ton.Mine;",
    alone: "an FB named TON would replace the Standard TON for every fixture that uses one",
  },
  {
    name: "sio_program_global_name",
    pouName: "SioInfeed",
    kind: "program",
    feature: "a PROGRAM and a global variable of the same name (SioInfeed)",
    fromDoc: doc,
    source: "PROGRAM SioInfeed\nVAR\n\tk : INT;\nEND_VAR\nk := 1;\nEND_PROGRAM\n\nVAR_GLOBAL\n\tSioInfeed : INT;\nEND_VAR\n",
    gvlNames: ["GVL_LANG_sio_program_global_name"],
    plcPrgVar: "k_sio_program_global_name : INT;",
    plcPrgBody: "SioInfeed();\nk_sio_program_global_name := SioInfeed.k;",
    alone: "it declares a PROGRAM and a global both named SioInfeed",
  },
]
