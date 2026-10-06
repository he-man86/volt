/**
 * FLOW RULES — openspec `analysis-conformance` task 3.9.1 (flow), rule by rule, the builders no recorded fixture fired
 * (0.3: case-labels' `caseOverlappingRanges`) and each rule's unmeasured sides:
 *
 *   case-labels         two ranges overlapping, touching at one value, one inside the other; a single label BEFORE the
 *                       range holding it; one label twice in one arm's list; a VAR CONSTANT beside its own value; an enum
 *                       member twice; a literal beyond a BYTE selector; a variable as a range bound; a REAL label
 *   jump-labels         a label declared twice; a JMP to no label; a JMP to a VARIABLE; a JMP into a loop's body; a label
 *                       and its JMP spelled in other cases; two labels nothing targets
 *   statement-rules     a VAR_INPUT CONSTANT assigned; an EXIT inside an IF outside any loop; a CONTINUE in a CASE in a loop
 *   no-op-statement     an array element, `THIS^.x`, a typed literal, a property read and an enum value as statements
 *   empty-block         an empty ELSE, an empty ELSIF, a `;` body (legal), a comment-only body (legal)
 *   loop-exit           a BYTE counter TO 255, an INT counter counting DOWN to its minimum, a USINT counter BY 2 to 255
 *   this-super-context  THIS^ in a FUNCTION, SUPER^ in a PROGRAM, SUPER^ in a method of an FB extending nothing, THIS^ in
 *                       an FB's ACTION (legal)
 *
 * GLOBAL NAMES ARE THE FIXTURE'S OWN (`FB_LANG_<name>…`, `DUT_LANG_<name>…`, `F_LANG_<name>…`): the replay binds every
 * fixture into one project.
 */
import type { LanguageTest } from "../../types.js"

const doc = "openspec analysis-conformance 3.9.1 (flow); docs/codesys-reference/04-statements.md"

/** A function block `FB_LANG_<name>`, instanced and called from PLC_PRG, its whole text `source` (dependencies first). */
function fb(name: string, feature: string, source: string, plcPrgVar = `inst_${name} : FB_LANG_${name};`, plcPrgBody = `inst_${name}();`): LanguageTest {
  return { name, pouName: `FB_LANG_${name}`, kind: "function_block", feature, fromDoc: doc, plcPrgVar, plcPrgBody, source }
}

/** `FUNCTION_BLOCK FB_LANG_<name>` declaring `vars`, running `body`, then `members`. */
const fbText = (name: string, vars: string, body: string, members = "", header = ""): string =>
  `FUNCTION_BLOCK FB_LANG_${name}${header}\nVAR\n${vars}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n${members === "" ? "" : `\n${members}`}`

/** An FB whose INT `a` (3) selects `CASE a OF <arms> END_CASE`, writing `out`. */
const caseOn = (name: string, feature: string, arms: string, vars = "\ta : INT := 3;\n\tout : INT;"): LanguageTest =>
  fb(name, feature, fbText(name, vars, `CASE a OF\n${arms}\nEND_CASE`))

const CASE_LABELS: LanguageTest[] = [
  caseOn("flw_case_overlapping_ranges", "two CASE ranges overlapping (1..5, 3..8)", "1..5: out := 1;\n3..8: out := 2;"),
  caseOn("flw_case_ranges_touching", "two CASE ranges sharing one value (1..3, 3..5)", "1..3: out := 1;\n3..5: out := 2;"),
  caseOn("flw_case_range_inside_range", "a CASE range inside an earlier one (1..10, 3..4)", "1..10: out := 1;\n3..4: out := 2;"),
  caseOn("flw_case_label_before_range", "a single CASE label ahead of the range holding it (2, then 1..3)", "2: out := 1;\n1..3: out := 2;"),
  caseOn("flw_case_duplicate_in_list", "one label twice in one arm's list (`1, 1:`)", "1, 1: out := 1;\n2: out := 2;"),
  caseOn("flw_case_constant_beside_value", "a VAR CONSTANT label beside a literal of its value", "c: out := 1;\n1: out := 2;",
    "\ta : INT := 3;\n\tout : INT;\nEND_VAR\nVAR CONSTANT\n\tc : INT := 1;"),
  fb("flw_case_enum_duplicate", "an enum member twice among a CASE's labels",
    `TYPE DUT_LANG_flw_case_enum_duplicate :\n(\n\tIdle := 0,\n\tBusy := 1\n);\nEND_TYPE\n\n` +
      fbText("flw_case_enum_duplicate", "\trec : DUT_LANG_flw_case_enum_duplicate;\n\tout : INT;",
        "CASE rec OF\nDUT_LANG_flw_case_enum_duplicate.Idle: out := 1;\nDUT_LANG_flw_case_enum_duplicate.Idle: out := 2;\nEND_CASE")),
  caseOn("flw_case_label_beyond_byte", "a literal label beyond a BYTE selector (300)", "1: out := 1;\n300: out := 2;", "\ta : BYTE := 3;\n\tout : INT;"),
  caseOn("flw_case_variable_range_bound", "a variable as a CASE range's upper bound", "1..v: out := 1;", "\ta : INT := 3;\n\tv : INT := 5;\n\tout : INT;"),
  {
    ...caseOn("flw_case_real_label", "a REAL literal as a CASE label on an INT", "1.5: out := 1;\n2: out := 2;"),
    deferred: {
      lsp: "2026-10-06 niche: accepted loss (0 REAL case labels in the corpora): both vendors' parsers refuse a REAL literal as a CASE label (\"No CASE label found\", \"Unexpected token '1.5' found\") and resync through the arm; the LSP's CASE parser reads any literal as a label and says nothing",
    },
  },
]

