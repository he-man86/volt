/**
 * The OBJECT's name and the name in its SIGNATURE are two different things, and CODESYS lets them disagree until
 * you build: "The name used in the signature is not identical to the object name" (measured live on SP21,
 * 2026-09-17 — the IDE stored `FUNCTION_BLOCK FB_TotallyDifferentName` inside an object called `FB_NameMismatch`
 * verbatim, and only the build objected).
 *
 * WHY THIS MATTERS BEYOND ONE DIAGNOSTIC. It is the measurement behind Volt's rule that an item's IDENTITY comes
 * from its FILE NAME and never from the declaration text. Two places were breaking that rule and neither could
 * have been caught without this:
 *
 *   - the RECORDER took the pushed item's name from the parsed signature, so it silently CORRECTED the mismatch
 *     on the way into the IDE — the one case worth recording was the one case it could not record;
 *   - the LSP had no check at all, so a POU that will not compile looked clean in the editor.
 *
 * One fixture per POU kind, because the kinds are not obviously alike: a FUNCTION carries a return type in its
 * signature, an INTERFACE has no body, a PROGRAM is instantiated by the application rather than by a caller, and
 * a DUT names itself in `TYPE <name> :` — whether the compiler holds a DUT to the same rule is genuinely unknown
 * and this is what asks. Each has a MATCHING control beside it, because a check that fires on everything is not
 * a check.
 */
import type { LanguageTest } from "../../types.js"

const doc = "conformance — the object's name vs the name in its signature"

export const SIGNATURE_NAME_TESTS: readonly LanguageTest[] = [
  // ─── the mismatch, per kind ────────────────────────────────────────────────
  {
    name: "sn_fb_mismatch",
    pouName: "FB_SN_object",
    kind: "function_block",
    feature: "a FUNCTION_BLOCK whose signature names something other than its object",
    fromDoc: doc,
    source: `FUNCTION_BLOCK FB_SN_signature
VAR
	n : INT;
END_VAR
n := n + 1;
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_SN_signature;",
    plcPrgBody: "inst();",
  },
  {
    name: "sn_function_mismatch",
    pouName: "F_SN_object",
    kind: "function",
    feature: "a FUNCTION whose signature names something else — its RETURN TYPE rides on that same line",
    fromDoc: doc,
    source: `FUNCTION F_SN_signature : INT
VAR_INPUT
	value : INT;
END_VAR
F_SN_signature := value * 2;
END_FUNCTION
`,
    plcPrgVar: "n : INT;",
    plcPrgBody: "n := F_SN_signature(2);",
  },
  {
    name: "sn_program_mismatch",
    pouName: "PRG_SN_object",
    kind: "program",
    feature: "a PROGRAM whose signature names something else — nothing CALLS a program by that name",
    fromDoc: doc,
    source: `PROGRAM PRG_SN_signature
VAR
	n : INT;
END_VAR
n := n + 1;
END_PROGRAM
`,
    plcPrgVar: "unrelated : INT;",
    plcPrgBody: "PRG_SN_signature();\nunrelated := 1;",
  },
  {
    name: "sn_interface_mismatch",
    pouName: "ITF_SN_object",
    kind: "interface",
    feature: "an INTERFACE whose signature names something else — and an FB implementing the name it DECLARES",
    fromDoc: doc,
    source: `INTERFACE ITF_SN_signature
METHOD Run : INT
END_METHOD
END_INTERFACE
`,
  },
  {
    name: "sn_dut_mismatch",
    pouName: "DUT_SN_object",
    kind: "dut",
    feature: "a DUT whose `TYPE <name> :` names something other than its object — is a type held to the same rule?",
    fromDoc: doc,
    note: "Genuinely unknown before recording. A DUT names itself in the type header rather than a POU signature, and the message speaks of a 'signature', so the compiler may well not apply it here.",
    source: `TYPE DUT_SN_signature :
STRUCT
	x : INT;
END_STRUCT
END_TYPE
`,
  },

  // ─── the same two, REFERENCED, because unreferenced proves nothing ─────────
  // `sn_interface_mismatch` and `sn_dut_mismatch` both build clean, and that is not evidence: CODESYS compiles
  // what the application REACHES. Deleting C0149 on exactly that mistake (2026-09-16, restored 2026-09-17) is
  // why these exist — an implementer and a user make the compiler look inside.
  {
    name: "sn_interface_mismatch_used",
    pouName: "FB_SN_itfUser",
    kind: "function_block",
    feature: "an FB implementing the interface whose signature disagrees with its object",
    fromDoc: doc,
    source: `FUNCTION_BLOCK FB_SN_itfUser IMPLEMENTS ITF_SN_signature
VAR
	n : INT;
END_VAR
n := n + 1;
END_FUNCTION_BLOCK

METHOD Run : INT
Run := 1;
END_METHOD
`,
    plcPrgVar: "inst : FB_SN_itfUser;",
    plcPrgBody: "inst();",
  },
  {
    name: "sn_dut_mismatch_used",
    pouName: "FB_SN_dutUser",
    kind: "function_block",
    feature: "an FB declaring a variable of the DUT whose type name disagrees with its object",
    fromDoc: doc,
    source: `FUNCTION_BLOCK FB_SN_dutUser
VAR
	held : DUT_SN_signature;
	n : INT;
END_VAR
n := held.x;
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_SN_dutUser;",
    plcPrgBody: "inst();",
  },

  // ─── the controls: the same shapes, named correctly ────────────────────────
  {
    name: "sn_fb_matches",
    pouName: "FB_SN_agrees",
    kind: "function_block",
    feature: "the same FB with its signature and object in agreement — the control",
    fromDoc: doc,
    source: `FUNCTION_BLOCK FB_SN_agrees
VAR
	n : INT;
END_VAR
n := n + 1;
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_SN_agrees;",
    plcPrgBody: "inst();",
  },
  {
    name: "sn_function_matches",
    pouName: "F_SN_agrees",
    kind: "function",
    feature: "the same FUNCTION in agreement — the control",
    fromDoc: doc,
    source: `FUNCTION F_SN_agrees : INT
VAR_INPUT
	value : INT;
END_VAR
F_SN_agrees := value * 2;
END_FUNCTION
`,
    plcPrgVar: "n : INT;",
    plcPrgBody: "n := F_SN_agrees(2);",
  },
  {
    name: "sn_case_differs_only",
    pouName: "FB_SN_casing",
    kind: "function_block",
    feature: "object and signature differing ONLY in case — IEC names are case-insensitive, so is this identical?",
    fromDoc: doc,
    note: "The check compares case-insensitively on that reasoning. If CODESYS objects here, it does not mean 'identical' the way the language means it, and the check is wrong.",
    source: `FUNCTION_BLOCK fb_sn_CASING
VAR
	n : INT;
END_VAR
n := n + 1;
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_SN_casing;",
    plcPrgBody: "inst();",
  },
]
