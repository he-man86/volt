/**
 * `CALC` — the one instruction-list operator name CODESYS does NOT refuse the way it refuses the others.
 *
 * WHY THESE EXIST. `refused-name` covers the IL operator names, and `cc_il_name_cal`, `_calcn` and `_jmpc` all
 * record the SAME uniform ten messages: the name, then a `';' expected` / `Unexpected token` pair for every token
 * to the next `;`, at the declaration and again at the use. `calc` records nine ENTIRELY DIFFERENT ones —
 * `'(' expected instead of ':'`, `Second parameter of conditional call must be a valid call statement` twice,
 * `This code is not supported in declaration part`, `'END_VAR' expected instead of ''` — because the parser reads
 * it as a CONDITIONAL CALL and keeps trying to parse one. The check's header says so and leaves it unmodelled.
 *
 * Three siblings agreeing and `calc` differing is good evidence it is genuinely special. It is not enough to
 * write a RULE from: `cc_il_name_calc` is a single sample, so any emission built on it would be fitted to one
 * declaration in one body rather than derived from how the parser behaves. These vary the two things that
 * sample holds fixed — whether the name is USED after being declared, and whether the declared TYPE changes the
 * recovery — so the next recording says whether the nine messages are a shape or a coincidence.
 *
 * Deliberately no LSP expectation: nothing emits for `calc` today (it is excluded from `IL_OPERATOR_NAMES`), and
 * that stays true until these are recorded.
 */
import type { LanguageTest } from "../types.js"

const doc = "conformance — is the CALC cascade a shape, or one sample?"

function fb(name: string, pouName: string, feature: string, source: string, note?: string): LanguageTest {
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    ...(note === undefined ? {} : { note }),
    source,
    plcPrgVar: `inst : ${pouName};`,
    plcPrgBody: "inst();",
  }
}

export const IL_CALC_SHAPE_TESTS: readonly LanguageTest[] = [
  fb("ilc_calc_declared_unused", "FB_ILC_unused", "`calc` DECLARED and never used — the declaration half of the cascade on its own",
    `FUNCTION_BLOCK FB_ILC_unused
VAR
\tcalc : INT;
\tn : INT;
END_VAR
n := 1;
END_FUNCTION_BLOCK
`,
    "`cc_il_name_calc` declares AND uses it, so its nine messages cannot be split between the two. If the declaration alone still gives `'(' expected instead of ':'` and `This code is not supported in declaration part`, the declaration half is a shape; if it gives something else again, the cascade depends on what follows and no general rule can be written from one sample."),

  fb("ilc_calc_other_type", "FB_ILC_othertype", "`calc` declared with a different TYPE — does the recovery depend on what it is declared as?",
    `FUNCTION_BLOCK FB_ILC_othertype
VAR
\tcalc : STRING(8);
\tn : INT;
END_VAR
n := 1;
END_FUNCTION_BLOCK
`,
    "The sample's type is INT. A STRING has a parenthesised length, and the parser is looking for a `(` — so this is where a rule fitted to `calc : INT;` would come apart, and the cheapest measurement that shows it."),

  fb("ilc_calc_used_not_declared", "FB_ILC_useonly", "`calc` USED with nothing declared — the use half on its own",
    `FUNCTION_BLOCK FB_ILC_useonly
VAR
\tn : INT;
END_VAR
calc := 1;
n := 1;
END_FUNCTION_BLOCK
`,
    "Isolates what the parser does with `calc` in a BODY. The sample's `Expression expected instead of ':='` and its `!!!'ERROR'!!!` no-effect warning both look like they belong to the use, and this is what confirms or refutes that."),

  fb("ilc_calc_called_properly", "FB_ILC_called", "`CALC(…)` written as the conditional call the parser is looking for",
    `FUNCTION_BLOCK FB_ILC_called
VAR
\tflag : BOOL;
\tn : INT;
END_VAR
n := 1;
CALC(flag, n := 2);
END_FUNCTION_BLOCK
`,
    "The other end of the question: if the parser wants `CALC ( cond , call )`, what does it say when given one? Either it accepts it — and `CALC` is a real operator the LSP knows nothing about — or its complaint names what a valid second parameter is, which is the same message the broken form produces twice."),
]

/**
 * The question `cc2_var_in_interface` left open. CODESYS BUILDS a VAR section declared directly in an INTERFACE —
 * that is what deleted the C0149 rule — and a clean build means the declaration is legal, not that it is inert.
 * Whether an implementing FB then INHERITS the variable is unmeasured, and it decides whether the parser's
 * `strayVarSections` is information the symbol table owes anyone or merely something it swallows.
 */
export const INTERFACE_VAR_TESTS: readonly LanguageTest[] = [
  {
    name: "itf_var_section_declaration",
    pouName: "ITF_IV_withVar",
    kind: "interface",
    feature: "an INTERFACE declaring a VAR section — legal, per its own clean build",
    fromDoc: doc,
    source: `INTERFACE ITF_IV_withVar
VAR
\theld : INT;
END_VAR
METHOD Run : INT
END_METHOD
END_INTERFACE
`,
  },
  fb("itf_var_section_inherited", "FB_IV_user", "an FB IMPLEMENTING that interface, reading the variable it declared",
    `FUNCTION_BLOCK FB_IV_user IMPLEMENTS ITF_IV_withVar
VAR
\tseen : INT;
END_VAR
seen := held;
END_FUNCTION_BLOCK

METHOD Run : INT
Run := 1;
END_METHOD
`,
    "If `held` resolves, an interface VAR section is inherited state and the symbol table owes it; if the compiler answers `Identifier 'held' not defined`, the section is legal-but-inert and `strayVarSections` can go. Either answer settles it; today nobody knows which."),
]
