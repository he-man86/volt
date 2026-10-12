/**
 * F1 — the CONVERSION fixes (design.md §4 F1): wrap the converted value in `TO_<target>(…)` at every site the conversion
 * checks report — an assignment, an initial value, a call argument, a function's return value — for the narrowing warning
 * (C0197: LREAL into REAL; an integer narrowing is C0032, an error, in both compilers), the change-of-sign warning (C0195),
 * the conversion error (C0032) and an argument's (`call-argument-type`); C0032 also binds a REFERENCE through `REF=`; a
 * conversion named for the wrong source type (`conversion-source-mismatch`) becomes the source-generic `TO_<target>(…)`.
 *
 * A warning's wrap is `preferred`: it is the conversion the compiler already makes, so it cannot mean anything else. An
 * error's is not — the value may be the wrong variable, not the wrong type.
 */
import type { LanguageTest } from "../../types.js"
import { after, fb } from "./shared.js"

const FN = (n: string, input: string, returns: string, body: string): string =>
  `FUNCTION F_LANG_${n}_half : ${returns}\nVAR_INPUT\n\tvalue : ${input};\nEND_VAR\n${body}\nEND_FUNCTION\n\n`
const assign = (n: string, value: string): string =>
  `FUNCTION_BLOCK FB_LANG_${n}\nVAR\n\twide : LREAL := 7.5;\n\tnarrow : REAL;\nEND_VAR\nnarrow := ${value};\nEND_FUNCTION_BLOCK\n`
const init = (n: string, value: string): string =>
  `FUNCTION_BLOCK FB_LANG_${n}\nVAR\n\twide : LREAL := 7.5;\n\tnarrow : REAL := ${value};\nEND_VAR\nnarrow := narrow + 1.0;\nEND_FUNCTION_BLOCK\n`
const argument = (n: string, value: string): string =>
  `${FN(n, "REAL", "REAL", `F_LANG_${n}_half := value / 2.0;`)}FUNCTION_BLOCK FB_LANG_${n}\nVAR\n\twide : LREAL := 8.5;\n\tresult : REAL;\nEND_VAR\nresult := F_LANG_${n}_half(value := ${value});\nEND_FUNCTION_BLOCK\n`
const returned = (n: string, value: string): string =>
  `${FN(n, "LREAL", "REAL", `F_LANG_${n}_half := ${value};`)}FUNCTION_BLOCK FB_LANG_${n}\nVAR\n\tresult : REAL;\nEND_VAR\nresult := F_LANG_${n}_half(value := 9.5);\nEND_FUNCTION_BLOCK\n`
const sign = (n: string, value: string): string =>
  `FUNCTION_BLOCK FB_LANG_${n}\nVAR\n\tsigned : INT := 5;\n\tunsigned : UINT;\nEND_VAR\nunsigned := ${value};\nEND_FUNCTION_BLOCK\n`
const mismatch = (n: string, value: string): string =>
  `FUNCTION_BLOCK FB_LANG_${n}\nVAR\n\tflag : BOOL := TRUE;\n\tcount : INT;\nEND_VAR\ncount := ${value};\nEND_FUNCTION_BLOCK\n`
const reference = (n: string, statement: string): string =>
  `FUNCTION_BLOCK FB_LANG_${n}\nVAR\n\tx : INT := 4;\n\tp : POINTER TO INT;\n\trf : REFERENCE TO INT;\n\tout : INT;\nEND_VAR\np := ADR(x);\n${statement}\nout := rf;\nEND_FUNCTION_BLOCK\n`
const callArgument = (n: string, value: string): string =>
  `${FN(n, "INT", "INT", `F_LANG_${n}_half := value / 2;`)}FUNCTION_BLOCK FB_LANG_${n}\nVAR\n\tflag : BOOL := TRUE;\n\tresult : INT;\nEND_VAR\nresult := F_LANG_${n}_half(value := ${value});\nEND_FUNCTION_BLOCK\n`
const conversion = (n: string, value: string): string =>
  `FUNCTION_BLOCK FB_LANG_${n}\nVAR\n\ti : INT := 3;\n\tu : UDINT;\nEND_VAR\nu := ${value};\nEND_FUNCTION_BLOCK\n`
