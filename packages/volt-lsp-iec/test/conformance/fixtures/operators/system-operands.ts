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
  // WHAT DOES IT EVALUATE TO? Every probe above measures the TYPE, and the type carries a length nobody could
  // explain: CODESYS answers `STRING(INT#23)` for the call form and `STRING(INT#13)` for the initializer. A
  // build cannot say more; a RUN can, because the simulator reads VALUES — and this one did (2026-09-20):
  //
  //     posBody    'Line 1, Column 1 (Impl)'      the call form, first statement
  //     posIndent  'Line 2, Column 11 (Impl)'     the same statement indented ten spaces
  //     posDecl    'Line 5 (Decl)'                a declaration initializer, and NO column at all
  //
  // 21 characters of fixed text plus the digits in an implementation, 12 plus the digits in a declaration, the
  // LINE counted inside the POU's own part and the COLUMN belonging to the STATEMENT rather than the operator.
  // The declaration form is written `__POSITION()` here on purpose: without the parentheses it eats its own
  // semicolon and the VAR section never closes — which is what `sysop_position_initializer` above records.
  probe(
    "sysop_position_value",
    "\tposBody : STRING(80);\n\tposIndent : STRING(80);\n\tposDecl : STRING(80) := __POSITION();",
    "posBody := __POSITION();\n          posIndent := __POSITION();",
    "__POSITION's actual TEXT in both positions — the one question the build oracle cannot answer",
  ),
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



/**
 * `__NEW` AND THE `enable_dynamic_creation` PRAGMA — is the recorded refusal the LANGUAGE or the PROJECT?
 *
 * `op_sys_new_delete` carries the pragma and CODESYS still answered:
 *
 *   No memory for dynamic object creation defined for application 'Device.Application'
 *   A function block or structure needs the pragma '{attribute 'enable_dynamic_creation'}' to be created with __NEW
 *   No memory for dynamic object creation defined for application 'Device.Application'
 *
 * The first is an APPLICATION SETTING — the recording project defines no dynamic-memory pool — and the second
 * contradicts the fixture, which has the pragma. One of three things is true and the pair below tells them apart:
 * the pragma never reaches the compiler (a recorder fault), the pragma is irrelevant while the pool is missing,
 * or it genuinely must sit somewhere else. The probe holds everything constant but the pragma.
 */
const dynamicCreation: LanguageTest[] = [
  {
    name: "newdel_without_pragma",
    pouName: "FB_LANG_newdel_without_pragma",
    kind: "function_block" as const,
    feature: "__NEW on an FB that does NOT carry {attribute 'enable_dynamic_creation'}",
    fromDoc: "03-operators.md",
    plcPrgVar: "inst : FB_LANG_newdel_without_pragma;",
    plcPrgBody: "inst();",
    source: `FUNCTION_BLOCK FB_LANG_newdel_without_pragma
VAR
\tpInst : POINTER TO FB_LANG_newdel_without_pragma;
END_VAR
pInst := __NEW(FB_LANG_newdel_without_pragma);
IF pInst <> 0 THEN
\t__DELETE(pInst);
END_IF
END_FUNCTION_BLOCK
`,
  },
  {
    name: "newdel_with_pragma",
    pouName: "FB_LANG_newdel_with_pragma",
    kind: "function_block" as const,
    feature: "the same __NEW, with the pragma — and in the FB BODY, so no METHOD unit can mislay it",
    fromDoc: "03-operators.md",
    plcPrgVar: "inst : FB_LANG_newdel_with_pragma;",
    plcPrgBody: "inst();",
    source: `{attribute 'enable_dynamic_creation'}
FUNCTION_BLOCK FB_LANG_newdel_with_pragma
VAR
\tpInst : POINTER TO FB_LANG_newdel_with_pragma;
END_VAR
pInst := __NEW(FB_LANG_newdel_with_pragma);
IF pInst <> 0 THEN
\t__DELETE(pInst);
END_IF
END_FUNCTION_BLOCK
`,
  },
  {
    name: "newdel_with_pragma_has_method",
    pouName: "FB_LANG_newdel_with_pragma_has_method",
    kind: "function_block" as const,
    feature: "pragma + a METHOD, but __NEW called from the BODY — which of the two made `op_sys_new_delete` differ?",
    fromDoc: "03-operators.md",
    plcPrgVar: "inst : FB_LANG_newdel_with_pragma_has_method;",
    plcPrgBody: "inst();",
    source: `{attribute 'enable_dynamic_creation'}
FUNCTION_BLOCK FB_LANG_newdel_with_pragma_has_method
VAR
	pInst : POINTER TO FB_LANG_newdel_with_pragma_has_method;
	n : INT;
END_VAR
pInst := __NEW(FB_LANG_newdel_with_pragma_has_method);
IF pInst <> 0 THEN
	__DELETE(pInst);
END_IF
END_FUNCTION_BLOCK

METHOD Touch
n := n + 1;
END_METHOD
`,
  },
  {
    name: "newdel_in_method_with_pragma",
    pouName: "FB_LANG_newdel_in_method_with_pragma",
    kind: "function_block" as const,
    feature: "pragma, and __NEW inside a METHOD that nothing calls — is it the METHOD, or being reached?",
    fromDoc: "03-operators.md",
    plcPrgVar: "inst : FB_LANG_newdel_in_method_with_pragma;",
    plcPrgBody: "inst();",
    source: `{attribute 'enable_dynamic_creation'}
FUNCTION_BLOCK FB_LANG_newdel_in_method_with_pragma
VAR
	pInst : POINTER TO FB_LANG_newdel_in_method_with_pragma;
END_VAR
END_FUNCTION_BLOCK

METHOD Alloc
pInst := __NEW(FB_LANG_newdel_in_method_with_pragma);
IF pInst <> 0 THEN
	__DELETE(pInst);
END_IF
END_METHOD
`,
  },
  {
    name: "newdel_elementary",
    pouName: "FB_LANG_newdel_elementary",
    kind: "function_block" as const,
    feature: "__NEW of an ELEMENTARY type, which no pragma can carry — the control for the pool message",
    fromDoc: "03-operators.md",
    plcPrgVar: "inst : FB_LANG_newdel_elementary;",
    plcPrgBody: "inst();",
    source: `FUNCTION_BLOCK FB_LANG_newdel_elementary
VAR
\tp : POINTER TO INT;
END_VAR
p := __NEW(INT);
IF p <> 0 THEN
\t__DELETE(p);
END_IF
END_FUNCTION_BLOCK
`,
  },
]

export const SYSTEM_OPERAND_TESTS: readonly LanguageTest[] = [...position, ...currentTask, ...dynamicCreation]