/** An FB running `body` over INT `n` and `out`. */
const flow = (name: string, feature: string, body: string, vars = "\tn : INT;\n\tout : INT;"): LanguageTest =>
  fb(name, feature, fbText(name, vars, body))

const JUMP_LABELS: LanguageTest[] = [
  flow("flw_jmp_label_duplicate", "one label declared twice, jumped to", "JMP L;\nL:\nout := 1;\nL:\nout := 2;"),
  flow("flw_jmp_undefined", "a JMP to a label nothing declares", "JMP Nowhere;\nout := 1;"),
  flow("flw_jmp_to_variable", "a JMP to a VARIABLE's name", "JMP n;\nout := 1;"),
  flow("flw_jmp_into_loop", "a JMP from outside into a FOR loop's body", "JMP Inside;\nFOR n := 1 TO 3 DO\nInside:\n\tout := out + 1;\nEND_FOR"),
  flow("flw_jmp_label_other_case", "a label `Again:` jumped to as `JMP AGAIN`", "Again:\nout := out + 1;\nIF out < 3 THEN\n\tJMP AGAIN;\nEND_IF"),
  flow("flw_label_unreferenced_two", "two labels nothing jumps to", "First:\nout := 1;\nSecond:\nout := 2;"),
]

const STATEMENTS: LanguageTest[] = [
  fb("flw_assign_input_constant", "a VAR_INPUT CONSTANT assigned in the body",
    `FUNCTION_BLOCK FB_LANG_flw_assign_input_constant\nVAR_INPUT CONSTANT\n\tlimit_ : INT := 4;\nEND_VAR\nVAR\n\tout : INT;\nEND_VAR\nlimit_ := 5;\nout := limit_;\nEND_FUNCTION_BLOCK\n`),
  flow("flw_exit_in_if_outside_loop", "an EXIT inside an IF, no loop around it", "IF n = 0 THEN\n\tEXIT;\nEND_IF\nout := 1;"),
  flow("flw_continue_in_case_in_loop", "a CONTINUE inside a CASE inside a FOR loop", "FOR n := 1 TO 3 DO\n\tCASE n OF\n\t2: CONTINUE;\n\tEND_CASE\n\tout := out + n;\nEND_FOR"),
]

const NO_OP: LanguageTest[] = [
  flow("flw_noop_array_element", "an array element as a statement", "arr[1];\nout := 1;", "\tarr : ARRAY[1..2] OF INT;\n\tout : INT;"),
  flow("flw_noop_this_member", "`THIS^.out` as a statement", "THIS^.out;\nout := 1;", "\tout : INT;"),
  flow("flw_noop_typed_literal", "a typed literal `INT#5` as a statement", "INT#5;\nout := 1;", "\tout : INT;"),
  fb("flw_noop_property_read", "an instance's property read as a statement",
    `FUNCTION_BLOCK FB_LANG_flw_noop_property_read_t\nVAR\n\tstored : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\nPROPERTY P : INT\nGET\nP := stored;\nEND_GET\nEND_PROPERTY\n\n` +
      fbText("flw_noop_property_read", "\tt : FB_LANG_flw_noop_property_read_t;\n\tout : INT;", "t.P;\nout := 1;")),
  fb("flw_noop_enum_value", "an enum value as a statement",
    `TYPE DUT_LANG_flw_noop_enum_value :\n(\n\tIdle := 0,\n\tBusy := 1\n);\nEND_TYPE\n\n` +
      fbText("flw_noop_enum_value", "\tout : INT;", "DUT_LANG_flw_noop_enum_value.Busy;\nout := 1;")),
]

