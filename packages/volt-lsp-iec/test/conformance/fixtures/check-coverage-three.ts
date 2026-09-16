/**
 * More checks with no fixture (2026-09-16 — 41 of the 85 diagnostic codes were still never produced by any fixture
 * after `check-coverage-two.ts` took the first twelve).
 *
 * Same discipline: invalid code written to trigger one check, or a few that belong together, and what CODESYS says
 * about it recorded by `bun run record:language`. A POU nobody instantiates is dead code the IDE never compiles, so
 * every fixture here is instantiated in PLC_PRG by the helper.
 */
import type { LanguageTest } from "../types.js"

const doc = "conformance — checks with no fixture, second set"

function fb(name: string, pouName: string, feature: string, source: string): LanguageTest {
  return { name, pouName, kind: "function_block", feature, fromDoc: doc, source, plcPrgVar: `inst : ${pouName};`, plcPrgBody: "inst();" }
}

export const CHECK_COVERAGE_THREE_TESTS: readonly LanguageTest[] = [
  fb("cc3_reference_assign", "FB_C3_refs", "REF= with a target that is not a reference, and a write through a reference that was never bound",
    `FUNCTION_BLOCK FB_C3_refs
VAR
	plain : INT;
	other : INT;
	bound : REFERENCE TO INT;
END_VAR
plain REF= other;
bound REF= 7;
END_FUNCTION_BLOCK
`),

  fb("cc3_pointer_conversions", "FB_C3_pointers", "a pointer assigned something that is not an address, and a pointer indexed in more dimensions than one",
    `FUNCTION_BLOCK FB_C3_pointers
VAR
	value : INT := 3;
	p : POINTER TO INT;
	q : POINTER TO DINT;
	taken : INT;
END_VAR
p := value;
q := p;
taken := p[1, 2];
END_FUNCTION_BLOCK
`),

  fb("cc3_multiple_inheritance", "FB_C3_twoBases", "an FB naming two base classes",
    `FUNCTION_BLOCK FB_C3_baseOne
VAR
	one : INT;
END_VAR
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_C3_baseTwo
VAR
	two : INT;
END_VAR
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_C3_twoBases EXTENDS FB_C3_baseOne, FB_C3_baseTwo
VAR
	own : INT;
END_VAR
own := one + two;
END_FUNCTION_BLOCK
`),

  fb("cc3_interface_misuse", "FB_C3_itfMisuse", "IMPLEMENTS something that is not an interface, and an INTERFACE instantiated as a variable",
    `FUNCTION_BLOCK FB_C3_notAnInterface
VAR
	n : INT;
END_VAR
END_FUNCTION_BLOCK

INTERFACE ITF_C3_real
METHOD Run : INT
END_METHOD
END_INTERFACE

FUNCTION_BLOCK FB_C3_itfMisuse IMPLEMENTS FB_C3_notAnInterface
VAR
	held : ITF_C3_real;
	n : INT;
END_VAR
n := n + 1;
END_FUNCTION_BLOCK
`),

  fb("cc3_retain_and_var_config", "FB_C3_retain", "VAR_INPUT RETAIN and a VAR_CONFIG section where neither belongs",
    `FUNCTION_BLOCK FB_C3_retain
VAR_INPUT RETAIN
	kept : INT;
END_VAR
VAR_CONFIG
	misplaced : INT;
END_VAR
VAR
	n : INT;
END_VAR
n := kept;
END_FUNCTION_BLOCK
`),

  fb("cc3_input_defaults", "FB_C3_defaults", "a composite VAR_INPUT given a scalar default, and an enum initialised with something outside it",
    `TYPE DUT_C3_pair :
STRUCT
	x : INT;
	y : INT;
END_STRUCT
END_TYPE

TYPE DUT_C3_mode :
(
	Idle := 0,
	Busy := 1
) INT;
END_TYPE

FUNCTION_BLOCK FB_C3_taking
VAR_INPUT
	setup : DUT_C3_pair := 5;
	mode : DUT_C3_mode := 9;
END_VAR
VAR_OUTPUT
	seen : INT;
END_VAR
seen := setup.x;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_C3_defaults
VAR
	worker : FB_C3_taking;
	n : INT;
END_VAR
worker(seen => n);
END_FUNCTION_BLOCK
`),

  fb("cc3_bit_access_and_call_result", "FB_C3_access", "a bit taken from a call's result, and a member read off one",
    `TYPE DUT_C3_box :
STRUCT
	inner : INT;
END_STRUCT
END_TYPE

FUNCTION F_C3_flags : WORD
F_C3_flags := 16#0005;
END_FUNCTION

FUNCTION F_C3_box : DUT_C3_box
F_C3_box.inner := 4;
END_FUNCTION

FUNCTION_BLOCK FB_C3_access
VAR
	flagBit : BOOL;
	inner : INT;
END_VAR
flagBit := F_C3_flags().0;
inner := F_C3_box().inner;
END_FUNCTION_BLOCK
`),

  fb("cc3_unexpected_struct_init", "FB_C3_structInit", "a STRUCT variable given a scalar initial value, and a scalar given an aggregate one",
    `TYPE DUT_C3_point :
STRUCT
	x : INT;
	y : INT;
END_STRUCT
END_TYPE

FUNCTION_BLOCK FB_C3_structInit
VAR
	wrongWay : DUT_C3_point := 7;
	otherWay : INT := (x := 1, y := 2);
	n : INT;
END_VAR
n := wrongWay.x + otherWay;
END_FUNCTION_BLOCK
`),

  fb("cc3_empty_and_noop", "FB_C3_empty", "an IF with an empty THEN and an empty ELSE, and a statement that assigns a variable to itself",
    `FUNCTION_BLOCK FB_C3_empty
VAR
	n : INT;
	flag : BOOL;
END_VAR
IF flag THEN
ELSE
END_IF
WHILE flag DO
END_WHILE
n := n;
END_FUNCTION_BLOCK
`),
]
