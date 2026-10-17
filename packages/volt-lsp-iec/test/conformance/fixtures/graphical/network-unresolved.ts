/**
 * `???` — the vendor's marker for a graphical slot nobody named — against the real compiler.
 *
 * WHY THESE EXIST. `???` is not Volt's spelling: CODESYS writes it into a box whose instance is unnamed, or a
 * coil with no target, and draws it so the engineer sees the mistake. Volt carries it through verbatim, and the
 * LSP reports one `NETWORK_UNRESOLVED_BOX` per marker. Nothing had ever checked that claim against the
 * compiler — the conformance recorder's header said graphical bodies "can't be recorded, the bridge stores them
 * as PlcOpen XML, not pushable text", which stopped being true when network text became the transport. So the
 * one check that would have settled it was believed impossible, and the LSP's message ("the project will not
 * compile until it is replaced with a real operand") went unverified.
 *
 * It is TRUE — measured live on CODESYS SP21, each shape pushed into a fixture project and built:
 *
 *   instance position   `??? : TON(IN := a, PT := t);`   4 errors, build fails
 *                       ("Expression expected instead of '?'", "Program name, function or function block
 *                        instance expected instead of '!!!'ERROR'!!!'", "Unexpected token '?' found")
 *   assignment target   `??? := a;`                      "The assignment target is not specified."
 *   target behind EN    `??? := NOT(EN := , a).ENO;`     the same, plus two about the implicit temp
 *
 * So the LSP and the compiler agree that every one of these is an error, and these fixtures hold them to it
 * ON THE TEXT, not merely on the fact that both flagged something. The check reads which SLOT the marker sits
 * in and emits the compiler's own wording for it:
 *
 *   operand / input pin / unnamed instance   Expression expected instead of '?'
 *   assignment target (incl. behind an EN)   The assignment target is not specified.
 *
 * It emits ONE per marker where the compiler's parser sometimes emits two to four. That is deliberate and it
 * is a SUBSET, never an invention: the corpus gate forbids two diagnostics sharing a (range, code), the extra
 * messages are parse-recovery noise, and one of them names an implicit temp (`__FB__ImpVar15`) whose number
 * cannot be reproduced offline. These were in `KNOWN_DIVERGENCES` while the LSP answered every position with
 * one invented sentence; they are not any more.
 * * WHAT THIS DOES NOT COVER, and it is not what it looked like. `Lenze_MID-S100` builds with ZERO errors
 * while four markers sit in POUs the LSP reports on. Two explanations were proposed and BOTH are false,
 * each killed by a measurement rather than an argument:
 *
 *   "the objects are excluded from build"  —  planting an undeclared identifier in `Mach1_MIDS`, `AHWF`,
 *                                             `General` and `BasicMovement` makes the compiler report every
 *                                             one (the `probe-is-it-compiled` probe, deleted; `git show b2496efb4b` holds it, under `scripts/`). They ARE compiled.
 *   "nothing reaches them"                 —  same experiment, same answer. (The MECHANISM is real — an
 *                                             uninstantiated FB is skipped whatever is wrong inside it — it
 *                                             simply is not what is happening here.)
 *
 * The truth is a FORMAT ambiguity, and the vendor model shows it plainly (probe-nwl-dump.py (deleted; git show b2496efb4b:packages/volt-cli/scripts/probe-nwl-dump.py), `AHWF`
 * network 6): the marker there is a genuine `'???'` operand on a BOX OUTPUT PIN whose result nobody wired
 * (`BoxType='SideCorrection'`, `out[0] = <null>`, `out[1] = '???'`). CODESYS compiles an unwired result pin
 * without complaint. An unnamed COIL is a different shape — a `BoxTreeAssign` with a `???` target — and IS
 * an error, which is exactly what `network_unnamed_assignment_target` below records.
 *
 * Network text v1 wrote BOTH as `??? := <value>;`, so nothing downstream could tell them apart and the LSP
 * reported the pin case as the coil case. v2 gives the pin its own spelling — `f(…, => ???)`, the box's own output
 * slot (openspec network-text-literal-nwl, "a result pin is not an assign") — and the LSP says nothing about it, as
 * the build says nothing (`network/_boxes.ts`, `checkUnresolvedBoxes`). The coil keeps `??? := <value>;`
 * and the compiler's answer below.
 *
 * These bodies were recorded as v1 text; each is now the v2 text of the SAME vendor model (the v1 reader's model,
 * written by the v2 writer — an enabled box Volt builds is read through its ENO, DIALECT N21, so its consumer says
 * `.ENO`), so the recordings stand.
 */
import type { LanguageTest } from "../../types.js"

