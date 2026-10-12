/**
 * F9 — the LOCAL EDITS (design.md §1's "trivial", §4 F9): one insertion, deletion, replacement or swap inside the reported
 * construct, from facts the reporting check resolved. Each has one meaning, so each is `preferred`. The statement- and
 * declaration-level ones are here; the keyword- and header-level ones are `f9-local-edits-b.ts`.
 */
import type { LanguageTest } from "../../types.js"
import { abstractFb, after, fb } from "./shared.js"

const body = (n: string, vars: string, statements: string, before = ""): string =>
  `${before}FUNCTION_BLOCK FB_LANG_${n}\nVAR\n${vars}\nEND_VAR\n${statements}\nEND_FUNCTION_BLOCK\n`
const NAMED = (n: string): string => `FUNCTION_BLOCK FB_LANG_${n}_named\nEND_FUNCTION_BLOCK\n\nMETHOD Value : INT\nValue := 3;\nEND_METHOD\n\n`
const SEVEN = (n: string): string =>
  `FUNCTION F_LANG_${n}_seven : INT\nVAR\n\tbase : INT := 7;\nEND_VAR\nF_LANG_${n}_seven := base;\nEND_FUNCTION\n\n`
/** `NAMED` / `SEVEN` with one parameter `k : INT` in the section `section` (VAR_INPUT or VAR_IN_OUT). */
const NAMED_WITH = (n: string, section: string): string =>
  `FUNCTION_BLOCK FB_LANG_${n}_named\nEND_FUNCTION_BLOCK\n\nMETHOD Value : INT\n${section}\n\tk : INT;\nEND_VAR\nValue := k + 3;\nEND_METHOD\n\n`
const SEVEN_WITH = (n: string, section: string): string =>
  `FUNCTION F_LANG_${n}_seven : INT\n${section}\n\tk : INT;\nEND_VAR\nF_LANG_${n}_seven := k + 7;\nEND_FUNCTION\n\n`
/** Why `Add ()` is not offered on a callable with a parameter: the compiler refuses the call it makes. */
const CALL_NEEDS_INPUTS = (name: string): string =>
  `CODESYS refuses the call with no argument (2026-10-12): "Function '${name}' requires exactly '1' inputs" — which argument is not the fix's to choose`
const GVL = (n: string): string => `VAR_GLOBAL\n\tg_${n} : INT := 3;\nEND_VAR\n\n`
const external = (n: string, decl: string): string =>
  `${GVL(n)}FUNCTION_BLOCK FB_LANG_${n}\nVAR_EXTERNAL\n\t${decl}\nEND_VAR\nVAR\n\tout : INT;\nEND_VAR\nout := g_${n};\nEND_FUNCTION_BLOCK\n`
const abstractOutput = (n: string, output: string): string =>
  `FUNCTION_BLOCK ABSTRACT FB_LANG_${n}\nVAR\n\tcount : INT;\nEND_VAR\ncount := count + 1;\nEND_FUNCTION_BLOCK\n\nMETHOD ABSTRACT Area : INT\nVAR_OUTPUT\n\t${output}\nEND_VAR\nEND_METHOD\n`
const inOut = (n: string, type: string): string =>
  `FUNCTION_BLOCK FB_LANG_${n}\nVAR_IN_OUT\n\tb : ${type};\nEND_VAR\nVAR\n\tout : BOOL;\nEND_VAR\nout := b;\nEND_FUNCTION_BLOCK\n`
const inOutCaller = (name: string): { plcPrgVar: string; plcPrgBody: string } => ({
  plcPrgVar: `inst_${name} : FB_LANG_${name};\n\tflag_${name} : BOOL;`,
  plcPrgBody: `inst_${name}(b := flag_${name});`,
})