/** A CHAINED store `a := b := c` over the variables `vars` (gate of step 2.1: each link is its own store). */
const chain = (n: string, vars: string, statement: string): string =>
  `FUNCTION_BLOCK FB_LANG_${n}\nVAR\n${vars}\nEND_VAR\n${statement}\nEND_FUNCTION_BLOCK\n`
/** The generic `TO_<to>(v)` from a `from` variable — whether the compiler has that generic conversion at all. */
const generic = (n: string, from: string, value: string, to: string): string =>
  `FUNCTION_BLOCK FB_LANG_${n}\nVAR\n\tv : ${from} := ${value};\n\tout : ${to};\nEND_VAR\nout := TO_${to}(v);\nEND_FUNCTION_BLOCK\n`

/**
 * THE GENERIC `TO_<T>` INTO EACH ELEMENTARY TYPE no other fixture writes (gate of step 2.1): the wrap names `TO_<target>`,
 * and `xp_*` records `X_TO_Y`, not the generic form. Each source is one whose `X_TO_<T>` is recorded building. A target
 * whose generic conversion does not build is not wrapped (`rules.ts` `GENERIC_CONVERSION_TARGETS`).
 */
const GENERIC_SOURCES: readonly (readonly [to: string, from: string, value: string])[] = [
  ["BOOL", "INT", "1"], ["LINT", "INT", "5"], ["ULINT", "INT", "5"], ["LWORD", "INT", "5"], ["LTIME", "TIME", "T#5MS"],
  ["DATE", "UDINT", "86400"], ["TOD", "UDINT", "3600000"], ["DT", "UDINT", "86400"],
  ["LDATE", "ULINT", "86400"], ["LTOD", "ULINT", "3600000"], ["LDT", "ULINT", "86400"],
]

