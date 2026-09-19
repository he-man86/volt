/**
 * The last checks with no fixture — written after reading each check's CONDITION, which is what the earlier attempts
 * got wrong: a composite input default is only a FUNCTION's, RETAIN and an attribute misplacement are only a FUNCTION's
 * or METHOD's, a property read must be `inst.P` and not a bare name, and a loop that cannot exit is one whose control
 * variable's RANGE cannot reach the limit.
 *
 * `ambiguous-global` needs TWO GVLs declaring one name, which needs two fixtures: the check counts distinct URIs, and a
 * fixture is one file. The name is unique to this pair — the first attempt reused `gShared`, which `var_external_gvl`
 * already declares, and `var_external_consumer` silently started reading 1 where it had always read 100.
 */
import type { LanguageTest } from "../../types.js"

const doc = "conformance — checks with no fixture, last set"

/**
 * Five of the 85 codes still have no fixture, and each is here because the HARNESS cannot reach it, not because nobody
 * tried (measured 2026-09-16):
 *   `ambiguous-global`      — see the fixture below.
 *   `function-implements`, `interface-implements`, `return-type-not-allowed` — CODESYS's PARSER refuses the syntax
 *                             outright ("Unexpected token 'IMPLEMENTS' found"), so the recording is parse noise and
 *                             no fixture can isolate the semantic check. They may only be reachable on TwinCAT.
 *   `obsolete-usage`        — it reads `ctx.references.obsoletePous`, which the workspace SCAN fills from disk; the
 *                             replay resolves no workspace refs, so the check cannot fire there whatever the fixture
 *                             says. Reaching it needs the replay to carry a scanned reference set.
 */

function fb(name: string, pouName: string, feature: string, source: string): LanguageTest {
  return { name, pouName, kind: "function_block", feature, fromDoc: doc, source, plcPrgVar: `inst : ${pouName};`, plcPrgBody: "inst();" }
}

