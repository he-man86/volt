/**
 * F7 — the CONSTANT WITHOUT AN INITIAL VALUE (C0228, design.md §4 F7): `:= <the value the compiler already gives it>`,
 * so the fix changes nothing the program does, and is `preferred`.
 *
 * That value is NOT the type's initial value as a variable has it — measured on every kind of type (CODESYS record:exec,
 * 2026-10-12, after the review of step 1 asked): a CONSTANT of an alias that states its own (`TYPE A : INT := 42`) runs as
 * 0, not 42 (`qf_c0228_before_alias`: out = 1), and one of an INLINE subrange `INT(3..9)` as 0, outside its own range
 * (`qf_c0228_before_inline_subrange`: out = 1) — only a NAMED subrange's runs at its lower bound (`qf_c0228_before_subrange`:
 * out = 4). So each AFTER writes what its BEFORE ran with.
 *
 * Where the front-end FOLDS the constant (`frontend/types/const/values.ts`) — an ARRAY bound and a CASE label — the
 * value is asked too: the bound reads 0 (`qf_c0228_bound_alias`: "The constant index '42' is not within the range from
 * '1' to '0'"), yet `ARRAY[1..cap]` is NOT refused for its order (`qf_c0228_bound` builds clean), and a NAMED subrange's
 * constant is no constant there at all (`qf_c0228_bound_subrange`: "Array border cap does not evaluate to a valid signed
 * integer constant"); the CASE label reads 0 ("CASE label duplicate" beside `0:`).
 */
import type { LanguageTest } from "../../types.js"
import { after, fb } from "./shared.js"

const ALIAS = (n: string): string => `TYPE DUT_LANG_${n}_a : INT := 42;\nEND_TYPE\n\n`
const RANGE = (n: string): string => `TYPE DUT_LANG_${n}_r : INT(3..9);\nEND_TYPE\n\n`

/** A function block with the CONSTANT `cap : <type><init>` and the statements `body` over `vars`. */
const constant = (n: string, type: string, init: string, vars = "\tout : INT;", body = "out := cap + 1;", types = ""): string =>
  `${types}FUNCTION_BLOCK FB_LANG_${n}\nVAR CONSTANT\n\tcap : ${type}${init};\nEND_VAR\nVAR\n${vars}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n`

