/**
 * the fixtures of `network-graphical.ts` — part A: operator groups (§7); wires and fan-out (§6); modifiers (§6); calls and their pins (§6); EN/ENO and EXECUTE (§6); control flow (§6); network header fields (§6); an error path the graphical fixtures did not cover.
 *
 * One slice of `network-graphical.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"
import { doc, ng } from "./network-graphical-shared.js"

export const NETWORK_GRAPHICAL_TESTS_A: readonly LanguageTest[] = [
// ─── operator groups (§7) ──────────────────────────────────────────────────
  ng("ng_group_nested", "FB_NG_nested", "nested operator groups — parentheses carry the topology, there is no precedence",
    `FUNCTION_BLOCK FB_NG_nested
VAR
\ta : BOOL;
\tb : BOOL;
\tc : BOOL;
\tout : BOOL;
END_VAR

%LANGUAGE FBD
%NETWORK
out := OR(AND(a, b), c);

END_FUNCTION_BLOCK
`, `${doc}#elements`),
  ng("ng_group_nary", "FB_NG_nary", "one operator repeated in a group — an N-ary box, not a chain of binary ones",
    `FUNCTION_BLOCK FB_NG_nary
VAR
\ta : BOOL;
\tb : BOOL;
\tc : BOOL;
\tout : BOOL;
END_VAR

%LANGUAGE FBD
%NETWORK
out := AND(a, b, c);

END_FUNCTION_BLOCK
`, `${doc}#elements`),
  ng("ng_group_arithmetic", "FB_NG_arith", "the arithmetic operator boxes (ADD, MOD), which no graphical fixture had reached",
    `FUNCTION_BLOCK FB_NG_arith
VAR
\tx : INT := 2;
\ty : INT := 3;
\tz : INT := 4;
\tsum : INT;
\trest : INT;
END_VAR

%LANGUAGE FBD
%NETWORK
sum := ADD(x, y, z);
%NETWORK
rest := MOD(x, y);

END_FUNCTION_BLOCK
`, `${doc}#elements`),
  ng("ng_group_comparison", "FB_NG_compare", "the comparison operator boxes (LT, EQ), whose result is BOOL whatever the operands are",
    `FUNCTION_BLOCK FB_NG_compare
VAR
\tx : INT := 2;
\ty : INT := 3;
\tbelow : BOOL;
\tsame : BOOL;
END_VAR

%LANGUAGE FBD
%NETWORK
below := LT(x, y);
%NETWORK
same := EQ(x, y);

END_FUNCTION_BLOCK
`, `${doc}#elements`),
  // ─── wires and fan-out (§6) ────────────────────────────────────────────────
  ng("ng_fanout_let", "FB_NG_fanout", "a wire feeding TWO sinks — declared on the `VAR_TEMP` line, defined before its uses",
    `FUNCTION_BLOCK FB_NG_fanout
VAR
\ta : BOOL;
\tb : BOOL;
\tout1 : BOOL;
\tout2 : BOOL;
END_VAR

%LANGUAGE FBD
%NETWORK
VAR w1 : ANY; END_VAR
w1 := OR(a, b);
out1 := w1;
out2 := w1;

END_FUNCTION_BLOCK
`, `${doc}#wires`),
  ng("ng_coil_storage", "FB_NG_coils", "all three coil kinds off ONE wire — plain, SET and RESET",
    `FUNCTION_BLOCK FB_NG_coils
VAR
\ta : BOOL;
\tb : BOOL;
\tplain : BOOL;
\tlatched : BOOL;
\tcleared : BOOL;
END_VAR

%LANGUAGE LD
%NETWORK
VAR w1 : ANY; END_VAR
w1 := a OR b;
plain := w1;
latched S= w1;
cleared R= w1;

END_FUNCTION_BLOCK
`, `${doc}#elements`,
    "The storage kind is a property of the COIL, so a fan-out whose coils disagree needs one operator per target — the shape that could not be spelled before `S=`/`R=`, and the shape in which a RESET coil silently came out as a SET coil. Nothing held the compiler's opinion of it until this fixture."),
  ng("ng_opaque_leaf_negation", "FB_NG_opaque", "`NOT` on a bare leaf INSIDE a box's inputs — `AND(a, NOT b)`",
    `FUNCTION_BLOCK FB_NG_opaque
VAR
\ta : BOOL;
\tb : BOOL;
\tout : BOOL;
END_VAR

%LANGUAGE FBD
%NETWORK
out := AND(a, NOT b);

END_FUNCTION_BLOCK
`, `${doc}#elements`,
    "A negated input of a box: the IDE stores it as the pin's negation."),
  // ─── modifiers (§6) ────────────────────────────────────────────────────────
  ng("ng_negation_sink", "FB_NG_negate", "`NOT` riding on a SINK's source — the modifier form, not a statement of its own",
    `FUNCTION_BLOCK FB_NG_negate
VAR
\ta : BOOL;
\tb : BOOL;
\tout : BOOL;
END_VAR

%LANGUAGE FBD
%NETWORK
out := NOT(AND(a, b));

END_FUNCTION_BLOCK
`, `${doc}#elements`),
  ng("ng_edge_modifiers", "FB_NG_edges", "the edge boxes `RISING(x)` and `FALLING(x)` on an operand",
    `FUNCTION_BLOCK FB_NG_edges
VAR
\tclk : BOOL;
\tup : BOOL;
\tdown : BOOL;
END_VAR

%LANGUAGE LD
%NETWORK
up := RISING(clk);
%NETWORK
down := FALLING(clk);

END_FUNCTION_BLOCK
`, `${doc}#elements`,
    "The LSP reads `RISING(x)` as the edge, not as a call of an undeclared name."),
  // ─── calls and their pins (§6) ─────────────────────────────────────────────
  ng("ng_fb_call_output_read", "FB_NG_fbcall", "an FB instance call and its output read back by name",
    `FUNCTION_BLOCK FB_NG_fbcall
VAR
\tt1 : TON;
\tgo : BOOL;
\tpt : TIME := T#100MS;
\tdone : BOOL;
END_VAR

%LANGUAGE FBD
%NETWORK
t1(IN := go, PT := pt);
done := t1.Q;

END_FUNCTION_BLOCK
`, `${doc}#elements`),
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

%LANGUAGE FBD
%NETWORK
next := F_NG_split(source := src, doubled => twice).OUT;

END_FUNCTION_BLOCK
`, `${doc}#outputs`,
    "208 wired output pins on 171 boxes were DROPPED before this form existed — a pin the engineer wired was simply absent from the file. IEC's own split: a function's result is assigned, its VAR_OUTPUTs use `=>`."),
  // ─── EN/ENO and EXECUTE (§6) ───────────────────────────────────────────────
  ng("ng_en_eno_sink", "FB_NG_en", "an enabled operator box read through its ENO, its value wired nowhere (X3: it stores, and the build refuses it)",
    `FUNCTION_BLOCK FB_NG_en
VAR
\tgo : BOOL;
\ta : BOOL;
\tb : BOOL;
\tout : BOOL;
END_VAR

%LANGUAGE LD
%NETWORK
out := AND(EN := go, a, b).ENO;

END_FUNCTION_BLOCK
`, `${doc}#outputs`),
  ng("ng_en_eno_named_wire", "FB_NG_enwire", "an enabled operator box whose ENO is a wire, its value wired nowhere (X3: it stores, and the build refuses it)",
    `FUNCTION_BLOCK FB_NG_enwire
VAR
\tgo : BOOL;
\tb : BOOL;
\tc : BOOL;
\tout : BOOL;
\tout3 : BOOL;
END_VAR

%LANGUAGE FBD
%NETWORK
VAR w1 : ANY; END_VAR
w1 := OR(EN := go, b, c).ENO;
out := w1;
out3 := w1;

END_FUNCTION_BLOCK
`, `${doc}#outputs`),
  ng("ng_execute_box", "FB_NG_execute", "an EXECUTE box — raw ST inside a graphical body, with its own nested END_IF",
    `FUNCTION_BLOCK FB_NG_execute
VAR
\tbRun : BOOL;
\tbStart : BOOL;
\ttarget : INT;
END_VAR

%LANGUAGE FBD
%NETWORK
EXECUTE(EN := bRun, 'IF bStart THEN
	target := 40 + 2;
END_IF');

END_FUNCTION_BLOCK
`, `${doc}#execute`,
    "The box's ST is its CODE string, its line breaks as they stand, so the ST's own `END_IF` is code in it. The LSP reads the string's content as the ST it is."),
  // ─── control flow (§6) ─────────────────────────────────────────────────────
  ng("ng_label_jmp_resolved", "FB_NG_jump", "a label that DOES resolve, and the jump that reaches it",
    `FUNCTION_BLOCK FB_NG_jump
VAR
\tout : BOOL;
\tafter : BOOL;
END_VAR

%LANGUAGE LD
%NETWORK
out := TRUE;
JMP.Onwards := RAIL();
%NETWORK
Onwards:
after := TRUE;

END_FUNCTION_BLOCK
`, `${doc}#elements`,
    "Only the MISSING-label error was covered (`cc_vg_undefined_label`). A jump exists to leave the current network, so the label is the DESTINATION network's first line — resolving per network flagged every real jump."),
  ng("ng_conditional_jump_and_return", "FB_NG_cond", "a conditional JMP and a conditional RETURN, beside an unconditional one",
    `FUNCTION_BLOCK FB_NG_cond
VAR
\tcond : BOOL;
\tdone : BOOL;
\tlater : BOOL;
END_VAR

%LANGUAGE LD
%NETWORK
JMP.Tail := cond;
%NETWORK
RETURN := cond;
%NETWORK
Tail:
done := TRUE;
RETURN := RAIL();
%NETWORK
later := TRUE;

END_FUNCTION_BLOCK
`, `${doc}#elements`),
  // ─── network header fields (§6) ────────────────────────────────────────────
  ng("ng_network_title_and_comment", "FB_NG_header", "a network carrying a title and a leading comment",
    `FUNCTION_BLOCK FB_NG_header
VAR
\ta : BOOL;
\tb : BOOL;
\tout : BOOL;
END_VAR

%LANGUAGE FBD
%NETWORK "the interlock"
// both have to be true
out := AND(a, b);

END_FUNCTION_BLOCK
`, `${doc}#lines`),
  ng("ng_network_disabled", "FB_NG_disabled", "a DISABLED network, which the compiler does not generate code for",
    `FUNCTION_BLOCK FB_NG_disabled
VAR
\ta : BOOL;
\tout : BOOL;
\tlive : BOOL;
END_VAR

%LANGUAGE FBD
%NETWORK
%DISABLED
out := nothingDeclaredWithThisName;
%NETWORK
live := a;

END_FUNCTION_BLOCK
`, `${doc}#lines`,
    "The disabled network holds a DELIBERATE error, because a valid one would settle nothing: a disabled network is not compiled, so if CODESYS stays silent then anything the LSP says about its contents is a false positive — and if CODESYS reports it anyway, that is worth knowing too. Nothing has ever checked which."),
  // ─── an error path the graphical fixtures did not cover ────────────────────
  ng("ng_sink_type_mismatch", "FB_NG_badsink", "a BOOL box driven into an INT coil — the network type-check against a real build",
    `FUNCTION_BLOCK FB_NG_badsink
VAR
\ta : BOOL;
\tb : BOOL;
\tcount : INT;
END_VAR

%LANGUAGE FBD
%NETWORK
count := AND(a, b);

END_FUNCTION_BLOCK
`, `${doc}#subset`,
    "Every graphical ERROR fixture so far was about a missing NAME or an unnamed slot. None put a TYPE error in a network, so the shared assignment rules the network checks reuse have never been confirmed to say the same thing there as in ST."),
]
