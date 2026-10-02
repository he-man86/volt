/**
 * THE PRAGMAS, RULE BY RULE — design.md §4 2.7 of openspec `frontend-conformance` (P1–P13; tasks 2.7.1–2.7.3), each rule
 * put to the vendor by fixtures of its own: `record:language` for accept/refuse and the vendor's words, `record:exec`
 * for WHICH BRANCH a conditional pragma compiled. Every conditional fixture that builds leaves its answer in `out`, a
 * variable of the FB: the branch the condition selects writes `1`, the other `2` (so the run recording holds
 * `inst_<name>.out`) — a fixture whose untaken branch held text that is no statement would measure the build's refusal,
 * not the condition. Rows already decided by a recorded fixture elsewhere keep those fixtures
 * (`pragmas/conditional-pragma.ts` holds `{define}`/`{IF defined}`/`{ELSIF}`/`{ELSE}`/`{undefine}`,
 * `batches/check-coverage.ts` the never-closed `{IF}`, `pragmas/pragma.ts` the message and region pragmas and the
 * attribute catalogue); what is here is the cells that separate a rule's readings.
 *
 * ONE QUESTION PER FIXTURE, as in `statements.ts`. Every define a fixture names is `VOLT_*` so no project or library
 * define can answer for it, and the conditions are written as the vendor's documentation writes them (a space before
 * the operator's `(`).
 */
import type { LanguageTest } from "../../types.js"

const doc = "frontend-conformance design.md §4 2.7 (pragmas)"

/** A function block `FB_LANG_<name>` whose VAR section is `vars` and whose body is `body`; `before` (whole units) is
 *  written ahead of it, `after` (its members) behind it. */
function fb(name: string, feature: string, vars: string, body: string, before = "", after = ""): LanguageTest {
  const pouName = `FB_LANG_${name}`
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar: `inst_${name} : ${pouName};`,
    plcPrgBody: `inst_${name}();`,
    source: `${before}FUNCTION_BLOCK ${pouName}\nVAR\n${vars}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n${after}`,
  }
}

const OUT = "\tout : INT;"

/** `out`, and a local CONSTANT `c : INT := 5` in a VAR CONSTANT section of its own. */
const OUT_AND_C = `${OUT}\nEND_VAR\nVAR CONSTANT\n\tc : INT := 5;`

/** `{IF <condition>}` choosing `out := 1`, else `out := 2`; `prefix` stands before it (a `{define}`). */
const choose = (condition: string, prefix = ""): string =>
  `${prefix}{IF ${condition}}\nout := 1;\n{ELSE}\nout := 2;\n{END_IF}`

/** A STRUCT `DUT_LANG_<name>` with one field `v : INT`, written ahead of the FB. */
const box = (name: string): string => `TYPE DUT_LANG_${name} :\nSTRUCT\n\tv : INT;\nEND_STRUCT\nEND_TYPE\n\n`

/** A FUNCTION `FUN_LANG_<name> : INT` returning its input, written ahead of the FB; `attribute` above its header. */
const fun = (name: string, attribute = ""): string =>
  `${attribute}FUNCTION FUN_LANG_${name} : INT\nVAR_INPUT\n\tx : INT;\nEND_VAR\nFUN_LANG_${name} := x;\nEND_FUNCTION\n\n`

