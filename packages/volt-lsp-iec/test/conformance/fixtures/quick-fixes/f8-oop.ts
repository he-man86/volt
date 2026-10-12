/**
 * F8 — the OBJECT-ORIENTED SIGNATURES (design.md §4 F8): an override whose declaration differs from the base's (C0094) or
 * from the interface's (C0089) is given that declaration — a choice, since changing the base or the interface is as valid
 * (that edit is not offered: it reaches another object and every other override, §1); a missing interface METHOD or
 * PROPERTY gets a stub with the interface's signature (C0087); FB_Init / FB_Exit get the inputs the compiler requires
 * (C0119); `{attribute 'abstract'}` gets its ABSTRACT keyword (CODESYS only); ABSTRACT FINAL loses one of the two — a
 * choice.
 *
 * The stub is asked on every section a METHOD signature has (VAR_INPUT, VAR_OUTPUT, VAR_IN_OUT) and on a PROPERTY with a
 * SET; FB_Init on each input it may lack — bInCopyCode, bInitRetains, or both (review of step 1, 2026-10-12).
 *
 * A function block that is or may become ABSTRACT is never instanced: PLC_PRG holds a POINTER to it (`abstractFb`).
 */
import type { LanguageTest } from "../../types.js"
import { abstractFb, after, fb } from "./shared.js"

const overrides = (n: string, returns: string): string =>
  `FUNCTION_BLOCK FB_LANG_${n}_base\nVAR\n\tb : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\nMETHOD Fetch : INT\nFetch := 1;\nEND_METHOD\n\n` +
  `FUNCTION_BLOCK FB_LANG_${n} EXTENDS FB_LANG_${n}_base\nVAR\n\tout : DINT;\nEND_VAR\nout := Fetch();\nEND_FUNCTION_BLOCK\n\nMETHOD Fetch : ${returns}\nFetch := 2;\nEND_METHOD\n`
const implements_ = (n: string, returns: string): string =>
  `INTERFACE ITF_LANG_${n}_area\nMETHOD Area : INT\nEND_METHOD\nEND_INTERFACE\n\n` +
  `FUNCTION_BLOCK FB_LANG_${n} IMPLEMENTS ITF_LANG_${n}_area\nVAR\n\tout : DINT;\nEND_VAR\nout := Area();\nEND_FUNCTION_BLOCK\n\nMETHOD Area : ${returns}\nArea := 2;\nEND_METHOD\n`
const missingMethod = (n: string, stub: string): string =>
  `INTERFACE ITF_LANG_${n}_compute\nMETHOD Compute : INT\nVAR_INPUT\n\tx : INT;\nEND_VAR\nEND_METHOD\nEND_INTERFACE\n\n` +
  `FUNCTION_BLOCK FB_LANG_${n} IMPLEMENTS ITF_LANG_${n}_compute\nVAR\n\tout : INT;\nEND_VAR\nout := 1;\nEND_FUNCTION_BLOCK\n${stub}`
const missingProperty = (n: string, stub: string): string =>
  `INTERFACE ITF_LANG_${n}_level\nPROPERTY Level : INT\nGET\nEND_GET\nEND_PROPERTY\nEND_INTERFACE\n\n` +
  `FUNCTION_BLOCK FB_LANG_${n} IMPLEMENTS ITF_LANG_${n}_level\nVAR\n\tout : INT;\nEND_VAR\nout := 1;\nEND_FUNCTION_BLOCK\n${stub}`
const missingSections = (n: string, stub: string): string =>
  `INTERFACE ITF_LANG_${n}_compute\nMETHOD Compute : INT\nVAR_INPUT\n\tx : INT;\nEND_VAR\nVAR_OUTPUT\n\ty : INT;\nEND_VAR\nVAR_IN_OUT\n\tz : INT;\nEND_VAR\nEND_METHOD\nEND_INTERFACE\n\n` +
  `FUNCTION_BLOCK FB_LANG_${n} IMPLEMENTS ITF_LANG_${n}_compute\nVAR\n\tout : INT;\nEND_VAR\nout := 1;\nEND_FUNCTION_BLOCK\n${stub}`
