/**
 * Cross-object combinations, batch three — chains.
 *
 * Batches one and two took pairs of features in separate objects. This one takes CHAINS: a VAR_IN_OUT handed from a
 * PROGRAM through an FB through a METHOD into a FUNCTION, an override calling another override through THIS^, a FUNCTION
 * calling a FUNCTION, an ACTION calling a METHOD calling an ACTION — plus the declaration shapes nothing pins yet: an
 * ALIAS type, a SUBRANGE, a bit reached through a struct field, a WSTRING, SEL/MUX over another object's values, and a
 * METHOD local shadowing an inherited field. Recorded like every other fixture: built and RUN in CODESYS SP21.
 */
import type { LanguageTest } from "../types.js"

const doc = "conformance — cross-object combinations, batch three"

function fb(name: string, pouName: string, feature: string, source: string, plcPrgVar: string, plcPrgBody: string, cycles?: number): LanguageTest {
  return { name, pouName, kind: "function_block", feature, fromDoc: doc, source, plcPrgVar, plcPrgBody, ...(cycles === undefined ? {} : { cycles }) }
}

export const CROSS_OBJECT_THREE_TESTS: readonly LanguageTest[] = [
  // ─── a VAR_IN_OUT four objects deep ─────────────────────────────────────────
  fb("xo3_inout_chain_four_deep", "FB_X3_outer", "one variable bound as VAR_IN_OUT from the PROGRAM through an FB, its METHOD and a FUNCTION, each level writing it",
    `TYPE DUT_X3_log :
STRUCT
	steps : INT;
	trail : DINT;
END_STRUCT
END_TYPE

FUNCTION F_X3_mark : BOOL
VAR_IN_OUT
	book : DUT_X3_log;
END_VAR
VAR_INPUT
	digit : DINT;
END_VAR
book.steps := book.steps + 1;
book.trail := book.trail * 10 + digit;
F_X3_mark := TRUE;
END_FUNCTION

FUNCTION_BLOCK FB_X3_inner
VAR_IN_OUT
	book : DUT_X3_log;
END_VAR
F_X3_mark(book := book, digit := 3);
Deeper();
END_FUNCTION_BLOCK

METHOD Deeper
F_X3_mark(book := book, digit := 4);
END_METHOD

FUNCTION_BLOCK FB_X3_outer
VAR_IN_OUT
	book : DUT_X3_log;
END_VAR
VAR
	nested : FB_X3_inner;
END_VAR
F_X3_mark(book := book, digit := 2);
nested(book := book);
END_FUNCTION_BLOCK
`,
    "inst : FB_X3_outer; ledger : DUT_X3_log;", "inst(book := ledger);", 2),

  // ─── an override reaching another override through THIS^ ────────────────────
  fb("xo3_override_calls_override", "FB_X3_child", "a base METHOD calling another METHOD through THIS^, both overridden in the derived FB, the base body run by SUPER^",
    `FUNCTION_BLOCK FB_X3_parent
VAR
	trail : DINT;
END_VAR
Outer();
END_FUNCTION_BLOCK

METHOD Outer
trail := trail * 10 + 1;
THIS^.Inner();
END_METHOD

METHOD Inner
trail := trail * 10 + 2;
END_METHOD

FUNCTION_BLOCK FB_X3_child EXTENDS FB_X3_parent
VAR
	ownRuns : INT;
END_VAR
SUPER^();
ownRuns := ownRuns + 1;
END_FUNCTION_BLOCK

METHOD Inner
trail := trail * 10 + 7;
END_METHOD
`,
    "inst : FB_X3_child;", "inst();"),

  // ─── a FUNCTION calling a FUNCTION in another object ────────────────────────
  fb("xo3_function_calls_function", "FB_X3_caller", "a FUNCTION whose body calls another FUNCTION in its own object, both reached from an FB",
    `FUNCTION F_X3_double : INT
VAR_INPUT
	value : INT;
END_VAR
F_X3_double := value * 2;
END_FUNCTION

FUNCTION F_X3_quadruple : INT
VAR_INPUT
	value : INT;
END_VAR
F_X3_quadruple := F_X3_double(value := F_X3_double(value := value));
END_FUNCTION

FUNCTION_BLOCK FB_X3_caller
VAR
	four : INT;
	sixteen : INT;
END_VAR
four := F_X3_quadruple(value := 1);
sixteen := F_X3_quadruple(value := four);
END_FUNCTION_BLOCK
`,
    "inst : FB_X3_caller;", "inst();"),

  // ─── an ACTION calling a METHOD calling an ACTION ───────────────────────────
  fb("xo3_action_method_action", "FB_X3_ring", "an ACTION calling a METHOD which calls another ACTION, all on one instance reached from another object",
    `FUNCTION_BLOCK FB_X3_ring
VAR
	trail : DINT;
	depth : INT;
END_VAR
First();
END_FUNCTION_BLOCK

ACTION First
trail := trail * 10 + 1;
Middle();
END_ACTION

METHOD Middle
trail := trail * 10 + 2;
Last();
END_METHOD

ACTION Last
trail := trail * 10 + 3;
depth := depth + 1;
END_ACTION
`,
    "inst : FB_X3_ring;", "inst();\ninst.First();", 2),

  // ─── an ALIAS type and a SUBRANGE declared in their own objects ─────────────
  {
    name: "xo3_alias_type",
    pouName: "DUT_X3_counter",
    kind: "dut",
    feature: "an ALIAS type with its own initial value, in its own object",
    fromDoc: doc,
    source: `TYPE DUT_X3_counter : UDINT := 100;
END_TYPE
`,
  },
  fb("xo3_alias_across_objects", "FB_X3_aliasUser", "an ALIAS type from another object: its initial value, arithmetic on it, and a conversion",
    `FUNCTION F_X3_bump : DUT_X3_counter
VAR_IN_OUT
	tally : DUT_X3_counter;
END_VAR
tally := tally + 5;
F_X3_bump := tally;
END_FUNCTION

FUNCTION_BLOCK FB_X3_aliasUser
VAR
	mine : DUT_X3_counter;
	returned : DUT_X3_counter;
	asInt : INT;
END_VAR
returned := F_X3_bump(tally := mine);
asInt := UDINT_TO_INT(mine);
END_FUNCTION_BLOCK
`,
    "inst : FB_X3_aliasUser;", "inst();", 2),

  // ─── a bit reached through a struct field of another object ────────────────
  fb("xo3_bit_through_struct", "FB_X3_flags", "bit access on a WORD held in a STRUCT from another object, read and written, beside a whole-word read",
    `TYPE DUT_X3_status :
STRUCT
	bits : WORD;
	spare : INT;
END_STRUCT
END_TYPE

FUNCTION_BLOCK FB_X3_flags
VAR
	state : DUT_X3_status;
	third : BOOL;
	whole : WORD;
	negative : INT := -1;
	top : BOOL;
END_VAR
state.bits := 16#0005;
state.bits.1 := TRUE;
third := state.bits.2;
whole := state.bits;
top := negative.15;
END_FUNCTION_BLOCK
`,
    "inst : FB_X3_flags;", "inst();"),

  // ─── SEL / MUX / LIMIT over values from another object ─────────────────────
  {
    name: "xo3_limits_gvl",
    pouName: "GVL_X3_limits",
    kind: "gvl",
    feature: "a GVL of CONSTANT bounds, in its own object",
    fromDoc: doc,
    source: `VAR_GLOBAL CONSTANT
	gLow : INT := 10;
	gHigh : INT := 20;
	gChoices : INT := 3;
END_VAR
`,
    plcPrgVar: "seen : INT;",
    plcPrgBody: "seen := GVL_X3_limits.gHigh;",
  },
  fb("xo3_value_functions_across_objects", "FB_X3_chooser", "SEL, MUX, LIMIT, MIN and MAX over CONSTANT bounds declared in a GVL of another object",
    `FUNCTION_BLOCK FB_X3_chooser
VAR_EXTERNAL CONSTANT
	gLow : INT;
	gHigh : INT;
	gChoices : INT;
END_VAR
VAR_INPUT
	raw : INT;
	flag : BOOL;
END_VAR
VAR_OUTPUT
	clamped : INT;
	picked : INT;
	chosen : INT;
	smallest : INT;
	largest : INT;
END_VAR
clamped := LIMIT(gLow, raw, gHigh);
picked := SEL(flag, gLow, gHigh);
chosen := MUX(gChoices, 0, 1, 2, 3, 4);
smallest := MIN(raw, gLow);
largest := MAX(raw, gHigh);
END_FUNCTION_BLOCK
`,
    "inst : FB_X3_chooser; lowClamp : INT; highClamp : INT; pickedLow : INT; muxed : INT; small : INT; large : INT;",
    "inst(raw := 5, flag := FALSE, clamped => lowClamp, picked => pickedLow, chosen => muxed, smallest => small, largest => large);\ninst(raw := 99, flag := TRUE, clamped => highClamp);"),

  // ─── a WSTRING built and measured across objects ───────────────────────────
  fb("xo3_wstring_across_objects", "FB_X3_wide", "a WSTRING field of a STRUCT from another object, compared and converted by its caller",
    `TYPE DUT_X3_wide :
STRUCT
	text : WSTRING(10);
	mark : WSTRING(2);
END_STRUCT
END_TYPE

FUNCTION_BLOCK FB_X3_wide
VAR
	held : DUT_X3_wide;
	same : BOOL;
	units : INT;
	narrow : STRING(10);
END_VAR
held.text := "abcd";
held.mark := "xy";
same := held.mark = "xy";
narrow := WSTRING_TO_STRING(held.text);
units := LEN(narrow);
END_FUNCTION_BLOCK
`,
    "inst : FB_X3_wide;", "inst();"),

  // The conversion itself, both ways and past each capacity — what `WSTRING_TO_STRING` and `STRING_TO_WSTRING` do when
  // the text does not fit. Recorded before either is built.
  fb("xo3_string_wide_conversions", "FB_X3_convert", "WSTRING_TO_STRING and STRING_TO_WSTRING, each into a target too short for the text",
    `FUNCTION_BLOCK FB_X3_convert
VAR
	wide : WSTRING(10) := "abcdefghij";
	narrow : STRING(4);
	back : WSTRING(3);
	roomy : STRING(20);
	short : STRING(6) := 'hello';
	widened : WSTRING(2);
	sameText : BOOL;
	narrowLen : INT;
END_VAR
narrow := WSTRING_TO_STRING(wide);
roomy := WSTRING_TO_STRING(wide);
back := STRING_TO_WSTRING(roomy);
widened := STRING_TO_WSTRING(short);
sameText := roomy = 'abcdefghij';
narrowLen := LEN(narrow);
END_FUNCTION_BLOCK
`,
    "inst : FB_X3_convert;", "inst();"),

  // ─── a METHOD local shadowing an inherited field ───────────────────────────
  fb("xo3_method_local_shadows_field", "FB_X3_shadowDerived", "a METHOD's own VAR with the same name as a field it inherits — which one each statement writes",
    `FUNCTION_BLOCK FB_X3_shadowBase
VAR
	amount : INT := 7;
	baseSeen : INT;
END_VAR
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_X3_shadowDerived EXTENDS FB_X3_shadowBase
VAR
	afterCall : INT;
	returned : INT;
END_VAR
returned := Hide();
afterCall := amount;
END_FUNCTION_BLOCK

METHOD Hide : INT
VAR
	amount : INT := 100;
END_VAR
amount := amount + 1;
THIS^.amount := THIS^.amount + 1;
baseSeen := THIS^.amount;
Hide := amount;
END_METHOD
`,
    "inst : FB_X3_shadowDerived;", "inst();", 2),

  // ─── an interface as an FB's input, handed on to another object ────────────
  fb("xo3_interface_input_passed_on", "FB_X3_front", "an interface-typed VAR_INPUT kept by one FB and handed on to another object's input, both calling through it",
    `INTERFACE ITF_X3_sink
METHOD Take : INT
VAR_INPUT
	item : INT;
END_VAR
END_METHOD
END_INTERFACE

FUNCTION_BLOCK FB_X3_bin IMPLEMENTS ITF_X3_sink
VAR
	held : INT;
	takes : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD Take : INT
VAR_INPUT
	item : INT;
END_VAR
takes := takes + 1;
held := held + item;
Take := held;
END_METHOD

FUNCTION_BLOCK FB_X3_back
VAR_INPUT
	target : ITF_X3_sink;
END_VAR
VAR_OUTPUT
	lastSeen : INT;
END_VAR
lastSeen := target.Take(item := 5);
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_X3_front
VAR_INPUT
	target : ITF_X3_sink;
END_VAR
VAR
	tail : FB_X3_back;
	fromFront : INT;
	fromBack : INT;
END_VAR
fromFront := target.Take(item := 2);
tail(target := target, lastSeen => fromBack);
END_FUNCTION_BLOCK
`,
    "bin : FB_X3_bin; front : FB_X3_front;", "front(target := bin);", 2),

  // ─── a struct initialized field by field, used as an input default ─────────
  fb("xo3_struct_default_as_input", "FB_X3_defaults", "a STRUCT with per-field initial values from another object, used as an FB's VAR_INPUT default and overridden at one call",
    `TYPE DUT_X3_config :
STRUCT
	speed : INT := 30;
	retries : INT := 2;
	tag : STRING(4) := 'cfg';
END_STRUCT
END_TYPE

FUNCTION_BLOCK FB_X3_worker
VAR_INPUT
	setup : DUT_X3_config;
END_VAR
VAR_OUTPUT
	effort : INT;
END_VAR
effort := setup.speed * setup.retries;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_X3_defaults
VAR
	plain : FB_X3_worker;
	tuned : FB_X3_worker;
	custom : DUT_X3_config := (speed := 4);
	fromDefault : INT;
	fromCustom : INT;
END_VAR
plain(effort => fromDefault);
tuned(setup := custom, effort => fromCustom);
END_FUNCTION_BLOCK
`,
    "inst : FB_X3_defaults;", "inst();"),
]
