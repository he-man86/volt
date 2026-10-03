/**
 * COMPARISONS AND BOOL — design.md §4 4.4 of openspec `frontend-conformance` (CB4, CB5; task 4.4), the rows no recorded
 * fixture decided.
 *
 *   CB4   the comparison's RESULT TYPE for every operand family — STRING, WSTRING, TIME, a date, REAL, BOOL, an enum, a
 *         pointer — and the pairs whose operands are not one family: TIME against LTIME, a pointer against an integer
 *   CB5   AND_THEN / OR_ELSE on operands that are not BOOL: an integer, a bit string, and BOOL beside an integer
 *
 * THE TRICK, as in `arithmetic-results.ts`: the result is assigned into a `STRING`, which nothing but a string converts
 * into, so the compiler has to NAME the type it arrived at (`Cannot convert type '<T>' to type 'STRING'`). The value twins
 * (`*_values`) store the same comparisons into BOOLs for the run recording. Every operand is a variable, so nothing folds.
 *
 * GLOBAL NAMES ARE THE FIXTURE'S OWN (`FB_LANG_<name>`, `DUT_LANG_<name>`): the replay binds every fixture into one project.
 */
import type { LanguageTest } from "../../types.js"

const doc = "frontend-conformance design.md §4 4.4 (comparisons and BOOL); docs/codesys-reference/05-operators.md"

/** A function block `FB_LANG_<name>` with VAR `vars` and body `body`; `before` (whole units) is written ahead of it. */
function fb(name: string, feature: string, vars: string, body: string, before = ""): LanguageTest {
  const pouName = `FB_LANG_${name}`
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar: `inst_${name} : ${pouName};`,
    plcPrgBody: `inst_${name}();`,
    source: `${before}FUNCTION_BLOCK ${pouName}\nVAR\n${vars}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n`,
  }
}

/** Variables `decls` (set by `setup`), and each of `exprs` assigned into an `out<i>` of `outType`. */
function probe(name: string, feature: string, decls: string, setup: string, exprs: readonly string[], outType: string, before = ""): LanguageTest {
  const vars = exprs.map((_, i) => `\tout${i + 1} : ${outType};`).join("\n")
  const body = exprs.map((e, i) => `out${i + 1} := ${e};`).join("\n")
  return fb(name, feature, `${decls}\n${vars}`, `${setup}${setup === "" ? "" : "\n"}${body}`, before)
}

const SCALARS =
  "\ts1 : STRING := 'abc';\n\ts2 : STRING := 'abd';\n\tw1 : WSTRING := \"abc\";\n\tw2 : WSTRING := \"abd\";\n" +
  "\tt1 : TIME := T#1S;\n\tt2 : TIME := T#2S;\n\td1 : DATE := D#2026-05-09;\n\td2 : DATE := D#2026-05-10;\n" +
  "\tr1 : REAL := 1.5;\n\tr2 : LREAL := 2.5;\n\tb1 : BOOL := TRUE;\n\tb2 : BOOL;\n\tn1 : INT := 3;\n\tn2 : UDINT := 4;\n" +
  "\te1 : DUT_LANG_<name>;\n\te2 : DUT_LANG_<name> := DUT_LANG_<name>.On;"
const SCALAR_EXPRS = ["s1 = s2", "s1 < s2", "w1 <> w2", "t1 < t2", "d1 >= d2", "r1 < r2", "b1 = b2", "n1 < n2", "e1 = e2"]
const enumOf = (name: string): string => `TYPE DUT_LANG_${name} :\n(\n\tOff := 0,\n\tOn := 1\n);\nEND_TYPE\n\n`

const POINTERS =
  "\tx : INT;\n\ty : INT;\n\tpa : POINTER TO INT;\n\tpb : POINTER TO INT;\n\tpr : POINTER TO REAL;\n\tlw : LWORD;\n\tul : ULINT;\n\tdw : DWORD;"
