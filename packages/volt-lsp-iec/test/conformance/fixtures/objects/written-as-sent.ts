/**
 * AN OBJECT'S TEXT, AGAINST THE OBJECT — what the build says about a text the push writes exactly as sent.
 *
 * `openspec/changes/push-without-header-check`: a top-level item's kind is its wire name's extension, and the push
 * no longer reads its header, checks it against the extension, or refuses a text for what it says. So these shapes —
 * each one the push USED to refuse — now reach the IDE verbatim, and the build is the only thing that answers for
 * them. The LSP owes the same answer, no more and no less: an LSP-only message about one of them is a false positive.
 *
 * Every fixture here is `asSent`: its `source` is ONE item's whole text, pushed under `pouName` + the extension of
 * `kind` without being parsed or marked (a never-closed `(*` parses to nothing, so the parser has no unit to split or
 * mark). A POU text therefore states its own `IMPLEMENTATION ST` line, as a workspace file does.
 *
 * Each is REFERENCED from PLC_PRG, because a build reaches only what something references (measured 2026-09-30 on
 * SP21: an unreferenced item is not compiled at all — "The application is up to date", 0 errors, even for `n := ;`).
 * The e2e twin is `packages/volt-cli/test/e2e/items/push-without-header-check.test.ts`, which pinned the first
 * four's errors (identical on both vendors, all on PLC_PRG's reference): the item's text read as one comment
 * declares nothing.
 */
import type { LanguageTest } from "../../types.js"

const doc = "openspec push-without-header-check — tasks 4.1/4.2 (the push writes a top-level text as sent)"
const asSent = "push-without-header-check: the item's text as a workspace file holds it, pushed verbatim under its extension"
/** For a text that builds clean and declares NOTHING: there is no object of it to load into a program and run. */
const declaresNothing =
  "NOTHING TO COMPARE — the text declares nothing, so there is no object of it for a program to run; its one question is what the build says about it"

