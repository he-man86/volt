/**
 * THE CODE CHECKS THE PUSH NO LONGER MAKES — what the IDE's build says about each text it now receives.
 *
 * `openspec/changes/bridge-refusal-review` removed or narrowed the push's own judgements of code (§1 and §2): an ST
 * body shaped like network text (1.1), the identifier `implementation` (1.2), an undeclared wire-shaped name in a
 * network (1.3), `.ENO` on a box with no EN (1.5), a retired `(* @volt-… *)` comment in a current-format body (2.1),
 * a member or property header with nothing after its name (2.4, 2.6), and the IEC/ASCII name check (3.1, now the
 * vendors' measured create rule). Each text reaches the IDE as written, so the build is what answers for it, and the
 * LSP owes the same answer on the same line (task 5.1/5.2; "What the LSP must pick up" in the proposal). An LSP-only
 * message about one of them is a false positive.
 *
 * Already recorded elsewhere: `sig_empty_type` (2.4, a METHOD with nothing after its colon) and `sig_unknown_word`
 * (2.5) in `oop/header-rules.ts`; `pwh_struct_member_implementation` and `pwh_gvl_retired_volt_comment` in
 * `objects/written-as-sent.ts`; `cc_vg_undeclared` (an undeclared operand in a network) in `check-coverage.ts`. 3.2 (a
 * wire's declared type against its producer) was measured and KEPT (DIALECT N25), so it has no row here.
 *
 * Every POU is REFERENCED from PLC_PRG: a build reaches only what something references.
 */
import type { LanguageTest } from "../../types.js"
import { NOT_ST } from "../graphical/network-graphical.js"

const doc = "openspec bridge-refusal-review — What the LSP must pick up (task 5.1)"
const asSent = "bridge-refusal-review: the item's text as a workspace file holds it — the push writes it as sent"

/** The push's refusal of `rcc_network_late_block_shadows_read` — Volt's own reader, before either IDE sees the text
 *  (`NetworkTextReader`, bridge-refusal-review 2.7 review; `NetworkTextGateTests`), the LSP's NETWORK_DUPLICATE_NAME. */
const LATE_BLOCK_SHADOWS_READ =
  "NETWORK_DUPLICATE_NAME: the wire g1 is declared after line 3 read g1 as a variable: one name would mean the variable before this block and the wire after it. Declare the wire before its first use, or give it another name. — Volt's push, before the IDE is asked"

/** A graphical FB, instantiated in PLC_PRG — the shape of `network-graphical.ts`'s fixtures. */
function network(
  name: string,
  pouName: string,
  feature: string,
  vars: string,
  statements: string,
  extra: Partial<LanguageTest> = {},
): LanguageTest {
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    source: `FUNCTION_BLOCK ${pouName}\nVAR\n${vars}\nEND_VAR\n\nIMPLEMENTATION FBD\nNETWORK\n${statements}\nEND_NETWORK\n\nEND_FUNCTION_BLOCK\n`,
    plcPrgVar: `inst : ${pouName};`,
    plcPrgBody: "inst();",
    execSkip: NOT_ST,
    ...extra,
  }
}