const POINTER_SETUP = "pa := ADR(x);\npb := ADR(y);\nlw := pa;\nul := pa;"

const TIME_LTIME = "\tt : TIME := T#1S;\n\tlt2 : LTIME := LTIME#2S;"

const CB4: LanguageTest[] = [
  // CB4 — every comparison names BOOL: one family at a time
  probe("cb_compare_result_types", "a comparison of two STRINGs, WSTRINGs, TIMEs, DATEs, a REAL with an LREAL, two BOOLs, INT with UDINT and two enum values, into STRINGs",
    SCALARS.replaceAll("<name>", "cb_compare_result_types"), "", SCALAR_EXPRS, "STRING", enumOf("cb_compare_result_types")),
  probe("cb_compare_result_values", "the same comparisons stored into BOOLs",
    SCALARS.replaceAll("<name>", "cb_compare_result_values"), "", SCALAR_EXPRS, "BOOL", enumOf("cb_compare_result_values")),
  // …two pointers: equal, unequal, ordered, and a pointer against a pointer to another type and against integers
  probe("cb_compare_pointers", "a comparison of two POINTER TO INT (=, <>, <, >=), of a POINTER TO INT with a POINTER TO REAL, and of a pointer with an LWORD, a ULINT and a DWORD, into STRINGs",
    POINTERS, POINTER_SETUP, ["pa = pb", "pa <> pb", "pa < pb", "pa >= pb", "pa = pr", "pa = lw", "ul = pa", "pa = dw"], "STRING"),
  probe("cb_compare_pointer_values", "two POINTER TO INT compared (=, <>) and a pointer against the LWORD and ULINT it was stored into, into BOOLs",
    POINTERS, POINTER_SETUP, ["pa = pb", "pa <> pb", "pa = pa", "pa = lw", "ul = pa"], "BOOL"),
  // …a TIME against an LTIME, either side
  probe("cb_compare_time_ltime", "a TIME compared with an LTIME, either side (=, <, >=), into STRINGs",
    TIME_LTIME, "", ["t = lt2", "t < lt2", "lt2 >= t"], "STRING"),
  probe("cb_compare_time_ltime_values", "a TIME (1 s) compared with an LTIME (2 s), either side, into BOOLs",
    TIME_LTIME, "", ["t = lt2", "t < lt2", "lt2 >= t"], "BOOL"),
]

const SHORT_CIRCUIT =
  "\ta : INT := 6;\n\tb : INT := 3;\n\twa : WORD := 16#00F0;\n\twb : WORD := 16#0FF0;\n\tba : BOOL := TRUE;\n\tbb : BOOL;"

const CB5: LanguageTest[] = [
  // CB5 — AND_THEN / OR_ELSE: BOOL operands name their type; integers and bit strings are what is asked
  probe("cb_and_then_on_int", "AND_THEN of two INTs, into an INT", SHORT_CIRCUIT, "", ["a AND_THEN b"], "INT"),
  probe("cb_or_else_on_int", "OR_ELSE of two INTs, into an INT", SHORT_CIRCUIT, "", ["a OR_ELSE b"], "INT"),
  probe("cb_and_then_on_word", "AND_THEN and OR_ELSE of two WORDs, into WORDs", SHORT_CIRCUIT, "", ["wa AND_THEN wb", "wa OR_ELSE wb"], "WORD"),
  probe("cb_and_then_bool_and_int", "AND_THEN and OR_ELSE of a BOOL and an INT, either side, into BOOLs", SHORT_CIRCUIT, "",
    ["ba AND_THEN a", "a OR_ELSE ba"], "BOOL"),
  probe("cb_and_then_result_type", "AND_THEN and OR_ELSE of two BOOLs, into STRINGs", SHORT_CIRCUIT, "", ["ba AND_THEN bb", "ba OR_ELSE bb"], "STRING"),
]

export const COMPARISON_BOOL_TESTS: readonly LanguageTest[] = [...CB4, ...CB5]
