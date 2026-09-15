/**
 * Calls — the oracle for transpile-st-to-rust phase 3 steps 3–5, recorded BEFORE they are built. The conformance
 * fixtures already call FB instances everywhere; these isolate the edges a call's semantics turn on, one question each:
 * inputs kept between calls, outputs read after a call, state across calls and scans, a nested and a second instance,
 * VAR_IN_OUT written back, an output widened on its way out, whether a METHOD's or FUNCTION's locals start over per
 * call, an ACTION, and a PROGRAM writing a global another program reads. Variable names avoid the reserved IL operators
 * (`r`, `s`, `ld`, `st`, …).
 */
import type { LanguageTest } from "../types.js"

const doc = "transpile-st-to-rust phase 3"

function fb(name: string, pouName: string, feature: string, source: string, plcPrgVar: string, plcPrgBody: string, cycles?: number): LanguageTest {
  return { name, pouName, kind: "function_block", feature, fromDoc: doc, source, plcPrgVar, plcPrgBody, ...(cycles === undefined ? {} : { cycles }) }
}

const ADDER = `FUNCTION_BLOCK FB_CALL_adder
VAR_INPUT
	a : INT;
	b : INT;
END_VAR
VAR_OUTPUT
	sum : INT;
END_VAR
sum := a + b;
END_FUNCTION_BLOCK
`

const COUNTER = `FUNCTION_BLOCK FB_CALL_counter
VAR
	count : INT;
END_VAR
VAR_OUTPUT
	q : INT;
END_VAR
count := count + 1;
q := count;
END_FUNCTION_BLOCK
`

