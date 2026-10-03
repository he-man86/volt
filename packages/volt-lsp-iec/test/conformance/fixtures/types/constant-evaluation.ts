/**
 * CONSTANT EVALUATION — design.md §4 4.6 of openspec `frontend-conformance` (CE5, CE6, CE9, P16; tasks 4.6.1, 4.6.2), the
 * cells no recorded fixture decided. CE1–CE4, CE7 and CE8 have theirs (`real_constant_fold_width`, `named_const_*`,
 * `var_input_constant_default_as_step`, `cfold_global_list`, the C0218 cases, `array_index_const_*`).
 *
 *   CE6   what a constant expression may hold beyond arithmetic — a CONVERSION (`X_TO_Y`, `TO_Y`, TRUNC; one that wraps,
 *         one that rounds, BOOL and TIME sources), a pure BUILT-IN (ABS, MIN, MAX, LIMIT, SEL, MUX, EXPT), SIZEOF (of a
 *         type, a variable, an array, a STRING) and an ENUM VALUE
 *   CE9   NOT on an integer (a bit string, an untyped literal, a signed integer), the shifts and rotations at their
 *         operand's width, and a REAL constant declared through an alias
 *   CE5   a constant defined through itself, directly and through another
 *   P16   a `{attribute 'const_non_replaced'}` constant of a global list, named qualified, as a bound
 *
 * THE PROBE IS AN ARRAY BOUND. A constant expression is the array's upper bound and the body writes element 30000, which
 * no bound below reaches: the compiler refuses it naming the range it folded ("The constant index '30000' is not within the
 * range from '0' to '<fold>'"), so the recording carries the value, and a bound the compiler does not take as a constant is
 * an error of its own. The value twins (`*_values`) run on CODESYS.
 */
import type { LanguageTest } from "../../types.js"

const doc = "frontend-conformance design.md §4 4.6 (constant evaluation); docs/codesys-reference/06-data-types.md"

/** A function block `FB_LANG_<name>` with VAR CONSTANT `constants` (none when empty), VAR `vars` and body `body`;
 *  `before` (whole units) is written ahead of it. */
function fb(name: string, feature: string, constants: string, vars: string, body: string, before = ""): LanguageTest {
  const pouName = `FB_LANG_${name}`
  const constantSection = constants === "" ? "" : `VAR CONSTANT\n${constants}\nEND_VAR\n`
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar: `inst_${name} : ${pouName};`,
    plcPrgBody: `inst_${name}();`,
    source: `${before}FUNCTION_BLOCK ${pouName}\n${constantSection}VAR\n${vars}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n`,
  }
}

/** The bound probe: `a : ARRAY[0..<upper>] OF INT` beside `vars`, and element 30000 written. */
function bound(name: string, feature: string, upper: string, { constants = "", vars = "", before = "" } = {}): LanguageTest {
  return fb(name, feature, constants, `\ta : ARRAY[0..${upper}] OF INT;${vars === "" ? "" : `\n${vars}`}`, "a[30000] := 1;", before)
}

// ─── CE6 — conversions ─────────────────────────────────────────────────────────────────────────────────────────────

const CONVERSIONS: LanguageTest[] = [
  bound("ce_fold_conversion_bound", "CE6 — a CONSTANT initialized by `INT_TO_DINT(3)`, as an array bound", "c",
    { constants: "\tc : DINT := INT_TO_DINT(3);" }),
  bound("ce_fold_conversion_bound_direct", "CE6 — `TO_DINT(5)` written as an array bound", "TO_DINT(5)"),
  bound("ce_fold_conversion_bound_wrap", "CE6 — `INT_TO_USINT(300)` (out of USINT's range) as an array bound", "INT_TO_USINT(300)"),
  bound("ce_fold_conversion_bound_real", "CE6 — `REAL_TO_INT(2.5)` (a half) as an array bound", "REAL_TO_INT(2.5)"),
  bound("ce_fold_conversion_bound_trunc", "CE6 — `TRUNC(7.9)` as an array bound", "TRUNC(7.9)"),
  bound("ce_fold_conversion_bound_bool", "CE6 — `BOOL_TO_INT(TRUE)` as an array bound", "BOOL_TO_INT(TRUE)"),
  bound("ce_fold_conversion_bound_time", "CE6 — `TIME_TO_DINT(T#5MS)` as an array bound", "TIME_TO_DINT(T#5MS)"),
  bound("ce_fold_conversion_bound_nested", "CE6 — `DINT_TO_INT(INT_TO_DINT(4) + 2)` (a conversion of an operation on one) as an array bound",
    "DINT_TO_INT(INT_TO_DINT(4) + 2)"),
]

