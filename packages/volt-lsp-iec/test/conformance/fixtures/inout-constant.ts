/**
 * VAR_IN_OUT CONSTANT — what may be bound to a read-only in-out, recorded BEFORE the transpiler models it (design §23: a
 * `&` borrow, a literal a borrow of a temporary). No fixture, recording or corpus project held one. One question each, so a
 * form CODESYS rejects cannot hide the others: a literal, a constant and a variable bound; an expression; a STRING literal;
 * a literal bound to an FB's; and the two that should not compile — a literal bound to a plain VAR_IN_OUT, and a write to
 * a VAR_IN_OUT CONSTANT inside the callee.
 */
import type { LanguageTest } from "../types.js"

const doc = "transpile-st-to-rust review 2026-09-15 — VAR_IN_OUT CONSTANT"

function fb(name: string, pouName: string, feature: string, source: string): LanguageTest {
  const instance = `user_${name.split("_").at(-1)}`
  return { name, pouName, kind: "function_block", feature, fromDoc: doc, source, plcPrgVar: `${instance} : ${pouName};`, plcPrgBody: `${instance}();` }
}

export const INOUT_CONSTANT_TESTS: readonly LanguageTest[] = [
  fb("inout_const_bound_forms_1", "FB_IOC_user1", "VAR_IN_OUT CONSTANT bound to a literal, to a VAR CONSTANT and to a variable",
    `FUNCTION F_IOC_twice1 : INT
VAR_IN_OUT CONSTANT
	value : INT;
END_VAR
F_IOC_twice1 := value * 2;
END_FUNCTION

FUNCTION_BLOCK FB_IOC_user1
VAR CONSTANT
	seven : INT := 7;
END_VAR
VAR
	plainVar : INT := 3;
	fromLiteral : INT;
	fromConstant : INT;
	fromVariable : INT;
END_VAR
fromLiteral := F_IOC_twice1(value := 5);
fromConstant := F_IOC_twice1(value := seven);
fromVariable := F_IOC_twice1(value := plainVar);
END_FUNCTION_BLOCK
`),
  fb("inout_const_expression_2", "FB_IOC_user2", "VAR_IN_OUT CONSTANT bound to an expression",
    `FUNCTION F_IOC_twice2 : INT
VAR_IN_OUT CONSTANT
	value : INT;
END_VAR
F_IOC_twice2 := value * 2;
END_FUNCTION

FUNCTION_BLOCK FB_IOC_user2
VAR
	plainVar : INT := 3;
	fromExpression : INT;
END_VAR
fromExpression := F_IOC_twice2(value := plainVar + 1);
END_FUNCTION_BLOCK
`),
  fb("inout_const_string_literal_3", "FB_IOC_user3", "VAR_IN_OUT CONSTANT STRING bound to string literals",
    `FUNCTION F_IOC_matches3 : BOOL
VAR_IN_OUT CONSTANT
	text : STRING;
END_VAR
F_IOC_matches3 := text = 'abc';
END_FUNCTION

FUNCTION_BLOCK FB_IOC_user3
VAR
	matching : BOOL;
	different : BOOL;
END_VAR
matching := F_IOC_matches3(text := 'abc');
different := F_IOC_matches3(text := 'xyz');
END_FUNCTION_BLOCK
`),
  fb("inout_plain_literal_4", "FB_IOC_user4", "a literal bound to a plain VAR_IN_OUT — expected not to compile",
    `FUNCTION F_IOC_plain4 : INT
VAR_IN_OUT
	value : INT;
END_VAR
F_IOC_plain4 := value * 2;
END_FUNCTION

FUNCTION_BLOCK FB_IOC_user4
VAR
	fromLiteral : INT;
END_VAR
fromLiteral := F_IOC_plain4(value := 5);
END_FUNCTION_BLOCK
`),
  fb("inout_const_write_5", "FB_IOC_user5", "a write to a VAR_IN_OUT CONSTANT inside the callee — expected not to compile",
    `FUNCTION F_IOC_write5 : INT
VAR_IN_OUT CONSTANT
	value : INT;
END_VAR
value := 1;
F_IOC_write5 := value;
END_FUNCTION

FUNCTION_BLOCK FB_IOC_user5
VAR
	plainVar : INT := 3;
	result : INT;
END_VAR
result := F_IOC_write5(value := plainVar);
END_FUNCTION_BLOCK
`),
  fb("inout_const_fb_literal_6", "FB_IOC_user6", "an FB's VAR_IN_OUT CONSTANT bound to a literal, read through its output",
    `FUNCTION_BLOCK FB_IOC_holder6
VAR_IN_OUT CONSTANT
	threshold : INT;
END_VAR
VAR_OUTPUT
	doubled : INT;
END_VAR
doubled := threshold * 2;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_IOC_user6
VAR
	holder : FB_IOC_holder6;
	got : INT;
END_VAR
holder(threshold := 4);
got := holder.doubled;
END_FUNCTION_BLOCK
`),
  // Recorded answers above: a literal INT, a VAR CONSTANT and an expression are all refused ("needs variable as input"),
  // a STRING literal builds, a write inside is refused. The FB case first named its in-out `limit` — LIMIT is a reserved
  // standard function, so its syntax error answered nothing about the section; renamed and re-recorded.
  // Whether a variable alone binds was hidden by the literal in the same case — asked apart here, with a STRING constant
  // and a METHOD's.
  fb("inout_const_variable_7", "FB_IOC_user7", "VAR_IN_OUT CONSTANT bound to an INT variable, and nothing else",
    `FUNCTION F_IOC_twice7 : INT
VAR_IN_OUT CONSTANT
	value : INT;
END_VAR
F_IOC_twice7 := value * 2;
END_FUNCTION

FUNCTION_BLOCK FB_IOC_user7
VAR
	plainVar : INT := 3;
	fromVariable : INT;
END_VAR
fromVariable := F_IOC_twice7(value := plainVar);
plainVar := plainVar + 1;
END_FUNCTION_BLOCK
`),
  fb("inout_const_string_constant_8", "FB_IOC_user8", "VAR_IN_OUT CONSTANT STRING bound to a STRING VAR CONSTANT",
    `FUNCTION F_IOC_matches8 : BOOL
VAR_IN_OUT CONSTANT
	text : STRING;
END_VAR
F_IOC_matches8 := text = 'abc';
END_FUNCTION

FUNCTION_BLOCK FB_IOC_user8
VAR CONSTANT
	fixedText : STRING := 'abc';
END_VAR
VAR
	matching : BOOL;
END_VAR
matching := F_IOC_matches8(text := fixedText);
END_FUNCTION_BLOCK
`),
  fb("inout_const_method_9", "FB_IOC_user9", "a METHOD's VAR_IN_OUT CONSTANT bound to a variable and to a string literal",
    `FUNCTION_BLOCK FB_IOC_user9
VAR
	plainVar : INT := 4;
	fromMethod : INT;
	textMatches : BOOL;
END_VAR
fromMethod := Twice(value := plainVar);
textMatches := Matches(text := 'abc');
END_FUNCTION_BLOCK

METHOD Twice : INT
VAR_IN_OUT CONSTANT
	value : INT;
END_VAR
Twice := value * 2;
END_METHOD

METHOD Matches : BOOL
VAR_IN_OUT CONSTANT
	text : STRING;
END_VAR
Matches := text = 'abc';
END_METHOD
`),
  // The batch's review found forms no recording answered: an FB call binding a variable and a STRING literal (only an FB's
  // INT literal was recorded, and it does not compile), the address of the in-out, and an FB instance lent read-only —
  // its METHOD and output read, and the instance called.
  fb("inout_const_fb_variable_10", "FB_IOC_user10", "an FB's VAR_IN_OUT CONSTANT bound to a variable and a STRING one to a literal, through the FB call",
    `FUNCTION_BLOCK FB_IOC_holder10
VAR_IN_OUT CONSTANT
	threshold : INT;
	label : STRING;
END_VAR
VAR_OUTPUT
	doubled : INT;
	labelMatches : BOOL;
END_VAR
doubled := threshold * 2;
labelMatches := label = 'abc';
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_IOC_user10
VAR
	holder : FB_IOC_holder10;
	plainVar : INT := 5;
	got : INT;
	matched : BOOL;
END_VAR
holder(threshold := plainVar, label := 'abc');
got := holder.doubled;
matched := holder.labelMatches;
END_FUNCTION_BLOCK
`),
  fb("inout_const_adr_11", "FB_IOC_user11", "the address of a VAR_IN_OUT CONSTANT taken, and read through",
    `FUNCTION F_IOC_viaPointer11 : INT
VAR_IN_OUT CONSTANT
	value : INT;
END_VAR
VAR
	pointerToValue : POINTER TO INT;
END_VAR
pointerToValue := ADR(value);
F_IOC_viaPointer11 := pointerToValue^;
END_FUNCTION

FUNCTION_BLOCK FB_IOC_user11
VAR
	plainVar : INT := 9;
	got : INT;
END_VAR
got := F_IOC_viaPointer11(value := plainVar);
END_FUNCTION_BLOCK
`),
  fb("inout_const_fb_method_12", "FB_IOC_user12", "an FB instance lent as VAR_IN_OUT CONSTANT: its METHOD called and its output read",
    `FUNCTION_BLOCK FB_IOC_counter12
VAR
	count : INT := 3;
END_VAR
VAR_OUTPUT
	shown : INT := 7;
END_VAR
END_FUNCTION_BLOCK

METHOD Peek : INT
Peek := count;
END_METHOD

FUNCTION F_IOC_peek12 : INT
VAR_IN_OUT CONSTANT
	lentCounter : FB_IOC_counter12;
END_VAR
F_IOC_peek12 := lentCounter.Peek() + lentCounter.shown;
END_FUNCTION

FUNCTION_BLOCK FB_IOC_user12
VAR
	counter : FB_IOC_counter12;
	got : INT;
END_VAR
got := F_IOC_peek12(lentCounter := counter);
END_FUNCTION_BLOCK
`),
  fb("inout_const_fb_call_13", "FB_IOC_user13", "an FB instance lent as VAR_IN_OUT CONSTANT, called",
    `FUNCTION_BLOCK FB_IOC_counter13
VAR_OUTPUT
	calls : INT;
END_VAR
calls := calls + 1;
END_FUNCTION_BLOCK

FUNCTION F_IOC_call13 : INT
VAR_IN_OUT CONSTANT
	lentCounter : FB_IOC_counter13;
END_VAR
lentCounter();
F_IOC_call13 := lentCounter.calls;
END_FUNCTION

FUNCTION_BLOCK FB_IOC_user13
VAR
	counter : FB_IOC_counter13;
	got : INT;
END_VAR
got := F_IOC_call13(lentCounter := counter);
END_FUNCTION_BLOCK
`),
]