const EMPTY_BLOCKS: LanguageTest[] = [
  flow("flw_empty_else", "an IF whose ELSE is empty", "IF n = 0 THEN\n\tout := 1;\nELSE\nEND_IF"),
  flow("flw_empty_elsif", "an IF whose ELSIF is empty", "IF n = 0 THEN\n\tout := 1;\nELSIF n = 1 THEN\nELSE\n\tout := 2;\nEND_IF"),
  flow("flw_empty_semicolon_body", "a WHILE whose body is a lone `;`", "WHILE n > 3 DO\n\t;\nEND_WHILE\nout := 1;"),
  flow("flw_empty_comment_body", "an IF whose THEN holds only a comment", "IF n = 0 THEN\n\t(* nothing yet *)\nEND_IF\nout := 1;"),
]

/** Each loop below cannot exit, so its scan never completes and the done flag `record:exec` waits on cannot rise. */
const ENDLESS = "a loop that cannot exit never completes its scan, so the done flag the recorder waits on cannot rise (record:exec on flw_for_byte_to_255: 'the done flag never rose')"
const endless = (t: LanguageTest): LanguageTest => ({ ...t, execSkip: ENDLESS })

const LOOP_EXIT: LanguageTest[] = [
  endless(flow("flw_for_byte_to_255", "a BYTE counter FOR … TO 255", "FOR b := 0 TO 255 DO\n\tout := out + 1;\nEND_FOR", "\tb : BYTE;\n\tout : INT;")),
  endless(flow("flw_for_int_down_to_min", "an INT counter counting DOWN to -32768", "FOR n := 0 TO -32768 BY -1 DO\n\tout := out + 1;\nEND_FOR")),
  endless(flow("flw_for_usint_by_two_to_255", "a USINT counter BY 2 TO 255", "FOR u := 1 TO 255 BY 2 DO\n\tout := out + 1;\nEND_FOR", "\tu : USINT;\n\tout : INT;")),
]

const THIS_SUPER: LanguageTest[] = [
  {
    name: "flw_this_in_function",
    pouName: "F_LANG_flw_this_in_function",
    kind: "function",
    feature: "THIS^ in a FUNCTION",
    fromDoc: doc,
    plcPrgVar: "v_flw_this_in_function : INT;",
    plcPrgBody: "v_flw_this_in_function := F_LANG_flw_this_in_function(1);",
    source: "FUNCTION F_LANG_flw_this_in_function : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nTHIS^.a := 2;\nF_LANG_flw_this_in_function := a;\nEND_FUNCTION\n",
  },
  {
    name: "flw_super_in_program",
    pouName: "P_LANG_flw_super_in_program",
    kind: "program",
    feature: "SUPER^ called in a PROGRAM",
    fromDoc: doc,
    plcPrgBody: "P_LANG_flw_super_in_program();",
    source: "PROGRAM P_LANG_flw_super_in_program\nVAR\n\tout : INT;\nEND_VAR\nSUPER^();\nout := 1;\nEND_PROGRAM\n",
  },
  {
    // the gate review of 3.7+3.9: the program/function branch's SUPER^ call, on its FUNCTION side
    name: "flw_super_in_function",
    pouName: "F_LANG_flw_super_in_function",
    kind: "function",
    feature: "SUPER^ called in a FUNCTION",
    fromDoc: doc,
    plcPrgVar: "v_flw_super_in_function : INT;",
    plcPrgBody: "v_flw_super_in_function := F_LANG_flw_super_in_function();",
    source: "FUNCTION F_LANG_flw_super_in_function : INT\nSUPER^();\nF_LANG_flw_super_in_function := 1;\nEND_FUNCTION\n",
  },
  fb("flw_super_in_method_no_base", "SUPER^.M() in a method of an FB extending nothing",
    fbText("flw_super_in_method_no_base", "\tout : INT;", "out := M();", "METHOD M : INT\nM := SUPER^.M();\nEND_METHOD\n")),
  fb("flw_this_in_action", "THIS^ in an FB's ACTION",
    fbText("flw_this_in_action", "\tout : INT;", "Act();", "ACTION Act\nTHIS^.out := 3;\nEND_ACTION\n")),
]

export const FLOW_RULE_TESTS: readonly LanguageTest[] = [...CASE_LABELS, ...JUMP_LABELS, ...STATEMENTS, ...NO_OP, ...EMPTY_BLOCKS, ...LOOP_EXIT, ...THIS_SUPER]
