/**
 * the fixtures of `call-shapes.ts` — part A.
 *
 * One slice of `call-shapes.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"
import { fb } from "./call-shapes-shared.js"

export const CALL_SHAPE_TESTS_A: readonly LanguageTest[] = [
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
]
