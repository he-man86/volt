/**
 * AN UNTYPED INTEGER LITERAL STORED INTO A STRUCT OR AN ARRAY — openspec `analysis-conformance` task 3.1.3 (types A), the
 * `assignment` check's message for a scalar literal into a composite target. The compiler NAMES the literal's type, and
 * the recordings name it two ways: `wrongWay : DUT := 7` is "Cannot convert type 'SINT' to type 'DUT_C3_point'"
 * (`cc3_unexpected_struct_init`) while `rec : DUT := (1, 2)` is "Cannot convert type 'BIT' …" (`decl_struct_init_positional`,
 * `LITERAL_ONE_IS_BIT`). Two cells could not tell the rule apart — the VALUE (0 and 1 are BIT?) or the parenthesized
 * list — so each is asked alone: 0, 1 and 2, in a declaration and in a statement, into a struct and into an array.
 * The `litc_fb_*` cells (3.1+3.3 gate review) ask the same of a FUNCTION BLOCK instance, which no cell had asked.
 *
 * GLOBAL NAMES ARE THE FIXTURE'S OWN (`FB_LANG_<name>`, `DUT_LANG_<name>`): the replay binds every fixture into one project.
 */
import type { LanguageTest } from "../../types.js"

const doc = "openspec analysis-conformance 3.1.3 (assignment: a literal into a composite)"

function fb(name: string, feature: string, vars: string, body: string, struct: boolean, inner = false): LanguageTest {
  const pouName = `FB_LANG_${name}`
  const before = struct
    ? `TYPE DUT_LANG_${name} :\nSTRUCT\n\ta : INT;\n\tb : INT;\nEND_STRUCT\nEND_TYPE\n\n`
    : inner
      ? `FUNCTION_BLOCK FB_LANG_${name}_inner\nVAR\n\ta : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n`
      : ""
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar: `inst_${name} : ${pouName};`,
    plcPrgBody: `inst_${name}();`,
    source: `${before}FUNCTION_BLOCK ${pouName}\nVAR\n${vars}\n\tout : INT;\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n`,
  }
}

const rec = (name: string, init: string): string => `\trec : DUT_LANG_${name}${init};`

export const LITERAL_INTO_COMPOSITE_TESTS: readonly LanguageTest[] = [
  fb("litc_struct_init_zero", "a struct variable initialized with the literal 0", rec("litc_struct_init_zero", " := 0"), "out := rec.a;", true),
  fb("litc_struct_init_one", "a struct variable initialized with the literal 1", rec("litc_struct_init_one", " := 1"), "out := rec.a;", true),
  fb("litc_struct_init_two", "a struct variable initialized with the literal 2", rec("litc_struct_init_two", " := 2"), "out := rec.a;", true),
  fb("litc_struct_init_one_in_parens", "a struct variable initialized with the literal 1 in parentheses", rec("litc_struct_init_one_in_parens", " := (1)"), "out := rec.a;", true),
  fb("litc_struct_assign_one", "the literal 1 assigned to a struct variable", rec("litc_struct_assign_one", ""), "rec := 1;\nout := rec.a;", true),
  fb("litc_struct_assign_zero", "the literal 0 assigned to a struct variable", rec("litc_struct_assign_zero", ""), "rec := 0;\nout := rec.a;", true),
  fb("litc_struct_assign_two", "the literal 2 assigned to a struct variable", rec("litc_struct_assign_two", ""), "rec := 2;\nout := rec.a;", true),
  fb("litc_array_init_one", "an ARRAY[0..1] OF INT initialized with the literal 1", "\tarr : ARRAY[0..1] OF INT := 1;", "out := arr[0];", false),
  fb("litc_array_init_two", "an ARRAY[0..1] OF INT initialized with the literal 2", "\tarr : ARRAY[0..1] OF INT := 2;", "out := arr[0];", false),
  fb("litc_array_assign_one", "the literal 1 assigned to an ARRAY[0..1] OF INT", "\tarr : ARRAY[0..1] OF INT;", "arr := 1;\nout := arr[0];", false),
  fb("litc_fb_init_one", "a function block instance initialized with the literal 1", "\tfbv : FB_LANG_litc_fb_init_one_inner := 1;", "fbv();\nout := fbv.a;", false, true),
  fb("litc_fb_assign_one", "the literal 1 assigned to a function block instance", "\tfbv : FB_LANG_litc_fb_assign_one_inner;", "fbv := 1;\nout := fbv.a;", false, true),
  fb("litc_fb_assign_two", "the literal 2 assigned to a function block instance", "\tfbv : FB_LANG_litc_fb_assign_two_inner;", "fbv := 2;\nout := fbv.a;", false, true),
]
