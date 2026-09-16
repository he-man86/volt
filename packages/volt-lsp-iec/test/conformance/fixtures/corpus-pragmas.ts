/**
 * Pragmas, compiler operators and statement forms the CORPUS writes and the catalog did not (census, 2026-09-16).
 *
 * By how often the four real projects write them: `{attribute 'symbol'}` 646 — in all four spellings the corpus uses,
 * with and without spaces around `:=` — `{attribute 'monitoring'}` 320, `__POUNAME()` 304, an EMPTY statement 114, an
 * inline assignment 78, `{attribute 'strict'}` 56, `{attribute 'no_explicit_call'}` 25, `{attribute 'analysis'}` 17,
 * `{attribute 'to_string'}` 12, `XSIZEOF` 5, `{attribute 'obsolete'}` 3 and `{attribute 'pack_mode'}` 1. None of these
 * changes a value on its own; every one of them can stop a parse, a bind or a lowering, which is why they belong here.
 * Recorded like every other fixture: built and RUN in CODESYS SP21.
 */
import type { LanguageTest } from "../types.js"

const doc = "conformance — pragmas and operators the corpus uses"

function fb(name: string, pouName: string, feature: string, source: string, plcPrgVar: string, plcPrgBody: string, cycles?: number): LanguageTest {
  return { name, pouName, kind: "function_block", feature, fromDoc: doc, source, plcPrgVar, plcPrgBody, ...(cycles === undefined ? {} : { cycles }) }
}