export const REMOVED_PUSH_CHECK_TESTS: readonly LanguageTest[] = [
  // ─── 1.1 — an ST body holding NETWORK … END_NETWORK ───
  {
    name: "rcc_st_body_network",
    pouName: "FB_LANG_rcc_st_network",
    kind: "function_block",
    feature: "an `IMPLEMENTATION ST` body holding NETWORK … END_NETWORK — ST to the build, which reads `NETWORK` as code",
    fromDoc: doc,
    asSent,
    source: `FUNCTION_BLOCK FB_LANG_rcc_st_network
VAR
	a : BOOL;
	out : BOOL;
END_VAR
IMPLEMENTATION ST
NETWORK
  out := a;
END_NETWORK
END_FUNCTION_BLOCK
`,
    plcPrgVar: "fb_rsn : FB_LANG_rcc_st_network;",
    plcPrgBody: "fb_rsn();",
  },

  // ─── 1.2 — `implementation` is a name like any other ───
  {
    name: "rcc_implementation_variable",
    pouName: "FB_LANG_rcc_impl_var",
    kind: "function_block",
    feature: "a variable named `implementation`, written and read",
    fromDoc: doc,
    asSent,
    source: `FUNCTION_BLOCK FB_LANG_rcc_impl_var
VAR
	implementation : INT;
	x : INT;
END_VAR
IMPLEMENTATION ST
implementation := 3;
x := implementation;
END_FUNCTION_BLOCK
`,
    plcPrgVar: "fb_riv : FB_LANG_rcc_impl_var;",
    plcPrgBody: "fb_riv();",
  },
  {
    name: "rcc_implementation_method",
    pouName: "FB_LANG_rcc_impl_method",
    kind: "function_block",
    feature: "a METHOD named `implementation`, called from its FB's body",
    fromDoc: doc,
    asSent,
    source: `FUNCTION_BLOCK FB_LANG_rcc_impl_method
VAR
	n : INT;
END_VAR
IMPLEMENTATION ST
n := implementation();
END_FUNCTION_BLOCK

METHOD implementation : INT
IMPLEMENTATION ST
implementation := 7;
END_METHOD
`,
    plcPrgVar: "fb_rim : FB_LANG_rcc_impl_method;",
    plcPrgBody: "fb_rim();",
  },
  {
    name: "rcc_implementation_enum_value",
    pouName: "DUT_LANG_rcc_impl_enum",
    kind: "dut",
    feature: "an enum value named `Implementation`, assigned in PLC_PRG",
    fromDoc: doc,
    asSent,
    source: `TYPE DUT_LANG_rcc_impl_enum :
(
	Idle := 0,
	Implementation := 1
);
END_TYPE
`,
    plcPrgVar: "e_rie : DUT_LANG_rcc_impl_enum;",
    plcPrgBody: "e_rie := DUT_LANG_rcc_impl_enum.Implementation;",
  },

  // ─── 1.3 — a wire-shaped name no VAR_TEMP declares is a variable ───
  network(
    "rcc_network_undeclared_wire_shape",
    "FB_LANG_rcc_nw_g7",
    "an operand shaped like a wire (`g7`) that nothing declares — the build's undeclared identifier",
    "\tout : BOOL;",
    "  out := g7;",
  ),
  network(
    "rcc_network_located_wire_shape",
    "FB_LANG_rcc_nw_g5",
    "a real variable named like a wire (`g5 AT %IX0.0 : BOOL;`), read in a network",
    "\tg5 AT %IX0.0 : BOOL;\n\tout : BOOL;",
    "  out := g5;",
  ),

  // ─── 1.5 — `.ENO` on a box with no EN ───
  network(
    "rcc_network_eno_without_en",
    "FB_LANG_rcc_nw_eno",
    "`.ENO` read on an ADD box that has no EN — written as the text describes it, and the build's to answer",
    "\ta : INT;\n\tb : INT;\n\tx : BOOL;",
    "  x := ADD(a, b).ENO;",
    {
      vendorRefuses: {
        twincat:
          "TwinCAT: the text reads `.ENO` on the 'ADD' box, and the IDE builds that box with no ENO output — the suffix names an output the box does not have. Without `.ENO` the text matches the box the IDE builds. (Volt's driver, `TcEnoRefusal`, before the first write — measured 2026-10-04.)",
      },
    },
  ),

  // …and on a user FUNCTION's box: the network-missing-en check takes every head that is no variable, and only ADD (an
  // operator) was recorded (review 5+6)
  {
    name: "rcc_network_eno_function_without_en",
    pouName: "FB_LANG_rcc_nw_eno_fun",
    kind: "function_block",
    feature: "`.ENO` read on a user FUNCTION's box that has no EN",
    fromDoc: doc,
    source: `FUNCTION FUN_LANG_rcc_twice : INT
VAR_INPUT
	a : INT;
	b : INT;
END_VAR
FUN_LANG_rcc_twice := a + b;
END_FUNCTION

FUNCTION_BLOCK FB_LANG_rcc_nw_eno_fun
VAR
	a : INT;
	b : INT;
	x : BOOL;
END_VAR

IMPLEMENTATION FBD
NETWORK
  x := FUN_LANG_rcc_twice(a, b).ENO;
END_NETWORK

END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LANG_rcc_nw_eno_fun;",
    plcPrgBody: "inst();",
    execSkip: NOT_ST,
    vendorRefuses: {
      twincat:
        "TwinCAT: the text reads `.ENO` on the 'FUN_LANG_rcc_twice' box, and the IDE builds that box with no ENO output — the suffix names an output the box does not have. Without `.ENO` the text matches the box the IDE builds. (Volt's driver, `TcEnoRefusal`, before the first write — measured 2026-10-04.)",
    },
  },

  // ─── 2.7–2.10 — the network layout rules the push dropped (task 5.2d): each is written as sent now ───
  network(
    "rcc_network_var_temp_after_statement",
    "FB_LANG_rcc_nw_late",
    "a VAR_TEMP block standing after the network's first statement (2.7)",
    "\ta : BOOL;\n\tb : BOOL;\n\tout : BOOL;\n\tlamp1 : BOOL;\n\tlamp2 : BOOL;",
    "  out := a;\n  VAR_TEMP g1 : BOOL; END_VAR\n  g1 := (a OR b);\n  lamp1 := g1;\n  lamp2 := g1;",
  ),
  network(
    "rcc_network_second_var_temp",
    "FB_LANG_rcc_nw_two_blocks",
    "a second VAR_TEMP block in one network, adding to the first (2.7)",
    "\ta : BOOL;\n\tb : BOOL;\n\tc : BOOL;\n\tout1 : BOOL;\n\tout2 : BOOL;\n\tout3 : BOOL;\n\tout4 : BOOL;",
    "  VAR_TEMP g1 : BOOL; END_VAR\n  g1 := (a AND b);\n  out1 := g1;\n  out2 := g1;\n  VAR_TEMP g2 : BOOL; END_VAR\n  g2 := (b OR c);\n  out3 := g2;\n  out4 := g2;",
  ),
  network(
    "rcc_network_empty_var_temp",
    "FB_LANG_rcc_nw_empty_block",
    "an empty VAR_TEMP block (2.9)",
    "\ta : BOOL;\n\tout : BOOL;",
    "  VAR_TEMP END_VAR\n  out := a;",
  ),
  network(
    "rcc_network_wire_never_defined",
    "FB_LANG_rcc_nw_undefined_wire",
    "a wire VAR_TEMP declares and no statement defines (2.8)",
    "\ta : BOOL;\n\tout : BOOL;",
    "  VAR_TEMP g1 : BOOL; END_VAR\n  out := a;",
  ),
  network(
    "rcc_network_wire_named_like_variable",
    "FB_LANG_rcc_nw_wire_shadow",
    "a wire spelled like a variable of the POU (`g1 : INT` beside the wire `g1 : BOOL`) — the wire, for every use after its block (2.10)",
    "\tg1 : INT;\n\ta : BOOL;\n\tb : BOOL;\n\tout1 : BOOL;\n\tout2 : BOOL;",
    // fed by a group, not a bare leaf: TwinCAT's driver refuses a wire fed by a leaf as an unmeasured import shape
    // (NETWORK_UNSUPPORTED, 2026-10-04), which is no answer about the name
    "  VAR_TEMP g1 : BOOL; END_VAR\n  g1 := (a OR b);\n  out1 := g1;\n  out2 := g1;",
  ),
  // the one rule the reader ADDED (2.7 review): a late block may not take a name the network already read as a variable
  network(
    "rcc_network_late_block_shadows_read",
    "FB_LANG_rcc_nw_late_shadow",
    "a late VAR_TEMP block declaring a name the network read as a variable above it — the push refuses it",
    "\tg1 : BOOL;\n\ta : BOOL;\n\tout : BOOL;\n\tlamp1 : BOOL;\n\tlamp2 : BOOL;",
    "  out := g1;\n  VAR_TEMP g1 : BOOL; END_VAR\n  g1 := a;\n  lamp1 := g1;\n  lamp2 := g1;",
    { vendorRefuses: { codesys: LATE_BLOCK_SHADOWS_READ, twincat: LATE_BLOCK_SHADOWS_READ } },
  ),

  // ─── 2.1 — a retired `(* @volt-… *)` comment in a current-format POU ───
  {
    name: "rcc_retired_comment_in_body",
    pouName: "FB_LANG_rcc_retired",
    kind: "function_block",
    feature: "a `(* @volt-… *)` comment in an ST body and a member body of a POU stating its language — a comment",
    fromDoc: doc,
    asSent,
    source: `FUNCTION_BLOCK FB_LANG_rcc_retired
VAR
	n : INT;
END_VAR
IMPLEMENTATION ST
(* @volt-x *)
n := Twice();
END_FUNCTION_BLOCK

METHOD Twice : INT
IMPLEMENTATION ST
(* @volt-implementation ST *)
Twice := 2;
END_METHOD
`,
    plcPrgVar: "fb_rrc : FB_LANG_rcc_retired;",
    plcPrgBody: "fb_rrc();",
  },

  // ─── 2.6 — a POU property with no type ───
  {
    name: "rcc_property_no_type",
    pouName: "FB_LANG_rcc_prop_untyped",
    kind: "function_block",
    feature: "a PROPERTY header with no colon and no type",
    fromDoc: doc,
    asSent,
    source: `FUNCTION_BLOCK FB_LANG_rcc_prop_untyped
VAR
END_VAR
IMPLEMENTATION ST
;
END_FUNCTION_BLOCK

PROPERTY Ready
GET
IMPLEMENTATION ST
Ready := TRUE;
END_GET
END_PROPERTY
`,
    plcPrgVar: "fb_rpu : FB_LANG_rcc_prop_untyped;",
    plcPrgBody: "fb_rpu();",
  },
  {
    name: "rcc_property_empty_type",
    pouName: "FB_LANG_rcc_prop_empty",
    kind: "function_block",
    feature: "a PROPERTY header with nothing after its colon",
    fromDoc: doc,
    asSent,
    source: `FUNCTION_BLOCK FB_LANG_rcc_prop_empty
VAR
END_VAR
IMPLEMENTATION ST
;
END_FUNCTION_BLOCK

PROPERTY Ready :
GET
IMPLEMENTATION ST
Ready := TRUE;
END_GET
END_PROPERTY
`,
    plcPrgVar: "fb_rpe : FB_LANG_rcc_prop_empty;",
    plcPrgBody: "fb_rpe();",
  },

  // ─── 3.1 — a member name: the vendors' measured create rule (DIALECT C28), not Volt's ───
  {
    name: "rcc_member_backtick_name",
    pouName: "FB_LANG_rcc_backtick",
    kind: "function_block",
    feature: "a METHOD whose name is quoted between backticks and holds a blank — created by CODESYS (C28)",
    fromDoc: doc,
    asSent,
    source: `FUNCTION_BLOCK FB_LANG_rcc_backtick
VAR
	n : INT;
END_VAR
IMPLEMENTATION ST
n := 1;
END_FUNCTION_BLOCK

METHOD \`a b\` : INT
IMPLEMENTATION ST
\`a b\` := 3;
END_METHOD
`,
    plcPrgVar: "fb_rbt : FB_LANG_rcc_backtick;",
    plcPrgBody: "fb_rbt();",
    vendorRefuses: {
      twincat:
        "Creating the child named '`a b`' is not possible on node (Name mismatch) — the IDE's own refusal, measured (DIALECT C28) and pre-flighted by name (measured 2026-10-04).",
    },
  },
  {
    name: "rcc_member_name_not_identifier",
    pouName: "FB_LANG_rcc_badname",
    kind: "function_block",
    feature: "a METHOD named `My-Name` — no identifier; both vendors refuse to create it (C28)",
    fromDoc: doc,
    asSent,
    source: `FUNCTION_BLOCK FB_LANG_rcc_badname
VAR
	n : INT;
END_VAR
IMPLEMENTATION ST
n := 1;
END_FUNCTION_BLOCK

METHOD My-Name : BOOL
IMPLEMENTATION ST
;
END_METHOD
`,
    execSkip:
      "NOTHING TO MEASURE — neither IDE creates a METHOD called 'My-Name' (CODESYS \"The name 'My-Name' is not valid for this object.\", TwinCAT \"Name mismatch\", 2026-10-04), so there is no program to run; record:exec would load the parser's own split of the text",
    plcPrgVar: "fb_rbn : FB_LANG_rcc_badname;",
    plcPrgBody: "fb_rbn();",
    vendorRefuses: {
      codesys: "The name 'My-Name' is not valid for this object. — the IDE's own refusal (DIALECT C28), pre-flighted by name (measured 2026-10-04).",
      twincat:
        "Creating the child named 'My-Name' is not possible on node (Name mismatch) — the IDE's own refusal (DIALECT C28), pre-flighted by name (measured 2026-10-04).",
    },
  },
]
