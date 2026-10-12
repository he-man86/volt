/**
 * the fixtures of `call-shapes.ts` — part C: A REFERENCE IS IMPLICITLY DEREFERENCED.
 *
 * One slice of `call-shapes.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"
import { fb } from "./call-shapes-shared.js"

export const CALL_SHAPE_TESTS_C: readonly LanguageTest[] = [
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
    feature: "a field read and written through a REFERENCE TO a struct — ref_.x means ref_^.x",
    fromDoc: "reference-deref",
    plcPrgVar: "inst_xo_reference_field_step : FB_LANG_xo_reference_field_step;",
    plcPrgBody: "inst_xo_reference_field_step();",
    source: "TYPE DUT_LANG_reference_field_step :\nSTRUCT\n\tx : INT;\nEND_STRUCT\nEND_TYPE\n\nFUNCTION_BLOCK FB_LANG_xo_reference_field_step\nVAR\n\tp : DUT_LANG_reference_field_step;\n\tref_ : REFERENCE TO DUT_LANG_reference_field_step;\n\treadBack : INT;\n\twrittenBack : INT;\nEND_VAR\np.x := 5;\nref_ REF= p;\nreadBack := ref_.x;\nref_.x := 8;\nwrittenBack := p.x;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "xo_reference_index_step",
    pouName: "FB_LANG_xo_reference_index_step",
    kind: "function_block" as const,
    feature: "an element read and written through a REFERENCE TO an array — ref_[1] means ref_^[1]",
    fromDoc: "reference-deref",
    plcPrgVar: "inst_xo_reference_index_step : FB_LANG_xo_reference_index_step;",
    plcPrgBody: "inst_xo_reference_index_step();",
    source: "FUNCTION_BLOCK FB_LANG_xo_reference_index_step\nVAR\n\tarr : ARRAY[0..2] OF INT;\n\tref_ : REFERENCE TO ARRAY[0..2] OF INT;\n\treadBack : INT;\n\twrittenBack : INT;\nEND_VAR\narr[1] := 9;\nref_ REF= arr;\nreadBack := ref_[1];\nref_[2] := 6;\nwrittenBack := arr[2];\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "xo_reference_property",
    pouName: "FB_LANG_xo_reference_property",
    kind: "function_block" as const,
    feature: "a PROPERTY read and written through a REFERENCE TO an FB — the accessor runs on the instance pointed at",
    fromDoc: "reference-deref",
    plcPrgVar: "inst_xo_reference_property : FB_LANG_xo_reference_property;",
    plcPrgBody: "inst_xo_reference_property();",
    source: "FUNCTION_BLOCK FB_LANG_reference_property_target\nVAR\n\tside : INT := 3;\nEND_VAR\nEND_FUNCTION_BLOCK\n\nPROPERTY Size : INT\nGET\nSize := side;\nEND_GET\nSET\nside := Size;\nEND_SET\nEND_PROPERTY\n\nFUNCTION_BLOCK FB_LANG_xo_reference_property\nVAR\n\tc : FB_LANG_reference_property_target;\n\tref_ : REFERENCE TO FB_LANG_reference_property_target;\n\treadBack : INT;\n\twrittenBack : INT;\nEND_VAR\nref_ REF= c;\nreadBack := ref_.Size;\nref_.Size := 7;\nwrittenBack := c.Size;\nEND_FUNCTION_BLOCK\n",
  },
]
