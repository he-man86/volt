/**
 * Checks with no fixture, fourth set — the remaining 30, written against what each check actually looks for rather than
 * at what its name suggests (reading the check first is how `cc4` avoided three more fixtures that measured nothing).
 *
 * One rule per fixture wherever the IDE would otherwise stop at the first parse error, which is what made the earlier
 * combined fixtures measure the stop instead of the rule.
 */
import type { LanguageTest } from "../../types.js"

const doc = "conformance — checks with no fixture, fourth set"

function fb(name: string, pouName: string, feature: string, source: string): LanguageTest {
  return { name, pouName, kind: "function_block", feature, fromDoc: doc, source, plcPrgVar: `inst : ${pouName};`, plcPrgBody: "inst();" }
}

export const CHECK_COVERAGE_FIVE_TESTS: readonly LanguageTest[] = [
  fb("cc5_abstract_assign_and_output", "FB_C5_abstractUse", "a value assignment whose target is an ABSTRACT FB, and a VAR_OUTPUT given a default in an abstract METHOD",
    `FUNCTION_BLOCK ABSTRACT FB_C5_shape
VAR
	n : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD ABSTRACT Area : INT
VAR_OUTPUT
	extra : INT := 7;
END_VAR
END_METHOD

FUNCTION_BLOCK FB_C5_abstractUse
VAR
	one : FB_C5_shape;
	two : FB_C5_shape;
END_VAR
one := two;
END_FUNCTION_BLOCK
`),

  fb("cc5_new_in_expression", "FB_C5_alloc", "__NEW inside another expression, and __NEW on the right of a chained assignment",
    `FUNCTION_BLOCK FB_C5_alloc
VAR
	p : POINTER TO INT;
	q : POINTER TO INT;
	ok : BOOL;
END_VAR
IF (p := __NEW(INT)) = 0 THEN
	ok := FALSE;
END_IF
q := p := __NEW(INT);
END_FUNCTION_BLOCK
`),

  fb("cc5_no_op_statement", "FB_C5_noop", "an expression statement with no side effect — a bare name, a member and an index",
    `TYPE DUT_C5_pair :
STRUCT
	x : INT;
	y : INT;
END_STRUCT
END_TYPE

FUNCTION_BLOCK FB_C5_noop
VAR
	n : INT;
	pair : DUT_C5_pair;
	list : ARRAY[1..2] OF INT;
END_VAR
n;
pair.x;
list[1];
END_FUNCTION_BLOCK
`),

  fb("cc5_deprecated_functionblock_keyword", "FB_C5_oldKeyword", "the obsolete FUNCTIONBLOCK spelling, with no underscore",
    `FUNCTIONBLOCK FB_C5_oldKeyword
VAR
	n : INT;
END_VAR
n := n + 1;
END_FUNCTION_BLOCK
`),

  fb("cc5_fb_init_inout", "FB_C5_initInout", "an inline FB-instance initializer that assigns a VAR_IN_OUT",
    `FUNCTION_BLOCK FB_C5_bound
VAR_INPUT
	amount : INT;
END_VAR
VAR_IN_OUT
	target : INT;
END_VAR
target := target + amount;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_C5_initInout
VAR
	own : INT;
	worker : FB_C5_bound := (target := own);
END_VAR
worker(amount := 1, target := own);
END_FUNCTION_BLOCK
`),

  fb("cc5_inout_external_access", "FB_C5_outsideInout", "an FB's VAR_IN_OUT read and written from OUTSIDE the FB",
    `FUNCTION_BLOCK FB_C5_holder
VAR_IN_OUT
	shared : INT;
END_VAR
shared := shared + 1;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_C5_outsideInout
VAR
	worker : FB_C5_holder;
	own : INT;
	seen : INT;
END_VAR
worker(shared := own);
seen := worker.shared;
worker.shared := 3;
END_FUNCTION_BLOCK
`),

  fb("cc5_enum_init_not_convertible", "FB_C5_enumInit", "an enumeration member initialised with a REAL literal",
    `TYPE DUT_C5_odd :
(
	Low := 1,
	Middle := 2.5,
	High := 4
) INT;
END_TYPE

FUNCTION_BLOCK FB_C5_enumInit
VAR
	mode : DUT_C5_odd;
END_VAR
mode := DUT_C5_odd.High;
END_FUNCTION_BLOCK
`),

  fb("cc5_input_default_composite", "FB_C5_arrayDefault", "an ARRAY-typed VAR_INPUT given a default value",
    `FUNCTION_BLOCK FB_C5_taking
VAR_INPUT
	values : ARRAY[1..3] OF INT := [1, 2, 3];
END_VAR
VAR_OUTPUT
	first : INT;
END_VAR
first := values[1];
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_C5_arrayDefault
VAR
	worker : FB_C5_taking;
	n : INT;
END_VAR
worker(first => n);
END_FUNCTION_BLOCK
`),

  fb("cc5_non_instantiable", "FB_C5_functionType", "a variable declared with a FUNCTION's name as its type",
    `FUNCTION F_C5_plain : INT
VAR_INPUT
	value : INT;
END_VAR
F_C5_plain := value;
END_FUNCTION

FUNCTION_BLOCK FB_C5_functionType
VAR
	cannot : F_C5_plain;
	n : INT;
END_VAR
n := 1;
END_FUNCTION_BLOCK
`),

  fb("cc5_at_address_not_direct", "FB_C5_badAt", "an AT clause whose operand is not a direct address",
    `FUNCTION_BLOCK FB_C5_badAt
VAR
	misplaced AT ABC : INT;
	n : INT;
END_VAR
n := misplaced;
END_FUNCTION_BLOCK
`),

  // `USING` is left out on purpose: CODESYS soft-allows it too (measured — it warns like CHAR and WCHAR), but Volt's
  // parser treats it as a HARD keyword, which `reserved-keyword`'s own doc already records. Including it here would
  // measure that parse error rather than the warning.
  fb("cc5_reserved_keyword_names", "FB_C5_softKeywords", "CHAR and WCHAR as declared names — the keywords CODESYS soft-allows",
    `FUNCTION_BLOCK FB_C5_softKeywords
VAR
	CHAR : INT;
	WCHAR : INT;
	n : INT;
END_VAR
n := CHAR + WCHAR;
END_FUNCTION_BLOCK
`),

  fb("cc5_pointer_not_convertible", "FB_C5_pointerToInt", "a pointer assigned to a plain integer target",
    `FUNCTION_BLOCK FB_C5_pointerToInt
VAR
	held : INT := 4;
	p : POINTER TO INT;
	asDword : DWORD;
END_VAR
p := ADR(held);
asDword := p;
END_FUNCTION_BLOCK
`),

  fb("cc5_type_invoked_directly", "FB_C5_typeCall", "an FB and an INTERFACE invoked by their TYPE name instead of an instance",
    `INTERFACE ITF_C5_runnable
METHOD Run : INT
END_METHOD
END_INTERFACE

FUNCTION_BLOCK FB_C5_callable
VAR
	n : INT;
END_VAR
n := n + 1;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_C5_typeCall
VAR
	n : INT;
END_VAR
FB_C5_callable();
ITF_C5_runnable();
n := 1;
END_FUNCTION_BLOCK
`),

  fb("cc5_in_out_type_mismatch", "FB_C5_wrongInOut", "a VAR_IN_OUT bound to a variable of another type",
    `FUNCTION_BLOCK FB_C5_wantsInt
VAR_IN_OUT
	target : INT;
END_VAR
target := target + 1;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_C5_wrongInOut
VAR
	worker : FB_C5_wantsInt;
	wrongType : REAL;
END_VAR
worker(target := wrongType);
END_FUNCTION_BLOCK
`),

  fb("cc5_invalid_call_target", "FB_C5_callPlain", "a plain variable invoked as if it were callable",
    `FUNCTION_BLOCK FB_C5_callPlain
VAR
	plain : INT;
	n : INT;
END_VAR
plain();
n := 1;
END_FUNCTION_BLOCK
`),
]