export const CHECK_COVERAGE_SIX_TESTS: readonly LanguageTest[] = [
  {
    name: "cc6_ambiguous_gvl_one",
    plcPrgVar: "gvlFirst : INT;",
    plcPrgBody: "gvlFirst := GVL_C6_first.gTwiceDeclared;",
    pouName: "GVL_C6_first",
    kind: "gvl",
    feature: "the first of two GVLs declaring one name",
    fromDoc: doc,
    source: `VAR_GLOBAL
	gTwiceDeclared : INT := 11;
END_VAR
`,
  },
  {
    name: "cc6_ambiguous_gvl_two",
    plcPrgVar: "gvlSecond : INT;",
    plcPrgBody: "gvlSecond := GVL_C6_second.gTwiceDeclared;",
    pouName: "GVL_C6_second",
    kind: "gvl",
    feature: "the second of two GVLs declaring one name",
    fromDoc: doc,
    source: `VAR_GLOBAL
	gTwiceDeclared : INT := 22;
END_VAR
`,
  },
  // `ambiguous-global` (C0136) has no fixture, and the two attempts say why. WITH a VAR_EXTERNAL the LSP resolves the
  // name to that declaration, so the ambiguity is shadowed and the check never looks; WITHOUT one CODESYS does not
  // compile the reference at all ("Identifier 'gTwiceDeclared' not defined" — a bare global needs the import). The
  // check may only be reachable in a project whose globals resolve bare, which this harness cannot build.
  fb("cc6_ambiguous_global", "FB_C6_ambiguous", "two GVLs declaring one name, imported with VAR_EXTERNAL",
    `FUNCTION_BLOCK FB_C6_ambiguous
VAR_EXTERNAL
	gTwiceDeclared : INT;
END_VAR
VAR
	n : INT;
END_VAR
n := gTwiceDeclared;
END_FUNCTION_BLOCK
`),

  fb("cc6_function_input_array_default", "FB_C6_arrayDefault", "an ARRAY-typed VAR_INPUT of a FUNCTION given a default — which only a FUNCTION forbids",
    `FUNCTION F_C6_taking : INT
VAR_INPUT
	values : ARRAY[1..3] OF INT := [1, 2, 3];
END_VAR
F_C6_taking := values[1];
END_FUNCTION

FUNCTION_BLOCK FB_C6_arrayDefault
VAR
	list : ARRAY[1..3] OF INT := [4, 5, 6];
	n : INT;
END_VAR
n := F_C6_taking(values := list);
END_FUNCTION_BLOCK
`),

  {
    ...fb("cc6_loop_cannot_exit", "FB_C6_endless", "a FOR whose control variable's RANGE cannot reach the limit",
    `FUNCTION_BLOCK FB_C6_endless
VAR
	small : SINT;
	n : INT;
END_VAR
FOR small := 1 TO 200 BY 1 DO
	n := n + 1;
END_FOR
END_FUNCTION_BLOCK
`),
    execSkip:
      "a loop that cannot exit never completes its scan, so the done flag the recorder waits on cannot rise — the fixture working as designed",
  },

  fb("cc6_property_lacks_getter", "FB_C6_setOnlyUser", "a SET-only PROPERTY read through an instance",
    `FUNCTION_BLOCK FB_C6_setOnly
VAR
	stored : INT;
END_VAR
END_FUNCTION_BLOCK

PROPERTY Level : INT
SET
stored := Level;
END_SET
END_PROPERTY

FUNCTION_BLOCK FB_C6_setOnlyUser
VAR
	dial : FB_C6_setOnly;
	seen : INT;
END_VAR
dial.Level := 4;
seen := dial.Level;
END_FUNCTION_BLOCK
`),

  fb("cc6_retain_in_method", "FB_C6_retainMethod", "VAR RETAIN and VAR PERSISTENT in a METHOD, where neither belongs",
    `FUNCTION_BLOCK FB_C6_retainMethod
VAR
	n : INT;
END_VAR
n := Counted();
END_FUNCTION_BLOCK

METHOD Counted : INT
VAR RETAIN
	kept : INT;
END_VAR
VAR PERSISTENT
	stuck : INT;
END_VAR
kept := kept + 1;
stuck := stuck + 1;
Counted := kept + stuck;
END_METHOD
`),

  fb("cc6_attribute_on_method", "FB_C6_attrPlacement", "{attribute 'pack_mode'} on a METHOD, where only a STRUCT takes it",
    `FUNCTION_BLOCK FB_C6_attrPlacement
VAR
	n : INT;
END_VAR
n := Sized();
END_FUNCTION_BLOCK

{attribute 'pack_mode' := '1'}
METHOD Sized : INT
Sized := 1;
END_METHOD
`),

  // C0051 is about the `hasattribute` CONDITIONAL-COMPILE operand, not an `{attribute …}` value — reading the check
  // is what corrected this; the first attempt wrote `{attribute 'symbol' := readwrite}`, which is a different rule.
  fb("cc6_attribute_value_unquoted", "FB_C6_unquoted", "a `hasattribute` operand that is a bare identifier where a quoted string belongs",
    `FUNCTION_BLOCK FB_C6_unquoted
VAR
	shown : INT;
	n : INT;
END_VAR
{IF hasattribute (pou: FB_C6_unquoted, myAttribute)}
n := shown;
{END_IF}
n := n + 1;
END_FUNCTION_BLOCK
`),

  {
    name: "cc6_callable_gvl",
    plcPrgVar: "gvlInside : INT;",
    plcPrgBody: "gvlInside := GVL_C6_called.gInside;",
    pouName: "GVL_C6_called",
    kind: "gvl",
    feature: "the GVL a caller tries to invoke",
    fromDoc: doc,
    source: `VAR_GLOBAL
	gInside : INT := 5;
END_VAR
`,
  },
  fb("cc6_call_a_gvl", "FB_C6_callsGvl", "a GVL block invoked as if it were callable",
    `FUNCTION_BLOCK FB_C6_callsGvl
VAR_EXTERNAL
	gInside : INT;
END_VAR
VAR
	n : INT;
END_VAR
GVL_C6_called();
n := gInside;
END_FUNCTION_BLOCK
`),

  fb("cc6_reference_assign_constant", "FB_C6_refConstant", "REF= whose right side is a named CONSTANT",
    `FUNCTION_BLOCK FB_C6_refConstant
VAR CONSTANT
	cFixed : INT := 9;
END_VAR
VAR
	bound : REFERENCE TO INT;
	n : INT;
END_VAR
bound REF= cFixed;
n := 1;
END_FUNCTION_BLOCK
`),

  // The catalog marks C0141 `implemented` and asserts the CODESYS DOCUMENTATION's wording — "Reference assign
  // needs variable with write access" — for a repro whose right side is a LITERAL. That message IS measured, but
  // on `cc6_reference_assign_constant` above, where the right side is a named CONSTANT. Those are different
  // shapes and a doc string is a lead, not a measurement. This asks the compiler which one it is.
  fb("cc6_reference_assign_literal", "FB_C6_refLiteral", "REF= whose right side is a LITERAL, not a named constant",
    `FUNCTION_BLOCK FB_C6_refLiteral
VAR
	bound : REFERENCE TO INT;
	n : INT;
END_VAR
bound REF= 314;
n := 1;
END_FUNCTION_BLOCK
`),

  // ─── which object does "The ABSTRACT keyword is missing" belong to? ────────────────────────────────────────
  // `cc4_not_instantiable` puts `{attribute 'abstract'}` on an FB AND on a method and records ONE warning, so it
  // cannot say which. These two split the question.
  fb("cc6_abstract_attribute_on_fb", "FB_C6_absAttrUser", "an FB carrying {attribute 'abstract'} but not the ABSTRACT keyword",
    `{attribute 'abstract'}
FUNCTION_BLOCK FB_C6_absAttr
VAR
	n : INT;
END_VAR
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_C6_absAttrUser
VAR
	held : FB_C6_absAttr;
	n : INT;
END_VAR
held();
n := held.n;
END_FUNCTION_BLOCK
`),

  fb("cc6_abstract_attribute_on_method", "FB_C6_absMethod", "a METHOD carrying {attribute 'abstract'} but not the ABSTRACT keyword",
    `FUNCTION_BLOCK FB_C6_absMethod
VAR
	n : INT;
END_VAR
n := Shape();
END_FUNCTION_BLOCK

{attribute 'abstract'}
METHOD Shape : INT
Shape := 1;
END_METHOD
`),

  // ─── what does a STRING convert to, for the targets nobody measured? ───────────────────────────────────────
  // `ir/values.ts` coerce() has a catch-all: any STRING reaching a non-REAL target is parsed for leading
  // digits. That is measured for STRING -> integer (`string_conversions*`), and for BOOL and TIME it is a guess
  // that reached a user as a value. A guess in the ORACLE is the worst place for one, so this asks.
  fb("cc6_string_to_bool_and_time", "FB_C6_strConv", "STRING converted to BOOL and to TIME — the targets coerce() guesses at",
    `FUNCTION_BLOCK FB_C6_strConv
VAR
	sTrue : STRING := 'TRUE';
	sFalse : STRING := 'FALSE';
	sOne : STRING := '1';
	sZero : STRING := '0';
	sJunk : STRING := 'abc';
	sLower : STRING := 'true';
	sMixed : STRING := 'True';
	sPadded : STRING := ' TRUE';
	sSuffix : STRING := 'TRUEX';
	bFromTrue : BOOL;
	bFromFalse : BOOL;
	bFromOne : BOOL;
	bFromZero : BOOL;
	bFromJunk : BOOL;
	bFromLower : BOOL;
	bFromMixed : BOOL;
	bFromPadded : BOOL;
	bFromSuffix : BOOL;
	sTime : STRING := 'T#1s';
	sPlain : STRING := '1500';
	tFromTime : TIME;
	tFromPlain : TIME;
END_VAR
bFromTrue := STRING_TO_BOOL(sTrue);
bFromFalse := STRING_TO_BOOL(sFalse);
bFromOne := STRING_TO_BOOL(sOne);
bFromZero := STRING_TO_BOOL(sZero);
bFromJunk := STRING_TO_BOOL(sJunk);
bFromLower := STRING_TO_BOOL(sLower);
bFromMixed := STRING_TO_BOOL(sMixed);
bFromPadded := STRING_TO_BOOL(sPadded);
bFromSuffix := STRING_TO_BOOL(sSuffix);
tFromTime := STRING_TO_TIME(sTime);
tFromPlain := STRING_TO_TIME(sPlain);
END_FUNCTION_BLOCK
`),
]
