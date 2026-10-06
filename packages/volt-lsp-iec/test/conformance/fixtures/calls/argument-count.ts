/**
 * A FUNCTION CALLED WITH NO ARGUMENT AT ALL — found by openspec `analysis-conformance` 3.3.1, whose first recording called
 * functions with defaulted inputs as `F()`: both vendors refuse it, "Function 'F' requires exactly '1' inputs", where
 * `callshape_input_left_out` measured that leaving out only the DEFAULTED one of two inputs is silent on CODESYS. The
 * `call-arguments` check's question (3.8), asked here on its own.
 *
 * GLOBAL NAMES ARE THE FIXTURE'S OWN (`F_LANG_<name>`): the replay binds every fixture into one project.
 */
import type { LanguageTest } from "../../types.js"

export const ARGUMENT_COUNT_TESTS: readonly LanguageTest[] = [
  {
    name: "callarg_no_argument_defaulted_input",
    pouName: "F_LANG_callarg_no_argument_defaulted_input",
    kind: "function",
    feature: "a FUNCTION whose one VAR_INPUT has a default, called with no argument: `F()`",
    fromDoc: "openspec analysis-conformance 3.3.1 (found); docs/codesys-reference/07-pous.md",
    plcPrgVar: "r_callarg : INT;",
    plcPrgBody: "r_callarg := F_LANG_callarg_no_argument_defaulted_input();",
    source: "FUNCTION F_LANG_callarg_no_argument_defaulted_input : INT\nVAR_INPUT\n\ti : INT := 7;\nEND_VAR\nF_LANG_callarg_no_argument_defaulted_input := i;\nEND_FUNCTION\n",
  },
  {
    name: "callarg_no_argument_variable_default",
    pouName: "F_LANG_callarg_no_argument_variable_default",
    kind: "function",
    feature: "a FUNCTION whose one VAR_INPUT is defaulted with a global VARIABLE (no constant), called with no argument: `F()`",
    fromDoc: "openspec analysis-conformance 3.3.1 (found); docs/codesys-reference/07-pous.md",
    plcPrgVar: "r_callarg_var : INT;",
    plcPrgBody: "r_callarg_var := F_LANG_callarg_no_argument_variable_default();",
    gvlNames: ["GVL_LANG_callarg_no_argument_variable_default"],
    source:
      "VAR_GLOBAL\n\tg_callarg_var : INT := 3;\nEND_VAR\n\n" +
      "FUNCTION F_LANG_callarg_no_argument_variable_default : INT\nVAR_INPUT\n\ti : INT := g_callarg_var;\nEND_VAR\nF_LANG_callarg_no_argument_variable_default := i;\nEND_FUNCTION\n",
  },
]
