/**
 * THE THREE HEADER SHAPES THE BRIDGE USED TO REFUSE BEFORE THE IDE SAW THEM — re-asked of the IDE itself.
 *
 * `error-catalog.json` carried a note on C0144, C0145 and C0149 (dated 2026-07-11): "Bridge-blocked (structural): the
 * bridge's own header/body parser rejects '<shape>' before the IDE compiles it (Unrecognized code header / Expected
 * METHOD/ACTION/PROPERTY)". `openspec/changes/push-without-header-check` removed that parser from the push — a
 * top-level text is written as sent — so the note describes a refusal that no longer happens, and the IDE's own
 * answer to each shape can finally be recorded (task 4.3). Each is REFERENCED from PLC_PRG, since the build only
 * compiles what something reaches.
 */
import type { LanguageTest } from "../../types.js"

const doc = "error-catalog.json C0144/C0145/C0149 — push-without-header-check task 4.3"

export const HEADER_RULE_TESTS: readonly LanguageTest[] = [
  {
    name: "hdr_function_extends",
    pouName: "F_LANG_hdr_extends",
    kind: "function",
    feature: "a FUNCTION that EXTENDS a function block (the C0144 note's 'FUNCTION EXTENDS')",
    fromDoc: doc,
    // AS SENT: the parser does not read `FUNCTION … EXTENDS` as a function, so it has no body to mark — the text states
    // its own IMPLEMENTATION line, and its base is `oop_base`'s FB.
    asSent: "the parser cannot split `FUNCTION … EXTENDS`; its text is pushed as a workspace file holds it",
    source: `FUNCTION F_LANG_hdr_extends EXTENDS FB_LANG_oop_base : INT
VAR_INPUT
	x : INT;
END_VAR
IMPLEMENTATION ST
F_LANG_hdr_extends := x;
END_FUNCTION
`,
    plcPrgVar: "nOut : INT;",
    plcPrgBody: "nOut := F_LANG_hdr_extends(2);",
  },
  {
    name: "hdr_function_implements",
    pouName: "F_LANG_hdr_implements",
    kind: "function",
    feature: "a FUNCTION that IMPLEMENTS an interface (C0145)",
    fromDoc: doc,
    // AS SENT, like its EXTENDS twin; the interface is `interface_empty`'s.
    asSent: "the parser cannot split `FUNCTION … IMPLEMENTS`; its text is pushed as a workspace file holds it",
    source: `FUNCTION F_LANG_hdr_implements IMPLEMENTS ITF_LANG_empty : INT
VAR_INPUT
	x : INT;
END_VAR
IMPLEMENTATION ST
F_LANG_hdr_implements := x;
END_FUNCTION
`,
    plcPrgVar: "nOut : INT;",
    plcPrgBody: "nOut := F_LANG_hdr_implements(2);",
  },
  {
    name: "hdr_interface_var_input",
    pouName: "ITF_LANG_hdr_var_input",
    kind: "interface",
    feature: "a VAR_INPUT block directly in an INTERFACE (C0149's repro), reached through an FB implementing it",
    fromDoc: doc,
    source: `INTERFACE ITF_LANG_hdr_var_input
VAR_INPUT
	i : INT;
END_VAR
METHOD M : INT
END_METHOD
END_INTERFACE

FUNCTION_BLOCK FB_LANG_hdr_var_input IMPLEMENTS ITF_LANG_hdr_var_input
VAR
	n : INT;
END_VAR
n := 1;
END_FUNCTION_BLOCK

METHOD M : INT
M := n;
END_METHOD
`,
    plcPrgVar: "fb : FB_LANG_hdr_var_input;",
    plcPrgBody: "fb();",
  },
  // THE SAME TWO WITHOUT A RETURN TYPE — the catalog's own C0145 repro shape (`FUNCTION POU IMPLEMENTS ITF`). CODESYS
  // reads the return type after EXTENDS/IMPLEMENTS as a syntax error (the two above), so this asks the header alone.
  {
    name: "hdr_function_extends_no_return",
    pouName: "F_LANG_hdr_extends_bare",
    kind: "function",
    feature: "a FUNCTION with no return type that EXTENDS a function block",
    fromDoc: doc,
    asSent: "the parser cannot split `FUNCTION … EXTENDS`; its text is pushed as a workspace file holds it",
    source: `FUNCTION F_LANG_hdr_extends_bare EXTENDS FB_LANG_oop_base
VAR_INPUT
	x : INT;
END_VAR
IMPLEMENTATION ST
;
END_FUNCTION
`,
    plcPrgBody: "F_LANG_hdr_extends_bare(2);",
  },
  {
    name: "hdr_function_implements_no_return",
    pouName: "F_LANG_hdr_implements_bare",
    kind: "function",
    feature: "a FUNCTION with no return type that IMPLEMENTS an interface (C0145's repro shape)",
    fromDoc: doc,
    asSent: "the parser cannot split `FUNCTION … IMPLEMENTS`; its text is pushed as a workspace file holds it",
    source: `FUNCTION F_LANG_hdr_implements_bare IMPLEMENTS ITF_LANG_empty
VAR_INPUT
	x : INT;
END_VAR
IMPLEMENTATION ST
;
END_FUNCTION
`,
    plcPrgBody: "F_LANG_hdr_implements_bare(2);",
  },
]
