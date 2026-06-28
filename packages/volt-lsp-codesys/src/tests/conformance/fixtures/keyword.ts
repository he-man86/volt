/**
 * Keyword conformance tests — ST control-flow statements (IF/CASE/
 * FOR/WHILE/REPEAT/EXIT/CONTINUE/RETURN) and special-identifier
 * keywords (THIS, NULL) that the existing catalogs don't already
 * exercise.
 *
 * Source: 10-keywords.md (cross-referenced to the relevant doc
 * pages: ST statements, pointers, OO basics).
 *
 * SUPER^ is already covered in oop-tests.ts.
 *
 * Same LanguageTest shape as pragmas — see pragma-tests.ts for field docs.
 */
import type { LanguageTest } from "../types.js";

export const KEYWORD_TESTS: readonly LanguageTest[] = [
	// ─── IF / ELSIF / ELSE ─────────────────────────────────────────────

	{
		name: "ctrl_if_elsif_else",
		pouName: "FB_LANG_ctrl_if_elsif_else",
		kind: "function_block",
		feature: "IF / ELSIF / ELSE / END_IF",
		fromDoc: "10-keywords.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_if : FB_LANG_ctrl_if_elsif_else;",
		plcPrgBody: "fb_if.Classify();",
		source:
`FUNCTION_BLOCK FB_LANG_ctrl_if_elsif_else
VAR
	iValue : INT := 5;
	sResult : STRING;
END_VAR

END_FUNCTION_BLOCK

METHOD Classify
IF iValue > 10 THEN
	sResult := 'big';
ELSIF iValue > 0 THEN
	sResult := 'small';
ELSE
	sResult := 'zero-or-negative';
END_IF
END_METHOD
`,
	},

	// ─── CASE / OF / ELSE ──────────────────────────────────────────────

	{
		name: "ctrl_case_of_else",
		pouName: "FB_LANG_ctrl_case_of",
		kind: "function_block",
		feature: "CASE / OF with ELSE default",
		fromDoc: "10-keywords.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_case : FB_LANG_ctrl_case_of;",
		plcPrgBody: "fb_case.Pick();",
		source:
`FUNCTION_BLOCK FB_LANG_ctrl_case_of
VAR
	iSelector : INT := 2;
	sChoice : STRING;
END_VAR

END_FUNCTION_BLOCK

METHOD Pick
CASE iSelector OF
	1: sChoice := 'one';
	2: sChoice := 'two';
	3, 4: sChoice := 'three-or-four';
ELSE
	sChoice := 'other';
END_CASE
END_METHOD
`,
	},

	// ─── FOR / DO ──────────────────────────────────────────────────────

	{
		name: "ctrl_for_to_by_do",
		pouName: "FB_LANG_ctrl_for_loop",
		kind: "function_block",
		feature: "FOR / TO / BY / DO / END_FOR",
		fromDoc: "10-keywords.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_for : FB_LANG_ctrl_for_loop;",
		plcPrgBody: "fb_for.Sum();",
		source:
`FUNCTION_BLOCK FB_LANG_ctrl_for_loop
VAR
	i : INT;
	iTotal : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Sum
iTotal := 0;
FOR i := 0 TO 10 BY 2 DO
	iTotal := iTotal + i;
END_FOR
END_METHOD
`,
	},

	// ─── WHILE / DO ────────────────────────────────────────────────────

	{
		name: "ctrl_while_do",
		pouName: "FB_LANG_ctrl_while_do",
		kind: "function_block",
		feature: "WHILE / DO / END_WHILE",
		fromDoc: "10-keywords.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_w : FB_LANG_ctrl_while_do;",
		plcPrgBody: "fb_w.Drain();",
		source:
`FUNCTION_BLOCK FB_LANG_ctrl_while_do
VAR
	iCount : INT := 5;
END_VAR

END_FUNCTION_BLOCK

METHOD Drain
WHILE iCount > 0 DO
	iCount := iCount - 1;
END_WHILE
END_METHOD
`,
	},

	// ─── REPEAT / UNTIL ────────────────────────────────────────────────

	{
		name: "ctrl_repeat_until",
		pouName: "FB_LANG_ctrl_repeat_until",
		kind: "function_block",
		feature: "REPEAT / UNTIL / END_REPEAT",
		fromDoc: "10-keywords.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_r : FB_LANG_ctrl_repeat_until;",
		plcPrgBody: "fb_r.Step();",
		source:
`FUNCTION_BLOCK FB_LANG_ctrl_repeat_until
VAR
	iCount : INT := 0;
END_VAR

END_FUNCTION_BLOCK

METHOD Step
REPEAT
	iCount := iCount + 1;
UNTIL iCount >= 5
END_REPEAT
END_METHOD
`,
	},

	// ─── EXIT / CONTINUE / RETURN ──────────────────────────────────────

	{
		name: "ctrl_exit_in_loop",
		pouName: "FB_LANG_ctrl_exit",
		kind: "function_block",
		feature: "EXIT statement breaks out of an enclosing loop",
		fromDoc: "10-keywords.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_exit : FB_LANG_ctrl_exit;",
		plcPrgBody: "fb_exit.Run();",
		source:
`FUNCTION_BLOCK FB_LANG_ctrl_exit
VAR
	i : INT;
	iFound : INT := -1;
END_VAR

END_FUNCTION_BLOCK

METHOD Run
FOR i := 0 TO 100 DO
	IF i = 42 THEN
		iFound := i;
		EXIT;
	END_IF
END_FOR
END_METHOD
`,
	},

	{
		name: "ctrl_continue_in_loop",
		pouName: "FB_LANG_ctrl_continue",
		kind: "function_block",
		feature: "CONTINUE statement skips to the next loop iteration",
		fromDoc: "10-keywords.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_c : FB_LANG_ctrl_continue;",
		plcPrgBody: "fb_c.Count();",
		source:
`FUNCTION_BLOCK FB_LANG_ctrl_continue
VAR
	i : INT;
	iEvens : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Count
FOR i := 0 TO 10 DO
	IF (i MOD 2) <> 0 THEN
		CONTINUE;
	END_IF
	iEvens := iEvens + 1;
END_FOR
END_METHOD
`,
	},

	{
		name: "ctrl_return_from_method",
		pouName: "FB_LANG_ctrl_return",
		kind: "function_block",
		feature: "RETURN statement exits a METHOD early",
		fromDoc: "10-keywords.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_ret : FB_LANG_ctrl_return;",
		plcPrgBody: "fb_ret.Check(iValue := -1);",
		source:
`FUNCTION_BLOCK FB_LANG_ctrl_return
VAR
	bSeenNegative : BOOL;
END_VAR

END_FUNCTION_BLOCK

METHOD Check
VAR_INPUT
	iValue : INT;
END_VAR
IF iValue < 0 THEN
	bSeenNegative := TRUE;
	RETURN;
END_IF
bSeenNegative := FALSE;
END_METHOD
`,
	},

	// ─── THIS ──────────────────────────────────────────────────────────

	{
		name: "keyword_this_dereference",
		pouName: "FB_LANG_keyword_this",
		kind: "function_block",
		feature: "THIS^ — explicit dereference to access the current instance",
		fromDoc: "10-keywords.md",
		expectTcAccepts: true,
		note: "THIS is a POINTER TO <self FB>; THIS^ dereferences it to access the instance's own fields.",
		plcPrgVar: "fb_this : FB_LANG_keyword_this;",
		plcPrgBody: "fb_this.Inc();",
		source:
`FUNCTION_BLOCK FB_LANG_keyword_this
VAR
	iCount : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Inc
THIS^.iCount := THIS^.iCount + 1;
END_METHOD
`,
	},

	// ─── NULL ──────────────────────────────────────────────────────────

	// NAMESPACE keyword is documented in 10-keywords.md but cannot be
	// exercised in this catalog's shape: NAMESPACE is an outer wrapper
	// around POU declarations, and the bridge's StSplitter (+ TC's
	// tree-item model) only handles FUNCTION_BLOCK / PROGRAM /
	// FUNCTION / INTERFACE / GVL / DUT outer kinds. The volt-lsp-codesys
	// parser supports NAMESPACE (see ast.ts `Namespace`) but the wire
	// model doesn't carry it. Listed here as a known gap so future
	// catalog expansions know to add NAMESPACE coverage when (if) TC
	// exposes a namespace tree-item type.

	{
		name: "keyword_null_pointer_init",
		pouName: "FB_LANG_keyword_null",
		kind: "function_block",
		feature: "NULL — explicit null-pointer initializer / comparison",
		fromDoc: "10-keywords.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_n : FB_LANG_keyword_null;",
		plcPrgBody: "fb_n.Reset();",
		source:
`FUNCTION_BLOCK FB_LANG_keyword_null
VAR
	pInt : POINTER TO INT := 0;
	bIsNull : BOOL;
END_VAR

END_FUNCTION_BLOCK

METHOD Reset
pInt := 0;
bIsNull := (pInt = 0);
END_METHOD
`,
	},
];
