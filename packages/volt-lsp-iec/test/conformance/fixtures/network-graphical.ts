/**
 * The graphical languages (FBD/LD) as network text, against the real compiler — the CLEAN half.
 *
 * WHY THESE EXIST. Before them, all eleven graphical fixtures were ERROR cases, and six were the same `???`
 * marker in different slots (`network-unresolved.ts`, `check-coverage.ts`). Not one graphical body in the whole
 * catalog COMPILED. That left the language's own surface unmeasured — fan-out, coil storage, edge modifiers,
 * output pins, EN/ENO, EXECUTE, jumps, network header fields — and, worse, left the zero-false-positive gate
 * with nothing to bite on: a gate that asks "is every LSP message a real IDE message" cannot catch a false
 * positive on a VALID network when no valid network exists to check.
 *
 * So most of what follows is expected to record CLEAN (`buildSuccess: true`, no diagnostics). A clean fixture is
 * not a weak one here — it is the only shape that can catch the LSP inventing a diagnostic about correct
 * graphical code, which is the failure mode network text is most exposed to (its checks were written against a
 * grammar, not against builds).
 *
 * Each form is spelled from `packages/volt-cli/docs/network-text.md` §6–§7. Where a form has a documented
 * MEASURED history, the fixture says so — `S=`/`R=` especially: a reset coil used to come out as a set coil
 * (the vendors spell it `Negation + Set` on the target), which is silent data corruption in a real project, and
 * nothing in this suite held the compiler's opinion of the three coil kinds until now.
 *
 * NOT here: mixing operator kinds in one group (`(a AND b OR c)`) and an infix box with a named output pin.
 * Both are refused by Volt's own reader/writer before a build can happen, so they belong to the format's tests,
 * not to a compiler oracle.
 */
import type { LanguageTest } from "../types.js"

const doc = "network-text.md"

/** Why none of these reach the EXECUTION recorder — and the reason is SCOPE, not difficulty.
 *
 *  That oracle exists to check the ST transpiler, whose input contract is "code CODESYS compiles"
 *  (`src/transpile/index.ts`) — ST. There is no graphical lowering in `src/transpile/` and none planned here, so
 *  a recording of a network's variable values would have no consumer.
 *
 *  It is worth being exact about this, because the mechanical symptom invites a more flattering explanation.
 *  `record:exec` writes declaration and implementation text straight into a POU, so `NETWORK 0 FBD` reaches the
 *  compiler verbatim and is answered "';' expected instead of 'FBD'". That LOOKS like an unfinished recorder —
 *  and the ground truth is in fact obtainable, since the BRIDGE turns network text into a real graphical body
 *  and that is how the BUILD recording of these very fixtures was taken. So the honest reason is not "it cannot
 *  be measured"; it is "nothing would read it". If a graphical lowering is ever built, this line is what has to
 *  change first. */
const NOT_ST = "the exec oracle checks the ST transpiler, which has no graphical lowering — nothing would read it"

/** A graphical FB, instantiated in PLC_PRG — an uninstantiated POU is dead code CODESYS never compiles. */
function ng(name: string, pouName: string, feature: string, source: string, fromDoc = doc, note?: string): LanguageTest {
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc,
    ...(note === undefined ? {} : { note }),
    source,
    plcPrgVar: `inst : ${pouName};`,
    plcPrgBody: "inst();",
    execSkip: NOT_ST,
  }
}

