/**
 * AN ARRAY INITIALIZER AGAINST ITS DECLARED TYPE — openspec `analysis-conformance` task 3.2.1 (types B), the `array-init`
 * check (`src/analysis/checks/types/array-init.ts`) rule by rule. The census (0.3) measured three of its builders at 0 TP on
 * both vendors — no fixture had asked them:
 *
 *   C0162 arrayInitCountNonConst   a repeat count `n(v)` whose `n` is a VARIABLE (and, beside it, a VAR CONSTANT count)
 *   C0232 arrayInitExpected        a flat list where an ARRAY OF ARRAY needs nested ones (and the nested form)
 *   C0233 initListExpected         a scalar where an ARRAY OF a struct needs a struct list (and the struct-list form)
 *   C0074 unexpectedArrayInit      an array literal on a scalar and on a struct
 *   C0075 tooManyArrayInit         too many values through a repeat count, on two dimensions, and a short list
 *
 * GLOBAL NAMES ARE THE FIXTURE'S OWN (`FB_LANG_<name>`, `DUT_LANG_<name>`): the replay binds every fixture into one project.
 */
import type { LanguageTest } from "../../types.js"

const doc = "openspec analysis-conformance 3.2.1 (array-init); docs/codesys-reference/06-data-types.md"

function fb(name: string, feature: string, vars: string, body: string, before = "", constants = ""): LanguageTest {
  const pouName = `FB_LANG_${name}`
  const constBlock = constants === "" ? "" : `VAR CONSTANT\n${constants}\nEND_VAR\n`
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar: `inst_${name} : ${pouName};`,
    plcPrgBody: `inst_${name}();`,
    source: `${before}FUNCTION_BLOCK ${pouName}\n${constBlock}VAR\n${vars}\n\tout : INT;\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n`,
  }
}

const struct = (name: string): string => `TYPE DUT_LANG_${name} :\nSTRUCT\n\tx : INT;\n\ty : INT;\nEND_STRUCT\nEND_TYPE\n\n`

export const ARRAY_INIT_SHAPE_TESTS: readonly LanguageTest[] = [
  fb("arrinit_count_variable", "a repeat count that is a VARIABLE: `[1, n(7)]` with `n : INT := 2`",
    "\tn : INT := 2;\n\ta : ARRAY[0..3] OF INT := [1, n(7)];", "out := a[1];"),
  fb("arrinit_count_constant", "a repeat count that is a VAR CONSTANT: `[1, n(7)]` with `n : INT := 2`",
    "\ta : ARRAY[0..3] OF INT := [1, n(7)];", "out := a[1];", "", "\tn : INT := 2;"),
  fb("arrinit_flat_into_nested", "a flat list `[1, 2, 3, 4]` on an ARRAY[0..1] OF ARRAY[0..1] OF INT",
    "\ta : ARRAY[0..1] OF ARRAY[0..1] OF INT := [1, 2, 3, 4];", "out := a[1][1];"),
  fb("arrinit_nested_into_nested", "nested lists `[[1, 2], [3, 4]]` on an ARRAY[0..1] OF ARRAY[0..1] OF INT",
    "\ta : ARRAY[0..1] OF ARRAY[0..1] OF INT := [[1, 2], [3, 4]];", "out := a[1][1];"),
  fb("arrinit_scalar_into_struct_array", "scalars `[1, 2]` on an ARRAY[0..1] OF a struct",
    "\ta : ARRAY[0..1] OF DUT_LANG_arrinit_scalar_into_struct_array := [1, 2];", "out := a[1].x;", struct("arrinit_scalar_into_struct_array")),
  fb("arrinit_struct_lists_into_struct_array", "struct lists `[(x := 1), (x := 2, y := 3)]` on an ARRAY[0..1] OF a struct",
    "\ta : ARRAY[0..1] OF DUT_LANG_arrinit_struct_lists_into_struct_array := [(x := 1), (x := 2, y := 3)];", "out := a[1].y;",
    struct("arrinit_struct_lists_into_struct_array")),
  fb("arrinit_on_scalar", "an array literal `[1, 2]` on an INT", "\tn : INT := [1, 2];", "out := n;"),
  fb("arrinit_on_struct", "an array literal `[1, 2]` on a struct", "\tsv : DUT_LANG_arrinit_on_struct := [1, 2];", "out := sv.x;", struct("arrinit_on_struct")),
  fb("arrinit_too_many_by_repeat", "four values `[4(1)]` through a repeat count on an ARRAY[0..2] OF INT",
    "\ta : ARRAY[0..2] OF INT := [4(1)];", "out := a[2];"),
  fb("arrinit_too_many_two_dims", "five values on an ARRAY[0..1, 0..1] OF INT", "\ta : ARRAY[0..1, 0..1] OF INT := [1, 2, 3, 4, 5];", "out := a[1, 1];"),
  fb("arrinit_short_list", "two values on an ARRAY[0..4] OF INT (the rest default)", "\ta : ARRAY[0..4] OF INT := [1, 2];", "out := a[4];"),
]
