/**
 * F3 — the NEAR-MISS NAME and the DECLARATION (design.md §4 F3). One engine answers every "not found" finding with "Change
 * to '<name>'" for each name the reporting check looked up that is within two edits of the one written: an identifier
 * (C0046), a type (C0077), a member (C0004), a struct initializer's field (`unknown-struct-field`), a base class (C0090), a
 * named input (C0037) and output (C0038), a jump label (C0117), an interface (C0086), the global a VAR_EXTERNAL names
 * (C0237), an attribute (C0351, CODESYS only — TwinCAT says nothing about an unknown attribute). C0046 also offers "Declare
 * '<name>' : <T>" where the use gives the type — the other side of an assignment (as target and as value), the input an
 * argument feeds, BOOL for a condition — and nothing where it does not (`qf_c0046_absent_declare`). C0351 also offers
 * removing the attribute. All of them are choices, so none is `preferred`.
 *
 * C0237's change renames the declaration AND its uses in the unit: renaming the declaration alone leaves the body naming
 * a variable that no longer exists.
 */
import type { LanguageTest } from "../../types.js"
import { after, fb } from "./shared.js"

const body = (n: string, vars: string, statements: string, before = ""): string =>
  `${before}FUNCTION_BLOCK FB_LANG_${n}\nVAR\n${vars}\nEND_VAR\n${statements}\nEND_FUNCTION_BLOCK\n`
const STRUCT = (n: string): string => `TYPE DUT_LANG_${n}_point :\nSTRUCT\n\tvalue : INT;\nEND_STRUCT\nEND_TYPE\n\n`
const TWICE = (n: string): string =>
  `FUNCTION F_LANG_${n}_twice : INT\nVAR_INPUT\n\tvalue : INT;\nEND_VAR\nF_LANG_${n}_twice := value * 2;\nEND_FUNCTION\n\n`
const SCALE = (n: string): string =>
  `FUNCTION F_LANG_${n}_scale : REAL\nVAR_INPUT\n\tfactor : REAL;\nEND_VAR\nF_LANG_${n}_scale := factor * 2.0;\nEND_FUNCTION\n\n`
const WORKER = (n: string): string =>
  `FUNCTION_BLOCK FB_LANG_${n}_worker\nVAR_OUTPUT\n\tdone : BOOL;\nEND_VAR\ndone := TRUE;\nEND_FUNCTION_BLOCK\n\n`
const SHAPE = (n: string): string => `INTERFACE ITF_LANG_${n}_shape\nEND_INTERFACE\n\n`
const BASE = (n: string): string => `FUNCTION_BLOCK FB_LANG_${n}_base\nVAR\n\tlevel : INT;\nEND_VAR\nlevel := level + 1;\nEND_FUNCTION_BLOCK\n\n`
const GVL = (n: string): string => `VAR_GLOBAL\n\tg_${n}_counter : INT := 3;\nEND_VAR\n\n`

