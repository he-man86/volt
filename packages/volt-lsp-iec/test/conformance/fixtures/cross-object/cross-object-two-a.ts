/**
 * the fixtures of `cross-object-two.ts` — part A: a PROPERTY overridden down an EXTENDS chain, reached both ways; an ARRAY of FB instances, called in a loop; an FB instance held inside a STRUCT, called through the field; an interface extending another, implemented in a third object; a FUNCTION returning a STRUCT declared in another object; an FB instance bound as a VAR_IN_OUT across objects; a METHOD's VAR_OUTPUT bound across objects; a two-dimensional array of structs written across objects; durations built in one object and compared in another; an ACTION on a derived FB beside an inherited one of another name; a CASE with ranges and a comma list over an enum from another object.
 *
 * One slice of `cross-object-two.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"
import { doc, fb } from "./cross-object-two-shared.js"

export const CROSS_OBJECT_TWO_TESTS_A: readonly LanguageTest[] = [
// ─── a PROPERTY overridden down an EXTENDS chain, reached both ways ─────────
  fb("xo2_property_override_chain", "FB_X2_derived", "a PROPERTY declared on a base FB and overridden in the derived one, read and written through the instance and through SUPER^",
    `FUNCTION_BLOCK FB_X2_base
VAR
	stored : INT := 1;
	getRuns : INT;
	setRuns : INT;
END_VAR
END_FUNCTION_BLOCK

PROPERTY Level : INT
GET
getRuns := getRuns + 1;
Level := stored;
END_GET
SET
setRuns := setRuns + 1;
stored := Level;
END_SET
END_PROPERTY

FUNCTION_BLOCK FB_X2_derived EXTENDS FB_X2_base
VAR
	seen : INT;
	viaSuper : INT;
END_VAR
Level := 40;
seen := Level;
viaSuper := SUPER^.Level;
END_FUNCTION_BLOCK

PROPERTY Level : INT
GET
getRuns := getRuns + 1;
Level := stored * 2;
END_GET
SET
setRuns := setRuns + 1;
stored := Level + 1;
END_SET
END_PROPERTY
`,
    "inst : FB_X2_derived; outside : INT;", "inst();\noutside := inst.Level;"),
  // ─── an ARRAY of FB instances, called in a loop ─────────────────────────────
  fb("xo2_array_of_instances", "FB_X2_bank", "an ARRAY of FB instances declared in another object, each called in a FOR loop with its index",
    `FUNCTION_BLOCK FB_X2_cell
VAR_INPUT
	amount : INT;
END_VAR
VAR_OUTPUT
	total : INT;
END_VAR
VAR
	runs : INT;
END_VAR
runs := runs + 1;
total := total + amount;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_X2_bank
VAR
	cells : ARRAY[1..3] OF FB_X2_cell;
	k : INT;
	sum : INT;
END_VAR
sum := 0;
FOR k := 1 TO 3 DO
	cells[k](amount := k * 10);
	sum := sum + cells[k].total;
END_FOR
END_FUNCTION_BLOCK
`,
    "inst : FB_X2_bank;", "inst();", 2),
  // ─── an FB instance held inside a STRUCT, called through the field ──────────
  fb("xo2_instance_in_struct", "FB_X2_machine", "an FB instance held as a STRUCT field declared in another object, called and its METHOD run through the field",
    `FUNCTION_BLOCK FB_X2_motor
VAR_INPUT
	speed : INT;
END_VAR
VAR
	travelled : INT;
END_VAR
travelled := travelled + speed;
END_FUNCTION_BLOCK

METHOD Halt : INT
travelled := 0;
Halt := speed;
END_METHOD

TYPE DUT_X2_axis :
STRUCT
	drive : FB_X2_motor;
	name : STRING(6);
END_STRUCT
END_TYPE

FUNCTION_BLOCK FB_X2_machine
VAR
	x : DUT_X2_axis;
	lastSpeed : INT;
END_VAR
x.name := 'X';
x.drive(speed := 6);
IF x.drive.travelled > 10 THEN
	lastSpeed := x.drive.Halt();
END_IF
END_FUNCTION_BLOCK
`,
    "inst : FB_X2_machine;", "inst();", 3),
  // ─── an interface extending another, implemented in a third object ──────────
  fb("xo2_interface_extends", "FB_X2_pump", "an INTERFACE extending another, implemented by an FB in a third object and called through each interface in turn",
    `INTERFACE ITF_X2_runnable
METHOD Run : INT
END_METHOD
END_INTERFACE

INTERFACE ITF_X2_pumpable EXTENDS ITF_X2_runnable
METHOD Prime : INT
END_METHOD
END_INTERFACE

FUNCTION_BLOCK FB_X2_pump IMPLEMENTS ITF_X2_pumpable
VAR
	runs : INT;
	primes : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD Run : INT
runs := runs + 1;
Run := runs * 100;
END_METHOD

METHOD Prime : INT
primes := primes + 1;
Prime := primes;
END_METHOD
`,
    "pump : FB_X2_pump; asPump : ITF_X2_pumpable; asRunnable : ITF_X2_runnable; primed : INT; ran : INT; ranBase : INT;",
    "asPump := pump;\nprimed := asPump.Prime();\nran := asPump.Run();\nasRunnable := asPump;\nranBase := asRunnable.Run();",
    2),
  // ─── a FUNCTION returning a STRUCT declared in another object ───────────────
  fb("xo2_function_returns_struct", "FB_X2_reader", "a FUNCTION whose result is a STRUCT from another object, its fields read by the caller",
    `TYPE DUT_X2_reading :
STRUCT
	value : INT;
	valid : BOOL;
	tag : STRING(4);
END_STRUCT
END_TYPE

FUNCTION F_X2_measure : DUT_X2_reading
VAR_INPUT
	raw : INT;
END_VAR
F_X2_measure.value := raw * 3;
F_X2_measure.valid := raw > 0;
F_X2_measure.tag := 'ok';
END_FUNCTION

FUNCTION_BLOCK FB_X2_reader
VAR
	good : DUT_X2_reading;
	bad : DUT_X2_reading;
	sum : INT;
END_VAR
good := F_X2_measure(raw := 5);
bad := F_X2_measure(raw := 0);
sum := good.value + bad.value;
END_FUNCTION_BLOCK
`,
    "inst : FB_X2_reader;", "inst();"),
  // ─── an FB instance bound as a VAR_IN_OUT across objects ───────────────────
  fb("xo2_fb_instance_as_inout", "FB_X2_driver", "an FB INSTANCE bound to another object's VAR_IN_OUT, called and its METHOD run through the binding",
    `FUNCTION_BLOCK FB_X2_lamp
VAR
	brightness : INT;
END_VAR
brightness := brightness + 1;
END_FUNCTION_BLOCK

METHOD Dim : INT
brightness := brightness - 5;
Dim := brightness;
END_METHOD

FUNCTION_BLOCK FB_X2_operator
VAR_IN_OUT
	target : FB_X2_lamp;
END_VAR
VAR_OUTPUT
	dimmed : INT;
END_VAR
target();
target();
dimmed := target.Dim();
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_X2_driver
VAR
	lamp : FB_X2_lamp;
	crew : FB_X2_operator;
	reported : INT;
END_VAR
crew(target := lamp, dimmed => reported);
END_FUNCTION_BLOCK
`,
    "inst : FB_X2_driver;", "inst();", 2),
  // ─── a METHOD's VAR_OUTPUT bound across objects ─────────────────────────────
  fb("xo2_method_outputs_across_objects", "FB_X2_splitter", "a METHOD of one object bound with => to two variables of another, beside an ordinary result",
    `FUNCTION_BLOCK FB_X2_divider
END_FUNCTION_BLOCK

METHOD Split : INT
VAR_INPUT
	value : INT;
	divisor : INT;
END_VAR
VAR_OUTPUT
	quotient : INT;
	remainder : INT;
END_VAR
quotient := value / divisor;
remainder := value MOD divisor;
Split := quotient + remainder;
END_METHOD

FUNCTION_BLOCK FB_X2_splitter
VAR
	maths : FB_X2_divider;
	quot : INT;
	rem : INT;
	both : INT;
END_VAR
both := maths.Split(value := 17, divisor := 5, quotient => quot, remainder => rem);
END_FUNCTION_BLOCK
`,
    "inst : FB_X2_splitter;", "inst();"),
  // ─── a two-dimensional array of structs written across objects ─────────────
  fb("xo2_grid_of_structs", "FB_X2_grid", "a two-dimensional ARRAY of a STRUCT from another object, filled by a nested loop with EXIT and CONTINUE",
    `TYPE DUT_X2_cell :
STRUCT
	weight : INT;
	skipped : BOOL;
END_STRUCT
END_TYPE

FUNCTION_BLOCK FB_X2_grid
VAR
	cells : ARRAY[1..2, 1..3] OF DUT_X2_cell;
	row : INT;
	col : INT;
	filled : INT;
	skips : INT;
END_VAR
FOR row := 1 TO 2 DO
	FOR col := 1 TO 3 DO
		IF col = 2 THEN
			cells[row, col].skipped := TRUE;
			skips := skips + 1;
			CONTINUE;
		END_IF
		IF row = 2 AND col = 3 THEN
			EXIT;
		END_IF
		cells[row, col].weight := row * 10 + col;
		filled := filled + 1;
	END_FOR
END_FOR
END_FUNCTION_BLOCK
`,
    "inst : FB_X2_grid;", "inst();"),
  // ─── durations built in one object and compared in another ─────────────────
  fb("xo2_time_across_objects", "FB_X2_timer", "TIME arithmetic in a FUNCTION of its own object, its result compared and converted by the caller",
    `FUNCTION F_X2_span : TIME
VAR_INPUT
	ticks : INT;
END_VAR
F_X2_span := T#100MS * ticks;
END_FUNCTION

FUNCTION_BLOCK FB_X2_timer
VAR
	short : TIME;
	long : TIME;
	sum : TIME;
	longer : BOOL;
	asMs : DINT;
END_VAR
short := F_X2_span(ticks := 3);
long := F_X2_span(ticks := 25);
sum := short + long;
longer := long > short;
asMs := TIME_TO_DINT(sum);
END_FUNCTION_BLOCK
`,
    "inst : FB_X2_timer;", "inst();"),
  // ─── an ACTION on a derived FB beside an inherited one of another name ──────
  fb("xo2_actions_base_and_derived", "FB_X2_both", "an ACTION on the base and another on the derived FB, each called from the other's object",
    `FUNCTION_BLOCK FB_X2_actBase
VAR
	baseRuns : INT;
	derivedSeen : INT;
END_VAR
END_FUNCTION_BLOCK

ACTION BaseTick
baseRuns := baseRuns + 1;
END_ACTION

FUNCTION_BLOCK FB_X2_both EXTENDS FB_X2_actBase
VAR
	derivedRuns : INT;
END_VAR
DerivedTick();
derivedSeen := baseRuns;
END_FUNCTION_BLOCK

ACTION DerivedTick
BaseTick();
BaseTick();
derivedRuns := derivedRuns + 1;
END_ACTION
`,
    "inst : FB_X2_both; outside : INT;", "inst();\ninst.BaseTick();\noutside := inst.baseRuns;", 2),
  // ─── a CASE with ranges and a comma list over an enum from another object ───
  {
    name: "xo2_grade_enum",
    plcPrgVar: "x2Grade : DUT_X2_grade;",
    pouName: "DUT_X2_grade",
    kind: "dut",
    feature: "an enum with gaps in its values, in its own object",
    fromDoc: doc,
    source: `TYPE DUT_X2_grade :
(
	None := 0,
	Low := 3,
	Mid := 4,
	High := 9
) INT;
END_TYPE
`,
  },
  fb("xo2_case_ranges_over_enum", "FB_X2_grader", "a CASE with a range arm, a comma list and an ELSE over an enum declared in another object",
    `FUNCTION_BLOCK FB_X2_grader
VAR_INPUT
	score : INT;
END_VAR
VAR_OUTPUT
	grade : DUT_X2_grade;
	band : INT;
END_VAR
CASE score OF
	0:
		grade := DUT_X2_grade.None;
		band := 1;
	1..3:
		grade := DUT_X2_grade.Low;
		band := 2;
	4, 5, 6:
		grade := DUT_X2_grade.Mid;
		band := 3;
ELSE
	grade := DUT_X2_grade.High;
	band := 4;
END_CASE
END_FUNCTION_BLOCK
`,
    "inst : FB_X2_grader; g0 : DUT_X2_grade; b0 : INT; g2 : DUT_X2_grade; b2 : INT; g5 : DUT_X2_grade; b5 : INT; g9 : DUT_X2_grade; b9 : INT;",
    "inst(score := 0, grade => g0, band => b0);\ninst(score := 2, grade => g2, band => b2);\ninst(score := 5, grade => g5, band => b5);\ninst(score := 9, grade => g9, band => b9);"),
]
