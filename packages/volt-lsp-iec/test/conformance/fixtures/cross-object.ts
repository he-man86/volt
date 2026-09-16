/**
 * Cross-object combinations — features that are each already implemented, met TOGETHER and split across the objects a
 * real project keeps them in (user request 2026-09-16: "multifile codesnippets instead of all single file").
 *
 * Every other catalog file pins ONE construct in ONE object. Real code is not shaped like that, and neither the LSP nor
 * the transpiler is exercised by it: a global reached through VAR_EXTERNAL from two different FBs, a three-deep EXTENDS
 * chain whose every level overrides and calls SUPER^, an interface implemented in two objects and dispatched from an
 * array, a DUT of DUTs written through a FUNCTION's VAR_IN_OUT — each is only interesting where the pieces are separate
 * objects that must resolve against each other. Recorded like every other fixture: built and RUN in CODESYS SP21, then
 * replayed by the LSP and by both transpiler backends.
 */
import type { LanguageTest } from "../types.js"

const doc = "conformance — cross-object combinations"

function fb(name: string, pouName: string, feature: string, source: string, plcPrgVar: string, plcPrgBody: string, cycles?: number): LanguageTest {
  return { name, pouName, kind: "function_block", feature, fromDoc: doc, source, plcPrgVar, plcPrgBody, ...(cycles === undefined ? {} : { cycles }) }
}