// ─── CE6 — pure built-ins ──────────────────────────────────────────────────────────────────────────────────────────

const BUILTINS: LanguageTest[] = [
  bound("ce_fold_builtin_bound_abs", "CE6 — `ABS(-3)` as an array bound", "ABS(-3)"),
  bound("ce_fold_builtin_bound_min", "CE6 — `MIN(5, 3)` as an array bound", "MIN(5, 3)"),
  bound("ce_fold_builtin_bound_max", "CE6 — `MAX(2, 4)` as an array bound", "MAX(2, 4)"),
  bound("ce_fold_builtin_bound_limit", "CE6 — `LIMIT(0, 9, 5)` as an array bound", "LIMIT(0, 9, 5)"),
  bound("ce_fold_builtin_bound_sel", "CE6 — `SEL(TRUE, 1, 6)` as an array bound", "SEL(TRUE, 1, 6)"),
  bound("ce_fold_builtin_bound_mux", "CE6 — `MUX(1, 2, 7, 9)` as an array bound", "MUX(1, 2, 7, 9)"),
  bound("ce_fold_builtin_bound_expt", "CE6 — `LREAL_TO_INT(EXPT(2, 3))` as an array bound", "LREAL_TO_INT(EXPT(2, 3))"),
]

// ─── CE6 — SIZEOF ──────────────────────────────────────────────────────────────────────────────────────────────────

const SIZEOF: LanguageTest[] = [
  bound("ce_fold_sizeof_bound", "CE6 — `SIZEOF(DINT)` (a type) as an array bound", "SIZEOF(DINT)"),
  bound("ce_fold_sizeof_bound_var", "CE6 — `SIZEOF(lr)` (an LREAL variable) as an array bound", "SIZEOF(lr)", { vars: "\tlr : LREAL;" }),
  bound("ce_fold_sizeof_bound_array", "CE6 — `SIZEOF(arr)` (an ARRAY[0..2] OF INT) as an array bound", "SIZEOF(arr)",
    { vars: "\tarr : ARRAY[0..2] OF INT;" }),
  bound("ce_fold_sizeof_bound_string", "CE6 — `SIZEOF(txt)` (a STRING(10)) as an array bound", "SIZEOF(txt)", { vars: "\ttxt : STRING(10);" }),
]

// ─── CE6 — enum values ─────────────────────────────────────────────────────────────────────────────────────────────

const ENUM_DUT = (name: string): string =>
  `TYPE DUT_LANG_${name} :\n(\n\tFirst,\n\tSecond,\n\tThird := 7\n);\nEND_TYPE\n\n`

const ENUM_VALUES: LanguageTest[] = [
  bound("ce_fold_enum_value_bound", "CE6 — an enum value (`Third := 7`) as an array bound", "DUT_LANG_ce_fold_enum_value_bound.Third",
    { before: ENUM_DUT("ce_fold_enum_value_bound") }),
  bound("ce_fold_enum_value_converted_bound", "CE6 — an enum value converted (`TO_INT(E.Third)`) as an array bound",
    "TO_INT(DUT_LANG_ce_fold_enum_value_converted_bound.Third)", { before: ENUM_DUT("ce_fold_enum_value_converted_bound") }),
  bound("ce_fold_enum_value_constant_bound", "CE6 — a CONSTANT INT initialized by an enum value, as an array bound", "c",
    { constants: "\tc : INT := DUT_LANG_ce_fold_enum_value_constant_bound.Third;", before: ENUM_DUT("ce_fold_enum_value_constant_bound") }),
]

// ─── CE9 — NOT, shifts, a REAL behind an alias ─────────────────────────────────────────────────────────────────────

const UNTYPED_OPERAND =
  "2026-10-03, frontend-conformance 4.6.1: an untyped literal under NOT or a shift has no width the fold may give it without a context (`types/const/fold` `integerTypeOf` — the transpiler folds an initializer by itself, where the narrowest width is wrong: `NOT 0` into a WORD is 65535); as a bound CODESYS takes its narrowest type. `UNTYPED_OPERAND_AS_A_BOUND`; niche: accepted loss (0 occurrences in the corpora)"