const missingSetter = (n: string, stub: string): string =>
  `INTERFACE ITF_LANG_${n}_level\nPROPERTY Level : INT\nGET\nEND_GET\nSET\nEND_SET\nEND_PROPERTY\nEND_INTERFACE\n\n` +
  `FUNCTION_BLOCK FB_LANG_${n} IMPLEMENTS ITF_LANG_${n}_level\nVAR\n\tout : INT;\nEND_VAR\nout := 1;\nEND_FUNCTION_BLOCK\n${stub}`
const lifecycle = (n: string, method: string, inputs: string): string =>
  `FUNCTION_BLOCK FB_LANG_${n}\nVAR\n\tcount : INT;\nEND_VAR\ncount := count + 1;\nEND_FUNCTION_BLOCK\n\nMETHOD ${method} : BOOL\nVAR_INPUT\n${inputs}END_VAR\ncount := 0;\nEND_METHOD\n`
const abstractKeyword = (n: string, header: string): string =>
  `{attribute 'abstract'}\nFUNCTION_BLOCK ${header}FB_LANG_${n}\nVAR\n\tcount : INT;\nEND_VAR\ncount := count + 1;\nEND_FUNCTION_BLOCK\n`
const modifiers = (n: string, header: string): string =>
  `FUNCTION_BLOCK ${header}FB_LANG_${n}\nVAR\n\tcount : INT;\nEND_VAR\ncount := count + 1;\nEND_FUNCTION_BLOCK\n`