export const CROSS_OBJECT_TESTS: readonly LanguageTest[] = [
  // ─── a global reached from two objects ──────────────────────────────────────
  {
    name: "xo_tally_struct",
    pouName: "DUT_XO_tally",
    kind: "dut",
    feature: "the struct the shared GVL holds",
    fromDoc: doc,
    source: `TYPE DUT_XO_tally :
STRUCT
	count : INT;
	last : INT;
END_STRUCT
END_TYPE
`,
  },
  {
    name: "xo_gvl_shared_struct",
    pouName: "GVL_XO_shared",
    kind: "gvl",
    feature: "a GVL holding a struct declared in another object, and a constant beside it",
    fromDoc: doc,
    source: `VAR_GLOBAL
	gTally : DUT_XO_tally;
	gStep : INT := 5;
END_VAR
`,
    plcPrgVar: "seen : INT;",
    plcPrgBody: "seen := GVL_XO_shared.gStep;",
  },
  fb("xo_two_fbs_one_global", "FB_XO_writer", "one FB writes a GVL struct through VAR_EXTERNAL and another reads it in the same scan",
    `FUNCTION_BLOCK FB_XO_writer
VAR_EXTERNAL
	gTally : DUT_XO_tally;
	gStep : INT;
END_VAR
gTally.count := gTally.count + gStep;
gTally.last := gStep;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_XO_reader
VAR_EXTERNAL
	gTally : DUT_XO_tally;
END_VAR
VAR_OUTPUT
	seenCount : INT;
	seenLast : INT;
END_VAR
seenCount := gTally.count;
seenLast := gTally.last;
END_FUNCTION_BLOCK
`,
    "writer : FB_XO_writer; reader : FB_XO_reader;", "writer();\nreader();", 3),

  // ─── inheritance three deep, every level overriding and chaining ────────────
  fb("xo_three_level_super_chain", "FB_XO_top", "a three-deep EXTENDS chain whose every level overrides one METHOD and calls SUPER^ into the one above",
    `FUNCTION_BLOCK FB_XO_base
VAR
	trace : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD Step : INT
trace := trace * 10 + 1;
Step := 1;
END_METHOD

FUNCTION_BLOCK FB_XO_mid EXTENDS FB_XO_base
END_FUNCTION_BLOCK

METHOD Step : INT
Step := SUPER^.Step() * 10 + 2;
trace := trace * 10 + 2;
END_METHOD

FUNCTION_BLOCK FB_XO_top EXTENDS FB_XO_mid
VAR
	result : INT;
END_VAR
result := Step();
END_FUNCTION_BLOCK

METHOD Step : INT
Step := SUPER^.Step() * 10 + 3;
trace := trace * 10 + 3;
END_METHOD
`,
    "inst : FB_XO_top;", "inst();", 2),

  // ─── an interface implemented in two objects, dispatched from an array ──────
  fb("xo_interface_array_dispatch", "FB_XO_adder", "an interface implemented by two FBs, held in an ARRAY of that interface and called in a FOR loop",
    `INTERFACE ITF_XO_op
METHOD Apply : INT
VAR_INPUT
	value : INT;
END_VAR
END_METHOD
END_INTERFACE

FUNCTION_BLOCK FB_XO_adder IMPLEMENTS ITF_XO_op
VAR
	calls : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD Apply : INT
VAR_INPUT
	value : INT;
END_VAR
calls := calls + 1;
Apply := value + 10;
END_METHOD

FUNCTION_BLOCK FB_XO_doubler IMPLEMENTS ITF_XO_op
VAR
	calls : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD Apply : INT
VAR_INPUT
	value : INT;
END_VAR
calls := calls + 1;
Apply := value * 2;
END_METHOD
`,
    "adder : FB_XO_adder; doubler : FB_XO_doubler; ops : ARRAY[1..2] OF ITF_XO_op; i : INT; total : INT;",
    "ops[1] := adder;\nops[2] := doubler;\ntotal := 1;\nFOR i := 1 TO 2 DO\n\ttotal := ops[i].Apply(value := total);\nEND_FOR",
    2),

  // ─── a DUT of DUTs written through a FUNCTION's VAR_IN_OUT ──────────────────
  fb("xo_function_inout_nested_struct", "FB_XO_filler", "a FUNCTION in its own object writing a nested DUT through VAR_IN_OUT, called from an FB's METHOD in a loop",
    `TYPE DUT_XO_point :
STRUCT
	x : INT;
	y : INT;
END_STRUCT
END_TYPE

TYPE DUT_XO_path :
STRUCT
	points : ARRAY[1..3] OF DUT_XO_point;
	used : INT;
END_STRUCT
END_TYPE

FUNCTION F_XO_push : BOOL
VAR_IN_OUT
	path : DUT_XO_path;
END_VAR
VAR_INPUT
	px : INT;
	py : INT;
END_VAR
IF path.used < 3 THEN
	path.used := path.used + 1;
	path.points[path.used].x := px;
	path.points[path.used].y := py;
	F_XO_push := TRUE;
ELSE
	F_XO_push := FALSE;
END_IF
END_FUNCTION

FUNCTION_BLOCK FB_XO_filler
VAR
	route : DUT_XO_path;
	accepted : INT;
	rejected : INT;
END_VAR
Fill();
END_FUNCTION_BLOCK

METHOD Fill
VAR
	k : INT;
END_VAR
FOR k := 1 TO 4 DO
	IF F_XO_push(path := route, px := k, py := k * 2) THEN
		accepted := accepted + 1;
	ELSE
		rejected := rejected + 1;
	END_IF
END_FOR
END_METHOD
`,
    "inst : FB_XO_filler;", "inst();"),

  // ─── VAR_STAT shared by instances held in two different objects ─────────────
  fb("xo_var_stat_two_holders", "FB_XO_holderA", "an FB's VAR_STAT counter shared by instances declared in two DIFFERENT holder FBs",
    `FUNCTION_BLOCK FB_XO_counted
VAR_STAT
	everyInstance : INT;
END_VAR
VAR
	mine : INT;
END_VAR
everyInstance := everyInstance + 1;
mine := mine + 1;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_XO_holderA
VAR
	one : FB_XO_counted;
END_VAR
one();
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_XO_holderB
VAR
	two : FB_XO_counted;
	three : FB_XO_counted;
END_VAR
two();
three();
END_FUNCTION_BLOCK
`,
    "a : FB_XO_holderA; b : FB_XO_holderB;", "a();\nb();", 2),

  // ─── a REFERENCE TO an FB instance, called through it ───────────────────────
  fb("xo_reference_to_fb_call", "FB_XO_refUser", "a REFERENCE TO an FB declared in another object, bound with REF= and both called and its METHOD run through",
    `FUNCTION_BLOCK FB_XO_engine
VAR_INPUT
	throttle : INT;
END_VAR
VAR
	revs : INT;
END_VAR
revs := revs + throttle;
END_FUNCTION_BLOCK

METHOD Boost : INT
revs := revs + 100;
Boost := revs;
END_METHOD

FUNCTION_BLOCK FB_XO_refUser
VAR
	left : FB_XO_engine;
	right : FB_XO_engine;
	chosen : REFERENCE TO FB_XO_engine;
	boosted : INT;
	valid : BOOL;
END_VAR
chosen REF= right;
valid := __ISVALIDREF(chosen);
chosen(throttle := 7);
boosted := chosen.Boost();
END_FUNCTION_BLOCK
`,
    "inst : FB_XO_refUser;", "inst();", 2),

  // ─── a UNION in its own DUT, written and read from another object ───────────
  fb("xo_union_across_objects", "FB_XO_unionUser", "a UNION declared in its own DUT, one member written and the others read from another object",
    `TYPE DUT_XO_word :
UNION
	whole : WORD;
	halves : ARRAY[0..1] OF BYTE;
END_UNION
END_TYPE

FUNCTION_BLOCK FB_XO_unionUser
VAR
	u : DUT_XO_word;
	low : BYTE;
	high : BYTE;
	back : WORD;
END_VAR
u.whole := 16#ABCD;
low := u.halves[0];
high := u.halves[1];
u.halves[0] := 16#11;
back := u.whole;
END_FUNCTION_BLOCK
`,
    "inst : FB_XO_unionUser;", "inst();"),

  // ─── a qualified_only enum in its own DUT, CASEd in another object ──────────
  {
    name: "xo_mode_enum",
    pouName: "DUT_XO_mode",
    kind: "dut",
    feature: "a qualified_only enum with explicit values and a BYTE base, in its own object",
    fromDoc: doc,
    source: `{attribute 'qualified_only'}
TYPE DUT_XO_mode :
(
	Idle := 0,
	Warming := 7,
	Running := 9
) BYTE;
END_TYPE
`,
  },
  fb("xo_enum_case_across_objects", "FB_XO_stepper", "a qualified_only enum from another object as a CASE selector, its labels and an assignment",
    `FUNCTION_BLOCK FB_XO_stepper
VAR
	mode : DUT_XO_mode;
	ticks : INT;
	raw : BYTE;
END_VAR
CASE mode OF
	DUT_XO_mode.Idle:
		mode := DUT_XO_mode.Warming;
		ticks := ticks + 1;
	DUT_XO_mode.Warming:
		mode := DUT_XO_mode.Running;
		ticks := ticks + 10;
	DUT_XO_mode.Running:
		ticks := ticks + 100;
END_CASE
raw := TO_BYTE(mode);
END_FUNCTION_BLOCK
`,
    "inst : FB_XO_stepper;", "inst();", 3),

  // ─── an ACTION inherited and called bare from a derived body ────────────────
  fb("xo_inherited_action_from_derived", "FB_XO_actionDerived", "an ACTION declared on a base FB, called bare from the derived FB's body and from the derived FB's own METHOD",
    `FUNCTION_BLOCK FB_XO_actionBase
VAR
	ran : INT;
	stamp : INT;
END_VAR
END_FUNCTION_BLOCK

ACTION Mark
ran := ran + 1;
stamp := stamp * 10 + 1;
END_ACTION

FUNCTION_BLOCK FB_XO_actionDerived EXTENDS FB_XO_actionBase
VAR
	fromBody : INT;
END_VAR
Mark();
fromBody := ran;
Twice();
END_FUNCTION_BLOCK

METHOD Twice
Mark();
Mark();
END_METHOD
`,
    "inst : FB_XO_actionDerived;", "inst();", 2),

  // ─── an ARRAY[*] handed on through a METHOD to a FUNCTION ───────────────────
  fb("xo_open_array_through_method", "FB_XO_shifter", "an ARRAY[*] VAR_IN_OUT handed from a PROGRAM to an FB METHOD and on to a FUNCTION in another object",
    `FUNCTION F_XO_sum : DINT
VAR_IN_OUT
	values : ARRAY[*] OF INT;
END_VAR
VAR
	k : DINT;
END_VAR
F_XO_sum := 0;
FOR k := LOWER_BOUND(values, 1) TO UPPER_BOUND(values, 1) DO
	F_XO_sum := F_XO_sum + values[k];
END_FOR
END_FUNCTION

FUNCTION_BLOCK FB_XO_shifter
END_FUNCTION_BLOCK

METHOD Total : DINT
VAR_IN_OUT
	values : ARRAY[*] OF INT;
END_VAR
Total := F_XO_sum(values := values) + UPPER_BOUND(values, 1);
END_METHOD
`,
    "inst : FB_XO_shifter; numbers : ARRAY[2..5] OF INT := [10, 20, 30, 40]; total : DINT;",
    "total := inst.Total(values := numbers);"),

  // ─── a STRING built across objects ──────────────────────────────────────────
  fb("xo_string_built_across_objects", "FB_XO_labeller", "a STRING built by a FUNCTION in its own object from a struct field, then measured by its caller",
    `TYPE DUT_XO_name :
STRUCT
	first : STRING(8);
	last : STRING(8);
END_STRUCT
END_TYPE

FUNCTION F_XO_join : STRING(20)
VAR_IN_OUT
	who : DUT_XO_name;
END_VAR
F_XO_join := CONCAT(CONCAT(who.first, ' '), who.last);
END_FUNCTION

FUNCTION_BLOCK FB_XO_labeller
VAR
	person : DUT_XO_name := (first := 'Ada', last := 'Lovelace');
	label : STRING(20);
	width : INT;
	initial : STRING(1);
END_VAR
label := F_XO_join(who := person);
width := LEN(label);
initial := LEFT(label, 1);
END_FUNCTION_BLOCK
`,
    "inst : FB_XO_labeller;", "inst();"),
]