const CE9: LanguageTest[] = [
  bound("ce_fold_not_int", "CE9 — `NOT BYTE#250` as an array bound", "NOT BYTE#250"),
  bound("ce_fold_not_int_word", "CE9 — `NOT WORD#65530` as an array bound", "NOT WORD#65530"),
  { ...bound("ce_fold_not_int_untyped", "CE9 — `NOT 250` (an untyped literal) as an array bound", "NOT 250"), deferred: { lsp: UNTYPED_OPERAND } },
  bound("ce_fold_not_int_signed", "CE9 — `NOT INT#-5` (a signed integer) as an array bound", "NOT INT#-5"),
  bound("ce_fold_not_int_constant", "CE9 — NOT of a BYTE CONSTANT (250) as an array bound", "NOT c", { constants: "\tc : BYTE := 250;" }),
  // an untyped literal's width as the bound measures it is its narrowest type; in a CONSTANT of a declared type, its context
  fb("ce_fold_untyped_in_context_values", "CE9 — `NOT 0` into a WORD CONSTANT, read back", "\tc1 : WORD := NOT 0;", "\to1 : WORD;", "o1 := c1;"),
  fb("ce_fold_untyped_shl_in_context_values", "CE9 — `SHL(1, 20)` into a DWORD CONSTANT, read back", "\tc2 : DWORD := SHL(1, 20);", "\to2 : DWORD;", "o2 := c2;"),
  {
    ...fb("ce_fold_untyped_not_signed_context_values", "CE9 — `NOT 5` into an INT CONSTANT, read back", "\tc3 : INT := NOT 5;", "\to3 : INT;", "o3 := c3;"),
    deferred: {
      lsp: "2026-10-03, CODESYS refuses it \"Cannot convert type 'INT' to type 'ANY_BIT'\": the literal takes the constant's INT and NOT takes no signed integer given by a context, where `NOT INT#-5` as a bound builds. `UNTYPED_NOT_IN_A_SIGNED_CONTEXT`; niche: accepted loss (0 occurrences in the corpora)",
    },
  },
  bound("ce_fold_shl", "CE9 — `SHL(BYTE#1, 3)` as an array bound", "SHL(BYTE#1, 3)"),
  bound("ce_fold_shl_overflow", "CE9 — `SHL(BYTE#255, 1)` (past the byte) as an array bound", "SHL(BYTE#255, 1)"),
  { ...bound("ce_fold_shl_untyped", "CE9 — `SHL(1, 3)` (an untyped literal) as an array bound", "SHL(1, 3)"), deferred: { lsp: UNTYPED_OPERAND } },
  bound("ce_fold_shr", "CE9 — `SHR(WORD#80, 4)` as an array bound", "SHR(WORD#80, 4)"),
  bound("ce_fold_rol", "CE9 — `ROL(BYTE#129, 1)` as an array bound", "ROL(BYTE#129, 1)"),
  bound("ce_fold_ror", "CE9 — `ROR(BYTE#129, 1)` as an array bound", "ROR(BYTE#129, 1)"),
  bound("ce_real_alias_const", "CE9 — a CONSTANT of an alias of REAL (`c : A := 10`), `REAL_TO_INT(c / 4)` as an array bound",
    "REAL_TO_INT(c / 4)", { constants: "\tc : DUT_LANG_ce_real_alias_const := 10;", before: "TYPE DUT_LANG_ce_real_alias_const : REAL;\nEND_TYPE\n\n" }),
  fb("ce_real_alias_const_values", "CE9 — a CONSTANT of an alias of REAL (`c : A := 10`) divided by 4, read into a REAL",
    "\tc : DUT_LANG_ce_real_alias_const_values := 10;", "\tq : REAL;", "q := c / 4;",
    "TYPE DUT_LANG_ce_real_alias_const_values : REAL;\nEND_TYPE\n\n"),
]

// ─── CE8 — a STRING length named by a constant of the declaring POU ────────────────────────────────────────────────
// `prag_const_*_string_length` store 'abcdef' into a STRING(n) (n a decorated local CONSTANT 3) and neither vendor warns the
// constant is too long: the same, undecorated, as an assignment and as an initializer