export const QF_OOP_TESTS: readonly LanguageTest[] = [
  fb("qf_c0094_before", "BEFORE — an override returning DINT where the base's method returns INT", (n) => overrides(n, "DINT")),
  after(fb("qf_c0094_match_base", "AFTER — the override declared as the base's method", (n) => overrides(n, "INT")),
    { before: "qf_c0094_before", code: "C0094", title: "Match the declaration of 'FB_LANG_qf_c0094_before_base.Fetch'" }),

  fb("qf_c0089_before", "BEFORE — a method returning DINT where the interface's returns INT", (n) => implements_(n, "DINT")),
  after(fb("qf_c0089_match_interface", "AFTER — the method declared as the interface's", (n) => implements_(n, "INT")),
    { before: "qf_c0089_before", code: "C0089", title: "Match the declaration of 'ITF_LANG_qf_c0089_before_area.Area'" }),

  fb("qf_c0087_before_method", "BEFORE — an interface METHOD the function block does not implement", (n) => missingMethod(n, "")),
  after(fb("qf_c0087_stub_method", "AFTER — the METHOD stubbed with the interface's signature",
    (n) => missingMethod(n, "\nMETHOD Compute : INT\nVAR_INPUT\n\tx : INT;\nEND_VAR\nEND_METHOD\n")),
    { before: "qf_c0087_before_method", code: "C0087", title: "Add METHOD 'Compute'", preferred: true }),

  fb("qf_c0087_before_property", "BEFORE — an interface PROPERTY the function block does not implement", (n) => missingProperty(n, "")),
  after(fb("qf_c0087_stub_property", "AFTER — the PROPERTY stubbed with the interface's GET",
    (n) => missingProperty(n, "\nPROPERTY Level : INT\nGET\nEND_GET\nEND_PROPERTY\n")),
    { before: "qf_c0087_before_property", code: "C0087", title: "Add PROPERTY 'Level'", preferred: true }),

  fb("qf_c0087_before_method_sections", "BEFORE — an interface METHOD with a VAR_INPUT, a VAR_OUTPUT and a VAR_IN_OUT, not implemented",
    (n) => missingSections(n, "")),
  after(fb("qf_c0087_stub_method_sections", "AFTER — the METHOD stubbed with every section of the interface's signature",
    (n) => missingSections(n, "\nMETHOD Compute : INT\nVAR_INPUT\n\tx : INT;\nEND_VAR\nVAR_OUTPUT\n\ty : INT;\nEND_VAR\nVAR_IN_OUT\n\tz : INT;\nEND_VAR\nEND_METHOD\n")),
    { before: "qf_c0087_before_method_sections", code: "C0087", title: "Add METHOD 'Compute'", preferred: true }),

  fb("qf_c0087_before_property_set", "BEFORE — an interface PROPERTY with a GET and a SET, not implemented", (n) => missingSetter(n, "")),
  after(fb("qf_c0087_stub_property_set", "AFTER — the PROPERTY stubbed with the interface's GET and SET",
    (n) => missingSetter(n, "\nPROPERTY Level : INT\nGET\nEND_GET\nSET\nEND_SET\nEND_PROPERTY\n")),
    { before: "qf_c0087_before_property_set", code: "C0087", title: "Add PROPERTY 'Level'", preferred: true }),

  fb("qf_c0119_before_init", "BEFORE — FB_Init with bInitRetains only", (n) => lifecycle(n, "FB_Init", "\tbInitRetains : BOOL;\n")),
  after(fb("qf_c0119_init", "AFTER — FB_Init given bInCopyCode", (n) => lifecycle(n, "FB_Init", "\tbInitRetains : BOOL;\n\tbInCopyCode : BOOL;\n")),
    { before: "qf_c0119_before_init", code: "C0119", title: "Add the input 'bInCopyCode : BOOL'", preferred: true }),

  fb("qf_c0119_before_exit", "BEFORE — FB_Exit with no input", (n) => lifecycle(n, "FB_Exit", "")),
  after(fb("qf_c0119_exit", "AFTER — FB_Exit given bInCopyCode", (n) => lifecycle(n, "FB_Exit", "\tbInCopyCode : BOOL;\n")),
    { before: "qf_c0119_before_exit", code: "C0119", title: "Add the input 'bInCopyCode : BOOL'", preferred: true }),

  fb("qf_c0119_before_init_none", "BEFORE — FB_Init with neither input", (n) => lifecycle(n, "FB_Init", "")),
  after(fb("qf_c0119_init_both", "AFTER — FB_Init given bInitRetains and bInCopyCode",
    (n) => lifecycle(n, "FB_Init", "\tbInitRetains : BOOL;\n\tbInCopyCode : BOOL;\n")),
    { before: "qf_c0119_before_init_none", code: "C0119", title: "Add the inputs 'bInitRetains : BOOL; bInCopyCode : BOOL'", preferred: true }),

  fb("qf_c0119_before_init_retains", "BEFORE — FB_Init with bInCopyCode only", (n) => lifecycle(n, "FB_Init", "\tbInCopyCode : BOOL;\n")),
  after(fb("qf_c0119_init_retains", "AFTER — FB_Init given bInitRetains before bInCopyCode",
    (n) => lifecycle(n, "FB_Init", "\tbInitRetains : BOOL;\n\tbInCopyCode : BOOL;\n")),
    { before: "qf_c0119_before_init_retains", code: "C0119", title: "Add the input 'bInitRetains : BOOL'", preferred: true }),

  abstractFb("qf_abstract_before", "BEFORE — {attribute 'abstract'} on a function block without the keyword", (n) => abstractKeyword(n, "")),
  after(abstractFb("qf_abstract_keyword", "AFTER — ABSTRACT added", (n) => abstractKeyword(n, "ABSTRACT ")),
    { before: "qf_abstract_before", code: "abstract-keyword-missing", title: "Add ABSTRACT", preferred: true }),

  abstractFb("qf_abstract_final_before", "BEFORE — a function block both ABSTRACT and FINAL", (n) => modifiers(n, "ABSTRACT FINAL ")),
  after(abstractFb("qf_abstract_final_keep_final", "AFTER — ABSTRACT removed", (n) => modifiers(n, "FINAL ")),
    { before: "qf_abstract_final_before", code: "abstract-and-final", title: "Remove ABSTRACT" }),
  after(abstractFb("qf_abstract_final_keep_abstract", "AFTER — FINAL removed", (n) => modifiers(n, "ABSTRACT ")),
    { before: "qf_abstract_final_before", code: "abstract-and-final", title: "Remove FINAL" }),
]