export const WRITTEN_AS_SENT_TESTS: readonly LanguageTest[] = [
  // ─── an opening comment that never closes — the c802b74d shape, per kind ───
  {
    name: "pwh_unclosed_comment_struct",
    pouName: "DUT_LANG_pwh_uc_struct",
    kind: "dut",
    feature: "a STRUCT whose opening comment never closes — the whole text is one comment",
    fromDoc: doc,
    asSent,
    source: `(* Carrier state
 *
TYPE DUT_LANG_pwh_uc_struct :
STRUCT
	nPos : INT; (* mm *)
END_STRUCT
END_TYPE
`,
    plcPrgVar: "v : DUT_LANG_pwh_uc_struct;",
  },
  {
    name: "pwh_unclosed_comment_enum",
    pouName: "DUT_LANG_pwh_uc_enum",
    kind: "dut",
    feature: "an ENUM whose opening comment never closes",
    fromDoc: doc,
    asSent,
    source: `(* Modes
 *
TYPE DUT_LANG_pwh_uc_enum :
(
	Idle := 0,
	Run
);
END_TYPE
`,
    plcPrgVar: "v : DUT_LANG_pwh_uc_enum;",
  },
  {
    name: "pwh_unclosed_comment_gvl",
    pouName: "GVL_LANG_pwh_uc_gvl",
    kind: "gvl",
    feature: "a GVL whose opening comment never closes — its global is declared nowhere",
    fromDoc: doc,
    asSent,
    source: `(* Globals
 *
VAR_GLOBAL
	g_pwh_uc_gvl : INT;
END_VAR
`,
    plcPrgVar: "v : INT;",
    plcPrgBody: "v := g_pwh_uc_gvl;",
  },
  {
    name: "pwh_unclosed_comment_fb",
    pouName: "FB_LANG_pwh_uc_fb",
    kind: "function_block",
    feature: "a FUNCTION_BLOCK whose opening comment never closes, IMPLEMENTATION line and all",
    fromDoc: doc,
    asSent,
    source: `(* Motor
 *
FUNCTION_BLOCK FB_LANG_pwh_uc_fb
VAR
	n : INT;
END_VAR
IMPLEMENTATION ST
n := n + 1;
END_FUNCTION_BLOCK
`,
    plcPrgVar: "v : FB_LANG_pwh_uc_fb;",
    plcPrgBody: "v();",
  },

  // ─── a text that is not what its extension says ───
  {
    name: "pwh_fb_text_says_program",
    pouName: "FB_LANG_pwh_fb_prg",
    kind: "function_block",
    feature: "an .fb whose text declares PROGRAM — the extension says one kind, the text another",
    fromDoc: doc,
    asSent,
    source: `PROGRAM FB_LANG_pwh_fb_prg
VAR_OUTPUT
	n : INT;
END_VAR
IMPLEMENTATION ST
n := 7;
END_PROGRAM
`,
    plcPrgVar: "nOut : INT;",
    plcPrgBody: "FB_LANG_pwh_fb_prg();\nnOut := FB_LANG_pwh_fb_prg.n;",
    note: "Measured by the e2e twin: CODESYS makes the object a PROGRAM (`refs` names it .prg), TwinCAT keeps the FB tree item (DIALECT C2f); both build it clean.",
  },
  {
    name: "pwh_struct_text_is_enum",
    pouName: "DUT_LANG_pwh_st_enum",
    kind: "dut",
    feature: "a .dut whose text is an ENUM (pushed as .struct before push-without-header-check 5.P; a DUT has one name now)",
    fromDoc: doc,
    asSent,
    source: `TYPE DUT_LANG_pwh_st_enum :
(
	Idle := 0,
	Run
);
END_TYPE
`,
    plcPrgVar: "v : DUT_LANG_pwh_st_enum := DUT_LANG_pwh_st_enum.Run;",
  },

  // ─── a DUT or a GVL is not read at all by the push ───
  {
    name: "pwh_empty_struct",
    pouName: "DUT_LANG_pwh_empty",
    kind: "dut",
    feature: "a .dut whose text is EMPTY",
    fromDoc: doc,
    asSent,
    source: "",
    plcPrgVar: "v : DUT_LANG_pwh_empty;",
  },
  {
    name: "pwh_prose_struct",
    pouName: "DUT_LANG_pwh_prose",
    kind: "dut",
    feature: "a .dut whose text is prose, not structured text",
    fromDoc: doc,
    asSent,
    source: "this is not structured text at all\n",
    plcPrgVar: "v : DUT_LANG_pwh_prose;",
  },
  {
    name: "pwh_struct_member_implementation",
    pouName: "DUT_LANG_pwh_implm",
    kind: "dut",
    feature: "a STRUCT member named IMPLEMENTATION — the word Volt's file format uses for its body line",
    fromDoc: doc,
    asSent,
    source: `TYPE DUT_LANG_pwh_implm :
STRUCT
	IMPLEMENTATION : INT;
END_STRUCT
END_TYPE
`,
    // Declared, not written to: `v.IMPLEMENTATION := 3;` in PLC_PRG is refused by the push itself — IMPLEMENTATION
    // stays reserved inside a POU, whose split it protects (push-without-header-check 2.2).
    plcPrgVar: "v : DUT_LANG_pwh_implm;",
  },
  {
    name: "pwh_gvl_retired_volt_comment",
    pouName: "GVL_LANG_pwh_retired",
    kind: "gvl",
    feature: "a GVL holding a retired `(* @volt-impl *)` comment — to the IDE, a comment",
    fromDoc: doc,
    asSent,
    source: `(* @volt-impl *)
VAR_GLOBAL
	g_pwh_retired : INT := 4;
END_VAR
`,
    plcPrgVar: "v : INT;",
    plcPrgBody: "v := g_pwh_retired;",
  },
  // ─── the rule behind "prose under a struct": which malformed DUT/GVL texts does the build report at all? ───
  // A DUT or a GVL is written without being read, so any text reaches the IDE. `pwh_prose_struct` came back with
  // nothing but the reference's `Unknown type` — these ask where that silence ends.
  {
    name: "pwh_prose_then_struct",
    pouName: "DUT_LANG_pwh_prose_first",
    kind: "dut",
    feature: "a prose line ABOVE a well-formed STRUCT",
    fromDoc: doc,
    asSent,
    source: `a note about the carrier
TYPE DUT_LANG_pwh_prose_first :
STRUCT
	nPos : INT;
END_STRUCT
END_TYPE
`,
    plcPrgVar: "v : DUT_LANG_pwh_prose_first;",
  },
  {
    name: "pwh_struct_then_prose",
    pouName: "DUT_LANG_pwh_prose_after",
    kind: "dut",
    feature: "a prose line BELOW a well-formed STRUCT's END_TYPE",
    fromDoc: doc,
    asSent,
    source: `TYPE DUT_LANG_pwh_prose_after :
STRUCT
	nPos : INT;
END_STRUCT
END_TYPE
a note about the carrier
`,
    plcPrgVar: "v : DUT_LANG_pwh_prose_after;",
  },
  {
    name: "pwh_struct_missing_semicolon",
    pouName: "DUT_LANG_pwh_no_semi",
    kind: "dut",
    feature: "a STRUCT member missing its `;` — a syntax error INSIDE a DUT declaration",
    fromDoc: doc,
    asSent,
    source: `TYPE DUT_LANG_pwh_no_semi :
STRUCT
	nPos : INT
	nSpeed : INT;
END_STRUCT
END_TYPE
`,
    plcPrgVar: "v : DUT_LANG_pwh_no_semi;",
  },
  // …and its twin in a POU's VAR block, which says whether that wording is the STRUCT's or every declaration's
  {
    name: "pwh_var_missing_semicolon",
    pouName: "FB_LANG_pwh_no_semi",
    kind: "function_block",
    feature: "a VAR declaration missing its `;` — the same syntax error in a POU, beside the STRUCT's",
    fromDoc: doc,
    asSent,
    source: `FUNCTION_BLOCK FB_LANG_pwh_no_semi
VAR
	nPos : INT
	nSpeed : INT;
END_VAR
IMPLEMENTATION ST
nSpeed := 1;
END_FUNCTION_BLOCK
`,
    plcPrgVar: "v : FB_LANG_pwh_no_semi;",
    plcPrgBody: "v();",
  },
  {
    name: "pwh_prose_gvl",
    pouName: "GVL_LANG_pwh_prose",
    kind: "gvl",
    feature: "a .gvl whose text is prose — referenced by nothing, since it declares nothing to reference",
    fromDoc: doc,
    asSent,
    execSkip: declaresNothing,
    source: "this is not structured text at all\n",
    plcPrgVar: "v : INT;",
  },
  {
    name: "pwh_empty_gvl",
    pouName: "GVL_LANG_pwh_empty",
    kind: "gvl",
    feature: "a .gvl whose text is EMPTY",
    fromDoc: doc,
    asSent,
    execSkip: declaresNothing,
    source: "",
    plcPrgVar: "v : INT;",
  },

  {
    name: "pwh_prose_then_gvl",
    pouName: "GVL_LANG_pwh_prose_first",
    kind: "gvl",
    feature: "a prose line ABOVE a well-formed VAR_GLOBAL",
    fromDoc: doc,
    asSent,
    source: `a note about the globals
VAR_GLOBAL
	g_pwh_prose_first : INT := 5;
END_VAR
`,
    plcPrgVar: "v : INT;",
    plcPrgBody: "v := g_pwh_prose_first;",
  },
  {
    name: "pwh_gvl_then_prose",
    pouName: "GVL_LANG_pwh_prose_after",
    kind: "gvl",
    feature: "a prose line BELOW a well-formed VAR_GLOBAL's END_VAR",
    fromDoc: doc,
    asSent,
    source: `VAR_GLOBAL
	g_pwh_prose_after : INT := 5;
END_VAR
a note about the globals
`,
    plcPrgVar: "v : INT;",
    plcPrgBody: "v := g_pwh_prose_after;",
  },
  {
    name: "pwh_gvl_missing_semicolon",
    pouName: "GVL_LANG_pwh_no_semi",
    kind: "gvl",
    feature: "a global missing its `;` — a syntax error INSIDE a GVL",
    fromDoc: doc,
    asSent,
    source: `VAR_GLOBAL
	g_pwh_no_semi_a : INT
	g_pwh_no_semi_b : INT;
END_VAR
`,
    plcPrgVar: "v : INT;",
    plcPrgBody: "v := g_pwh_no_semi_b;",
  },

  // ─── a DUT whose text is a STRUCT: the enum row's twin ───
  {
    name: "pwh_enum_text_is_struct",
    pouName: "DUT_LANG_pwh_enum_struct",
    kind: "dut",
    feature: "a .dut whose text is a STRUCT (pushed as .enum before push-without-header-check 5.P; a DUT has one name now)",
    fromDoc: doc,
    asSent,
    source: `TYPE DUT_LANG_pwh_enum_struct :
STRUCT
	nPos : INT;
END_STRUCT
END_TYPE
`,
    plcPrgVar: "v : DUT_LANG_pwh_enum_struct;",
  },
  {
    name: "pwh_prg_text_says_function_block",
    pouName: "PRG_LANG_pwh_prg_fb",
    kind: "program",
    feature: "a .prg whose text declares FUNCTION_BLOCK — instantiated as the FB its text says it is",
    fromDoc: doc,
    asSent,
    source: `FUNCTION_BLOCK PRG_LANG_pwh_prg_fb
VAR_OUTPUT
	n : INT;
END_VAR
IMPLEMENTATION ST
n := n + 1;
END_FUNCTION_BLOCK
`,
    plcPrgVar: "fb : PRG_LANG_pwh_prg_fb;\n\tnOut : INT;",
    plcPrgBody: "fb();\nnOut := fb.n;",
  },
]
