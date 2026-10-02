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
 *                                             one (scripts/probe-is-it-compiled.ts). They ARE compiled.
 *   "nothing reaches them"                 —  same experiment, same answer. (The MECHANISM is real — an
 *                                             uninstantiated FB is skipped whatever is wrong inside it — it
 *                                             simply is not what is happening here.)
 *
 * The truth is a FORMAT ambiguity, and the vendor model shows it plainly (probe-nwl-dump.py, `AHWF`
 * network 6): the marker there is a genuine `'???'` operand on a BOX OUTPUT PIN whose result nobody wired
 * (`BoxType='SideCorrection'`, `out[0] = <null>`, `out[1] = '???'`). CODESYS compiles an unwired result pin
 * without complaint. An unnamed COIL is a different shape — a `BoxTreeAssign` with a `???` target — and IS
 * an error, which is exactly what `network_unnamed_assignment_target` below records.
 *
 * Network text v1 wrote BOTH as `??? := <value>;`, so nothing downstream could tell them apart and the LSP
 * reported the pin case as the coil case. v2 gives the pin its own spelling — `f(…, => ???)`, the box's own output
 * slot (openspec network-text-literal-nwl, "a result pin is not an assign") — and the LSP says nothing about it, as
 * the build says nothing (`network/network-analysis.ts`, `checkUnresolvedBoxes`). The coil keeps `??? := <value>;`
 * and the compiler's answer below.
 *
 * These bodies were recorded as v1 text; each is now the v2 text of the SAME vendor model (the v1 reader's model,
 * written by the v2 writer — an enabled box Volt builds is read through its ENO, DIALECT N21, so its consumer says
 * `.ENO`), so the recordings stand.
 */
import type { LanguageTest } from "../../types.js"

/**
 * TWINCAT REFUSES THESE TWO PUSHES SINCE `push-without-header-check` 5.Q — a known divergence (tasks 5.Q.9). Every POU
 * is now created as a FUNCTION_BLOCK (tree code 604) whatever its text, and TwinCAT keeps that code until a solution
 * reload (DIALECT C2f/C2h); its graphical layer builds the call box of the just-created PROGRAM / FUNCTION from it, as
 * a function-block box with no ENO, so the driver refuses the `.ENO` the caller reads. Re-recorded 2026-10-02: both
 * refused, so nothing new was recorded; the committed TwinCAT rows were taken under the per-kind seeds (`.prg` → 602,
 * `.fun` → 603), when the box had its ENO, and stay as the vendor's answer for this source. Pinned live by `volt-cli`'s
 * `test/e2e/graphical/callee-seed-lag.test.ts`. Niche: accepted loss (0 such calls in the TwinCAT corpus; 2 `.ENO`
 * calls of a project PROGRAM / FUNCTION in the six corpora, all lenze-mid, a CODESYS project).
 */
const twincatSeedLag = (callee: string): string =>
  `TwinCAT: the text reads \`.ENO\` on the '${callee}' box, and the IDE builds that box with no ENO output — the ` +
  "callee is created in the same push under the one POU seed (604) and TwinCAT builds its box from that tree code " +
  "until a reload (push-without-header-check 5.Q.9). Niche: accepted loss (0 in the TwinCAT corpus, 2 in the six corpora)."

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
    source: `FUNCTION_BLOCK FB_LANG_network_unnamed_target_en
VAR
\ta : BOOL;
END_VAR

IMPLEMENTATION LD
NETWORK
  ??? := NOT(EN := , a).ENO;
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
  out := (??? AND a);
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
      "`network_unnamed_assignment_target` measures `??? := a` and the EN variant `??? := NOT(a)`; both have a " +
      "real value to leave unassigned, and CODESYS errors. A PROGRAM box has NO output pin at all, so there is " +
      "nothing unassigned — and lenze-mid carries four of exactly this (`??? := SpeedCalculationDryer();` and " +
      "friends, in Mach1_MIDS.pou and AHWF.pou) while its recorded build reports buildSuccess with no such " +
      "error. Volt is faithful here: a plain void call round-trips as `P();`, measured live, so the `???` is " +
      "the vendor's own. ANSWERED: all four are false positives. The compiler answers about the SOURCE over " +
      "any real call, so the target message is one it never emits here — and voidness is not the line, as " +
      "`network_unnamed_target_of_valued_call` shows. `Mach1_MIDS` is LIVE (`General.pou:29` calls it and " +
      "`general` is a task root), so the excluded-from-build reading this fixture tested is WRONG. " +
      "RESOLVED 2026-09-19: the compiler never reads network text — the recorder pushes this through the BRIDGE, " +
      "which writes PlcOpen XML. So this measures the XML the bridge makes of a `???`; lenze-mid measures the XML " +
      "its author drew, an unconnected output pin, which is legal. The gap is `volt-cli` round-trip fidelity, not " +
      "an LSP check, and the LSP stays silent so it does not flag the vendor's own drawing.",
    plcPrgBody: "PRG_LANG_network_unnamed_void_caller();",
    vendorRefuses: { twincat: twincatSeedLag("PRG_LANG_network_unnamed_void_callee") },
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
  ??? := PRG_LANG_network_unnamed_void_callee(EN := go).ENO;
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
      "The last unmeasured target shape, and the one lenze-mid's surviving corpus divergence sits on " +
      "(`??? := Alarms_V5_1_100(...)`, a `FUNCTION … : BOOL`). The neighbours bracket it without covering it: " +
      "`??? := NOT(a)` is an OPERATOR and errors on the target, `??? := <PROGRAM>()` returns NOTHING and errors " +
      "on the source. A valued call is a call with a value, so either answer is credible and only the compiler " +
      "settles it. Same unconnected enable as the corpus and as the `_behind_enable` fixture, so the enable is " +
      "held constant and the CALL is the only thing that varies. Answered with its void twin, below, and for " +
      "the same reason: this is the BRIDGE's XML for a `???`, not the XML a real project carries.",
    plcPrgVar: "fb_nvc : FB_LANG_network_unnamed_valued_call;",
    plcPrgBody: "fb_nvc();",
    vendorRefuses: { twincat: twincatSeedLag("FUN_LANG_network_unnamed_valued") },
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
  ??? := FUN_LANG_network_unnamed_valued(EN := , a).ENO;
END_NETWORK

END_FUNCTION_BLOCK
`,
  },
]
