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
  // The binding a METHOD called from outside uses: kept into LATER cycles? Bound to `first` in cycle 1 only, AddTen in
  // cycles 2 and 3 — 21 if it is kept, 1 if not (pro2193 calls `Conveyor.Reset()` from other METHODs, other runs).
  fb("callshape_inout_method_in_later_cycle", "FB_CS_workerLate", "an FB's VAR_IN_OUT written inside its METHOD called from outside in cycles after the one call that bound it",
    `FUNCTION_BLOCK FB_CS_workerLate
VAR_IN_OUT
	shared : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD AddTen
shared := shared + 10;
END_METHOD
`,
    "worker : FB_CS_workerLate; first : INT := 1; bound : BOOL; runs : INT;",
    "runs := runs + 1;\nIF bound THEN\n\tworker.AddTen();\nELSE\n\tworker(shared := first);\n\tbound := TRUE;\nEND_IF",
    3),
  // ...and before any call bound it: the METHOD runs first, then the call binds `first` (1 cycle). A stop here is the answer.
  fb("callshape_inout_method_before_binding", "FB_CS_workerEarly", "an FB's VAR_IN_OUT written inside its METHOD called from outside before any call of the FB bound it",
    `FUNCTION_BLOCK FB_CS_workerEarly
VAR_IN_OUT
	shared : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD AddTen
shared := shared + 10;
END_METHOD
`,
    "worker : FB_CS_workerEarly; first : INT := 1; reached : INT;",
    "worker.AddTen();\nreached := 1;\nworker(shared := first);"),
  // pro2193's ConveyorFB / AirBufferFB: a DERIVED FB's METHOD that names no in-out calls a BASE METHOD that writes the
  // base's VAR_IN_OUT, from the derived body's run — the binding of that call (11)?
  fb("callshape_inout_base_method_from_derived_method", "FB_CS_actBase23", "a derived FB's METHOD calling the base's METHOD that writes the base's VAR_IN_OUT, from the derived body",
    `FUNCTION_BLOCK FB_CS_actBase23
VAR_IN_OUT
	shared : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD AddTen
shared := shared + 10;
END_METHOD

FUNCTION_BLOCK FB_CS_actDerived23 EXTENDS FB_CS_actBase23
Bump();
END_FUNCTION_BLOCK

METHOD Bump
AddTen();
END_METHOD
`,
    "derived : FB_CS_actDerived23; v : INT := 1;",
    "derived(shared := v);"),
  // ...and that derived METHOD called from outside after the call: the last binding, through the chain (11, then 21).
  fb("callshape_inout_base_method_from_outside_derived", "FB_CS_actBase24", "a derived FB's METHOD, called from outside after the FB's call, reaching the base's VAR_IN_OUT through the base's METHOD",
    `FUNCTION_BLOCK FB_CS_actBase24
VAR_IN_OUT
	shared : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD AddTen
shared := shared + 10;
END_METHOD

FUNCTION_BLOCK FB_CS_actDerived24 EXTENDS FB_CS_actBase24
AddTen();
END_FUNCTION_BLOCK

METHOD Bump
AddTen();
END_METHOD
`,
    "derived : FB_CS_actDerived24; v : INT := 1;",
    "derived(shared := v);\nderived.Bump();"),
  // An override calling SUPER^.M(), the base's M writing the base's VAR_IN_OUT, from the derived body's run (11).
  fb("callshape_inout_super_method_from_override", "FB_CS_actBase25", "a derived FB's override calling SUPER^ of a METHOD that writes the base's VAR_IN_OUT",
    `FUNCTION_BLOCK FB_CS_actBase25
VAR_IN_OUT
	shared : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD AddTen
shared := shared + 10;
END_METHOD

FUNCTION_BLOCK FB_CS_actDerived25 EXTENDS FB_CS_actBase25
AddTen();
END_FUNCTION_BLOCK

METHOD AddTen
SUPER^.AddTen();
END_METHOD
`,
    "derived : FB_CS_actDerived25; v : INT := 1;",
    "derived(shared := v);"),
  // pro2193's shape itself: the BASE's body, run through the derived body's SUPER^(), calls a METHOD the derived FB
  // overrides, and the override writes the DERIVED FB's own VAR_IN_OUT — the binding of the derived call (11)?
  fb("callshape_inout_override_from_base_body", "FB_CS_ovBase26", "a base FB's body, run through SUPER^(), calling a METHOD whose override writes the derived FB's VAR_IN_OUT",
    `FUNCTION_BLOCK FB_CS_ovBase26
VAR
	calls : INT;
END_VAR
calls := calls + 1;
Hook();
END_FUNCTION_BLOCK

METHOD Hook
;
END_METHOD

FUNCTION_BLOCK FB_CS_ovDerived26 EXTENDS FB_CS_ovBase26
VAR_IN_OUT
	profile : INT;
END_VAR
SUPER^();
END_FUNCTION_BLOCK

METHOD Hook
profile := profile + 10;
END_METHOD
`,
    "derived : FB_CS_ovDerived26; v : INT := 1;",
    "derived(profile := v);"),
  // ...and a BASE METHOD called from outside after the call, calling that override: the last binding (11, then 21).
  fb("callshape_inout_override_from_outside_base_method", "FB_CS_ovBase27", "a base FB's METHOD, called from outside after the call, calling a METHOD whose override writes the derived FB's VAR_IN_OUT",
    `FUNCTION_BLOCK FB_CS_ovBase27
VAR
	calls : INT;
END_VAR
calls := calls + 1;
Hook();
END_FUNCTION_BLOCK

METHOD Hook
;
END_METHOD

METHOD Run
Hook();
END_METHOD

FUNCTION_BLOCK FB_CS_ovDerived27 EXTENDS FB_CS_ovBase27
VAR_IN_OUT
	profile : INT;
END_VAR
SUPER^();
END_FUNCTION_BLOCK

METHOD Hook
profile := profile + 10;
END_METHOD
`,
    "derived : FB_CS_ovDerived27; v : INT := 1;",
    "derived(profile := v);\nderived.Run();"),
  // An FB lending its own field to its own METHOD, which also reads the field by name after writing the in-out: by
  // reference the name sees the new value (10), a copy would not (7).
  fb("callshape_own_field_inout_read_by_name", "FB_CS_ownRead15", "an FB's own field lent to its own METHOD's VAR_IN_OUT, the METHOD reading the field by name after writing the in-out",
    `FUNCTION_BLOCK FB_CS_ownRead15
VAR_OUTPUT
	result : INT;
END_VAR
VAR
	counter : INT := 7;
END_VAR
result := Mixed(counter, 3);
END_FUNCTION_BLOCK

METHOD Mixed : INT
VAR_IN_OUT
	target : INT;
END_VAR
VAR_INPUT
	amount : INT;
END_VAR
target := target + amount;
Mixed := counter;
END_METHOD
`,
    "user : FB_CS_ownRead15;",
    "user();"),
  // One field lent to two in-outs of one call: both name it, so 5 then + 1 gives 6.
  fb("callshape_own_field_two_inouts", "FB_CS_twoInouts16", "one field of the FB lent to two VAR_IN_OUT of its own METHOD in the same call",
    `FUNCTION_BLOCK FB_CS_twoInouts16
VAR
	n : INT := 100;
END_VAR
Two(a := n, b := n);
END_FUNCTION_BLOCK

METHOD Two
VAR_IN_OUT
	a : INT;
	b : INT;
END_VAR
a := 5;
b := b + 1;
END_METHOD
`,
    "user : FB_CS_twoInouts16;",
    "user();"),
  // SUPER^ binding the base's two in-outs to ONE field of the derived FB: by reference n is 6.
  fb("callshape_super_own_field_twice", "FB_CS_superBase17", "SUPER^ binding both of the base's VAR_IN_OUT to one field of the derived FB",
    `FUNCTION_BLOCK FB_CS_superBase17
VAR_IN_OUT
	a : INT;
	b : INT;
END_VAR
a := 5;
b := b + 1;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_CS_superTwice17 EXTENDS FB_CS_superBase17
VAR
	n : INT := 100;
END_VAR
SUPER^(a := n, b := n);
END_FUNCTION_BLOCK
`,
    "twice : FB_CS_superTwice17; x : INT; y : INT;",
    "twice(a := x, b := y);"),
  // SUPER^ binding the base's in-outs to two fields of the derived FB, the derived body leaving its own in-outs unread.
  fb("callshape_super_own_fields", "FB_CS_superBase18", "SUPER^ binding the base's VAR_IN_OUT to two fields of the derived FB",
    `FUNCTION_BLOCK FB_CS_superBase18
VAR_IN_OUT
	a : INT;
	b : INT;
END_VAR
a := 5;
b := b + 1;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_CS_superPair18 EXTENDS FB_CS_superBase18
VAR
	n : INT := 100;
	m : INT := 200;
END_VAR
SUPER^(a := n, b := m);
END_FUNCTION_BLOCK
`,
    "pair : FB_CS_superPair18; x : INT := 1; y : INT := 2;",
    "pair(a := x, b := y);"),
  // A child instance's field lent to the child's METHOD called through THIS^, the METHOD also writing that field by name:
  // by reference 0 + 1, then + 10 — 11.
  fb("callshape_inout_sub_instance_field", "FB_CS_subHolder19", "a child instance's field lent to the child's METHOD through THIS^, the METHOD writing the field by name too",
    `FUNCTION_BLOCK FB_CS_subHolder19
VAR
	inner : FB_CS_subInner19;
END_VAR
THIS^.inner.Bump(v := inner.x);
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_CS_subInner19
VAR
	x : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD Bump
VAR_IN_OUT
	v : INT;
END_VAR
v := v + 1;
x := x + 10;
END_METHOD
`,
    "holder : FB_CS_subHolder19;",
    "holder();"),
  // A VAR_OUTPUT target indexed by a variable, written before a call in a later argument that moves the index: is the
  // index read where written (7 into numbers[0]) or after the call (numbers[1])?
  fb("callshape_output_index_before_call", "FB_CS_outOrder20", "a VAR_OUTPUT bound with => to an element indexed by a variable that a call in a later argument changes",
    `FUNCTION F_CS_out20 : INT
VAR_INPUT
	stepValue : INT;
END_VAR
VAR_OUTPUT
	res : INT;
END_VAR
res := 7;
F_CS_out20 := stepValue;
END_FUNCTION

FUNCTION_BLOCK FB_CS_outOrder20
VAR_OUTPUT
	got : INT;
END_VAR
VAR
	numbers : ARRAY[0..3] OF INT := [10, 20, 30, 40];
	cursor : INT;
END_VAR
cursor := 0;
got := F_CS_out20(res => numbers[cursor], stepValue := Advance());
END_FUNCTION_BLOCK

METHOD Advance : INT
cursor := cursor + 1;
Advance := cursor;
END_METHOD
`,
    "order : FB_CS_outOrder20;",
    "order();"),
  // An in-out indexed through another array, written before a call that moves the inner index: where written,
  // numbers[slots[0]] = numbers[3] (401); after the call, numbers[slots[1]] = numbers[2] (301).
  fb("callshape_inout_nested_index_before_call", "FB_CS_nested21", "an in-out bound to numbers[slots[cursor]] before a call in a later argument that changes cursor",
    `FUNCTION F_CS_take21 : INT
VAR_INPUT
	stepValue : INT;
END_VAR
VAR_IN_OUT
	boundValue : INT;
END_VAR
F_CS_take21 := boundValue * 10 + stepValue;
END_FUNCTION

FUNCTION_BLOCK FB_CS_nested21
VAR_OUTPUT
	got : INT;
END_VAR
VAR
	numbers : ARRAY[0..3] OF INT := [10, 20, 30, 40];
	slots : ARRAY[0..3] OF INT := [3, 2, 1, 0];
	cursor : INT;
END_VAR
cursor := 0;
got := F_CS_take21(boundValue := numbers[slots[cursor]], stepValue := Advance());
END_FUNCTION_BLOCK

METHOD Advance : INT
cursor := cursor + 1;
Advance := cursor;
END_METHOD
`,
    "nested : FB_CS_nested21;",
    "nested();"),
  // An in-out bound through a pointer, written before a call that repoints it: where written, numbers[0] (101); after
  // the call, numbers[1] (201).
  fb("callshape_inout_pointer_before_call", "FB_CS_pointer22", "an in-out bound to p^ before a call in a later argument that stores another address into p",
    `FUNCTION F_CS_take22 : INT
VAR_INPUT
	stepValue : INT;
END_VAR
VAR_IN_OUT
	boundValue : INT;
END_VAR
F_CS_take22 := boundValue * 10 + stepValue;
END_FUNCTION

FUNCTION_BLOCK FB_CS_pointer22
VAR_OUTPUT
	got : INT;
END_VAR
VAR
	numbers : ARRAY[0..1] OF INT := [10, 20];
	p : POINTER TO INT;
END_VAR
p := ADR(numbers[0]);
got := F_CS_take22(boundValue := p^, stepValue := Repoint());
END_FUNCTION_BLOCK

METHOD Repoint : INT
p := ADR(numbers[1]);
Repoint := 1;
END_METHOD
`,
    "pointed : FB_CS_pointer22;",
    "pointed();"),
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
  // An ARRAY[*] feels dynamic but takes the size of the array connected to it — so can an FB hand its ARRAY[*] in-out on to
  // a nested FB's ARRAY[*] in-out, FB layers deep? (A FUNCTION passing one on to a FUNCTION compiles: 9804.) If it compiles,
  // the inner FB sees the caller's bounds, 306, and its write reaches the caller's array.
  fb("callshape_array_star_fb_chain", "FB_CS_user19", "an FB's ARRAY[*] VAR_IN_OUT passed on to a nested FB's ARRAY[*] VAR_IN_OUT: does it compile, and which bounds does the inner FB see",
    `FUNCTION_BLOCK FB_CS_inner19
VAR_IN_OUT
	numbers : ARRAY[*] OF INT;
END_VAR
VAR_OUTPUT
	seenBounds : DINT;
END_VAR
seenBounds := LOWER_BOUND(numbers, 1) * 100 + UPPER_BOUND(numbers, 1);
numbers[UPPER_BOUND(numbers, 1)] := 77;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_CS_outer19
VAR_IN_OUT
	numbers : ARRAY[*] OF INT;
END_VAR
VAR_OUTPUT
	seenBounds : DINT;
END_VAR
VAR
	inner : FB_CS_inner19;
END_VAR
inner(numbers := numbers);
seenBounds := inner.seenBounds;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_CS_user19
VAR
	outer : FB_CS_outer19;
	row : ARRAY[3..6] OF INT;
	seen : DINT;
END_VAR
outer(numbers := row);
seen := outer.seenBounds;
END_FUNCTION_BLOCK
`,
    "user : FB_CS_user19;",
    "user();"),
  // pro2193 reaches FB instances declared INSIDE a PROGRAM from other POUs: `SER.EnableFreqInvertersRelay.Map()`, and
  // `Attach`/`Detach` on a program's instance (the transpiler's `call-program-method`, 60 corpus POUs). Does a METHOD run
  // on that instance, and does a call of it from outside run its body on the same instance the program's own body calls?
  fb("callshape_program_instance_from_outside", "FB_CS_caller20", "a METHOD and a body call of an FB instance declared inside a PROGRAM, reached through the program's name from PLC_PRG and from an FB",
    `FUNCTION_BLOCK FB_CS_relay20
VAR_INPUT
	level : INT;
END_VAR
VAR
	maps : INT;
	calls : INT;
	lastLevel : INT;
END_VAR
calls := calls + 1;
lastLevel := level;
END_FUNCTION_BLOCK

METHOD Map : INT
maps := maps + 1;
Map := maps * 100 + calls;
END_METHOD

PROGRAM PRG_CS_station20
VAR
	relay : FB_CS_relay20;
	runs : INT;
END_VAR
runs := runs + 1;
relay(level := runs);
END_PROGRAM

FUNCTION_BLOCK FB_CS_caller20
VAR_OUTPUT
	seen : INT;
END_VAR
seen := PRG_CS_station20.relay.Map();
PRG_CS_station20.relay(level := 50);
END_FUNCTION_BLOCK
`,
    "caller : FB_CS_caller20; fromPlc : INT;",
    "PRG_CS_station20();\nfromPlc := PRG_CS_station20.relay.Map();\ncaller();",
    2),
  // The same instance's PROPERTY, read from outside the PROGRAM (pro2193's `HardwareButtons.F1.ObserverCount` — the
  // transpiler's `call-program-property`, 64 corpus POUs): does the getter run on the program's instance? Recorded first
  // with the property also WRITTEN from outside, which does not compile: "'gauge' is no input of 'PRG_CS_station21'" —
  // so the program writes it, and the others only read.
  fb("callshape_program_instance_property", "FB_CS_caller21", "a PROPERTY of an FB instance declared inside a PROGRAM, set by the program and read through the program's name from PLC_PRG and from an FB",
    `FUNCTION_BLOCK FB_CS_gauge21
VAR
	stored : INT;
	gets : INT;
END_VAR
END_FUNCTION_BLOCK

PROPERTY Level : INT
GET
gets := gets + 1;
Level := stored * 10 + gets;
END_GET
SET
stored := stored + Level;
END_SET
END_PROPERTY

PROGRAM PRG_CS_station21
VAR
	gauge : FB_CS_gauge21;
	runs : INT;
END_VAR
runs := runs + 1;
gauge.Level := runs;
END_PROGRAM

FUNCTION_BLOCK FB_CS_caller21
VAR_OUTPUT
	seen : INT;
END_VAR
seen := PRG_CS_station21.gauge.Level;
END_FUNCTION_BLOCK
`,
    "caller : FB_CS_caller21; fromPlc : INT;",
    "PRG_CS_station21();\nfromPlc := PRG_CS_station21.gauge.Level;\ncaller();",
    2),
  // Positional arguments across sections (the transpiler's `call-positional`, 62 corpus POUs): pro2193 calls
  // `Arrays.Bool_All(result, TRUE)` — a VAR_IN_OUT declared before a VAR_INPUT — and `ClearProducts.Single(Product)`. Do
  // positional arguments bind in declaration order across VAR_IN_OUT and VAR_INPUT, interleaved too? In declaration order:
  // 100, 315, 46, with counter 11.
  fb("callshape_positional_arguments", "FB_CS_user22", "positional arguments to a METHOD whose VAR_IN_OUT comes before its VAR_INPUT, to one with VAR_INPUT, VAR_IN_OUT, VAR_INPUT interleaved, and to a FUNCTION",
    `FUNCTION F_CS_positional22 : INT
VAR_INPUT
	leftValue : INT;
	rightValue : INT;
END_VAR
F_CS_positional22 := leftValue * 10 + rightValue;
END_FUNCTION

FUNCTION_BLOCK FB_CS_user22
VAR
	counter : INT := 7;
	mixedResult : INT;
	interleavedResult : INT;
	functionResult : INT;
END_VAR
mixedResult := Mixed(counter, 3);
interleavedResult := Interleaved(2, counter, 5);
functionResult := F_CS_positional22(4, 6);
END_FUNCTION_BLOCK

METHOD Mixed : INT
VAR_IN_OUT
	target : INT;
END_VAR
VAR_INPUT
	amount : INT;
END_VAR
target := target + amount;
Mixed := target * 10;
END_METHOD

METHOD Interleaved : INT
VAR_INPUT
	leading : INT;
END_VAR
VAR_IN_OUT
	target : INT;
END_VAR
VAR_INPUT
	trailing : INT;
END_VAR
target := target + 1;
Interleaved := leading * 100 + target * 10 + trailing;
END_METHOD
`,
    "user : FB_CS_user22;",
    "user();"),
  // ─── A REFERENCE IS IMPLICITLY DEREFERENCED ────────────────────────────────────────────────────────
  // `r.x` means `r^.x` and `r[1]` means `r^[1]` — the whole difference between REFERENCE TO and POINTER TO. Lowering
  // applied the field and index step to the reference VARIABLE, so both were refused (`expr-member`, `place-shape`)
  // while a scalar `a := r` worked; a PROPERTY through one was refused the same way, one layer up. `xo_reference_to_fb_call`
  // already records the body call and the METHOD through a reference — these record the remaining three steps.
  {
    name: "xo_reference_field_step",
    pouName: "FB_LANG_xo_reference_field_step",
    kind: "function_block" as const,
    feature: "a field read and written through a REFERENCE TO a struct — r.x means r^.x",
    fromDoc: "reference-deref",
    plcPrgVar: "inst_xo_reference_field_step : FB_LANG_xo_reference_field_step;",
    plcPrgBody: "inst_xo_reference_field_step();",
    source: "TYPE DUT_LANG_reference_field_step :\nSTRUCT\n\tx : INT;\nEND_STRUCT\nEND_TYPE\n\nFUNCTION_BLOCK FB_LANG_xo_reference_field_step\nVAR\n\tp : DUT_LANG_reference_field_step;\n\tr : REFERENCE TO DUT_LANG_reference_field_step;\n\treadBack : INT;\n\twrittenBack : INT;\nEND_VAR\np.x := 5;\nr REF= p;\nreadBack := r.x;\nr.x := 8;\nwrittenBack := p.x;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "xo_reference_index_step",
    pouName: "FB_LANG_xo_reference_index_step",
    kind: "function_block" as const,
    feature: "an element read and written through a REFERENCE TO an array — r[1] means r^[1]",
    fromDoc: "reference-deref",
    plcPrgVar: "inst_xo_reference_index_step : FB_LANG_xo_reference_index_step;",
    plcPrgBody: "inst_xo_reference_index_step();",
    source: "FUNCTION_BLOCK FB_LANG_xo_reference_index_step\nVAR\n\tarr : ARRAY[0..2] OF INT;\n\tr : REFERENCE TO ARRAY[0..2] OF INT;\n\treadBack : INT;\n\twrittenBack : INT;\nEND_VAR\narr[1] := 9;\nr REF= arr;\nreadBack := r[1];\nr[2] := 6;\nwrittenBack := arr[2];\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "xo_reference_property",
    pouName: "FB_LANG_xo_reference_property",
    kind: "function_block" as const,
    feature: "a PROPERTY read and written through a REFERENCE TO an FB — the accessor runs on the instance pointed at",
    fromDoc: "reference-deref",
    plcPrgVar: "inst_xo_reference_property : FB_LANG_xo_reference_property;",
    plcPrgBody: "inst_xo_reference_property();",
    source: "FUNCTION_BLOCK FB_LANG_reference_property_target\nVAR\n\tside : INT := 3;\nEND_VAR\nEND_FUNCTION_BLOCK\n\nPROPERTY Size : INT\nGET\nSize := side;\nEND_GET\nSET\nside := Size;\nEND_SET\nEND_PROPERTY\n\nFUNCTION_BLOCK FB_LANG_xo_reference_property\nVAR\n\tc : FB_LANG_reference_property_target;\n\tr : REFERENCE TO FB_LANG_reference_property_target;\n\treadBack : INT;\n\twrittenBack : INT;\nEND_VAR\nr REF= c;\nreadBack := r.Size;\nr.Size := 7;\nwrittenBack := c.Size;\nEND_FUNCTION_BLOCK\n",
  },
]