export const QF_NEAR_MISS_TESTS: readonly LanguageTest[] = [
  // ─── C0046 identifier: the near miss, and the declaration at each kind of use ─────────────────────────────────────
  fb("qf_c0046_before_near", "BEFORE — `countr` written for the declared `counter`",
    (n) => body(n, "\tcounter : INT;", "countr := counter + 1;")),
  after(fb("qf_c0046_change", "AFTER — changed to the declared name", (n) => body(n, "\tcounter : INT;", "counter := counter + 1;")),
    { before: "qf_c0046_before_near", code: "C0046", title: "Change to 'counter'" }),

  fb("qf_c0046_before_declare_target", "BEFORE — an undeclared assignment target, its type the value's",
    (n) => body(n, "\tcap : INT := 4;", "total := cap;")),
  after(fb("qf_c0046_declare_target", "AFTER — the target declared with the value's type",
    (n) => body(n, "\tcap : INT := 4;\n\ttotal : INT;", "total := cap;")),
    { before: "qf_c0046_before_declare_target", code: "C0046", title: "Declare 'total' : INT" }),

  fb("qf_c0046_before_declare_value", "BEFORE — an undeclared assignment value, its type the target's",
    (n) => body(n, "\tout : DINT;", "out := level;")),
  after(fb("qf_c0046_declare_value", "AFTER — the value declared with the target's type",
    (n) => body(n, "\tout : DINT;\n\tlevel : DINT;", "out := level;")),
    { before: "qf_c0046_before_declare_value", code: "C0046", title: "Declare 'level' : DINT" }),

  fb("qf_c0046_before_declare_argument", "BEFORE — an undeclared argument, its type the input's",
    (n) => body(n, "\tout : REAL;", `out := F_LANG_${n}_scale(factor := amount);`, SCALE(n))),
  after(fb("qf_c0046_declare_argument", "AFTER — the argument declared with the input's type",
    (n) => body(n, "\tout : REAL;\n\tamount : REAL;", `out := F_LANG_${n}_scale(factor := amount);`, SCALE(n))),
    { before: "qf_c0046_before_declare_argument", code: "C0046", title: "Declare 'amount' : REAL" }),

  fb("qf_c0046_before_declare_condition", "BEFORE — an undeclared IF condition",
    (n) => body(n, "\tout : INT;", "IF ready THEN\n\tout := 1;\nEND_IF")),
  after(fb("qf_c0046_declare_condition", "AFTER — the condition declared BOOL",
    (n) => body(n, "\tout : INT;\n\tready : BOOL;", "IF ready THEN\n\tout := 1;\nEND_IF")),
    { before: "qf_c0046_before_declare_condition", code: "C0046", title: "Declare 'ready' : BOOL" }),

  fb("qf_c0046_absent_declare", "an undeclared name assigned from another undeclared name: no type to infer, no declaration",
    (n) => body(n, "\tout : INT;", "qfFirst := qfSecond;\nout := 1;"),
    { fixAbsent: { code: "C0046", title: "Declare", why: "the other side is undeclared too, so the use gives no type — a declaration would guess one" } }),

  // ─── C0077 type ───────────────────────────────────────────────────────────────────────────────────────────────────
  fb("qf_c0077_before", "BEFORE — `DIMT` written for DINT", (n) => body(n, "\tcount : DIMT;", "count := count + 1;")),
  after(fb("qf_c0077_change", "AFTER — the type changed to DINT", (n) => body(n, "\tcount : DINT;", "count := count + 1;")),
    { before: "qf_c0077_before", code: "C0077", title: "Change to 'DINT'" }),

  // ─── C0004 member, unknown-struct-field ───────────────────────────────────────────────────────────────────────────
  fb("qf_c0004_before", "BEFORE — `p.vlaue` for the struct's `value`",
    (n) => body(n, `\tp : DUT_LANG_${n}_point;\n\tout : INT;`, "out := p.vlaue;", STRUCT(n))),
  after(fb("qf_c0004_change", "AFTER — the member changed to `value`",
    (n) => body(n, `\tp : DUT_LANG_${n}_point;\n\tout : INT;`, "out := p.value;", STRUCT(n))),
    { before: "qf_c0004_before", code: "C0004", title: "Change to 'value'" }),

  fb("qf_structfield_before", "BEFORE — a struct initializer naming `vlue`",
    (n) => body(n, `\tp : DUT_LANG_${n}_point := (vlue := 3);\n\tout : INT;`, "out := p.value;", STRUCT(n))),
  after(fb("qf_structfield_change", "AFTER — the field changed to `value`",
    (n) => body(n, `\tp : DUT_LANG_${n}_point := (value := 3);\n\tout : INT;`, "out := p.value;", STRUCT(n))),
    { before: "qf_structfield_before", code: "unknown-struct-field", title: "Change to 'value'" }),

  // ─── C0090 base class, C0086 interface ────────────────────────────────────────────────────────────────────────────
  fb("qf_c0090_before", "BEFORE — EXTENDS a misspelled base",
    (n) => `${BASE(n)}FUNCTION_BLOCK FB_LANG_${n} EXTENDS FB_LANG_${n}_bse\nVAR\n\tout : INT;\nEND_VAR\nout := 1;\nEND_FUNCTION_BLOCK\n`),
  after(fb("qf_c0090_change", "AFTER — the base's name corrected",
    (n) => `${BASE(n)}FUNCTION_BLOCK FB_LANG_${n} EXTENDS FB_LANG_${n}_base\nVAR\n\tout : INT;\nEND_VAR\nout := 1;\nEND_FUNCTION_BLOCK\n`),
    { before: "qf_c0090_before", code: "C0090", title: "Change to 'FB_LANG_qf_c0090_before_base'" }),

  fb("qf_c0086_before", "BEFORE — IMPLEMENTS a misspelled interface",
    (n) => `${SHAPE(n)}FUNCTION_BLOCK FB_LANG_${n} IMPLEMENTS ITF_LANG_${n}_shap\nVAR\n\tout : INT;\nEND_VAR\nout := 1;\nEND_FUNCTION_BLOCK\n`),
  after(fb("qf_c0086_change", "AFTER — the interface's name corrected",
    (n) => `${SHAPE(n)}FUNCTION_BLOCK FB_LANG_${n} IMPLEMENTS ITF_LANG_${n}_shape\nVAR\n\tout : INT;\nEND_VAR\nout := 1;\nEND_FUNCTION_BLOCK\n`),
    { before: "qf_c0086_before", code: "C0086", title: "Change to 'ITF_LANG_qf_c0086_before_shape'" }),

  // ─── C0037 input, C0038 output ────────────────────────────────────────────────────────────────────────────────────
  fb("qf_c0037_before", "BEFORE — a call naming the input `valeu`",
    (n) => body(n, "\tout : INT;", `out := F_LANG_${n}_twice(valeu := 2);`, TWICE(n))),
  after(fb("qf_c0037_change", "AFTER — the input changed to `value`",
    (n) => body(n, "\tout : INT;", `out := F_LANG_${n}_twice(value := 2);`, TWICE(n))),
    { before: "qf_c0037_before", code: "C0037", title: "Change to 'value'" }),

  fb("qf_c0038_before", "BEFORE — a call naming the output `dne`",
    (n) => body(n, `\tworker : FB_LANG_${n}_worker;\n\tflag : BOOL;`, "worker(dne => flag);", WORKER(n))),
  after(fb("qf_c0038_change", "AFTER — the output changed to `done`",
    (n) => body(n, `\tworker : FB_LANG_${n}_worker;\n\tflag : BOOL;`, "worker(done => flag);", WORKER(n))),
    { before: "qf_c0038_before", code: "C0038", title: "Change to 'done'" }),

  // ─── C0117 jump label ─────────────────────────────────────────────────────────────────────────────────────────────
  fb("qf_c0117_before", "BEFORE — JMP to a misspelled label",
    (n) => body(n, "\tout : INT;", "JMP skp;\nout := 1;\nskip: out := out + 2;")),
  after(fb("qf_c0117_change", "AFTER — the label's name corrected",
    (n) => body(n, "\tout : INT;", "JMP skip;\nout := 1;\nskip: out := out + 2;")),
    { before: "qf_c0117_before", code: "C0117", title: "Change to 'skip'" }),

  // ─── C0237 the global of a VAR_EXTERNAL ───────────────────────────────────────────────────────────────────────────
  fb("qf_c0237_before", "BEFORE — VAR_EXTERNAL naming a misspelled global",
    (n) => `${GVL(n)}FUNCTION_BLOCK FB_LANG_${n}\nVAR_EXTERNAL\n\tg_${n}_countr : INT;\nEND_VAR\nVAR\n\tout : INT;\nEND_VAR\nout := g_${n}_countr;\nEND_FUNCTION_BLOCK\n`,
    { gvlNames: ["GVL_LANG_qf_c0237_before"] }),
  after(fb("qf_c0237_change", "AFTER — the external and its use renamed to the global",
    (n) => `${GVL(n)}FUNCTION_BLOCK FB_LANG_${n}\nVAR_EXTERNAL\n\tg_${n}_counter : INT;\nEND_VAR\nVAR\n\tout : INT;\nEND_VAR\nout := g_${n}_counter;\nEND_FUNCTION_BLOCK\n`,
    { gvlNames: ["GVL_LANG_qf_c0237_change"] }),
    { before: "qf_c0237_before", code: "C0237", title: "Change to 'g_qf_c0237_before_counter'" }),

  // ─── C0351 attribute (CODESYS only) ───────────────────────────────────────────────────────────────────────────────
  fb("qf_c0351_before", "BEFORE — the attribute `hid` for `hide`",
    (n) => body(n, "\t{attribute 'hid'}\n\tsecret : INT;\n\tout : INT;", "out := secret + 1;")),
  after(fb("qf_c0351_change", "AFTER — the attribute changed to `hide`",
    (n) => body(n, "\t{attribute 'hide'}\n\tsecret : INT;\n\tout : INT;", "out := secret + 1;")),
    { before: "qf_c0351_before", code: "C0351", title: "Change to 'hide'" }),
  after(fb("qf_c0351_remove", "AFTER — the attribute removed",
    (n) => body(n, "\tsecret : INT;\n\tout : INT;", "out := secret + 1;")),
    { before: "qf_c0351_before", code: "C0351", title: "Remove the attribute" }),
]
