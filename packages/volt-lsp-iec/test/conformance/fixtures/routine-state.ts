/**
 * Routine state and call edges — the oracle for the corpus work list after inheritance (tasks.md phase 3½), recorded
 * BEFORE it is built. `variable-section.ts` already holds one call of a METHOD with VAR_INST and one with VAR_STAT, which
 * cannot tell per-call from per-instance from shared; these call twice, on two instances. Also: an argument written but
 * left empty (`a := ,`, how the corpus leaves an input unconnected), and a PROGRAM called from inside an FB's body.
 */
import type { LanguageTest } from "../types.js"

const doc = "transpile-st-to-rust phase 3½ — routine state"

function fb(name: string, pouName: string, feature: string, source: string, plcPrgVar: string, plcPrgBody: string, cycles?: number): LanguageTest {
  return { name, pouName, kind: "function_block", feature, fromDoc: doc, source, plcPrgVar, plcPrgBody, ...(cycles === undefined ? {} : { cycles }) }
}

export const ROUTINE_STATE_TESTS: readonly LanguageTest[] = [
  fb("state_var_inst_two_instances", "FB_STATE_inst", "a METHOD's VAR_INST across two calls and two instances — kept per instance, reset per call, or shared",
    `FUNCTION_BLOCK FB_STATE_inst
VAR
	lastSeen : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD Tick : INT
VAR_INST
	ticks : INT := 10;
END_VAR
ticks := ticks + 1;
lastSeen := ticks;
Tick := ticks;
END_METHOD
`,
    "one : FB_STATE_inst; two : FB_STATE_inst; first : INT; second : INT; other : INT;",
    "first := one.Tick(); second := one.Tick(); other := two.Tick();", 2),
  fb("state_var_stat_two_instances", "FB_STATE_stat", "a METHOD's VAR_STAT across two calls and two instances — shared by every instance, or kept per instance",
    `FUNCTION_BLOCK FB_STATE_stat
VAR
	lastSeen : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD Tick : INT
VAR_STAT
	ticks : INT := 10;
END_VAR
ticks := ticks + 1;
lastSeen := ticks;
Tick := ticks;
END_METHOD
`,
    "one : FB_STATE_stat; two : FB_STATE_stat; first : INT; second : INT; other : INT;",
    "first := one.Tick(); second := one.Tick(); other := two.Tick();", 2),
  fb("state_empty_argument", "FB_STATE_empty", "an argument written but left empty (`a := ,`) — the input keeps its value, or is reset",
    `FUNCTION_BLOCK FB_STATE_empty
VAR_INPUT
	a : INT := 7;
	b : INT;
END_VAR
VAR_OUTPUT
	sum : INT;
END_VAR
sum := a + b;
END_FUNCTION_BLOCK
`,
    "inst : FB_STATE_empty; k : INT; got : INT;", "k := k + 1; IF k = 1 THEN inst(a := 100, b := 1); ELSE inst(a := , b := 2, sum => got); END_IF", 2),
  {
    name: "state_program_called_from_fb",
    pouName: "FB_STATE_caller",
    kind: "function_block",
    feature: "a PROGRAM called from inside an FB's body — its one instance, shared with a call from PLC_PRG",
    fromDoc: doc,
    source: `PROGRAM PRG_STATE_counted
VAR
	runs : INT;
END_VAR
runs := runs + 1;
END_PROGRAM

FUNCTION_BLOCK FB_STATE_caller
VAR_OUTPUT
	seen : INT;
END_VAR
PRG_STATE_counted();
seen := PRG_STATE_counted.runs;
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_STATE_caller; direct : INT;",
    plcPrgBody: "inst(); PRG_STATE_counted(); direct := PRG_STATE_counted.runs;",
    cycles: 2,
  },
  // `use_fb_property_read`/`_write` read and write once; these are what a PROPERTY turns on in the corpus: a getter's
  // own VAR (per call or kept), how often a getter runs when read twice, the name used bare inside the FB's body, and
  // `THIS^.Prop` read and written from a method.
  fb("state_property_get_set", "FB_STATE_prop", "a PROPERTY: getter VAR and run count, a bare read in the body, THIS^.Prop from a method",
    `FUNCTION_BLOCK FB_STATE_prop
VAR
	stored : INT;
	gets : INT;
	inside : INT;
END_VAR
inside := Level;
END_FUNCTION_BLOCK

METHOD Bump
THIS^.Level := THIS^.Level + 5;
END_METHOD

PROPERTY Level : INT
GET
VAR
	scratch : INT;
END_VAR
scratch := scratch + 1;
gets := gets + scratch;
Level := stored * 2;
END_GET
SET
stored := Level + 1;
END_SET
END_PROPERTY
`,
    "inst : FB_STATE_prop; twice : INT;", "inst.Level := 3; inst(); inst.Bump(); twice := inst.Level + inst.Level;"),
]