export const NETWORK_GRAPHICAL_TESTS: readonly LanguageTest[] = [
  // ─── operator groups (§7) ──────────────────────────────────────────────────
  ng("ng_group_nested", "FB_NG_nested", "nested operator groups — parentheses carry the topology, there is no precedence",
    `FUNCTION_BLOCK FB_NG_nested
VAR
\ta : BOOL;
\tb : BOOL;
\tc : BOOL;
\tout : BOOL;
END_VAR

NETWORK 0 FBD
  out := ((a AND b) OR c);
END_NETWORK

END_FUNCTION_BLOCK
`, `${doc}#operator-group--operand-op-operand-op-operand-`),

  ng("ng_group_nary", "FB_NG_nary", "one operator repeated in a group — an N-ary box, not a chain of binary ones",
    `FUNCTION_BLOCK FB_NG_nary
VAR
\ta : BOOL;
\tb : BOOL;
\tc : BOOL;
\tout : BOOL;
END_VAR

NETWORK 0 FBD
  out := (a AND b AND c);
END_NETWORK

END_FUNCTION_BLOCK
`, `${doc}#operator-group--operand-op-operand-op-operand-`),

  ng("ng_group_arithmetic", "FB_NG_arith", "the arithmetic operator boxes (`+` → ADD), which no graphical fixture had reached",
    `FUNCTION_BLOCK FB_NG_arith
VAR
\tx : INT := 2;
\ty : INT := 3;
\tz : INT := 4;
\tsum : INT;
\trest : INT;
END_VAR

NETWORK 0 FBD
  sum := (x + y + z);
END_NETWORK
NETWORK 1 FBD
  rest := (x MOD y);
END_NETWORK

END_FUNCTION_BLOCK
`, `${doc}#7-operators`),

  ng("ng_group_comparison", "FB_NG_compare", "the comparison operator boxes (`<` → LT), whose result is BOOL whatever the operands are",
    `FUNCTION_BLOCK FB_NG_compare
VAR
\tx : INT := 2;
\ty : INT := 3;
\tbelow : BOOL;
\tsame : BOOL;
END_VAR

NETWORK 0 FBD
  below := (x < y);
END_NETWORK
NETWORK 1 FBD
  same := (x = y);
END_NETWORK

END_FUNCTION_BLOCK
`, `${doc}#7-operators`),

  // ─── wires and fan-out (§6) ────────────────────────────────────────────────
  ng("ng_fanout_let", "FB_NG_fanout", "a named wire feeding TWO sinks — the reason `LET` exists at all",
    `FUNCTION_BLOCK FB_NG_fanout
VAR
\ta : BOOL;
\tb : BOOL;
\tout1 : BOOL;
\tout2 : BOOL;
END_VAR

NETWORK 0 FBD
  LET g1 := (a OR b);
  out1 := g1;
  out2 := g1;
END_NETWORK

END_FUNCTION_BLOCK
`, `${doc}#wire-definition--let-name--producer`),

  ng("ng_coil_storage", "FB_NG_coils", "all three coil kinds off ONE wire — plain, SET and RESET",
    `FUNCTION_BLOCK FB_NG_coils
VAR
\ta : BOOL;
\tb : BOOL;
\tplain : BOOL;
\tlatched : BOOL;
\tcleared : BOOL;
END_VAR

NETWORK 0 LD
  LET g1 := (a OR b);
  plain := g1;
  latched S= g1;
  cleared R= g1;
END_NETWORK

END_FUNCTION_BLOCK
`, `${doc}#coil-storage--the-assignment-operator`,
    "The storage kind is a property of the COIL, so a fan-out whose coils disagree needs one operator per target — the shape that could not be spelled before `S=`/`R=`, and the shape in which a RESET coil silently came out as a SET coil. Nothing held the compiler's opinion of it until this fixture."),

  ng("ng_opaque_leaf_negation", "FB_NG_opaque", "`NOT` on a bare leaf INSIDE a group, which becomes an opaque leaf of its own",
    `FUNCTION_BLOCK FB_NG_opaque
VAR
\ta : BOOL;
\tb : BOOL;
\tout : BOOL;
END_VAR

NETWORK 0 FBD
  LET i1 := NOT b;
  out := (a AND i1);
END_NETWORK

END_FUNCTION_BLOCK
`, `${doc}#opaque-leaf--let-i--text`,
    "`NOT b` is no longer a single token, so it cannot ride on the operand: the writer lifts it to `LET i1 := NOT b`. That round-trip has never been built."),

  // ─── modifiers (§6) ────────────────────────────────────────────────────────
  ng("ng_negation_sink", "FB_NG_negate", "`NOT` riding on a SINK's source — the modifier form, not a statement of its own",
    `FUNCTION_BLOCK FB_NG_negate
VAR
\ta : BOOL;
\tb : BOOL;
\tout : BOOL;
END_VAR

NETWORK 0 FBD
  out := NOT (a AND b);
END_NETWORK

END_FUNCTION_BLOCK
`, `${doc}#modifiers--ride-on-the-consumer`),

  ng("ng_edge_modifiers", "FB_NG_edges", "the trailing edge modifiers `RISING` and `FALLING`",
    `FUNCTION_BLOCK FB_NG_edges
VAR
\tclk : BOOL;
\tup : BOOL;
\tdown : BOOL;
END_VAR

NETWORK 0 LD
  up := clk RISING;
END_NETWORK
NETWORK 1 LD
  down := clk FALLING;
END_NETWORK

END_FUNCTION_BLOCK
`, `${doc}#modifiers--ride-on-the-consumer`,
    "The LSP's undeclared-identifier check has to SKIP these two words — they are graphical keywords the lean operand parser leaves in the expression, not names. No fixture has ever put one in front of the compiler."),

  // ─── calls and their pins (§6) ─────────────────────────────────────────────
  ng("ng_fb_call_output_read", "FB_NG_fbcall", "an FB instance call and its output read back by name",
    `FUNCTION_BLOCK FB_NG_fbcall
VAR
\tt1 : TON;
\tgo : BOOL;
\tpt : TIME := T#100MS;
\tdone : BOOL;
END_VAR

NETWORK 0 FBD
  t1(IN := go, PT := pt);
  done := t1.Q;
END_NETWORK

END_FUNCTION_BLOCK
`, `${doc}#fb-instance-call--instpin--arg--and-output-read-instpin`),

  ng("ng_box_output_arrow", "FB_NG_arrow", "a NAMED output pin bound with `=>`, beside the unnamed result",
    `FUNCTION F_NG_split : INT
VAR_INPUT
\tsource : INT;
END_VAR
VAR_OUTPUT
\tdoubled : INT;
END_VAR
doubled := source * 2;
F_NG_split := source + 1;
END_FUNCTION

FUNCTION_BLOCK FB_NG_arrow
VAR
\tsrc : INT := 5;
\tnext : INT;
\ttwice : INT;
END_VAR

NETWORK 0 FBD
  next := F_NG_split(src, doubled => twice);
END_NETWORK

END_FUNCTION_BLOCK
`, `${doc}#box-output-pins--the-calls-assignment-and-`,
    "208 wired output pins on 171 boxes were DROPPED before this form existed — a pin the engineer wired was simply absent from the file. IEC's own split: a function's result is assigned, its VAR_OUTPUTs use `=>`."),

  // ─── EN/ENO and EXECUTE (§6) ───────────────────────────────────────────────
  ng("ng_en_eno_sink", "FB_NG_en", "an enabled box whose result feeds one sink",
    `FUNCTION_BLOCK FB_NG_en
VAR
\tgo : BOOL;
\ta : BOOL;
\tb : BOOL;
\tout : BOOL;
END_VAR

NETWORK 0 LD
  LET en1 := go;
  IF en1 THEN out := (a AND b); END_IF
END_NETWORK

END_FUNCTION_BLOCK
`, `${doc}#eneno--let-en--src-if-en-then-result-end_if`),

  ng("ng_en_eno_named_wire", "FB_NG_enwire", "an enabled box whose result is a NAMED wire, so it can fan out past the IF",
    `FUNCTION_BLOCK FB_NG_enwire
VAR
\tgo : BOOL;
\tb : BOOL;
\tc : BOOL;
\tout : BOOL;
\tout3 : BOOL;
END_VAR

NETWORK 0 FBD
  LET en1 := go;
  IF en1 THEN (b OR c); END_IF
  LET g1 := en1;
  out := g1;
  out3 := g1;
END_NETWORK

END_FUNCTION_BLOCK
`, `${doc}#eneno--let-en--src-if-en-then-result-end_if`),

  ng("ng_execute_box", "FB_NG_execute", "an EXECUTE box — raw ST inside a graphical body, with its own nested END_IF",
    `FUNCTION_BLOCK FB_NG_execute
VAR
\tbRun : BOOL;
\tbStart : BOOL;
\ttarget : INT;
END_VAR

NETWORK 0 FBD
  LET en1 := bRun;
  IF en1 THEN
  EXECUTE
IF bStart THEN
\ttarget := 40 + 2;
END_IF
  END_EXECUTE
  END_IF
END_NETWORK

END_FUNCTION_BLOCK
`, `${doc}#execute-box--execute--end_execute`,
    "The explicit `END_EXECUTE` exists so the ST's own `END_IF` cannot end the box. The LSP treats what is between the markers as full ST, not as the network grammar — a claim no fixture has tested against a build."),

  // ─── control flow (§6) ─────────────────────────────────────────────────────
  ng("ng_label_jmp_resolved", "FB_NG_jump", "a label that DOES resolve, and the jump that reaches it",
    `FUNCTION_BLOCK FB_NG_jump
VAR
\tout : BOOL;
\tafter : BOOL;
END_VAR

NETWORK 0 LD
  out := TRUE;
  JMP Onwards;
END_NETWORK
NETWORK 1 LD LABEL: Onwards
  after := TRUE;
END_NETWORK

END_FUNCTION_BLOCK
`, `${doc}#control-flow`,
    "Only the MISSING-label error was covered (`cc_vg_undefined_label`). A jump exists to leave the current network, so the label sits on the DESTINATION network's header — resolving per network flagged every real jump."),

  ng("ng_conditional_jump_and_return", "FB_NG_cond", "a conditional JMP and a conditional RETURN, beside an unconditional one",
    `FUNCTION_BLOCK FB_NG_cond
VAR
\tcond : BOOL;
\tdone : BOOL;
\tlater : BOOL;
END_VAR

NETWORK 0 LD
  IF cond THEN JMP Tail; END_IF
END_NETWORK
NETWORK 1 LD
  IF cond THEN RETURN; END_IF
END_NETWORK
NETWORK 2 LD LABEL: Tail
  done := TRUE;
  RETURN;
END_NETWORK
NETWORK 3 LD
  later := TRUE;
END_NETWORK

END_FUNCTION_BLOCK
`, `${doc}#control-flow`),

  // ─── network header fields (§6) ────────────────────────────────────────────
  ng("ng_network_title_and_comment", "FB_NG_header", "a network carrying TITLE and a leading comment",
    `FUNCTION_BLOCK FB_NG_header
VAR
\ta : BOOL;
\tb : BOOL;
\tout : BOOL;
END_VAR

NETWORK 0 FBD TITLE: "the interlock"
  // both have to be true
  out := (a AND b);
END_NETWORK

END_FUNCTION_BLOCK
`, `${doc}#networks-comments-flags`),

  ng("ng_network_disabled", "FB_NG_disabled", "a DISABLED network, which the compiler does not generate code for",
    `FUNCTION_BLOCK FB_NG_disabled
VAR
\ta : BOOL;
\tout : BOOL;
\tlive : BOOL;
END_VAR

NETWORK 0 FBD DISABLED
  out := nothingDeclaredWithThisName;
END_NETWORK
NETWORK 1 FBD
  live := a;
END_NETWORK

END_FUNCTION_BLOCK
`, `${doc}#networks-comments-flags`,
    "The disabled network holds a DELIBERATE error, because a valid one would settle nothing: a disabled network is not compiled, so if CODESYS stays silent then anything the LSP says about its contents is a false positive — and if CODESYS reports it anyway, that is worth knowing too. Nothing has ever checked which."),

  ng("ng_two_languages_one_body", "FB_NG_mixed", "one body holding an FBD network and an LD network",
    `FUNCTION_BLOCK FB_NG_mixed
VAR
\ta : BOOL;
\tb : BOOL;
\tfromFbd : BOOL;
\tfromLd : BOOL;
END_VAR

NETWORK 0 LD
  fromFbd := (a AND b);
END_NETWORK
NETWORK 1 LD
  fromLd := (a OR b);
END_NETWORK

END_FUNCTION_BLOCK
`, `${doc}#networks-comments-flags`,
    "\"A body may even mix FBD and LD networks, vendor permitting\" — the spec's own hedge, and this is what settles it for CODESYS."),

  // ─── an error path the graphical fixtures did not cover ────────────────────
  ng("ng_sink_type_mismatch", "FB_NG_badsink", "a BOOL wire driven into an INT coil — the network type-check against a real build",
    `FUNCTION_BLOCK FB_NG_badsink
VAR
\ta : BOOL;
\tb : BOOL;
\tcount : INT;
END_VAR

NETWORK 0 FBD
  count := (a AND b);
END_NETWORK

END_FUNCTION_BLOCK
`, `${doc}#8-type-system--inference-the-lsps-job`,
    "Every graphical ERROR fixture so far was about a missing NAME or an unnamed slot. None put a TYPE error in a network, so the shared assignment rules the network checks reuse have never been confirmed to say the same thing there as in ST."),
]
