/**
 * Routine state and call edges — the oracle for the corpus work list after inheritance (tasks.md phase 3½), recorded
 * BEFORE it is built. `variable-section.ts` already holds one call of a METHOD with VAR_INST and one with VAR_STAT, which
 * cannot tell per-call from per-instance from shared; these call twice, on two instances. Also: an argument written but
 * left empty (`a := ,`, how the corpus leaves an input unconnected), and a PROGRAM called from inside an FB's body.
 */
import type { LanguageTest } from "../../types.js"

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
  // `var_output_on_function` writes 0 to its output, which a store never made cannot be told from. These carry values:
  // a FUNCTION's and a METHOD's VAR_OUTPUT read through `=>`, an output not connected, and whether an output starts
  // over on every call (a FUNCTION's) or keeps its value.
  {
    name: "state_routine_outputs",
    pouName: "F_STATE_split",
    kind: "function",
    feature: "VAR_OUTPUT of a FUNCTION and of a METHOD — read through `=>`, left unconnected, and across calls",
    fromDoc: doc,
    source: `FUNCTION F_STATE_split : INT
VAR_INPUT
	value : INT;
END_VAR
VAR_OUTPUT
	tens : INT;
	calls : INT;
END_VAR
calls := calls + 1;
tens := value / 10;
F_STATE_split := value MOD 10;
END_FUNCTION

FUNCTION_BLOCK FB_STATE_outs
VAR
	stored : INT := 5;
END_VAR
END_FUNCTION_BLOCK

METHOD Take : INT
VAR_INPUT
	amount : INT;
END_VAR
VAR_OUTPUT
	before : INT;
	kept : INT;
END_VAR
kept := kept + 1;
before := stored;
stored := stored + amount;
Take := stored;
END_METHOD
`,
    plcPrgVar: "inst : FB_STATE_outs; units : INT; tens : INT; calls1 : INT; calls2 : INT; units2 : INT; took : INT; before : INT; kept1 : INT; kept2 : INT;",
    plcPrgBody:
      "units := F_STATE_split(value := 47, tens => tens, calls => calls1); units2 := F_STATE_split(value := 3, calls => calls2); F_STATE_split(value := 9); took := inst.Take(amount := 2, before => before, kept => kept1); inst.Take(amount := 1, kept => kept2);",
    cycles: 2,
  },
  // `type_any_function_input` read `diSize` of one INT (2). Is `diSize` the argument's SIZEOF for every type — a REAL, a
  // STRING(10), a BOOL, a struct — and does an ANY_NUM input carry the same?
  {
    name: "state_any_input_sizes",
    pouName: "F_STATE_anySize",
    kind: "function",
    feature: "an ANY / ANY_NUM input's diSize, across argument types",
    fromDoc: doc,
    source: `FUNCTION F_STATE_anySize : DINT
VAR_INPUT
	anyArg : ANY;
END_VAR
F_STATE_anySize := anyArg.diSize;
END_FUNCTION

FUNCTION F_STATE_anyNumSize : DINT
VAR_INPUT
	anyNum : ANY_NUM;
END_VAR
F_STATE_anyNumSize := anyNum.diSize;
END_FUNCTION

TYPE DUT_STATE_pair :
STRUCT
	a : BYTE;
	b : DINT;
END_STRUCT
END_TYPE
`,
    plcPrgVar:
      "intArg : INT; lrealArg : LREAL; str10 : STRING(10); boolArg : BOOL; pairArg : DUT_STATE_pair; sizeInt : DINT; sizeLreal : DINT; sizeString : DINT; sizeBool : DINT; sizePair : DINT; numLreal : DINT; numInt : DINT;",
    plcPrgBody:
      "sizeInt := F_STATE_anySize(intArg); sizeLreal := F_STATE_anySize(lrealArg); sizeString := F_STATE_anySize(str10); sizeBool := F_STATE_anySize(boolArg); sizePair := F_STATE_anySize(pairArg); numLreal := F_STATE_anyNumSize(lrealArg); numInt := F_STATE_anyNumSize(intArg);",
  },
  // pro2193's `Increment.AnyInt` without its library: an ANY_INT input's `pValue` stored into a union of pointers, and the
  // caller's variable incremented through the one its `diSize` picks — does it change the caller's variable (6, 7, 8, 9)?
  {
    name: "state_any_int_pointer_increment",
    pouName: "F_STATE_incAnyInt",
    kind: "function",
    feature: "an ANY_INT input's pValue taken into a union of pointers and the caller's variable written through it by diSize",
    fromDoc: doc,
    source: `FUNCTION F_STATE_incAnyInt : BOOL
VAR_INPUT
	input : ANY_INT;
	incrementBy : INT := 1;
END_VAR
VAR
	u : DUT_STATE_ptrSizes;
END_VAR
u.p1_Byte := input.pValue;
CASE input.diSize OF
	1: u.p1_Sint^ := u.p1_Sint^ + TO_SINT(incrementBy);
	2: u.p2_Int^ := u.p2_Int^ + incrementBy;
	4: u.p4_Dint^ := u.p4_Dint^ + incrementBy;
	8: u.p8_Lint^ := u.p8_Lint^ + incrementBy;
END_CASE
F_STATE_incAnyInt := TRUE;
END_FUNCTION

TYPE DUT_STATE_ptrSizes :
UNION
	p1_Byte : POINTER TO BYTE;
	p1_Sint : POINTER TO SINT;
	p2_Int : POINTER TO INT;
	p4_Dint : POINTER TO DINT;
	p8_Lint : POINTER TO LINT;
END_UNION
END_TYPE
`,
    plcPrgVar: "siArg : SINT := 1; iArg : INT := 2; dArg : DINT := 3; lArg : LINT := 4; done : BOOL;",
    plcPrgBody: "done := F_STATE_incAnyInt(siArg, 5);\ndone := F_STATE_incAnyInt(iArg, 5);\ndone := F_STATE_incAnyInt(dArg, 5);\ndone := F_STATE_incAnyInt(lArg, 5);",
  },
  // `call_after_global_init_slot` set `iCount := 1`, which cannot tell "once before the first scan" from "every scan"; this
  // counts, over three scans, on two instances.
  fb("state_call_after_global_init_counts", "FB_STATE_init", "{attribute 'call_after_global_init_slot'} — how often the method runs, and on each instance",
    `FUNCTION_BLOCK FB_STATE_init
VAR
	inits : INT;
	scans : INT;
END_VAR
scans := scans + 1;
END_FUNCTION_BLOCK

{attribute 'call_after_global_init_slot' := '50000'}
METHOD AfterGlobalInit
inits := inits + 1;
END_METHOD
`,
    "one : FB_STATE_init; two : FB_STATE_init;", "one(); two();", 3),
]
