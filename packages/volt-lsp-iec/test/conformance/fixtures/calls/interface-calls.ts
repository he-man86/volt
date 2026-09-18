/**
 * Calls through an interface — the oracle for interface-typed variables in the transpiler (`slot-interface`), recorded
 * BEFORE it is built. `interface.ts` pins declarations that compile; nothing recorded a value reached THROUGH an
 * interface. One question each: which implementation a call runs after the variable is reassigned (and whether it keeps
 * its value across cycles), a property read and written through one, an interface assigned to its base interface,
 * `__QUERYINTERFACE` on success and on failure, and an FB instance passed to an interface-typed input. Interface
 * variables themselves are not read (an address); what they reached is.
 */
import type { LanguageTest } from "../../types.js"

const doc = "transpile-st-to-rust phase 5 — calls through an interface"

function fb(name: string, pouName: string, feature: string, source: string, plcPrgVar: string, plcPrgBody: string, cycles?: number): LanguageTest {
  return { name, pouName, kind: "function_block", feature, fromDoc: doc, source, plcPrgVar, plcPrgBody, ...(cycles === undefined ? {} : { cycles }) }
}

export const INTERFACE_CALL_TESTS: readonly LanguageTest[] = [
  fb("itf_call_dispatches_on_instance", "FB_IC_square1", "a call through an interface runs the assigned instance's method; the variable is null at first and keeps its value across cycles",
    `INTERFACE ITF_IC_shape1
METHOD Area : INT
END_METHOD
METHOD Bump
END_METHOD
END_INTERFACE

FUNCTION_BLOCK FB_IC_square1 IMPLEMENTS ITF_IC_shape1
VAR
	side : INT := 3;
	bumps : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD Area : INT
Area := side * side;
END_METHOD

METHOD Bump
bumps := bumps + 1;
END_METHOD

FUNCTION_BLOCK FB_IC_rect1 IMPLEMENTS ITF_IC_shape1
VAR
	width : INT := 2;
	height : INT := 5;
	bumps : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD Area : INT
Area := width * height;
END_METHOD

METHOD Bump
bumps := bumps + 10;
END_METHOD
`,
    "square : FB_IC_square1; rectangle : FB_IC_rect1; shapeRef : ITF_IC_shape1; areaSquare : INT; areaRect : INT; nullSeen : INT;",
    "IF shapeRef = 0 THEN\n\tnullSeen := nullSeen + 1;\nEND_IF\nshapeRef := square;\nareaSquare := shapeRef.Area();\nshapeRef.Bump();\nshapeRef := rectangle;\nareaRect := shapeRef.Area();\nshapeRef.Bump();",
    2),
  fb("itf_property_through_interface", "FB_IC_tank2", "a PROPERTY written and read through an interface runs the instance's setter and getter",
    `INTERFACE ITF_IC_level2
PROPERTY Level : INT
GET
END_GET
SET
END_SET
END_PROPERTY
END_INTERFACE

FUNCTION_BLOCK FB_IC_tank2 IMPLEMENTS ITF_IC_level2
VAR
	stored : INT;
END_VAR
END_FUNCTION_BLOCK

PROPERTY Level : INT
GET
Level := stored + 1;
END_GET
SET
stored := Level * 2;
END_SET
END_PROPERTY
`,
    "tank : FB_IC_tank2; levelRef : ITF_IC_level2; seenLevel : INT;",
    "levelRef := tank;\nlevelRef.Level := 5;\nseenLevel := levelRef.Level;"),
  fb("itf_extends_assigns_to_base", "FB_IC_impl3", "an interface that EXTENDS another: its variable calls both methods, and assigns to a variable of the base interface",
    `INTERFACE ITF_IC_base3
METHOD Ping : INT
END_METHOD
END_INTERFACE

INTERFACE ITF_IC_derived3 EXTENDS ITF_IC_base3
METHOD Pong : INT
END_METHOD
END_INTERFACE

FUNCTION_BLOCK FB_IC_impl3 IMPLEMENTS ITF_IC_derived3
VAR
	calls : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD Ping : INT
calls := calls + 1;
Ping := 100 + calls;
END_METHOD

METHOD Pong : INT
calls := calls + 1;
Pong := 200 + calls;
END_METHOD
`,
    "impl : FB_IC_impl3; derivedRef : ITF_IC_derived3; baseRef : ITF_IC_base3; ping1 : INT; pong1 : INT; ping2 : INT;",
    "derivedRef := impl;\nbaseRef := derivedRef;\nping1 := derivedRef.Ping();\npong1 := derivedRef.Pong();\nping2 := baseRef.Ping();"),
  fb("itf_queryinterface_success_and_failure", "FB_IC_both4", "__QUERYINTERFACE from a base interface to a derived one: TRUE and bound when the instance implements it; on FALSE, what the output holds",
    `INTERFACE ITF_IC_base4 EXTENDS __SYSTEM.IQueryInterface
METHOD Ping : INT
END_METHOD
END_INTERFACE

INTERFACE ITF_IC_derived4 EXTENDS ITF_IC_base4
METHOD Pong : INT
END_METHOD
END_INTERFACE

FUNCTION_BLOCK FB_IC_both4 IMPLEMENTS ITF_IC_derived4
END_FUNCTION_BLOCK

METHOD Ping : INT
Ping := 1;
END_METHOD

METHOD Pong : INT
Pong := 2;
END_METHOD

FUNCTION_BLOCK FB_IC_onlybase4 IMPLEMENTS ITF_IC_base4
END_FUNCTION_BLOCK

METHOD Ping : INT
Ping := 3;
END_METHOD
`,
    "both : FB_IC_both4; onlyBase : FB_IC_onlybase4; baseRef : ITF_IC_base4; derivedRef : ITF_IC_derived4; found1 : BOOL; found2 : BOOL; pong1 : INT; stillBound : BOOL;",
    "baseRef := both;\nfound1 := __QUERYINTERFACE(baseRef, derivedRef);\npong1 := derivedRef.Pong();\nbaseRef := onlyBase;\nfound2 := __QUERYINTERFACE(baseRef, derivedRef);\nstillBound := derivedRef <> 0;"),
  fb("itf_function_input", "FB_IC_square5", "an FB instance passed to a FUNCTION's interface-typed input, called through it",
    `INTERFACE ITF_IC_shape5
METHOD Area : INT
END_METHOD
END_INTERFACE

FUNCTION_BLOCK FB_IC_square5 IMPLEMENTS ITF_IC_shape5
VAR
	side : INT := 4;
END_VAR
END_FUNCTION_BLOCK

METHOD Area : INT
Area := side * side;
END_METHOD

FUNCTION F_IC_area5 : INT
VAR_INPUT
	shape : ITF_IC_shape5;
END_VAR
F_IC_area5 := shape.Area() + 1;
END_FUNCTION
`,
    "square : FB_IC_square5; areaPlusOne : INT;",
    "areaPlusOne := F_IC_area5(square);"),
  // An interface INPUT outlives nothing in a FUNCTION, but an FB keeps its inputs: whether it keeps the instance given and
  // uses it when a later call leaves the input out decides whether the input can be a borrow for the call. Asked here
  // before the transpiler takes one (`interface-input`, 127 corpus POUs, mostly FB inputs).
  fb("itf_fb_input_each_call", "FB_IC_meter6", "an FB's interface-typed VAR_INPUT, given on every call, called through in its body",
    `INTERFACE ITF_IC_shape6
METHOD Area : INT
END_METHOD
END_INTERFACE

FUNCTION_BLOCK FB_IC_square6 IMPLEMENTS ITF_IC_shape6
VAR
	side : INT := 4;
	calls : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD Area : INT
calls := calls + 1;
Area := side * side;
END_METHOD

FUNCTION_BLOCK FB_IC_rect6 IMPLEMENTS ITF_IC_shape6
VAR
	width : INT := 2;
	height : INT := 3;
END_VAR
END_FUNCTION_BLOCK

METHOD Area : INT
Area := width * height;
END_METHOD

FUNCTION_BLOCK FB_IC_meter6
VAR_INPUT
	shape : ITF_IC_shape6;
END_VAR
VAR_OUTPUT
	measured : INT;
END_VAR
measured := shape.Area();
END_FUNCTION_BLOCK
`,
    "square : FB_IC_square6; rect : FB_IC_rect6; meterSquare : FB_IC_meter6; meterRect : FB_IC_meter6; areaSquare : INT; areaRect : INT;",
    "meterSquare(shape := square, measured => areaSquare);\nmeterRect(shape := rect, measured => areaRect);",
    2),
  fb("itf_fb_input_left_out", "FB_IC_meter7", "an FB's interface-typed VAR_INPUT left out of a call: null before any is given, and after one is given",
    `INTERFACE ITF_IC_shape7
METHOD Area : INT
END_METHOD
END_INTERFACE

FUNCTION_BLOCK FB_IC_square7 IMPLEMENTS ITF_IC_shape7
VAR
	side : INT := 4;
END_VAR
END_FUNCTION_BLOCK

METHOD Area : INT
Area := side * side;
END_METHOD

FUNCTION_BLOCK FB_IC_meter7
VAR_INPUT
	shape : ITF_IC_shape7;
END_VAR
VAR_OUTPUT
	measured : INT;
	nullSeen : INT;
END_VAR
IF shape = 0 THEN
	nullSeen := nullSeen + 1;
	measured := -1;
ELSE
	measured := shape.Area();
END_IF
END_FUNCTION_BLOCK
`,
    "square : FB_IC_square7; meter : FB_IC_meter7; beforeAny : INT; given : INT; leftOut : INT; nulls : INT;",
    "meter(measured => beforeAny);\nmeter(shape := square, measured => given);\nmeter(measured => leftOut);\nnulls := meter.nullSeen;"),
  fb("itf_method_input_passed_on", "FB_IC_outer8", "a METHOD's interface-typed VAR_INPUT passed on to a FUNCTION and to a nested FB's input",
    `INTERFACE ITF_IC_shape8
METHOD Area : INT
END_METHOD
END_INTERFACE

FUNCTION_BLOCK FB_IC_square8 IMPLEMENTS ITF_IC_shape8
VAR
	side : INT := 4;
END_VAR
END_FUNCTION_BLOCK

METHOD Area : INT
Area := side * side;
END_METHOD

FUNCTION F_IC_area8 : INT
VAR_INPUT
	shape : ITF_IC_shape8;
END_VAR
F_IC_area8 := shape.Area() * 10;
END_FUNCTION

FUNCTION_BLOCK FB_IC_inner8
VAR_INPUT
	shape : ITF_IC_shape8;
END_VAR
VAR_OUTPUT
	got : INT;
END_VAR
got := shape.Area() + 1;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_IC_outer8
VAR
	inner : FB_IC_inner8;
END_VAR
VAR_OUTPUT
	viaFunction : INT;
	viaInner : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD Measure
VAR_INPUT
	shape : ITF_IC_shape8;
END_VAR
viaFunction := F_IC_area8(shape := shape);
inner(shape := shape);
viaInner := inner.got;
END_METHOD
`,
    "square : FB_IC_square8; outer : FB_IC_outer8;",
    "outer.Measure(shape := square);"),
  fb("itf_interface_variable_as_input", "FB_IC_meter9", "an interface variable passed as an FB's interface-typed input, reassigned between cycles",
    `INTERFACE ITF_IC_shape9
METHOD Area : INT
END_METHOD
END_INTERFACE

FUNCTION_BLOCK FB_IC_square9 IMPLEMENTS ITF_IC_shape9
VAR
	side : INT := 4;
END_VAR
END_FUNCTION_BLOCK

METHOD Area : INT
Area := side * side;
END_METHOD

FUNCTION_BLOCK FB_IC_rect9 IMPLEMENTS ITF_IC_shape9
VAR
	width : INT := 2;
	height : INT := 3;
END_VAR
END_FUNCTION_BLOCK

METHOD Area : INT
Area := width * height;
END_METHOD

FUNCTION_BLOCK FB_IC_meter9
VAR_INPUT
	shape : ITF_IC_shape9;
END_VAR
VAR_OUTPUT
	measured : INT;
END_VAR
measured := shape.Area();
END_FUNCTION_BLOCK
`,
    "square : FB_IC_square9; rect : FB_IC_rect9; shapeRef : ITF_IC_shape9; meter : FB_IC_meter9; total : INT;",
    "IF shapeRef = 0 THEN\n\tshapeRef := square;\nELSE\n\tshapeRef := rect;\nEND_IF\nmeter(shape := shapeRef);\ntotal := total + meter.measured;",
    2),
]