export const QF_LOCAL_EDIT_TESTS: readonly LanguageTest[] = [
  fb("qf_c0013_before", "BEFORE — an empty ELSE", (n) => body(n, "\tready : BOOL;\n\tout : INT;", "IF ready THEN\n\tout := 1;\nELSE\nEND_IF")),
  after(fb("qf_c0013_insert", "AFTER — the empty statement inserted",
    (n) => body(n, "\tready : BOOL;\n\tout : INT;", "IF ready THEN\n\tout := 1;\nELSE\n\t;\nEND_IF")),
    { before: "qf_c0013_before", code: "C0013", title: "Insert the empty statement ';'", preferred: true }),

  fb("qf_c0130_before", "BEFORE — a METHOD read as a value without ()",
    (n) => body(n, `\tother : FB_LANG_${n}_named;\n\tm : INT;`, "m := other.Value;", NAMED(n))),
  after(fb("qf_c0130_call", "AFTER — the METHOD called",
    (n) => body(n, `\tother : FB_LANG_${n}_named;\n\tm : INT;`, "m := other.Value();", NAMED(n))),
    { before: "qf_c0130_before", code: "C0130", title: "Add '()'", preferred: true }),

  fb("qf_fnparens_before", "BEFORE — a FUNCTION named as a statement without ()",
    (n) => body(n, "\tout : INT;", `F_LANG_${n}_seven;\nout := 1;`, SEVEN(n))),
  after(fb("qf_fnparens_call", "AFTER — the FUNCTION called",
    (n) => body(n, "\tout : INT;", `F_LANG_${n}_seven();\nout := 1;`, SEVEN(n))),
    { before: "qf_fnparens_before", code: "function-without-parens", title: "Add '()'", preferred: true }),

  // 'Add ()' is REFUSED where the callable takes a parameter — a VAR_INPUT as well as a VAR_IN_OUT: CODESYS answers
  // `other.Value()` and `F_…_seven()` with "Function 'Value' requires exactly '1' inputs" (all four AFTERs, 2026-10-12)
  fb("qf_c0130_before_input", "a METHOD with a VAR_INPUT read as a value without ()",
    (n) => body(n, `\tother : FB_LANG_${n}_named;\n\tm : INT;`, "m := other.Value;", NAMED_WITH(n, "VAR_INPUT")),
    { fixAbsent: { code: "C0130", title: "Add '()'", why: CALL_NEEDS_INPUTS("Value") } }),
  fb("qf_c0130_before_inout", "a METHOD with a VAR_IN_OUT read as a value without ()",
    (n) => body(n, `\tother : FB_LANG_${n}_named;\n\tm : INT;`, "m := other.Value;", NAMED_WITH(n, "VAR_IN_OUT")),
    { fixAbsent: { code: "C0130", title: "Add '()'", why: CALL_NEEDS_INPUTS("Value") } }),
  fb("qf_fnparens_before_input", "a FUNCTION with a VAR_INPUT named as a statement without ()",
    (n) => body(n, "\tout : INT;", `F_LANG_${n}_seven;\nout := 1;`, SEVEN_WITH(n, "VAR_INPUT")),
    { fixAbsent: { code: "function-without-parens", title: "Add '()'", why: CALL_NEEDS_INPUTS("F_LANG_…_seven") } }),
  fb("qf_fnparens_before_inout", "a FUNCTION with a VAR_IN_OUT named as a statement without ()",
    (n) => body(n, "\tout : INT;", `F_LANG_${n}_seven;\nout := 1;`, SEVEN_WITH(n, "VAR_IN_OUT")),
    { fixAbsent: { code: "function-without-parens", title: "Add '()'", why: CALL_NEEDS_INPUTS("F_LANG_…_seven") } }),

  fb("qf_c0051_before", "BEFORE — an attribute name unquoted in hasattribute",
    (n) => body(n, "\tout : INT;", `{IF hasattribute (pou: FB_LANG_${n}, qfMarker)}\nout := 1;\n{END_IF}\nout := out + 1;`)),
  after(fb("qf_c0051_quote", "AFTER — the attribute name quoted",
    (n) => body(n, "\tout : INT;", `{IF hasattribute (pou: FB_LANG_${n}, 'qfMarker')}\nout := 1;\n{END_IF}\nout := out + 1;`)),
    { before: "qf_c0051_before", code: "C0051", title: "Quote as 'qfMarker'", preferred: true }),

  fb("qf_c0238_before", "BEFORE — a VAR_EXTERNAL with an initial value", (n) => external(n, `g_${n} : INT := 5;`),
    { gvlNames: ["GVL_LANG_qf_c0238_before"] }),
  after(fb("qf_c0238_remove", "AFTER — the initial value removed", (n) => external(n, `g_${n} : INT;`), { gvlNames: ["GVL_LANG_qf_c0238_remove"] }),
    { before: "qf_c0238_before", code: "C0238", title: "Remove the initial value", preferred: true }),

  abstractFb("qf_c0533_before", "BEFORE — a default on an ABSTRACT method's VAR_OUTPUT", (n) => abstractOutput(n, "extra : INT := 7;")),
  after(abstractFb("qf_c0533_remove", "AFTER — the default removed", (n) => abstractOutput(n, "extra : INT;")),
    { before: "qf_c0533_before", code: "C0533", title: "Remove the default value", preferred: true }),

  fb("qf_indexof_before", "BEFORE — INDEXOF", (n) => body(n, "\tcount : INT;\n\tp : POINTER TO INT;", "p := INDEXOF(count);")),
  after(fb("qf_indexof_adr", "AFTER — ADR", (n) => body(n, "\tcount : INT;\n\tp : POINTER TO INT;", "p := ADR(count);")),
    { before: "qf_indexof_before", code: "indexof-removed", title: "Change to ADR", preferred: true }),

  fb("qf_c0206_before", "BEFORE — an ARRAY OF BIT", (n) => body(n, "\ta : ARRAY[1..8] OF BIT;\n\tout : BOOL;", "a[1] := TRUE;\nout := a[1];")),
  after(fb("qf_c0206_bool", "AFTER — an ARRAY OF BOOL", (n) => body(n, "\ta : ARRAY[1..8] OF BOOL;\n\tout : BOOL;", "a[1] := TRUE;\nout := a[1];")),
    { before: "qf_c0206_before", code: "C0206", title: "Change BIT to BOOL", preferred: true }),

  fb("qf_c0204_before", "BEFORE — a BIT VAR_IN_OUT", (n) => inOut(n, "BIT"), inOutCaller("qf_c0204_before")),
  after(fb("qf_c0204_bool", "AFTER — a BOOL VAR_IN_OUT", (n) => inOut(n, "BOOL"), inOutCaller("qf_c0204_bool")),
    { before: "qf_c0204_before", code: "C0204", title: "Change BIT to BOOL", preferred: true }),

  fb("qf_border_before", "BEFORE — a subrange written high to low", (n) => body(n, "\tv : INT(10..0);\n\tout : INT;", "out := v;")),
  after(fb("qf_border_swap", "AFTER — the bounds swapped", (n) => body(n, "\tv : INT(0..10);\n\tout : INT;", "out := v;")),
    { before: "qf_border_before", code: "border-order", title: "Swap the bounds", preferred: true }),

  fb("qf_caserange_before", "BEFORE — a CASE range written high to low",
    (n) => body(n, "\ta : INT := 2;\n\tout : INT;", "CASE a OF\n3..1: out := 1;\nEND_CASE")),
  after(fb("qf_caserange_swap", "AFTER — the bounds swapped",
    (n) => body(n, "\ta : INT := 2;\n\tout : INT;", "CASE a OF\n1..3: out := 1;\nEND_CASE")),
    { before: "qf_caserange_before", code: "case-range-inverted", title: "Swap the bounds", preferred: true }),

  fb("qf_c0118_before", "BEFORE — a label nothing jumps to", (n) => body(n, "\tout : INT;", "lbl: out := 1;")),
  after(fb("qf_c0118_remove", "AFTER — the label removed", (n) => body(n, "\tout : INT;", "out := 1;")),
    { before: "qf_c0118_before", code: "C0118", title: "Remove the label 'lbl'", preferred: true }),
]
