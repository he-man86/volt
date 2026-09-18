/**
 * How often the IDE reports a warning on a DECLARATION'S INITIALIZER — the shape behind ~20 fixtures that differ from
 * it in neither a missing message nor an extra one, only in how often one repeats (residue, 2026-09-16).
 *
 * One instance gave TWO warnings for one declaration. These pin the rule: none, one and two instances of the same FB,
 * and a PROGRAM (which has no instance of its own to count), each with one over-long string initializer.
 */
import type { LanguageTest } from "../../types.js"

const doc = "conformance — how often an initializer warning repeats"

export const INITIALIZER_REPEAT_TESTS: readonly LanguageTest[] = [
  {
    name: "ir_initializer_warning_no_instance",
    pouName: "FB_IR_none",
    kind: "function_block",
    feature: "an over-long string initializer in an FB NOBODY instantiates",
    fromDoc: doc,
    source: `FUNCTION_BLOCK FB_IR_none
VAR
	text : STRING(4) := '12345';
END_VAR
text := text;
END_FUNCTION_BLOCK
`,
    plcPrgVar: "unrelated : INT;",
    plcPrgBody: "unrelated := 1;",
  },
  {
    name: "ir_initializer_warning_one_instance",
    pouName: "FB_IR_one",
    kind: "function_block",
    feature: "the same declaration with ONE instance",
    fromDoc: doc,
    source: `FUNCTION_BLOCK FB_IR_one
VAR
	text : STRING(4) := '12345';
END_VAR
text := text;
END_FUNCTION_BLOCK
`,
    plcPrgVar: "first : FB_IR_one;",
    plcPrgBody: "first();",
  },
  {
    name: "ir_initializer_warning_two_instances",
    pouName: "FB_IR_two",
    kind: "function_block",
    feature: "the same declaration with TWO instances — the count that separates per-type from per-instance",
    fromDoc: doc,
    source: `FUNCTION_BLOCK FB_IR_two
VAR
	text : STRING(4) := '12345';
END_VAR
text := text;
END_FUNCTION_BLOCK
`,
    plcPrgVar: "first : FB_IR_two; second : FB_IR_two;",
    plcPrgBody: "first();\nsecond();",
  },
  {
    name: "ir_initializer_warning_nested_instance",
    pouName: "FB_IR_holder",
    kind: "function_block",
    feature: "the declaration inside an FB held by ANOTHER FB, which PLC_PRG instantiates once",
    fromDoc: doc,
    source: `FUNCTION_BLOCK FB_IR_inner
VAR
	text : STRING(4) := '12345';
END_VAR
text := text;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_IR_holder
VAR
	inner : FB_IR_inner;
END_VAR
inner();
END_FUNCTION_BLOCK
`,
    plcPrgVar: "holder : FB_IR_holder;",
    plcPrgBody: "holder();",
  },
  {
    name: "ir_initializer_warning_in_program",
    pouName: "PRG_IR_direct",
    kind: "program",
    feature: "the same declaration in a PROGRAM, which has no instance to count",
    fromDoc: doc,
    source: `PROGRAM PRG_IR_direct
VAR
	text : STRING(4) := '12345';
END_VAR
text := text;
END_PROGRAM
`,
    plcPrgVar: "unrelated : INT;",
    plcPrgBody: "PRG_IR_direct();\nunrelated := 1;",
  },
]
