/**
 * `__POSITION` AND `__CURRENTTASK` — the two system operands whose refusal nothing explains yet.
 *
 * One sample each was recorded and neither message describes a rule:
 *
 *   here := __POSITION;        ';' expected instead of end of POU
 *   pTask := __CURRENTTASK;    ';' expected instead of end of POU  +  Expression expected instead of ''
 *
 * Both say the parser reached the END OF THE POU still wanting a `;` — so a `;` that IS written was consumed by
 * something. Which something, and why `__CURRENTTASK` says one thing more, are exactly what one sample cannot
 * settle, and a check written from it would be fitting a message to a coincidence.
 *
 * So each is asked in the positions that tell the shapes apart:
 *   - with a STATEMENT AFTER it — if the operand swallows its own `;`, the next statement is what cascades;
 *   - in the CALL form, `__POSITION()`, which is how every other system operator is written;
 *   - as an ARGUMENT and inside a larger EXPRESSION, where an operand that is merely unknown would be named;
 *   - as an INITIALIZER, which is the position `__POSITION` is documented for (the implicit-parameter pragma);
 *   - `__CURRENTTASK` in an FB BODY as well as in a METHOD, because the one recorded difference between the two
 *     samples is which terminator followed.
 */
import type { LanguageTest } from "../../types.js"

function probe(slug: string, decls: string, body: string, feature: string): LanguageTest {
  const pou = `FB_LANG_${slug}`
  return {
    name: slug,
    pouName: pou,
    kind: "function_block" as const,
    feature,
    fromDoc: "03-operators.md",
    plcPrgVar: `inst : ${pou};`,
    plcPrgBody: "inst();",
    source: `FUNCTION_BLOCK ${pou}\nVAR\n${decls}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n`,
  }
}

/** The same probe, but with the operand used inside a METHOD — the one difference the two samples had. */
function methodProbe(slug: string, decls: string, body: string, feature: string): LanguageTest {
  const pou = `FB_LANG_${slug}`
  return {
    name: slug,
    pouName: pou,
    kind: "function_block" as const,
    feature,
    fromDoc: "03-operators.md",
    plcPrgVar: `inst : ${pou};`,
    plcPrgBody: "inst.Inspect();",
    source: `FUNCTION_BLOCK ${pou}\nVAR\n${decls}\nEND_VAR\nEND_FUNCTION_BLOCK\n\nMETHOD Inspect\n${body}\nEND_METHOD\n`,
  }
}

const position: LanguageTest[] = [
  probe(
    "sysop_position_then_statement",
    "\there : DINT;\n\tafter : DINT;",
    "here := __POSITION;\nafter := 7;",
    "__POSITION with a STATEMENT AFTER IT — does it swallow its own `;` and cascade into the next?",
  ),
  probe("sysop_position_call_form", "\there : DINT;", "here := __POSITION();", "__POSITION written as a CALL, the way every other system operator is"),
  probe("sysop_position_in_expression", "\there : DINT;", "here := __POSITION + 1;", "__POSITION as the left operand of an arithmetic expression"),
  probe("sysop_position_as_argument", "\there : DINT;", "here := ABS(__POSITION);", "__POSITION as a call ARGUMENT — an unknown operand would be named here"),
  probe("sysop_position_initializer", "\there : DINT := __POSITION;", "here := here;", "__POSITION as a declaration INITIALIZER, the position it is documented for"),
  probe("sysop_position_bare_statement", "\there : DINT;", "__POSITION;\nhere := 1;", "__POSITION as a whole statement"),
  methodProbe("sysop_position_in_method", "\there : DINT;", "here := __POSITION;", "__POSITION in a METHOD rather than an FB body — the terminator the samples differed on"),
]

const currentTask: LanguageTest[] = [
  probe(
    "sysop_currenttask_then_statement",
    "\tpTask : POINTER TO BYTE;\n\tafter : DINT;",
    "pTask := __CURRENTTASK;\nafter := 7;",
    "__CURRENTTASK with a STATEMENT AFTER IT — the same question as __POSITION",
  ),
  probe("sysop_currenttask_call_form", "\tpTask : POINTER TO BYTE;", "pTask := __CURRENTTASK();", "__CURRENTTASK written as a CALL"),
  probe("sysop_currenttask_in_body", "\tpTask : POINTER TO BYTE;", "pTask := __CURRENTTASK;", "__CURRENTTASK in an FB BODY — the recorded sample was in a METHOD"),
  probe("sysop_currenttask_bare_statement", "\tpTask : POINTER TO BYTE;", "__CURRENTTASK;\npTask := 0;", "__CURRENTTASK as a whole statement"),
  probe(
    "sysop_currenttask_deref_member",
    "\ttaskName : STRING;",
    "taskName := __CURRENTTASK^.szName;",
    "__CURRENTTASK dereferenced and read — the use the operator exists for",
  ),
]

export const SYSTEM_OPERAND_TESTS: readonly LanguageTest[] = [...position, ...currentTask]