export const PRAGMA_RULE_TESTS: readonly LanguageTest[] = [
  // ─── P3 the conditional structure: where an {IF} may stand, and an unbalanced chain ─────────────────────────────────
  // a = 1: the untaken branch adds 10, the taken one 20 → out = 21
  fb(
    "prag_if_in_expression_statement",
    "P3 — an `{IF}` inside an expression: `out := a {IF defined (X)} + INT#10 {ELSE} + INT#20 {END_IF};`",
    "\ta : INT := 1;\n\tout : INT;",
    "out := a\n{IF defined (VOLT_NEVER_DEFINED)}\n+ INT#10\n{ELSE}\n+ INT#20\n{END_IF}\n;",
  ),
  fb(
    "prag_unbalanced_end_if",
    "P3 — an `{END_IF}` more than the `{IF}`s: a closed block and a second `{END_IF}`",
    OUT,
    "{IF defined (VOLT_NEVER_DEFINED)}\nout := 2;\n{END_IF}\nout := 1;\n{END_IF}",
  ),
  fb("prag_if_nested", "P3 — an `{IF}` inside the taken branch of another", OUT,
    "{define VOLT_OUTER}\n{IF defined (VOLT_OUTER)}\n{IF defined (VOLT_INNER)}\nout := 2;\n{ELSE}\nout := 1;\n{END_IF}\n{ELSE}\nout := 2;\n{END_IF}"),
  fb("prag_if_unknown_operator", "P3 — an `{IF}` condition no operator of the vendor's: `{IF volt_unknown (X)}`", OUT,
    choose("volt_unknown (VOLT_X)")),
  // where a conditional pragma acts: `prag_if_in_expression_statement` measured BOTH branches compiled inside an expression
  fb("prag_if_inside_if_statement", "P3 — an `{IF}` inside an IF statement's THEN list", "\ta : INT := 1;\n\tout : INT;",
    "IF a > INT#0 THEN\n{IF defined (VOLT_NEVER_DEFINED)}\nout := 2;\n{ELSE}\nout := 1;\n{END_IF}\nEND_IF"),
  fb("prag_if_whole_operand", "P3 — an `{IF}` choosing an assignment's whole value: `out := {IF …} INT#10 {ELSE} INT#20 {END_IF};`", OUT,
    "out :=\n{IF defined (VOLT_NEVER_DEFINED)}\nINT#10\n{ELSE}\nINT#20\n{END_IF}\n;"),
  // out = 5 when the statement is dropped whole, a refused `+` when the tokens are dropped, 21 when the pragma is ignored
  fb("prag_if_statement_starts_inside", "P3 — a statement that starts inside an untaken `{IF}` branch and ends after `{END_IF}`",
    "\ta : INT := 1;\n\tout : INT;", "out := 5;\n{IF defined (VOLT_NEVER_DEFINED)}\nout := a\n{END_IF}\n+ INT#20;"),
  fb("prag_if_lower_case_keyword", "P3 — the directives in lower case: `{if defined (X)}` … `{else}` … `{end_if}`", OUT,
    "{define VOLT_LOWER}\n{if defined (VOLT_LOWER)}\nout := 1;\n{else}\nout := 2;\n{end_if}"),
  fb("prag_define_case_insensitive", "P3 — `{define VOLT_MIXED}` read as `defined (volt_mixed)`", OUT,
    choose("defined (volt_mixed)", "{define VOLT_MIXED}\n")),
  fb("prag_define_upper_case", "P3 — `{DEFINE X}` in upper case, read by `{IF defined (X)}`: is it a directive", OUT,
    choose("defined (VOLT_UPPER)", "{DEFINE VOLT_UPPER}\n")),
  fb("prag_if_mixed_case_condition", "P3 — the operator in upper case: `{IF DEFINED (X)}`, X defined", OUT,
    choose("DEFINED (VOLT_MIXED_OP)", "{define VOLT_MIXED_OP}\n")),
  fb("prag_else_twice", "P3 — a second `{ELSE}` in one `{IF}`", OUT,
    "{IF defined (VOLT_NEVER_DEFINED)}\nout := 2;\n{ELSE}\nout := 1;\n{ELSE}\nout := 3;\n{END_IF}"),
  fb("prag_elsif_after_else", "P3 — an `{ELSIF}` after the `{ELSE}`", OUT,
    "{IF defined (VOLT_NEVER_DEFINED)}\nout := 2;\n{ELSE}\nout := 1;\n{ELSIF defined (VOLT_NEVER_DEFINED)}\nout := 3;\n{END_IF}"),
  // CODESYS reads `{IF}`/`{ELSE}`/`{END_IF}` only where a STATEMENT may start: inside an expression they are trivia
  // (`prag_if_in_expression_statement` 31, `prag_if_whole_operand`, `prag_if_statement_starts_inside`); these ask the rest
  fb("prag_if_crossing_statement", "P3 — an IF statement opened in both `{IF}` branches and closed after `{END_IF}`",
    "\ta : INT := 2;\n\tout : INT;",
    "{IF defined (VOLT_NEVER_DEFINED)}\nIF a > INT#0 THEN\n{ELSE}\nIF a > INT#1 THEN\n{END_IF}\nout := 1;\nEND_IF"),
  fb("prag_untaken_branch_syntax_error", "P3 — text that does not parse in an untaken branch: is it parsed", OUT,
    "out := 1;\n{IF defined (VOLT_NEVER_DEFINED)}\nout := := ;\n{END_IF}"),
  fb("prag_if_lower_case_not_taken", "P3 — `{if defined (X)}` … `{end_if}` in lower case, X not defined: is it a directive", OUT,
    "out := 2;\n{if defined (VOLT_NEVER_DEFINED)}\nout := 1;\n{end_if}"),
  fb("prag_warning_in_untaken_branch", "P6 — a `{warning}` inside an untaken `{IF}` branch: is it said", OUT,
    "out := 1;\n{IF defined (VOLT_NEVER_DEFINED)}\n{warning 'volt warning in an untaken branch'}\n{END_IF}"),
  fb("prag_define_inside_expression", "P3 — a `{define}` inside an expression, read by a later `{IF defined}`",
    "\ta : INT := 1;\n\tout : INT;",
    "out := a + {define VOLT_MID} INT#0;\n{IF defined (VOLT_MID)}\nout := 1;\n{ELSE}\nout := 2;\n{END_IF}"),

  // ─── P5 a {define} in the declaration part ─────────────────────────────────────────────────────────────────────────
  fb("prag_define_in_declaration", "P5 — a `{define}` in the VAR section, read by an `{IF defined}` in the body",
    `{define VOLT_DECLARED}\n${OUT}`, choose("defined (VOLT_DECLARED)")),
  fb("prag_if_defined_in_declaration", "P5 — an `{IF defined (X)}` (not project_defined) around a declaration",
    `{IF defined (VOLT_NEVER_DEFINED)}\n\tghost : INT;\n{END_IF}\n${OUT}`, "out := 1;"),
  fb("prag_define_in_body_seen_by_method", "P5 — a `{define}` in the FB's body, read by an `{IF defined}` in its METHOD",
    OUT, "{define VOLT_FB_BODY}\nRun();",
    "", "\nMETHOD Run\n{IF defined (VOLT_FB_BODY)}\nout := 1;\n{ELSE}\nout := 2;\n{END_IF}\nEND_METHOD\n"),

  // ─── P10 a define with a value ─────────────────────────────────────────────────────────────────────────────────────
  fb("prag_define_with_value", "P10 — `{define X '123'}` makes `defined (X)` TRUE", OUT,
    choose("defined (VOLT_VALUED)", "{define VOLT_VALUED '123'}\n")),

  // ─── P11 the other conditional operators ───────────────────────────────────────────────────────────────────────────
  fb("prag_if_hasvalue", "P11 — `hasvalue (X, '123')` of `{define X '123'}`", OUT,
    choose("hasvalue (VOLT_VALUED, '123')", "{define VOLT_VALUED '123'}\n")),
  fb("prag_if_hasvalue_other", "P11 — `hasvalue (X, '124')` of `{define X '123'}`", OUT,
    choose("hasvalue (VOLT_VALUED, '124')", "{define VOLT_VALUED '123'}\n")),
  fb("prag_if_hasvalue_no_value", "P11 — `hasvalue (X, '')` of a `{define X}` without a value", OUT,
    choose("hasvalue (VOLT_BARE, '')", "{define VOLT_BARE}\n")),
  fb("prag_if_hasconstantvalue", "P11 — `hasconstantvalue (c, 5, =)` of a local `c : INT := 5` CONSTANT", OUT_AND_C,
    choose("hasconstantvalue (c, 5, =)")),
  fb("prag_if_hasconstantvalue_order", "P11 — `hasconstantvalue (c, 7, <)` of `c = 5`: is it `c < 7` or `7 < c`", OUT_AND_C,
    choose("hasconstantvalue (c, 7, <)")),
  fb("prag_if_hasconstanttype", "P11 — `hasconstanttype (c, TRUE)` of a local scalar CONSTANT (is it replaced)", OUT_AND_C,
    choose("hasconstanttype (c, TRUE)")),
  fb("prag_if_defined_type", "P11 — `defined (type: DUT)` of a STRUCT declared in the project", OUT,
    choose("defined (type: DUT_LANG_prag_if_defined_type)"), box("prag_if_defined_type")),
  fb("prag_if_defined_type_absent", "P11 — `defined (type: X)` of a name no type has", OUT,
    choose("defined (type: DUT_LANG_volt_no_such_type)")),
  fb("prag_if_defined_pou", "P11 — `defined (pou: F)` of a FUNCTION declared in the project", OUT,
    choose("defined (pou: FUN_LANG_prag_if_defined_pou)"), fun("prag_if_defined_pou")),
  fb("prag_if_defined_pou_absent", "P11 — `defined (pou: X)` of a name no POU has", OUT,
    choose("defined (pou: FUN_LANG_volt_no_such_pou)")),
  fb("prag_if_defined_variable", "P11 — `defined (variable: v)` of a local variable", `\tv : INT;\n${OUT}`,
    choose("defined (variable: v)")),
  fb("prag_if_defined_variable_absent", "P11 — `defined (variable: x)` of a name no variable has", OUT,
    choose("defined (variable: volt_no_such_variable)")),
  fb("prag_if_hastype", "P11 — `hastype (variable: v, INT)` of `v : INT`", `\tv : INT;\n${OUT}`,
    choose("hastype (variable: v, INT)")),
  fb("prag_if_hastype_other", "P11 — `hastype (variable: v, DINT)` of `v : INT`", `\tv : INT;\n${OUT}`,
    choose("hastype (variable: v, DINT)")),
  fb("prag_if_hasattribute_pou", "P11 — `hasattribute (pou: F, 'a')` of a FUNCTION carrying `{attribute 'a'}`", OUT,
    choose("hasattribute (pou: FUN_LANG_prag_if_hasattribute_pou, 'volt_marked')"),
    fun("prag_if_hasattribute_pou", "{attribute 'volt_marked'}\n")),
  fb("prag_if_hasattribute_variable", "P11 — `hasattribute (variable: v, 'a')` of `v` carrying `{attribute 'a'}`",
    `\t{attribute 'volt_marked'}\n\tv : INT;\n${OUT}`, choose("hasattribute (variable: v, 'volt_marked')")),
  // an UNQUOTED attribute operand (`cc6_attribute_value_unquoted` measures it on an `{IF}` that is decided): is it the
  // vendor's error where no condition is asked — after a taken branch, in an untaken region, in the declaration part?
  fb("prag_hasattribute_unquoted_elsif_after_taken", "P11 — an unquoted `hasattribute` attribute on an `{ELSIF}` after a taken branch", OUT,
    "{IF NOT defined (VOLT_NEVER_DEFINED)}\nout := 1;\n{ELSIF hasattribute (pou: FB_LANG_prag_hasattribute_unquoted_elsif_after_taken, volt_marked)}\nout := 2;\n{END_IF}"),
  fb("prag_hasattribute_unquoted_elsif_asked", "P11 — an unquoted `hasattribute` attribute on an `{ELSIF}` whose condition is asked", OUT,
    "{IF defined (VOLT_NEVER_DEFINED)}\nout := 2;\n{ELSIF hasattribute (pou: FB_LANG_prag_hasattribute_unquoted_elsif_asked, volt_marked)}\nout := 2;\n{ELSE}\nout := 1;\n{END_IF}"),
  fb("prag_hasattribute_unquoted_in_untaken_branch", "P11 — an unquoted `hasattribute` attribute on an `{IF}` inside an untaken branch", OUT,
    "out := 1;\n{IF defined (VOLT_NEVER_DEFINED)}\n{IF hasattribute (pou: FB_LANG_prag_hasattribute_unquoted_in_untaken_branch, volt_marked)}\nout := 2;\n{END_IF}\n{END_IF}"),
  fb("prag_hasattribute_unquoted_in_declaration", "P11 — an unquoted `hasattribute` attribute on an `{IF}` in the VAR section",
    `{IF hasattribute (pou: FB_LANG_prag_hasattribute_unquoted_in_declaration, volt_marked)}\n\tghost : INT;\n{END_IF}\n${OUT}`, "out := 1;"),
  fb("prag_if_defined_task","P11 — `defined (task: MainTask)`, the recording project's task (CODESYS)", OUT,
    choose("defined (task: MainTask)")),
  fb("prag_if_defined_task_absent", "P11 — `defined (task: X)` of a name no task has", OUT,
    choose("defined (task: VOLT_NO_SUCH_TASK)")),
  fb("prag_if_defined_resource", "P11 — `defined (resource: X)`, documented as not implemented", OUT,
    choose("defined (resource: VOLT_NO_SUCH_RESOURCE)")),
  fb("prag_if_is_little_endian", "P11 — `defined (IsLittleEndian)` on the recording device", OUT,
    choose("defined (IsLittleEndian)")),
  fb("prag_if_is_simulation_mode", "P11 — `defined (IsSimulationMode)` on the recording device", OUT,
    choose("defined (IsSimulationMode)")),
  fb("prag_if_is_fpu_supported", "P11 — `defined (IsFPUSupported)` on the recording device", OUT,
    choose("defined (IsFPUSupported)")),
  fb("prag_if_register_size", "P11 — `hasvalue (RegisterSize, '64')` on the recording device", OUT,
    choose("hasvalue (RegisterSize, '64')")),
  fb("prag_if_register_size_32", "P11 — `hasvalue (RegisterSize, '32')` on the recording device", OUT,
    choose("hasvalue (RegisterSize, '32')")),
  fb("prag_if_packmode", "P11 — `hasvalue (PackMode, '8')` on the recording device", OUT,
    choose("hasvalue (PackMode, '8')")),

  // ─── P12 NOT / AND / OR ────────────────────────────────────────────────────────────────────────────────────────────
  // C defined only: NOT A AND (B OR C) = TRUE
  fb("prag_if_not_and_or", "P12 — `NOT defined (A) AND (defined (B) OR defined (C))`, C alone defined", OUT,
    choose("NOT defined (VOLT_A) AND (defined (VOLT_B) OR defined (VOLT_C))", "{define VOLT_C}\n")),
  // A defined only: A OR (B AND C) = TRUE, (A OR B) AND C = FALSE
  fb("prag_if_and_or_precedence", "P12 — `defined (A) OR defined (B) AND defined (C)`, A alone defined: AND binds first?", OUT,
    choose("defined (VOLT_A) OR defined (VOLT_B) AND defined (VOLT_C)", "{define VOLT_A}\n")),
  // A defined only: (NOT A) OR A = TRUE, NOT (A OR A) = FALSE
  fb("prag_if_not_precedence", "P12 — `NOT defined (A) OR defined (A)`, A defined: NOT binds first?", OUT,
    choose("NOT defined (VOLT_A) OR defined (VOLT_A)", "{define VOLT_A}\n")),

  // ─── P13 project_defined ───────────────────────────────────────────────────────────────────────────────────────────
  fb("prag_project_defined_in_declaration", "P13 — a declaration inside `{IF project_defined (X)}` with X not set: is it declared",
    `{IF project_defined (VOLT_NOT_SET)}\n\tghost : INT;\n{END_IF}\n${OUT}`, "ghost := 1;\nout := ghost;"),
  fb("prag_project_defined_not_in_declaration", "P13 — a declaration inside `{IF NOT project_defined (X)}` with X not set",
    `{IF NOT project_defined (VOLT_NOT_SET)}\n\tpresent : INT;\n{END_IF}\n${OUT}`, "present := 1;\nout := present;"),
  fb("prag_project_defined_in_body", "P13 — `project_defined (X)` in a body, X not set", OUT,
    choose("project_defined (VOLT_NOT_SET)")),
  {
    name: "prag_project_defined_forbidden_construct",
    pouName: "FB_LANG_prag_project_defined_forbidden_construct",
    kind: "function_block",
    feature: "P13 — a whole VAR … END_VAR block inside `{IF project_defined (X)}` (documented as not allowed)",
    fromDoc: doc,
    plcPrgVar: "inst_prag_project_defined_forbidden_construct : FB_LANG_prag_project_defined_forbidden_construct;",
    plcPrgBody: "inst_prag_project_defined_forbidden_construct();",
    source: `FUNCTION_BLOCK FB_LANG_prag_project_defined_forbidden_construct
VAR
	out : INT;
END_VAR
{IF project_defined (VOLT_NOT_SET)}
VAR
	extra : INT;
END_VAR
{END_IF}
out := 1;
END_FUNCTION_BLOCK
`,
  },

  // ─── P2 an attribute on a member and inside a STRUCT ───────────────────────────────────────────────────────────────
  fb("prag_attribute_on_method", "P2 — `{attribute 'obsolete'}` on a METHOD, the method called", OUT, "Run();", "",
    "\n{attribute 'obsolete' := 'volt method text'}\nMETHOD Run\nout := 1;\nEND_METHOD\n"),
  fb("prag_attribute_on_property", "P2 — `{attribute 'obsolete'}` on a PROPERTY, the property read", OUT, "out := Value;", "",
    "\n{attribute 'obsolete' := 'volt property text'}\nPROPERTY Value : INT\nGET\nValue := 1;\nEND_GET\nEND_PROPERTY\n"),
  fb("prag_attribute_on_struct_field", "P2 — `{attribute 'obsolete'}` on a STRUCT field, the field written",
    `\tbox : DUT_LANG_prag_attribute_on_struct_field;\n${OUT}`, "box.v := 1;\nout := box.v;",
    "TYPE DUT_LANG_prag_attribute_on_struct_field :\nSTRUCT\n\t{attribute 'obsolete' := 'volt field text'}\n\tv : INT;\nEND_STRUCT\nEND_TYPE\n\n"),

  // ─── P8 `}` inside a quoted attribute value; P9 a commented-out attribute ──────────────────────────────────────────
  // On a METHOD, where `obsolete` is measured to warn with its text (`prag_attribute_on_method`): on an FB used as a type
  // it says nothing (`cp_obsolete_pou`), so a FUNCTION or an FB could not tell a dropped attribute from a silent one.
  fb("prag_attribute_obsolete_function", "P1 — `{attribute 'obsolete'}` on a FUNCTION, the function called: does it warn", OUT,
    "out := FUN_LANG_prag_attribute_obsolete_function(x := INT#1);",
    fun("prag_attribute_obsolete_function", "{attribute 'obsolete' := 'volt function text'}\n")),
  // an unknown attribute's NAME is echoed by the vendor's warning, so the name carries the brace
  // an obsolete FB is warned twice in `cp_obsolete_pou` (declared AND called): which use is each warning about
  fb("prag_attribute_obsolete_fb_declared", "P1 — an `{attribute 'obsolete'}` FB declared as a variable's type and never called",
    `\told : FB_LANG_prag_attribute_obsolete_fb_declared_old;\n${OUT}`, "out := 1;",
    "{attribute 'obsolete' := 'volt fb text'}\nFUNCTION_BLOCK FB_LANG_prag_attribute_obsolete_fb_declared_old\nVAR\n\tn : INT;\nEND_VAR\nn := n + INT#1;\nEND_FUNCTION_BLOCK\n\n"),
  fb("prag_attribute_obsolete_fb_called_twice", "P1 — an `{attribute 'obsolete'}` FB declared once and called twice",
    `\told : FB_LANG_prag_attribute_obsolete_fb_called_twice_old;\n${OUT}`, "old();\nold();\nout := 1;",
    "{attribute 'obsolete' := 'volt fb text'}\nFUNCTION_BLOCK FB_LANG_prag_attribute_obsolete_fb_called_twice_old\nVAR\n\tn : INT;\nEND_VAR\nn := n + INT#1;\nEND_FUNCTION_BLOCK\n\n"),
  fb("prag_attribute_obsolete_method_called_twice", "P2 — an `{attribute 'obsolete'}` METHOD called twice", OUT, "Run();\nRun();", "",
    "\n{attribute 'obsolete' := 'volt method text'}\nMETHOD Run\nout := 1;\nEND_METHOD\n"),
  // an unknown attribute above a DUT: a STRUCT's is warned (`tc_global_data_type`, re-recorded with its pragma pushed),
  // an ENUM's was measured silent on a real project (pro2193 `enumErrorReaction`) — one fixture per DUT kind
  ...(["struct", "enum", "alias", "union"] as const).map((dutKind) =>
    fb(`prag_unknown_attribute_on_${dutKind}`, `P1 — an unknown attribute above a ${dutKind.toUpperCase()} DUT the FB uses`,
      `\td : DUT_LANG_prag_unknown_attribute_on_${dutKind};\n${OUT}`, "out := 1;",
      `{attribute 'volt_bogus'}\nTYPE DUT_LANG_prag_unknown_attribute_on_${dutKind} :\n${
        dutKind === "struct" ? "STRUCT\n\tv : INT;\nEND_STRUCT"
        : dutKind === "enum" ? "(Idle, Running);"
        : dutKind === "alias" ? "INT;"
        : "UNION\n\tv : INT;\n\tw : DINT;\nEND_UNION"}\nEND_TYPE\n\n`)),
  fb("prag_attribute_brace_in_value", "P8 — `}` inside a quoted attribute name: `{attribute 'volt } brace'}` on a variable",
    `\t{attribute 'volt } brace'}\n\tv : INT;\n${OUT}`, "out := v;"),
  fb("prag_attribute_commented_out", "P9 — `// {attribute 'obsolete'}` above a METHOD, the method called", OUT, "Run();", "",
    "\n// {attribute 'obsolete' := 'volt commented text'}\nMETHOD Run\nout := 1;\nEND_METHOD\n"),
  fb("prag_attribute_block_commented_out", "P9 — `(* {attribute 'obsolete'} *)` above a METHOD, the method called", OUT, "Run();", "",
    "\n(* {attribute 'obsolete' := 'volt commented text'} *)\nMETHOD Run\nout := 1;\nEND_METHOD\n"),

  // ─── P7 a pragma inside an expression / a statement; P6 an unclosed region ─────────────────────────────────────────
  // a = 1 → out = 3
  fb("prag_inside_expression", "P7 — a message pragma between an operator and its operand: `out := a + {info 'x'} INT#2;`",
    "\ta : INT := 1;\n\tout : INT;", "out := a + {info 'volt inside an expression'} INT#2;"),
  fb("prag_warning_inside_expression", "P7 — a `{warning}` between an operator and its operand: is it still said",
    "\ta : INT := 1;\n\tout : INT;", "out := a + {warning 'volt warning inside an expression'} INT#2;"),
  fb("prag_inside_statement_keywords", "P7 — a pragma between a statement's keywords: `IF {info 'x'} a > 0 THEN`",
    "\ta : INT := 1;\n\tout : INT;", "IF {info 'volt inside an IF'} a > INT#0 THEN\n\tout := 1;\nELSE\n\tout := 2;\nEND_IF"),
  fb("prag_warning_inside_statement_keywords", "P7 — a `{warning}` between a statement's keywords: is it still said",
    "\ta : INT := 1;\n\tout : INT;", "IF {warning 'volt warning inside an IF'} a > INT#0 THEN\n\tout := 1;\nELSE\n\tout := 2;\nEND_IF"),
  fb("prag_warning_before_end_if", "P7 — a `{warning}` standing as the last thing of an IF's THEN list",
    "\ta : INT := 1;\n\tout : INT;", "IF a > INT#0 THEN\n\tout := 1;\n{warning 'volt warning in a THEN list'}\nEND_IF"),
  // the message words in upper and mixed case — every other pragma word is case-sensitive on both vendors (2.7.1); is this one
  fb("prag_warning_upper_case", "P6 — a message pragma's word in upper case: `{WARNING 'x'}` where a statement may start", OUT,
    "{WARNING 'volt upper warning'}\nout := 1;"),
  fb("prag_warning_mixed_case", "P6 — a message pragma's word in mixed case: `{Warning 'x'}` where a statement may start", OUT,
    "{Warning 'volt mixed warning'}\nout := 1;"),
  fb("prag_error_upper_case", "P6 — `{ERROR 'x'}` in upper case where a statement may start: does the build fail", OUT,
    "{ERROR 'volt upper error'}\nout := 1;"),
  fb("prag_warning_upper_case_in_declaration", "P6 — `{WARNING 'x'}` in upper case above a declaration, out of the body",
    `{WARNING 'volt upper warning in a declaration'}\n${OUT}`, "out := 1;"),
  fb("prag_region_unclosed", "P6 — a `{region}` never closed by `{end_region}`", OUT, "{region 'volt open'}\nout := 1;"),
  fb("prag_end_region_orphan", "P6 — an `{end_region}` with no `{region}`", OUT, "out := 1;\n{end_region}"),
]