export const FB_CALL_TESTS: readonly LanguageTest[] = [
  fb("fbcall_inputs_outputs", "FB_CALL_adder", "inputs assigned, body run, output read through `=>`", ADDER,
    "inst : FB_CALL_adder; got : INT;", "inst(a := 2, b := 3, sum => got);"),
  fb("fbcall_output_widens", "FB_CALL_adder_w", "an INT output read through `=>` into a DINT",
    ADDER.replaceAll("FB_CALL_adder", "FB_CALL_adder_w"),
    "inst : FB_CALL_adder_w; wide : DINT;", "inst(a := 30000, b := 1, sum => wide);"),
  fb("fbcall_input_retained", "FB_CALL_twice", "an input not given in a later call keeps its last value",
    `FUNCTION_BLOCK FB_CALL_twice
VAR_INPUT
	x : INT;
END_VAR
VAR_OUTPUT
	y : INT;
END_VAR
y := x * 2;
END_FUNCTION_BLOCK
`,
    "inst : FB_CALL_twice; first : INT; second : INT;", "inst(x := 5); first := inst.y; inst(); second := inst.y;"),
  fb("fbcall_output_before_and_after", "FB_CALL_step", "an output read before the call holds the previous call's value",
    `FUNCTION_BLOCK FB_CALL_step
VAR_INPUT
	x : INT;
END_VAR
VAR_OUTPUT
	y : INT;
END_VAR
y := x + 100;
END_FUNCTION_BLOCK
`,
    "inst : FB_CALL_step; k : INT; before : INT; after : INT;", "k := k + 1; before := inst.y; inst(x := k); after := inst.y;", 3),
  fb("fbcall_state_across_calls", "FB_CALL_counter", "an FB's VAR keeps its value across calls and scans", COUNTER,
    "inst : FB_CALL_counter; got : INT;", "inst(); inst(); got := inst.q;", 3),
  fb("fbcall_two_instances", "FB_CALL_counter2", "two instances of one FB keep separate state",
    COUNTER.replaceAll("FB_CALL_counter", "FB_CALL_counter2"),
    "one : FB_CALL_counter2; two : FB_CALL_counter2;", "one(); two(); two();", 2),
  fb("fbcall_nested_instance", "FB_CALL_outer", "an instance declared inside an FB, called from its body",
    `${COUNTER.replaceAll("FB_CALL_counter", "FB_CALL_inner")}
FUNCTION_BLOCK FB_CALL_outer
VAR
	inner : FB_CALL_inner;
END_VAR
VAR_OUTPUT
	total : INT;
END_VAR
inner();
total := inner.q * 10;
END_FUNCTION_BLOCK
`,
    "outer1 : FB_CALL_outer;", "outer1();", 2),
  fb("fbcall_inout_written_back", "FB_CALL_inout", "a VAR_IN_OUT written in the body changes the caller's variable",
    `FUNCTION_BLOCK FB_CALL_inout
VAR_IN_OUT
	v : INT;
END_VAR
v := v + 10;
END_FUNCTION_BLOCK
`,
    "inst : FB_CALL_inout; n : INT := 1;", "inst(v := n);", 2),
  fb("fbcall_method_locals", "FB_CALL_meth", "a METHOD's VAR starts over on every call; its return value and input",
    `FUNCTION_BLOCK FB_CALL_meth
VAR
	calls : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD Tick : INT
VAR_INPUT
	amount : INT;
END_VAR
VAR
	localCount : INT;
END_VAR
localCount := localCount + amount;
calls := calls + 1;
Tick := localCount;
END_METHOD
`,
    "inst : FB_CALL_meth; first : INT; second : INT;", "first := inst.Tick(amount := 3); second := inst.Tick(amount := 3);"),
  fb("fbcall_action", "FB_CALL_act", "an ACTION runs on its FB's variables",
    `FUNCTION_BLOCK FB_CALL_act
VAR
	count : INT;
END_VAR
END_FUNCTION_BLOCK

ACTION Inc
count := count + 1;
END_ACTION
`,
    "inst : FB_CALL_act;", "inst.Inc(); inst.Inc();", 2),
  {
    name: "fbcall_function_locals",
    pouName: "F_CALL_acc",
    kind: "function",
    feature: "a FUNCTION's VAR starts over on every call",
    fromDoc: doc,
    source: `FUNCTION F_CALL_acc : INT
VAR_INPUT
	amount : INT;
END_VAR
VAR
	acc : INT;
END_VAR
acc := acc + amount;
F_CALL_acc := acc;
END_FUNCTION
`,
    plcPrgVar: "first : INT; second : INT;",
    plcPrgBody: "first := F_CALL_acc(amount := 4); second := F_CALL_acc(4);",
  },
  {
    name: "fbcall_program_writes_global",
    pouName: "GVL_CALL_shared",
    kind: "gvl",
    feature: "a PROGRAM called from PLC_PRG writes a global that PLC_PRG then reads; the program's own VAR persists",
    fromDoc: doc,
    source: `VAR_GLOBAL
	gCallShared : INT;
END_VAR

PROGRAM PRG_CALL_writer
VAR
	runs : INT;
END_VAR
runs := runs + 1;
gCallShared := runs * 7;
END_PROGRAM
`,
    plcPrgVar: "seen : INT;",
    plcPrgBody: "PRG_CALL_writer(); seen := gCallShared;",
    cycles: 2,
  },
  // Phase 3½ (2026-09-15): what the corpus's `call-this` and `gvl_block` blockers turn on, recorded before either is built.
  fb("fbcall_bare_method_call", "FB_CALL_bare", "a METHOD and an ACTION called bare — from the FB's body and from another method",
    `FUNCTION_BLOCK FB_CALL_bare
VAR
	calls : INT;
	deep : INT;
	tidied : INT;
END_VAR
Bump();
Bump();
Tidy();
END_FUNCTION_BLOCK

METHOD Bump
calls := calls + 1;
Deeper();
END_METHOD

METHOD Deeper
deep := deep + 10;
END_METHOD

ACTION Tidy
tidied := tidied + 100;
END_ACTION
`,
    "inst : FB_CALL_bare;", "inst();", 2),
  {
    name: "fbcall_gvl_qualified",
    pouName: "GVL_CALL_qualified",
    kind: "gvl",
    feature: "a `qualified_only` global read and written through its list's name",
    fromDoc: doc,
    source: `{attribute 'qualified_only'}
VAR_GLOBAL
	gQualified : INT := 1;
END_VAR
`,
    plcPrgVar: "seen : INT;",
    plcPrgBody: "GVL_CALL_qualified.gQualified := GVL_CALL_qualified.gQualified + 5; seen := GVL_CALL_qualified.gQualified;",
    cycles: 2,
  },
]