const CE8: LanguageTest[] = [
  fb("ce_string_length_constant_assign", "CE8 — 'abcdef' assigned to a STRING(n), n a local CONSTANT 3", "\tn : INT := 3;", "\ttxt : STRING(n);",
    "txt := 'abcdef';"),
  fb("ce_string_length_constant_init", "CE8 — a STRING(n) initialized with 'abcdef', n a local CONSTANT 3", "\tn : INT := 3;", "\ttxt : STRING(n) := 'abcdef';",
    "txt := txt;"),
  fb("ce_string_length_literal_assign", "CE8 — 'abcdef' assigned to a STRING(3)", "", "\ttxt : STRING(3);", "txt := 'abcdef';"),
]

// ─── CE5 — a cycle ─────────────────────────────────────────────────────────────────────────────────────────────────

// TwinCAT has no answer to give: its XAE exits building either (the restart manager relaunches it on the same solution),
// recorded three times on 2026-10-03 — in two batches and alone
const XAE_EXITS = "the XAE process exits building a recursive constant definition (recorded three times, 2026-10-03: in two batches and alone; the restart manager relaunches it) — there is no build to record"

const CE5: LanguageTest[] = [
  {
    ...bound("ce_cycle", "CE5 — two CONSTANTs each initialized from the other, one an array bound", "ca",
      { constants: "\tca : INT := cb + 1;\n\tcb : INT := ca + 1;" }),
    vendorRefuses: { twincat: XAE_EXITS },
  },
  {
    ...bound("ce_cycle_self", "CE5 — a CONSTANT initialized from itself, an array bound", "cs", { constants: "\tcs : INT := cs + 1;" }),
    vendorRefuses: { twincat: XAE_EXITS },
  },
  // step 4d review: a cycle through an enum member's written value — the member names a global CONSTANT initialized by it
  {
    name: "ce_cycle_enum",
    pouName: "FB_LANG_ce_cycle_enum",
    kind: "function_block",
    feature: "CE5 — a global CONSTANT initialized by an enum member whose value is that constant, an array bound",
    fromDoc: doc,
    plcPrgVar: "inst_ce_cycle_enum : FB_LANG_ce_cycle_enum;",
    plcPrgBody: "inst_ce_cycle_enum();",
    gvlNames: ["GVL_LANG_ce_cycle_enum"],
    source:
      "TYPE DUT_LANG_ce_cycle_enum :\n(\n\tA := cEnumCycle\n);\nEND_TYPE\n\n" +
      "VAR_GLOBAL CONSTANT\n\tcEnumCycle : INT := DUT_LANG_ce_cycle_enum.A;\nEND_VAR\n\n" +
      "FUNCTION_BLOCK FB_LANG_ce_cycle_enum\nVAR\n\ta : ARRAY[0..cEnumCycle] OF INT;\nEND_VAR\na[30000] := 1;\nEND_FUNCTION_BLOCK\n",
    vendorRefuses: {
      twincat:
        "not attempted: the XAE exits building both recursive constant definitions measured (`ce_cycle`, `ce_cycle_self`, 2026-10-03), and an exit takes the whole recording batch with it",
    },
  },
]

// ─── P16 — a const_non_replaced constant of a global list ──────────────────────────────────────────────────────────

const P16: LanguageTest[] = [
  {
    ...bound("ce_const_non_replaced_bound", "P16 — a `{attribute 'const_non_replaced'}` global CONSTANT, named qualified, as an array bound",
      "GVL_LANG_ce_const_non_replaced_bound.cBound"),
    gvlNames: ["GVL_LANG_ce_const_non_replaced_bound"],
    source:
      "VAR_GLOBAL CONSTANT\n\t{attribute 'const_non_replaced'}\n\tcBound : INT := 3;\nEND_VAR\n\n" +
      "FUNCTION_BLOCK FB_LANG_ce_const_non_replaced_bound\nVAR\n\ta : ARRAY[0..GVL_LANG_ce_const_non_replaced_bound.cBound] OF INT;\nEND_VAR\n" +
      "a[30000] := 1;\nEND_FUNCTION_BLOCK\n",
  },
]

export const CONSTANT_EVALUATION_TESTS: readonly LanguageTest[] = [...CONVERSIONS, ...BUILTINS, ...SIZEOF, ...ENUM_VALUES, ...CE9, ...CE8, ...CE5, ...P16]
