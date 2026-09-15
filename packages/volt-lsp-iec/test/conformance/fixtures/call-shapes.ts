/**
 * Call shapes the corpus leans on and no recording answers — the oracle for the transpiler's `call-program-method`,
 * VAR_IN_OUT-in-METHOD (`place-not-local`), `call-nested` and `call-input-missing` blockers, recorded BEFORE any is built.
 * One question each: a METHOD run on a PROGRAM's one instance, from PLC_PRG and from an FB; an FB's VAR_IN_OUT read and
 * written inside its METHOD, when the body calls the METHOD and when a caller does after the FB was called; the order
 * a call's arguments are evaluated in when they hold calls and PROPERTY reads; what an input left out of a METHOD or
 * FUNCTION call holds.
 */
import type { LanguageTest } from "../types.js"

const doc = "transpile-st-to-rust phase 3½ — call shapes"

function fb(name: string, pouName: string, feature: string, source: string, plcPrgVar: string, plcPrgBody: string, cycles?: number): LanguageTest {
  return { name, pouName, kind: "function_block", feature, fromDoc: doc, source, plcPrgVar, plcPrgBody, ...(cycles === undefined ? {} : { cycles }) }
}

export const CALL_SHAPE_TESTS: readonly LanguageTest[] = [
  fb("callshape_method_on_program", "FB_CS_caller1", "a METHOD of a PROGRAM, run on the program's one instance from PLC_PRG and from an FB, beside the program's own body",
    `PROGRAM PRG_CS_counter1
VAR
	runs : INT;
	bumps : INT;
END_VAR
runs := runs + 1;
END_PROGRAM

METHOD Bump : INT
VAR_INPUT
	amount : INT;
END_VAR
bumps := bumps + amount;
Bump := bumps + runs;
END_METHOD

FUNCTION_BLOCK FB_CS_caller1
VAR_OUTPUT
	seen : INT;
END_VAR
seen := PRG_CS_counter1.Bump(amount := 10);
END_FUNCTION_BLOCK
`,
    "caller : FB_CS_caller1; fromPlc : INT;",
    "PRG_CS_counter1();\nfromPlc := PRG_CS_counter1.Bump(amount := 1);\ncaller();",
    2),
  fb("callshape_inout_in_method_from_body", "FB_CS_worker2", "an FB's VAR_IN_OUT written inside its METHOD, the METHOD called from the FB's body",
    `FUNCTION_BLOCK FB_CS_worker2
VAR_IN_OUT
	shared : INT;
END_VAR
VAR
	calls : INT;
END_VAR
calls := calls + 1;
AddTen();
END_FUNCTION_BLOCK

METHOD AddTen
shared := shared + 10;
END_METHOD
`,
    "worker : FB_CS_worker2; first : INT := 1;",
    "worker(shared := first);",
    2),
  fb("callshape_inout_in_method_after_call", "FB_CS_worker3", "an FB's VAR_IN_OUT written inside its METHOD, the METHOD called from outside after the FB was called with one variable, then another",
    `FUNCTION_BLOCK FB_CS_worker3
VAR_IN_OUT
	shared : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD AddTen
shared := shared + 10;
END_METHOD
`,
    "worker : FB_CS_worker3; first : INT := 1; second : INT := 100;",
    "worker(shared := first);\nworker.AddTen();\nworker(shared := second);\nworker.AddTen();"),
  fb("callshape_argument_order", "FB_CS_marker4", "calls inside a call's arguments: the order they run in, written in declaration order and reversed",
    `FUNCTION_BLOCK FB_CS_marker4
VAR
	order : DINT;
END_VAR
END_FUNCTION_BLOCK

METHOD Mark : INT
VAR_INPUT
	digit : INT;
END_VAR
order := order * 10 + digit;
Mark := digit;
END_METHOD

FUNCTION F_CS_pair4 : INT
VAR_INPUT
	leftValue : INT;
	rightValue : INT;
END_VAR
F_CS_pair4 := leftValue * 10 + rightValue;
END_FUNCTION
`,
    "marker : FB_CS_marker4; inOrder : INT; reversed : INT;",
    "inOrder := F_CS_pair4(leftValue := marker.Mark(digit := 1), rightValue := marker.Mark(digit := 2));\nreversed := F_CS_pair4(rightValue := marker.Mark(digit := 3), leftValue := marker.Mark(digit := 4));"),
  fb("callshape_property_read_in_arguments", "FB_CS_gauge5", "a PROPERTY read inside a call's arguments, its getter counting the reads",
    `FUNCTION_BLOCK FB_CS_gauge5
VAR
	reads : INT;
END_VAR
END_FUNCTION_BLOCK

PROPERTY Level : INT
GET
reads := reads + 1;
Level := reads;
END_GET
END_PROPERTY

FUNCTION F_CS_pair5 : INT
VAR_INPUT
	leftValue : INT;
	rightValue : INT;
END_VAR
F_CS_pair5 := leftValue * 10 + rightValue;
END_FUNCTION
`,
    "gauge : FB_CS_gauge5; combined : INT;",
    "combined := F_CS_pair5(leftValue := gauge.Level, rightValue := gauge.Level);"),
  fb("callshape_input_left_out", "FB_CS_calc6", "an input left out of a METHOD or FUNCTION call: its declared initial value, or what the last call gave",
    `FUNCTION_BLOCK FB_CS_calc6
END_FUNCTION_BLOCK

METHOD Combine : INT
VAR_INPUT
	baseValue : INT := 5;
	extra : INT;
END_VAR
Combine := baseValue * 10 + extra;
END_METHOD

FUNCTION F_CS_combine6 : INT
VAR_INPUT
	baseValue : INT := 5;
	extra : INT;
END_VAR
F_CS_combine6 := baseValue * 10 + extra;
END_FUNCTION
`,
    // (the instance was `calc` — CALC is an IL operator CODESYS reserves; `by` below was FOR's BY.) Leaving out `extra`,
    // which has no initial value, does not compile: "Function 'Combine' requires at least '1' and maximum '2' inputs" —
    // only an input WITH an initial value may be left out of a METHOD call, so this case leaves out only that one.
    "calculator : FB_CS_calc6; allGiven : INT; baseLeftOut : INT; functionLeftOut : INT;",
    "allGiven := calculator.Combine(baseValue := 2, extra := 3);\nbaseLeftOut := calculator.Combine(extra := 4);\nfunctionLeftOut := F_CS_combine6(extra := 1);"),
  // Recorded: it does not compile either — "Function 'F_CS_combine11' requires at least '1' and maximum '2' inputs". A
  // FUNCTION and a METHOD alike may leave out only an input that has an initial value.
  fb("callshape_function_input_no_default", "FB_CS_user11", "a FUNCTION called without an input that has no initial value — does it compile, and what does the input hold",
    `FUNCTION F_CS_combine11 : INT
VAR_INPUT
	baseValue : INT := 5;
	extra : INT;
END_VAR
F_CS_combine11 := baseValue * 10 + extra;
END_FUNCTION

FUNCTION_BLOCK FB_CS_user11
VAR
	extraLeftOut : INT;
END_VAR
extraLeftOut := F_CS_combine11(baseValue := 7);
END_FUNCTION_BLOCK
`,
    "user : FB_CS_user11;",
    "user();"),
  // Variable-length arrays — the largest shape behind the corpus's `place-shape` (636 index diagnostics in one project):
  // an `ARRAY[*]` VAR_IN_OUT, indexed within LOWER_BOUND/UPPER_BOUND. Asked in one and two dimensions, of a struct, and
  // a FOR whose step is decided at run time (`for-step-runtime`), which the same functions use.
  fb("callshape_array_star_bounds", "FB_CS_user7", "an ARRAY[*] VAR_IN_OUT bound to ARRAY[3..7]: its LOWER_BOUND/UPPER_BOUND, and writes through it by the caller's indices",
    `FUNCTION F_CS_fill7 : INT
VAR_IN_OUT
	numbers : ARRAY[*] OF INT;
END_VAR
VAR
	index : DINT;
	lowest : DINT;
	highest : DINT;
END_VAR
lowest := LOWER_BOUND(numbers, 1);
highest := UPPER_BOUND(numbers, 1);
FOR index := lowest TO highest DO
	numbers[index] := DINT_TO_INT(index * 2);
END_FOR
F_CS_fill7 := DINT_TO_INT(lowest * 100 + highest);
END_FUNCTION

FUNCTION_BLOCK FB_CS_user7
VAR
	numbers : ARRAY[3..7] OF INT;
	bounds : INT;
END_VAR
bounds := F_CS_fill7(numbers := numbers);
END_FUNCTION_BLOCK
`,
    "user : FB_CS_user7;",
    "user();"),
  fb("callshape_array_star_two_dims", "FB_CS_user8", "an ARRAY[*, *] VAR_IN_OUT bound to ARRAY[1..2, 0..2]: the bounds of each dimension, and a write",
    `FUNCTION F_CS_grid8 : INT
VAR_IN_OUT
	grid : ARRAY[*, *] OF INT;
END_VAR
VAR
	row : DINT;
	column : DINT;
END_VAR
FOR row := LOWER_BOUND(grid, 1) TO UPPER_BOUND(grid, 1) DO
	FOR column := LOWER_BOUND(grid, 2) TO UPPER_BOUND(grid, 2) DO
		grid[row, column] := DINT_TO_INT(row * 10 + column);
	END_FOR
END_FOR
F_CS_grid8 := DINT_TO_INT(LOWER_BOUND(grid, 2) * 10 + UPPER_BOUND(grid, 2));
END_FUNCTION

FUNCTION_BLOCK FB_CS_user8
VAR
	grid : ARRAY[1..2, 0..2] OF INT;
	secondDim : INT;
END_VAR
secondDim := F_CS_grid8(grid := grid);
END_FUNCTION_BLOCK
`,
    "user : FB_CS_user8;",
    "user();"),
  fb("callshape_array_star_of_struct", "FB_CS_owner9", "a METHOD writing a struct element's field through an ARRAY[*] VAR_IN_OUT",
    `TYPE DUT_CS_point9 :
STRUCT
	x : INT;
	y : INT;
END_STRUCT
END_TYPE

FUNCTION_BLOCK FB_CS_owner9
VAR
	points : ARRAY[0..2] OF DUT_CS_point9;
END_VAR
Shift(line := points, offset := 5);
END_FUNCTION_BLOCK

METHOD Shift
VAR_IN_OUT
	line : ARRAY[*] OF DUT_CS_point9;
END_VAR
VAR_INPUT
	offset : INT;
END_VAR
VAR
	index : DINT;
END_VAR
FOR index := LOWER_BOUND(line, 1) TO UPPER_BOUND(line, 1) DO
	line[index].x := line[index].x + offset;
	line[index].y := DINT_TO_INT(index);
END_FOR
END_METHOD
`,
    "owner : FB_CS_owner9;",
    "owner();"),
  fb("callshape_for_runtime_step", "FB_CS_counter10", "a FOR whose step is decided at run time, counting up and counting down",
    `FUNCTION_BLOCK FB_CS_counter10
VAR_INPUT
	backwards : BOOL;
END_VAR
VAR_OUTPUT
	visits : INT;
	lastIndex : INT;
END_VAR
VAR
	index : INT;
	firstIndex : INT;
	finalIndex : INT;
END_VAR
visits := 0;
IF backwards THEN
	firstIndex := 5;
	finalIndex := 1;
ELSE
	firstIndex := 1;
	finalIndex := 5;
END_IF
FOR index := firstIndex TO finalIndex BY SEL(backwards, 2, -2) DO
	visits := visits + 1;
	lastIndex := index;
END_FOR
END_FUNCTION_BLOCK
`,
    "up : FB_CS_counter10; down : FB_CS_counter10;",
    "up(backwards := FALSE);\ndown(backwards := TRUE);"),
  // Is a FOR's limit and step read once, or on every pass? The body changes both after the first pass. Read once: 9 visits,
  // last index 9. Step every pass, limit once: 3 visits (1, 4, 7). Both every pass: 2 (1, 4). Limit every pass, step
  // once: 4 (1..4).
  fb("callshape_for_bounds_changed_in_body", "FB_CS_loop12", "a FOR whose limit variable and step variable the body changes after the first pass",
    `FUNCTION_BLOCK FB_CS_loop12
VAR_OUTPUT
	visits : INT;
	lastIndex : INT;
END_VAR
VAR
	index : INT;
	finalIndex : INT;
	stride : INT;
END_VAR
visits := 0;
finalIndex := 9;
stride := 1;
FOR index := 1 TO finalIndex BY stride DO
	visits := visits + 1;
	lastIndex := index;
	stride := 3;
	finalIndex := 4;
END_FOR
END_FUNCTION_BLOCK
`,
    "loop : FB_CS_loop12;",
    "loop();"),
  // Arguments run in the order written — an in-out's binding too? The input's call moves the cursor the in-out's index
  // reads. Bound where written: 201 then 101. Every in-out bound after the inputs: 201 then 201.
  fb("callshape_inout_binding_order", "FB_CS_order13", "an in-out bound by an index that a call in another argument of the same call changes, written before and after it",
    `FUNCTION F_CS_take13 : INT
VAR_INPUT
	stepValue : INT;
END_VAR
VAR_IN_OUT
	boundValue : INT;
END_VAR
F_CS_take13 := boundValue * 10 + stepValue;
END_FUNCTION

FUNCTION_BLOCK FB_CS_order13
VAR_OUTPUT
	inputWrittenFirst : INT;
	inoutWrittenFirst : INT;
END_VAR
VAR
	numbers : ARRAY[0..3] OF INT := [10, 20, 30, 40];
	cursor : INT;
END_VAR
cursor := 0;
inputWrittenFirst := F_CS_take13(stepValue := Advance(), boundValue := numbers[cursor]);
cursor := 0;
inoutWrittenFirst := F_CS_take13(boundValue := numbers[cursor], stepValue := Advance());
END_FUNCTION_BLOCK

METHOD Advance : INT
cursor := cursor + 1;
Advance := cursor;
END_METHOD
`,
    "order : FB_CS_order13;",
    "order();"),
  // The width of LOWER_BOUND/UPPER_BOUND's result: 70002 * 40000 overflows a DINT (to -1494887296) and fits a 64-bit
  // integer (2800080000).
  fb("callshape_array_star_bound_width", "FB_CS_user14", "UPPER_BOUND of an ARRAY[*] VAR_IN_OUT multiplied past the DINT range",
    `FUNCTION F_CS_wide14 : LINT
VAR_IN_OUT
	values : ARRAY[*] OF BYTE;
END_VAR
F_CS_wide14 := UPPER_BOUND(values, 1) * 40000;
END_FUNCTION

FUNCTION_BLOCK FB_CS_user14
VAR
	values : ARRAY[70000..70002] OF BYTE;
	wide : LINT;
END_VAR
wide := F_CS_wide14(values := values);
END_FUNCTION_BLOCK
`,
    "user : FB_CS_user14;",
    "user();"),
  fb("callshape_array_star_passed_on", "FB_CS_user15", "an ARRAY[*] VAR_IN_OUT passed on to another function's ARRAY[*] VAR_IN_OUT: its bounds and a write there",
    `FUNCTION F_CS_inner15 : DINT
VAR_IN_OUT
	numbers : ARRAY[*] OF INT;
END_VAR
numbers[UPPER_BOUND(numbers, 1)] := 99;
F_CS_inner15 := LOWER_BOUND(numbers, 1) * 100 + UPPER_BOUND(numbers, 1);
END_FUNCTION

FUNCTION F_CS_outer15 : DINT
VAR_IN_OUT
	numbers : ARRAY[*] OF INT;
END_VAR
F_CS_outer15 := F_CS_inner15(numbers := numbers) + 10000;
END_FUNCTION

FUNCTION_BLOCK FB_CS_user15
VAR
	numbers : ARRAY[-2..4] OF INT;
	bounds : DINT;
END_VAR
bounds := F_CS_outer15(numbers := numbers);
END_FUNCTION_BLOCK
`,
    "user : FB_CS_user15;",
    "user();"),
  fb("callshape_array_star_fb_inout", "FB_CS_user16", "an FB's ARRAY[*] VAR_IN_OUT bound to a short array, then a longer one: the bounds each call sees",
    `FUNCTION_BLOCK FB_CS_filler16
VAR_IN_OUT
	numbers : ARRAY[*] OF INT;
END_VAR
VAR_OUTPUT
	elementCount : DINT;
END_VAR
VAR
	index : DINT;
END_VAR
elementCount := UPPER_BOUND(numbers, 1) - LOWER_BOUND(numbers, 1) + 1;
FOR index := LOWER_BOUND(numbers, 1) TO UPPER_BOUND(numbers, 1) DO
	numbers[index] := DINT_TO_INT(index + elementCount * 100);
END_FOR
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_CS_user16
VAR
	filler : FB_CS_filler16;
	shortRow : ARRAY[1..2] OF INT;
	longRow : ARRAY[5..8] OF INT;
	shortCount : DINT;
	longCount : DINT;
END_VAR
filler(numbers := shortRow);
shortCount := filler.elementCount;
filler(numbers := longRow);
longCount := filler.elementCount;
END_FUNCTION_BLOCK
`,
    "user : FB_CS_user16;",
    "user();"),
  fb("callshape_bounds_of_sized_array", "FB_CS_user17", "LOWER_BOUND and UPPER_BOUND of an array declared with its bounds, in each dimension",
    `FUNCTION_BLOCK FB_CS_user17
VAR
	grid : ARRAY[-1..1, 3..9] OF INT;
	firstLower : DINT;
	secondUpper : DINT;
END_VAR
firstLower := LOWER_BOUND(grid, 1);
secondUpper := UPPER_BOUND(grid, 2);
END_FUNCTION_BLOCK
`,
    "user : FB_CS_user17;",
    "user();"),
  // The limit is read on every pass (`callshape_for_bounds_changed_in_body`) — is a PROPERTY read or a METHOD call there
  // run on every pass too? The corpus's limits are property reads (`fbModuleManager.baseModulesCount`). Each runs 4 times
  // for 3 passes if the test runs it per pass, once if it is taken once.
  fb("callshape_for_limit_call", "FB_CS_user18", "a FOR whose limit is a PROPERTY read, and one whose limit is a METHOD call: how often each runs",
    `FUNCTION_BLOCK FB_CS_holder18
VAR
	propertyReads : INT;
	methodCalls : INT;
END_VAR
END_FUNCTION_BLOCK

PROPERTY PassLimit : INT
GET
propertyReads := propertyReads + 1;
PassLimit := 3;
END_GET
END_PROPERTY

METHOD LimitOf : INT
methodCalls := methodCalls + 1;
LimitOf := 3;
END_METHOD

FUNCTION_BLOCK FB_CS_user18
VAR
	holder : FB_CS_holder18;
	index : INT;
	propertyPasses : INT;
	methodPasses : INT;
END_VAR
propertyPasses := 0;
methodPasses := 0;
FOR index := 1 TO holder.PassLimit DO
	propertyPasses := propertyPasses + 1;
END_FOR
FOR index := 1 TO holder.LimitOf() DO
	methodPasses := methodPasses + 1;
END_FOR
END_FUNCTION_BLOCK
`,
    "user : FB_CS_user18;",
    "user();"),
]