export const QF_CONSTANT_TESTS: readonly LanguageTest[] = [
  fb("qf_c0228_before", "BEFORE — a VAR CONSTANT with no initial value", (n) => constant(n, "INT", "")),
  after(fb("qf_c0228_initialize", "AFTER — the type's initial value written out", (n) => constant(n, "INT", " := 0")),
    { before: "qf_c0228_before", code: "C0228", title: "Initialize with ':= 0'", preferred: true }),

  fb("qf_c0228_before_alias", "BEFORE — a CONSTANT of an alias that states its own initial value, given none",
    (n) => constant(n, `DUT_LANG_${n}_a`, "", undefined, undefined, ALIAS(n))),
  after(fb("qf_c0228_initialize_alias", "AFTER — the value it ran with (0, not the alias's 42) written out",
    (n) => constant(n, `DUT_LANG_${n}_a`, " := 0", undefined, undefined, ALIAS(n))),
    { before: "qf_c0228_before_alias", code: "C0228", title: "Initialize with ':= 0'", preferred: true }),

  fb("qf_c0228_before_subrange", "BEFORE — a CONSTANT of a named subrange that excludes 0, given no initial value",
    (n) => constant(n, `DUT_LANG_${n}_r`, "", undefined, undefined, RANGE(n))),
  after(fb("qf_c0228_initialize_subrange", "AFTER — the subrange's lower bound written out",
    (n) => constant(n, `DUT_LANG_${n}_r`, " := 3", undefined, undefined, RANGE(n))),
    { before: "qf_c0228_before_subrange", code: "C0228", title: "Initialize with ':= 3'", preferred: true }),

  // no fix here: the value it ran with cannot be written — CODESYS refuses `cap : INT(3..9) := 0` (2026-10-12), and any
  // value the range admits changes what the program does
  fb("qf_c0228_before_inline_subrange", "a CONSTANT of an inline subrange that excludes 0, given no initial value",
    (n) => constant(n, "INT(3..9)", ""),
    { fixAbsent: { code: "C0228", why: "it runs as 0, outside INT(3..9) (record:exec: out = 1); `:= 0` is refused — \"Cannot convert type '0' to type 'INT (3..9)'\" — and `:= 3` changes what the program does" } }),

  // WHERE THE FOLD READS IT — the value an uninitialized constant has in an ARRAY bound and a CASE label
  fb("qf_c0228_bound", "an INT CONSTANT with no initial value as an ARRAY's upper bound",
    (n) => constant(n, "INT", "", "\tarr : ARRAY[1..cap] OF INT;\n\tout : INT;", "out := 1;")),
  fb("qf_c0228_bound_subrange", "a CONSTANT of a subrange INT(3..9) with no initial value as an ARRAY's upper bound",
    (n) => constant(n, `DUT_LANG_${n}_r`, "", "\tarr : ARRAY[1..cap] OF INT;\n\tout : INT;", "arr[3] := 5;\nout := arr[3];", RANGE(n)),
    { deferred: { lsp: "niche: accepted loss (0 occurrences in the corpora — their one constant with no initial value is a STRUCT that bounds nothing) — the LSP says nothing where both vendors say \"Array border cap does not evaluate to a valid signed integer constant\"" } }),
  fb("qf_c0228_bound_alias", "a CONSTANT of an alias INT := 42 with no initial value as an ARRAY's upper bound",
    (n) => constant(n, `DUT_LANG_${n}_a`, "", "\tarr : ARRAY[1..cap] OF INT;\n\tout : INT;", "arr[42] := 5;\nout := arr[42];", ALIAS(n))),
  fb("qf_c0228_case_label", "an INT CONSTANT with no initial value as a CASE label beside the label 0",
    (n) => constant(n, "INT", "", "\tx : INT := 1;\n\tout : INT;", "CASE x OF\ncap: out := 1;\n0: out := 2;\nELSE\n\tout := 3;\nEND_CASE")),

  // THE BORDER RULE, asked by the review of step 1: is `1..0` (an EMPTY array) refused for its order when no
  // uninitialized constant is named — written as a literal, from an initialized constant, from a constant initialized
  // FROM an uninitialized one?
  fb("qf_c0228_bound_literal_empty", "an ARRAY written with the literal bounds 1..0",
    (n) => `FUNCTION_BLOCK FB_LANG_${n}\nVAR\n\tarr : ARRAY[1..0] OF INT;\n\tout : INT;\nEND_VAR\nout := 1;\nEND_FUNCTION_BLOCK\n`),
  fb("qf_c0228_bound_literal_two_below", "an ARRAY written with the literal bounds 2..0 — one past empty",
    (n) => `FUNCTION_BLOCK FB_LANG_${n}\nVAR\n\tarr : ARRAY[2..0] OF INT;\n\tout : INT;\nEND_VAR\nout := 1;\nEND_FUNCTION_BLOCK\n`),
  fb("qf_c0228_bound_init_zero", "an INT CONSTANT initialized to 0 as an ARRAY's upper bound (1..0)",
    (n) => constant(n, "INT", " := 0", "\tarr : ARRAY[1..cap] OF INT;\n\tout : INT;", "out := 1;")),
  fb("qf_c0228_bound_chained", "a CONSTANT initialized FROM a constant with no initial value, as an ARRAY's upper bound",
    (n) => `FUNCTION_BLOCK FB_LANG_${n}\nVAR CONSTANT\n\tcap : INT;\n\tc2 : INT := cap;\nEND_VAR\nVAR\n\tarr : ARRAY[1..c2] OF INT;\n\tout : INT;\nEND_VAR\nout := 1;\nEND_FUNCTION_BLOCK\n`),
  // the other compile-time readers of the uninitialized constant's 0: an INLINE subrange's constant as a bound, and an
  // initializer list sized by it
  fb("qf_c0228_bound_inline_subrange", "a CONSTANT of an inline subrange INT(3..9) with no initial value as an ARRAY's upper bound",
    (n) => constant(n, "INT(3..9)", "", "\tarr : ARRAY[1..cap] OF INT;\n\tout : INT;", "arr[3] := 5;\nout := arr[3];"),
    { deferred: { lsp: "niche: accepted loss (0 occurrences in the corpora — their one constant with no initial value is a STRUCT that bounds nothing) — the LSP says nothing where both vendors say \"Array border cap does not evaluate to a valid signed integer constant\", as for the named subrange (`qf_c0228_bound_subrange`)" } }),
  fb("qf_c0228_bound_init_list", "an ARRAY bounded by an INT CONSTANT with no initial value, initialized with two elements",
    (n) => constant(n, "INT", "", "\tarr : ARRAY[1..cap] OF INT := [1, 2];\n\tout : INT;", "out := 1;")),
  // a SUBRANGE-typed constant WITH an initial value as a bound: is the refusal about the missing value, or the subrange?
  fb("qf_c0228_bound_subrange_init", "a CONSTANT of a named subrange INT(3..9) := 5 as an ARRAY's upper bound",
    (n) => constant(n, `DUT_LANG_${n}_r`, " := 5", "\tarr : ARRAY[1..cap] OF INT;\n\tout : INT;", "arr[3] := 5;\nout := arr[3];", RANGE(n))),
  fb("qf_c0228_bound_inline_subrange_init", "a CONSTANT of an inline subrange INT(3..9) := 5 as an ARRAY's upper bound",
    (n) => constant(n, "INT(3..9)", " := 5", "\tarr : ARRAY[1..cap] OF INT;\n\tout : INT;", "arr[3] := 5;\nout := arr[3];")),
]