export const CORPUS_PRAGMA_TESTS: readonly LanguageTest[] = [
  // ─── `symbol` and `monitoring`, 966 uses between them ──────────────────────
  fb("cp_symbol_and_monitoring", "FB_CP_symbols", "{attribute 'symbol'} in each value the corpus writes and both spacings, beside {attribute 'monitoring'} on a variable and on a METHOD",
    `{attribute 'symbol' := 'readwrite'}
FUNCTION_BLOCK FB_CP_symbols
VAR
	{attribute 'symbol' := 'read'}
	readable : INT := 1;
	{attribute 'symbol':='readwrite'}
	writable : INT := 2;
	{attribute 'symbol' := 'none'}
	hidden : INT := 3;
	{attribute 'monitoring':='variable'}
	watched : INT := 4;
	total : INT;
END_VAR
readable := readable + 1;
writable := writable + 1;
hidden := hidden + 1;
watched := watched + 1;
total := readable + writable + hidden + watched + Counted();
END_FUNCTION_BLOCK

{attribute 'monitoring':='call'}
METHOD Counted : INT
Counted := 10;
END_METHOD
`,
    "inst : FB_CP_symbols;", "inst();", 2),

  // ─── `__POUNAME()`, 304 uses ───────────────────────────────────────────────
  fb("cp_pouname_operator", "FB_CP_named", "__POUNAME() in an FB body, in a METHOD and in an ACTION — what each one names",
    `FUNCTION_BLOCK FB_CP_named
VAR
	fromBody : STRING(40);
	fromMethod : STRING(40);
	fromAction : STRING(40);
	matches : BOOL;
	width : INT;
END_VAR
fromBody := __POUNAME();
fromMethod := Inner();
Marked();
matches := fromBody = 'FB_CP_named';
width := LEN(fromBody);
END_FUNCTION_BLOCK

METHOD Inner : STRING(40)
Inner := __POUNAME();
END_METHOD

ACTION Marked
fromAction := __POUNAME();
END_ACTION
`,
    "inst : FB_CP_named;", "inst();"),

  // ─── an EMPTY statement, 114 of them in the corpus ─────────────────────────
  fb("cp_empty_statements", "FB_CP_empty", "a stray `;` on its own, after a statement, and as the whole arm of an IF and a CASE",
    `FUNCTION_BLOCK FB_CP_empty
VAR
	n : INT;
	branch : INT;
END_VAR
;
n := n + 1;;
IF n > 0 THEN
	;
ELSE
	n := 99;
END_IF
CASE n OF
	1:
		;
	2:
		branch := 2;
ELSE
	branch := 9;
END_CASE
;
END_FUNCTION_BLOCK
`,
    "inst : FB_CP_empty;", "inst();", 2),

  // ─── an inline assignment, 78 in the corpus ────────────────────────────────
  fb("cp_inline_assignment", "FB_CP_inline", "an assignment used as an EXPRESSION — in a parenthesis, as a call argument and inside a condition",
    `FUNCTION F_CP_twice : INT
VAR_INPUT
	value : INT;
END_VAR
F_CP_twice := value * 2;
END_FUNCTION

FUNCTION_BLOCK FB_CP_inline
VAR
	a : INT;
	b : INT;
	c : INT;
	doubled : INT;
	taken : BOOL;
END_VAR
a := (b := 7);
doubled := F_CP_twice(value := (c := 3));
IF (a := a + 1) > 7 THEN
	taken := TRUE;
END_IF
END_FUNCTION_BLOCK
`,
    "inst : FB_CP_inline;", "inst();"),

  // ─── the quieter pragmas, each on the declaration the corpus puts it on ────
  fb("cp_declaration_pragmas", "FB_CP_pragmas", "{attribute 'strict'} on an enum, 'to_string', 'analysis', 'no_explicit_call' and 'pack_mode' — none changes a value, each can stop a parse",
    `{attribute 'strict'}
{attribute 'to_string'}
TYPE DUT_CP_mode :
(
	Off := 0,
	On := 1
) INT;
END_TYPE

{attribute 'pack_mode' := '1'}
TYPE DUT_CP_packed :
STRUCT
	flag : BOOL;
	wide : DINT;
END_STRUCT
END_TYPE

{attribute 'no_explicit_call' := 'Do not call this FB. Only use the methods.'}
FUNCTION_BLOCK FB_CP_methodsOnly
VAR
	runs : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD Bump : INT
runs := runs + 1;
Bump := runs;
END_METHOD

FUNCTION_BLOCK FB_CP_pragmas
VAR
	mode : DUT_CP_mode;
	packed : DUT_CP_packed;
	onlyMethods : FB_CP_methodsOnly;
	bumped : INT;
	packedSize : DINT;
	{attribute 'analysis' := '-33'}
	neverRead : INT := 5;
END_VAR
mode := DUT_CP_mode.On;
packed.flag := TRUE;
packed.wide := 7;
bumped := onlyMethods.Bump();
packedSize := SIZEOF(packed);
END_FUNCTION_BLOCK
`,
    "inst : FB_CP_pragmas;", "inst();", 2),

  // ─── XSIZEOF, and SIZEOF beside it ─────────────────────────────────────────
  fb("cp_xsizeof", "FB_CP_sizes", "XSIZEOF beside SIZEOF, on a variable, a type and an array",
    `FUNCTION_BLOCK FB_CP_sizes
VAR
	small : INT;
	block : ARRAY[1..4] OF DINT;
	sizeOfVar : DINT;
	xsizeOfVar : __UXINT;
	sizeOfArray : DINT;
	xsizeOfArray : __UXINT;
	xsizeOfType : __UXINT;
END_VAR
sizeOfVar := SIZEOF(small);
xsizeOfVar := XSIZEOF(small);
sizeOfArray := SIZEOF(block);
xsizeOfArray := XSIZEOF(block);
xsizeOfType := XSIZEOF(DINT);
END_FUNCTION_BLOCK
`,
    "inst : FB_CP_sizes;", "inst();"),

  // ─── parentheses and the boolean operators, which the corpus writes 1808 and 1275 times
  fb("cp_boolean_precedence", "FB_CP_logic", "deeply parenthesised boolean expressions mixing AND, OR, XOR, NOT and the short-circuit pair, where precedence shows",
    `FUNCTION_BLOCK FB_CP_logic
VAR
	a : BOOL := TRUE;
	b : BOOL := FALSE;
	c : BOOL := TRUE;
	d : BOOL := FALSE;
	andBeforeOr : BOOL;
	parenthesised : BOOL;
	notBinds : BOOL;
	xored : BOOL;
	shortCircuit : BOOL;
	nested : BOOL;
	mixedWithCompare : BOOL;
	n : INT := 3;
END_VAR
andBeforeOr := a OR b AND c;
parenthesised := (a OR b) AND c;
notBinds := NOT b OR d;
xored := a XOR c XOR b;
shortCircuit := b AND_THEN (a OR_ELSE d);
nested := ((a AND (b OR (c AND NOT d))) OR (d XOR a));
mixedWithCompare := (n > 1) AND ((n < 5) OR b);
END_FUNCTION_BLOCK
`,
    "inst : FB_CP_logic;", "inst();"),

  // ─── an obsolete POU, which the corpus marks three times ───────────────────
  fb("cp_obsolete_pou", "FB_CP_user", "{attribute 'obsolete'} on an FB, and the FB used anyway — what the IDE says about it",
    `{attribute 'obsolete' := 'Use FB_CP_new instead.'}
FUNCTION_BLOCK FB_CP_old
VAR
	n : INT;
END_VAR
n := n + 1;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_CP_user
VAR
	legacy : FB_CP_old;
	seen : INT;
END_VAR
legacy();
seen := legacy.n;
END_FUNCTION_BLOCK
`,
    "inst : FB_CP_user;", "inst();", 2),
]