export const QF_CONVERSION_TESTS: readonly LanguageTest[] = [
  // ─── C0197 narrowing, per site ────────────────────────────────────────────────────────────────────────────────────
  fb("qf_c0197_before_assign", "BEFORE — an LREAL stored into a REAL by an assignment", (n) => assign(n, "wide")),
  after(fb("qf_c0197_wrap_assign", "AFTER — the assignment's value wrapped in TO_REAL", (n) => assign(n, "TO_REAL(wide)")),
    { before: "qf_c0197_before_assign", code: "C0197", title: "Wrap in TO_REAL(…)", preferred: true }),

  fb("qf_c0197_before_init", "BEFORE — an LREAL stored into a REAL by an initial value", (n) => init(n, "wide")),
  after(fb("qf_c0197_wrap_init", "AFTER — the initial value wrapped in TO_REAL", (n) => init(n, "TO_REAL(wide)")),
    { before: "qf_c0197_before_init", code: "C0197", title: "Wrap in TO_REAL(…)", preferred: true }),

  fb("qf_c0197_before_argument", "BEFORE — an LREAL passed to a REAL input", (n) => argument(n, "wide")),
  after(fb("qf_c0197_wrap_argument", "AFTER — the argument wrapped in TO_REAL", (n) => argument(n, "TO_REAL(wide)")),
    { before: "qf_c0197_before_argument", code: "C0197", title: "Wrap in TO_REAL(…)", preferred: true }),

  fb("qf_c0197_before_return", "BEFORE — an LREAL returned from a REAL function", (n) => returned(n, "value")),
  after(fb("qf_c0197_wrap_return", "AFTER — the return value wrapped in TO_REAL", (n) => returned(n, "TO_REAL(value)")),
    { before: "qf_c0197_before_return", code: "C0197", title: "Wrap in TO_REAL(…)", preferred: true }),

  // ─── C0195 change of sign ─────────────────────────────────────────────────────────────────────────────────────────
  fb("qf_c0195_before", "BEFORE — an INT stored into a UINT", (n) => sign(n, "signed")),
  after(fb("qf_c0195_wrap", "AFTER — the value wrapped in TO_UINT", (n) => sign(n, "TO_UINT(signed)")),
    { before: "qf_c0195_before", code: "C0195", title: "Wrap in TO_UINT(…)", preferred: true }),

  // ─── C0032, one BEFORE per option ─────────────────────────────────────────────────────────────────────────────────
  fb("qf_c0032_before_wrap", "BEFORE — a BOOL stored into an INT", (n) => mismatch(n, "flag")),
  after(fb("qf_c0032_wrap", "AFTER — the BOOL wrapped in TO_INT", (n) => mismatch(n, "TO_INT(flag)")),
    { before: "qf_c0032_before_wrap", code: "C0032", title: "Wrap in TO_INT(…)" }),

  fb("qf_c0032_before_ref", "BEFORE — a POINTER TO INT stored into a REFERENCE TO INT with :=", (n) => reference(n, "rf := p;")),
  after(fb("qf_c0032_ref", "AFTER — the reference bound to what the pointer points to", (n) => reference(n, "rf REF= p^;")),
    { before: "qf_c0032_before_ref", code: "C0032", title: "Bind with 'rf REF= p^'" }),

  // ─── call-argument-type ───────────────────────────────────────────────────────────────────────────────────────────
  fb("qf_callarg_before", "BEFORE — a BOOL passed to an INT input", (n) => callArgument(n, "flag")),
  after(fb("qf_callarg_wrap", "AFTER — the argument wrapped in TO_INT", (n) => callArgument(n, "TO_INT(flag)")),
    { before: "qf_callarg_before", code: "call-argument-type", title: "Wrap in TO_INT(…)" }),

  // ─── conversion-source-mismatch ───────────────────────────────────────────────────────────────────────────────────
  fb("qf_convsrc_before", "BEFORE — TOD_TO_UDINT given an INT", (n) => conversion(n, "TOD_TO_UDINT(i)")),
  after(fb("qf_convsrc_generic", "AFTER — the conversion named for no source type", (n) => conversion(n, "TO_UDINT(i)")),
    { before: "qf_convsrc_before", code: "conversion-source-mismatch", title: "Change to TO_UDINT(…)", preferred: true }),

  // ─── a CHAINED store, link by link (gate of step 2.1) ────────────────────────────────────────────────────────────
  // measured once by hand as "Cannot convert type 'DINT' to type 'SINT'" (`assign_chained_plain`'s note): the OUTER link
  // stores `wide`, not `narrowFrom` — and its value is the next target, which no wrap can reach
  fb("qf_c0032_chain_outer", "a chain whose OUTER link is refused: SINT := DINT := INT", (n) =>
    chain(n, "\tviaWide : SINT;\n\twide : DINT;\n\tnarrowFrom : INT := 3;", "viaWide := wide := narrowFrom;"),
    { fixAbsent: { code: "C0032", title: "Wrap in", why: "the outer link's value is the next target: `a := TO_X(b) := c` does not parse" } }),
  fb("qf_c0032_chain_both", "a chain whose two links are both refused: INT := TIME := INT", (n) =>
    chain(n, "\ta : INT;\n\tb : TIME;\n\tc : INT := 3;", "a := b := c;")),
  fb("qf_c0032_before_chain", "BEFORE — a chain whose INNER link is refused: INT := INT := TIME", (n) =>
    chain(n, "\ta : INT;\n\tb : INT;\n\tc : TIME := T#5MS;", "a := b := c;")),
  after(fb("qf_c0032_wrap_chain", "AFTER — the inner link's value wrapped in TO_INT", (n) =>
    chain(n, "\ta : INT;\n\tb : INT;\n\tc : TIME := T#5MS;", "a := b := TO_INT(c);")),
    { before: "qf_c0032_before_chain", code: "C0032", title: "Wrap in TO_INT(…)" }),

  // ─── the generic TO_<T> into every elementary type no other fixture writes (gate of step 2.1) ─────────────────────
  ...GENERIC_SOURCES.map(([to, from, value]) =>
    fb(`qf_to_${to.toLowerCase()}`, `the generic TO_${to} of a ${from}`, (n) => generic(n, from, value, to))),
  fb("qf_to_bit", "the generic TO_BIT of an INT, into a STRUCT's BIT field", (n) =>
    `TYPE DUT_LANG_${n} :\nSTRUCT\n\tb : BIT;\nEND_STRUCT\nEND_TYPE\n\nFUNCTION_BLOCK FB_LANG_${n}\nVAR\n\trec : DUT_LANG_${n};\n\tv : INT := 1;\nEND_VAR\nrec.b := TO_BIT(v);\nEND_FUNCTION_BLOCK\n`),
]