export const NETWORK_UNRESOLVED_TESTS: readonly LanguageTest[] = [
  {
    name: "network_unnamed_instance",
    pouName: "FB_LANG_network_unnamed_instance",
    kind: "function_block",
    feature: "`???` in a call box's INSTANCE position",
    fromDoc: "network-text.html#unnamed-instance",
    note: "The shape Lenze_MID-S100's `MotionControl/POU` holds four of. Network text spells the type inline here (`??? : TYPE(…)`) because `???` is declared nowhere for the push to read it from.",
    plcPrgVar: "fb_nui : FB_LANG_network_unnamed_instance;",
    plcPrgBody: "fb_nui();",
    source: `FUNCTION_BLOCK FB_LANG_network_unnamed_instance
VAR
\ta : BOOL;
\tt : TIME;
END_VAR

IMPLEMENTATION FBD
NETWORK
  ??? : TON(IN := a, PT := t);
END_NETWORK

END_FUNCTION_BLOCK
`,
  },
  {
    name: "network_unnamed_assignment_target",
    pouName: "FB_LANG_network_unnamed_target",
    kind: "function_block",
    feature: "`???` as an assignment TARGET (a coil / outVariable nobody named)",
    fromDoc: "network-text.html#sink",
    note: "CODESYS answers `The assignment target is not specified.` — a different error from the instance case, which is why both shapes are held here rather than one standing in for the other.",
    plcPrgVar: "fb_nut : FB_LANG_network_unnamed_target;",
    plcPrgBody: "fb_nut();",
    source: `FUNCTION_BLOCK FB_LANG_network_unnamed_target
VAR
\ta : BOOL;
END_VAR

IMPLEMENTATION LD
NETWORK
  ??? := a;
END_NETWORK

END_FUNCTION_BLOCK
`,
  },
  {
    name: "network_unnamed_target_behind_enable",
    pouName: "FB_LANG_network_unnamed_target_en",
    kind: "function_block",
    feature: "`???` as an assignment target inside an UNCONNECTED enable",
    fromDoc: "network-text.html#eneno",
    note: "The exact shape the two LIVE Lenze POUs carry, and the reason it is here: an unconnected EN does NOT excuse the marker — the compiler still errors. That rules out 'the rung is not generated' as the explanation for those POUs building clean, leaving exclude-from-build.",
    plcPrgVar: "fb_nute : FB_LANG_network_unnamed_target_en;",
    plcPrgBody: "fb_nute();",
    // TwinCAT's native builder refuses an enabled bit operator read through its ENO: built so, it does not compile there
    // ("__ImpVar not defined", DIALECT N42 e) — re-recorded 2026-10-17 (openspec twincat-inproc-host).
    vendorRefuses: {
      twincat:
        "TwinCAT: the 'NOT' box has an EN pin, and TwinCAT does not compile an enabled NOT built with only its ENO output (measured: \"__ImpVar not defined\"); the box its editor draws keeps a result slot the text has no position for. Draw it in the IDE, or feed the rung into the box as an input.",
    },
    source: `FUNCTION_BLOCK FB_LANG_network_unnamed_target_en
VAR
\ta : BOOL;
END_VAR

IMPLEMENTATION LD
NETWORK
  NOT(IN := a) EN
  ??? := ENO;
END_NETWORK

END_FUNCTION_BLOCK
`,
  },
  {
    name: "network_unnamed_input_pin",
    pouName: "FB_LANG_network_unnamed_input_pin",
    kind: "function_block",
    feature: "`???` on a NAMED INPUT pin of an FB call",
    fromDoc: "network-text.html#fb",
    note: "The position NO real project has shown us yet — pinned because 'never seen' is not 'cannot happen'. Same two parse errors as an operand: the compiler chokes on the marker text wherever it stands.",
    plcPrgVar: "fb_nip : FB_LANG_network_unnamed_input_pin;",
    plcPrgBody: "fb_nip();",
    source: `FUNCTION_BLOCK FB_LANG_network_unnamed_input_pin
VAR
	t1 : TON;
	pt : TIME;
END_VAR

IMPLEMENTATION FBD
NETWORK
  t1(IN := ???, PT := pt);
END_NETWORK

END_FUNCTION_BLOCK
`,
  },
  {
    name: "network_unnamed_group_operand",
    pouName: "FB_LANG_network_unnamed_group_operand",
    kind: "function_block",
    feature: "`???` as an operand inside a group",
    fromDoc: "network-text.html#group",
    note: "The marker where a plain variable belongs. Grouped with the pin case because the compiler answers both identically — which is itself the finding: position matters for the TARGET case and nowhere else.",
    plcPrgVar: "fb_ngo : FB_LANG_network_unnamed_group_operand;",
    plcPrgBody: "fb_ngo();",
    source: `FUNCTION_BLOCK FB_LANG_network_unnamed_group_operand
VAR
	a : BOOL;
	out : BOOL;
END_VAR

IMPLEMENTATION FBD
NETWORK
  out := ??? AND a;
END_NETWORK

END_FUNCTION_BLOCK
`,
  },
  {
    name: "network_unnamed_target_of_void_call",
    pouName: "PRG_LANG_network_unnamed_void_caller",
    kind: "program",
    feature: "`???` as the target of a call that RETURNS NOTHING (a PROGRAM box)",
    fromDoc: "network-text.html#sink",
    note:
      "THE SHAPE THE CORPUS ACTUALLY CARRIES, and the one the other target fixtures do not reach. " +
      "`network_unnamed_assignment_target` measures `??? := a` and the EN variant `??? := NOT(IN := a)`; both have a " +
      "real value to leave unassigned, and CODESYS errors. A PROGRAM box has NO output pin at all, so there is " +
      "nothing unassigned — and lenze-mid carries four of exactly this (`??? := SpeedCalculationDryer();` and " +
      "friends, in Mach1_MIDS.pou and AHWF.pou) while its recorded build reports buildSuccess with no such " +
      "error. Volt is faithful here: a plain void call round-trips as `P();`, measured live, so the `???` is " +
      "the vendor's own. `Mach1_MIDS` is LIVE (`General.pou:29` calls it and `general` is a task root), so the " +
      "excluded-from-build reading this fixture tested is WRONG. RESOLVED 2026-09-19: the compiler never reads " +
      "network text — the recorder pushes this through the BRIDGE, so this measures the box the bridge builds of a " +
      "`???`; lenze-mid's drawings are unconnected output pins, which network text now spells as such " +
      "(`SpeedCalculationDryer(=> ???) EN;`, no coil, no LSP error). RE-RECORDED 2026-10-16 (ld-fbd-coverage 2R.3): on " +
      "the box 2R.3's push builds (its output list derived from the text, ENO first) the answer is the TARGET, " +
      "\"The assignment target is not specified.\" — before 2R.3 it was the lazy-type pair plus \"The assignment " +
      "source is incorrect.\" The LSP gives the target message for a `???` coil read off a box's ENO.",
    plcPrgBody: "PRG_LANG_network_unnamed_void_caller();",
    source: `PROGRAM PRG_LANG_network_unnamed_void_callee
VAR
	x : BOOL;
END_VAR

x := TRUE;

END_PROGRAM

PROGRAM PRG_LANG_network_unnamed_void_caller
VAR
	go : BOOL;
END_VAR

IMPLEMENTATION LD
NETWORK
  PRG_LANG_network_unnamed_void_callee() EN go
  ??? := ENO;
END_NETWORK

END_PROGRAM
`,
  },
  {
    name: "network_unnamed_target_of_valued_call",
    pouName: "FB_LANG_network_unnamed_valued_call",
    kind: "function_block",
    feature: "`???` as the target of a FUNCTION call that DOES return a value",
    fromDoc: "network-text.html#sink",
    note:
      "The valued twin of `network_unnamed_target_of_void_call`, for lenze-mid's `Alarms_V5_1_100(…, => ???) EN` (a " +
      "`FUNCTION … : BOOL`; now spelled as its unconnected output pin, no coil). Same unconnected enable as the " +
      "`_behind_enable` fixture, so the CALL is the only thing that varies. RE-RECORDED 2026-10-16 (ld-fbd-coverage " +
      "2R.3): read through its ENO on the box 2R.3's push builds, the answer is the TARGET, \"The assignment target " +
      "is not specified.\", as for the PROGRAM twin and the operator — before 2R.3, the lazy-type pair plus \"The " +
      "assignment source is incorrect.\" This is the BRIDGE's box for a `???`, not one a real project carries.",
    plcPrgVar: "fb_nvc : FB_LANG_network_unnamed_valued_call;",
    plcPrgBody: "fb_nvc();",
    source: `FUNCTION FUN_LANG_network_unnamed_valued : BOOL
VAR_INPUT
	a : BOOL;
END_VAR

FUN_LANG_network_unnamed_valued := a;

END_FUNCTION

FUNCTION_BLOCK FB_LANG_network_unnamed_valued_call
VAR
	a : BOOL;
END_VAR

IMPLEMENTATION LD
NETWORK
  FUN_LANG_network_unnamed_valued(a) EN
  ??? := ENO;
END_NETWORK

END_FUNCTION_BLOCK
`,
  },
  {
    name: "network_unknown_fb_type",
    pouName: "FB_LANG_network_unknown_fb_type",
    kind: "function_block",
    feature: "an FB instance box whose TYPE neither the project nor a library declares",
    fromDoc: "network-text.html#fb",
    note:
      "openspec bridge-refusal-review D4. The push used to decide 'instance or function' from a hand copy of IEC type " +
      "words (`NonBlockTypeWords`, deleted); now a variable's type is no block only where the VENDOR refuses that word " +
      "as a POU name (its measured list) or names a project item of another kind. Any other type is a library's as far " +
      "as the push can tell, so the box is written as sent — and this asks what each IDE then does with a box whose " +
      "type nothing resolves: write it and let the build report it (CODESYS keeps the parameters Volt appends, DIALECT " +
      "N21), or refuse it (TwinCAT takes a box's pins from its callee, C2m).",
    plcPrgVar: "fb_nuft : FB_LANG_network_unknown_fb_type;",
    plcPrgBody: "fb_nuft();",
    source: `FUNCTION_BLOCK FB_LANG_network_unknown_fb_type
VAR
	t1 : FB_LANG_NoSuchType;
	a : BOOL;
END_VAR

IMPLEMENTATION FBD
NETWORK
  t1(IN := a);
END_NETWORK

END_FUNCTION_BLOCK
`,
  },
]
