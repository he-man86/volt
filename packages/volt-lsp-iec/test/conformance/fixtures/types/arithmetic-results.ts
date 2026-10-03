/**
 * ARITHMETIC AND BUILT-IN RESULT TYPES — design.md §4 4.3 of openspec `frontend-conformance` (AR1–AR31; tasks 4.3.1–4.3.5),
 * the rows whose recorded fixtures measured a VALUE but never the TYPE, put to the vendor one result at a time.
 *
 * THE TRICK, as in `operators/mixed-type.ts`: the result is assigned into a `STRING`, which no number, duration, pointer or
 * struct converts into implicitly, so the compiler has to NAME the type it arrived at in order to refuse it
 * (`Cannot convert type '<T>' to type 'STRING'`). Every operand is a variable written by the body, so nothing folds and
 * the literal-typing rules stay out of the way.
 *
 *   AR21      `/` and `MOD` with negative operands — VALUES (`record:exec`): which sign the quotient
 *             and the remainder take, at each integer width and all-constant
 *   AR10      SHL, SHR, ROL, ROR over every integer and bit-string type (`ar_<op>_<type>_type`)
 *   AR13/14   LIMIT, SEL and MUX over mixed operand pairs, in both orders, and MIN/MAX/LIMIT of two bit strings of one type
 *   AR22–29   ADR, BITADR, SIZEOF, XSIZEOF, `__NEW`, `__ISVALIDREF`, `__QUERYINTERFACE`, `__QUERYPOINTER`, `__VARINFO`,
 *             `__POUNAME`, `__COMPARE_AND_SWAP`, TRUNC, TRUNC_INT, ABS, MOVE — the result type each hands back
 *   AR30/31   UPPER_BOUND / LOWER_BOUND of an `ARRAY[*]`; the nullary clock calls `TIME()` / `LTIME()`
 *   AR17/18   date − date, date ± duration, duration × / ÷ integer (and integer × duration)
 *
 * GLOBAL NAMES ARE THE FIXTURE'S OWN (`FB_LANG_<name>`): the replay binds every fixture into one project.
 */
import type { LanguageTest } from "../../types.js"

const doc = "frontend-conformance design.md §4 4.3 (arithmetic and built-in result types); docs/codesys-reference/05-operators.md"

/** A function block `FB_LANG_<name>` with VAR `vars` and body `body`; `before` (whole units) is written ahead of it.
 *  Instanced in PLC_PRG as `inst_<name>` and called. */
function fb(name: string, feature: string, vars: string, body: string, before = "", attribute = ""): LanguageTest {
  const pouName = `FB_LANG_${name}`
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar: `inst_${name} : ${pouName};`,
    plcPrgBody: `inst_${name}();`,
    source: `${before}${attribute}FUNCTION_BLOCK ${pouName}\nVAR\n${vars}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n`,
  }
}

/** `out<i> := <expr>` into a STRING for each expression — the compiler names each result's type. */
function intoStrings(exprs: readonly string[]): { vars: string; body: string } {
  return {
    vars: exprs.map((_, i) => `\tout${i + 1} : STRING;`).join("\n"),
    body: exprs.map((e, i) => `out${i + 1} := ${e};`).join("\n"),
  }
}

/** A probe: variables `decls` (set by `setup`), and each of `exprs` assigned into a STRING. */
function typeProbe(name: string, feature: string, decls: string, setup: string, exprs: readonly string[], before = "", attribute = ""): LanguageTest {
  const s = intoStrings(exprs)
  return fb(name, feature, `${decls}\n${s.vars}`, `${setup}${setup === "" ? "" : "\n"}${s.body}`, before, attribute)
}

// ─── AR21 — DIV and MOD with negative operands (values) ──────────────────────────────────────────────────────────────

const SIGNS: LanguageTest[] = [
  fb("ar_div_negative", "integer division with negative operands at SINT, INT, DINT and LINT, and all-constant",
    [
      "\tsm7 : SINT := -7;\n\ts2 : SINT := 2;",
      "\tim7 : INT := -7;\n\ti7 : INT := 7;\n\ti2 : INT := 2;\n\tim2 : INT := -2;",
      "\tdm7 : DINT := -7;\n\td7 : DINT := 7;\n\td2 : DINT := 2;\n\tdm2 : DINT := -2;",
      "\tlm7 : LINT := -7;\n\tl2 : LINT := 2;",
      "\tqs : SINT;\n\tqi1 : INT;\n\tqi2 : INT;\n\tqi3 : INT;\n\tqd1 : DINT;\n\tqd2 : DINT;\n\tqd3 : DINT;\n\tql : LINT;\n\tqk : DINT;",
    ].join("\n"),
    "qs := sm7 / s2;\nqi1 := im7 / i2;\nqi2 := i7 / im2;\nqi3 := im7 / im2;\nqd1 := dm7 / d2;\nqd2 := d7 / dm2;\nqd3 := dm7 / dm2;\nql := lm7 / l2;\nqk := -7 / 2;"),
  fb("ar_mod_negative", "MOD with negative operands at SINT, INT, DINT and LINT, and all-constant",
    [
      "\tsm7 : SINT := -7;\n\ts2 : SINT := 2;",
      "\tim7 : INT := -7;\n\ti7 : INT := 7;\n\ti2 : INT := 2;\n\tim2 : INT := -2;",
      "\tdm7 : DINT := -7;\n\td7 : DINT := 7;\n\td2 : DINT := 2;\n\tdm2 : DINT := -2;",
      "\tlm7 : LINT := -7;\n\tl2 : LINT := 2;",
      "\trs : SINT;\n\tri1 : INT;\n\tri2 : INT;\n\tri3 : INT;\n\trd1 : DINT;\n\trd2 : DINT;\n\trd3 : DINT;\n\trl : LINT;\n\trk : DINT;",
    ].join("\n"),
    "rs := sm7 MOD s2;\nri1 := im7 MOD i2;\nri2 := i7 MOD im2;\nri3 := im7 MOD im2;\nrd1 := dm7 MOD d2;\nrd2 := d7 MOD dm2;\nrd3 := dm7 MOD dm2;\nrl := lm7 MOD l2;\nrk := -7 MOD 2;"),
  // `DIV(a, b)` and `MOD(a, b)` CALLED — the function forms of the two operators (CODESYS SP21 refused both in the first
  // recording of ar_div_negative / ar_mod_negative, 2026-10-03, as statements it cannot parse)
  fb("ar_div_function_form", "DIV(a, b) called as a function", "\ta : DINT := -7;\n\tb : DINT := 2;\n\tq : DINT;", "q := DIV(a, b);"),
  fb("ar_mod_function_form", "MOD(a, b) called as a function", "\ta : DINT := -7;\n\tb : DINT := 2;\n\tq : DINT;", "q := MOD(a, b);"),
]

// ─── AR1–AR3 — an operation with an untyped literal operand: the type the meet names ─────────────────────────────────

const LITERAL_OPERAND_DECLS =
  "\tsi : SINT;\n\ti : INT;\n\td : DINT;\n\tli : LINT;\n\tus : USINT;\n\tui : UINT;\n\tbt : BYTE;\n\tw : WORD;\n\trv : REAL;\n\tlr : LREAL;"

const LITERAL_OPERANDS: LanguageTest[] = [
  typeProbe("ar_int_literal_operand_types", "an untyped integer literal beside a variable of each kind, in range and beyond it, either side, into STRINGs",
    LITERAL_OPERAND_DECLS, "",
    ["i + 1", "1 + i", "si + 1", "si + 200", "si + 1000", "i + 70000", "us + 1", "us - 1", "us + 300", "ui + 1", "ui + 70000",
      "bt + 1", "w + 1", "d * 2", "li + 1", "i / 2", "i MOD 2", "i + -1", "bt AND 1", "si AND 1", "rv + 1", "lr + 1"]),
  typeProbe("ar_real_literal_operand_types", "an untyped real literal beside a REAL, an LREAL and integers, either side, into STRINGs",
    LITERAL_OPERAND_DECLS, "",
    ["rv + 1.5", "1.5 + rv", "rv * 2.0", "lr + 1.5", "i + 1.5", "si + 1.5", "d + 1.5"]),
  // …and the same operations STORED into their own operand's type — does the store's context retype the literal?
  fb("ar_literal_operand_stores", "an operation with an untyped literal stored back into its typed operand: SINT + 200, INT + 70000, USINT + 300, BYTE + 1, WORD AND 1",
    "\tsi : SINT;\n\ti : INT;\n\tus : USINT;\n\tbt : BYTE;\n\tw : WORD;",
    "si := si + 200;\ni := i + 70000;\nus := us + 300;\nbt := bt + 1;\nw := w AND 1;"),
  // a BIT operator beside a signed operand, with a literal only the unsigned integer of the width holds (and one beyond
  // even that) — does the literal widen to the next signed integer as at `+`, or stay at the width?
  typeProbe("ar_bitwise_literal_beyond_width", "AND/OR of a signed variable and an untyped literal only the unsigned integer of its width holds, either side, and one beyond it, into STRINGs",
    LITERAL_OPERAND_DECLS, "",
    ["si AND 255", "255 AND si", "i AND 16#FF00", "d OR 16#80000000", "si AND 300"]),
  // …beside an UNSIGNED integer and a BIT STRING operand (does the literal still widen the operation?), and a NEGATIVE
  // literal beside a signed operand (does it keep the operand's type, or take an unsigned view?) — review findings of 4b
  typeProbe("ar_bitwise_literal_unsigned_or_negative", "AND/OR/XOR of a USINT, a BYTE and a WORD with an untyped literal wider than the operand, and of a SINT with a negative literal, either side, into STRINGs",
    LITERAL_OPERAND_DECLS, "",
    ["us AND 300", "bt AND 300", "w AND 16#1FFFF", "300 OR us", "si AND -1", "-1 AND si", "i XOR -1"]),
  // …and the same operations STORED back into their own operand's type
  fb("ar_bitwise_literal_unsigned_or_negative_stores", "a bit operation with an untyped literal stored back into its operand: USINT AND 300, BYTE AND 300, WORD AND 16#1FFFF, SINT AND -1",
    "\tsi : SINT;\n\tus : USINT;\n\tbt : BYTE;\n\tw : WORD;",
    "us := us AND 300;\nbt := bt AND 300;\nw := w AND 16#1FFFF;\nsi := si AND -1;"),
]

// ─── AR10 — shifts and rotates, by operand type ──────────────────────────────────────────────────────────────────────

const SHIFT_OPERANDS = ["BYTE", "WORD", "DWORD", "LWORD", "SINT", "INT", "DINT", "LINT", "USINT", "UINT", "UDINT", "ULINT"]

const SHIFTS: LanguageTest[] = ["SHL", "SHR", "ROL", "ROR"].flatMap((op) =>
  SHIFT_OPERANDS.map((t) =>
    typeProbe(`ar_${op.toLowerCase()}_${t.toLowerCase()}_type`, `${op} of a ${t} into a STRING — the compiler names its result type`,
      `\ta : ${t};\n\tn : USINT;`, "a := 1;\nn := 1;", [`${op}(a, n)`]),
  ),
)

// ─── AR13/AR14 — MIN/MAX/LIMIT/SEL/MUX result types ──────────────────────────────────────────────────────────────────

/** The pairs `operators/selection.ts` asked MIN and MAX across, and two bit strings of one type. */
const PAIRS: readonly [string, string][] = [
  ["INT", "UINT"],
  ["DINT", "UDINT"],
  ["SINT", "DINT"],
  ["INT", "REAL"],
  ["LINT", "REAL"],
  ["BYTE", "SINT"],
  ["BYTE", "BYTE"],
  ["WORD", "WORD"],
]
const pairDecls = PAIRS.map(([l, r], i) => `\ta${i + 1} : ${l};\n\tb${i + 1} : ${r};`).join("\n")
const pairSetup = PAIRS.map((_, i) => `a${i + 1} := 6;\nb${i + 1} := 3;`).join("\n")
/** `form(a, b)` and `form(b, a)` for every pair: the result of a meet is the same both ways, an argument's type is not. */
const bothOrders = (form: (a: string, b: string) => string): string[] =>
  PAIRS.flatMap((_, i) => [form(`a${i + 1}`, `b${i + 1}`), form(`b${i + 1}`, `a${i + 1}`)])

const SELECTIONS: LanguageTest[] = [
  typeProbe("ar_limit_mixed_types", "LIMIT over mixed pairs, value of one type between bounds of the other, both ways, into STRINGs",
    pairDecls, pairSetup, bothOrders((a, b) => `LIMIT(${a}, ${b}, ${a})`)),
  typeProbe("ar_sel_mixed_types", "SEL over mixed pairs, both orders, into STRINGs",
    `\tg : BOOL;\n${pairDecls}`, `g := TRUE;\n${pairSetup}`, bothOrders((a, b) => `SEL(g, ${a}, ${b})`)),
  typeProbe("ar_mux_mixed_types", "MUX over mixed pairs, both orders, into STRINGs",
    `\tk : INT;\n${pairDecls}`, `k := 1;\n${pairSetup}`, bothOrders((a, b) => `MUX(k, ${a}, ${b})`)),
  typeProbe("ar_minmax_bitstring_types", "MIN and MAX of two BYTEs and of two WORDs into STRINGs — the bit string, or the unsigned integer of its width?",
    "\tx1 : BYTE;\n\tx2 : BYTE;\n\tw1 : WORD;\n\tw2 : WORD;", "x1 := 6;\nx2 := 3;\nw1 := 6;\nw2 := 3;",
    ["MIN(x1, x2)", "MAX(x1, x2)", "MIN(w1, w2)", "MAX(w1, w2)"]),
]

// ─── AR22–AR29 — the built-ins' result types ─────────────────────────────────────────────────────────────────────────

const BUILTINS: LanguageTest[] = [
  typeProbe("ar_adr_type", "ADR of an INT and of a BYTE array into STRINGs", "\ti : INT;\n\tarr : ARRAY[0..3] OF BYTE;", "", ["ADR(i)", "ADR(arr)"]),
  typeProbe("ar_bitadr_type", "BITADR of a located BOOL into a STRING", "\tx AT %MX4.3 : BOOL;", "", ["BITADR(x)"]),
  typeProbe("ar_sizeof_type", "SIZEOF of an INT, of a 100000-byte array and of a type into STRINGs — is the result's width the size's?",
    "\ti : INT;\n\tbig : ARRAY[0..99999] OF BYTE;", "", ["SIZEOF(i)", "SIZEOF(big)", "SIZEOF(LINT)"]),
  typeProbe("ar_sizeof_width_edges", "SIZEOF of byte arrays of 255, 256, 65535 and 65536 elements into STRINGs — where the result's width steps",
    "\ta255 : ARRAY[1..255] OF BYTE;\n\ta256 : ARRAY[1..256] OF BYTE;\n\ta65535 : ARRAY[1..65535] OF BYTE;\n\ta65536 : ARRAY[1..65536] OF BYTE;", "",
    ["SIZEOF(a255)", "SIZEOF(a256)", "SIZEOF(a65535)", "SIZEOF(a65536)"]),
  typeProbe("ar_xsizeof_type", "XSIZEOF of an INT and of a 100000-byte array into STRINGs",
    "\ti : INT;\n\tbig : ARRAY[0..99999] OF BYTE;", "", ["XSIZEOF(i)", "XSIZEOF(big)"]),
  // …and SIZEOF / XSIZEOF STORED into, and compared with, a signed or narrower integer: does the folded size convert like a
  // typed value (warn / refuse) or like a constant that fits (silent)?
  fb("ar_sizeof_into_narrow", "SIZEOF of a 10-byte array into a SINT, and SIZEOF of a 100000-byte array compared with a DINT",
    "\tsi : SINT;\n\ta : ARRAY[0..9] OF BYTE;\n\tdi : DINT;\n\tbig : ARRAY[0..99999] OF BYTE;\n\tb : BOOL;",
    "si := SIZEOF(a);\nb := di < SIZEOF(big);"),
  fb("ar_xsizeof_into_narrow", "XSIZEOF of a 10-INT array into a UDINT and into a SINT",
    "\tu : UDINT;\n\tsi : SINT;\n\tai : ARRAY[0..9] OF INT;", "u := XSIZEOF(ai);\nsi := XSIZEOF(ai);"),
  typeProbe("ar_new_type", "__NEW of a STRUCT carrying enable_dynamic_creation into a STRING",
    "", "", ["__NEW(DUT_LANG_ar_new_target)"],
    "{attribute 'enable_dynamic_creation'}\nTYPE DUT_LANG_ar_new_target :\nSTRUCT\n\tn : INT;\nEND_STRUCT\nEND_TYPE\n\n"),
  typeProbe("ar_isvalidref_type", "__ISVALIDREF of a bound REFERENCE into a STRING", "\ttarget : INT;\n\trf : REFERENCE TO INT;", "rf REF= target;", ["__ISVALIDREF(rf)"]),
  typeProbe("ar_queryinterface_type", "__QUERYINTERFACE between two interfaces one FB implements, into a STRING",
    "\timpl : FB_LANG_ar_query_impl;\n\tia : ITF_LANG_ar_query_a;\n\tib : ITF_LANG_ar_query_b;", "ia := impl;", ["__QUERYINTERFACE(ia, ib)"],
    QUERY_UNITS()),
  typeProbe("ar_querypointer_type", "__QUERYPOINTER from an interface to a POINTER TO the FB, into a STRING",
    "\timpl : FB_LANG_ar_qp_impl;\n\tia : ITF_LANG_ar_qp_a;\n\tp : POINTER TO FB_LANG_ar_qp_impl;", "ia := impl;", ["__QUERYPOINTER(ia, p)"],
    QUERY_UNITS("qp")),
  {
    ...typeProbe("ar_varinfo_type", "__VARINFO of an INT into a STRING", "\tv : INT;", "", ["__VARINFO(v)"]),
    deferred: {
      lsp: "2026-10-03, both vendors: \"Cannot convert type '__SYSTEM.VAR_INFO' to type 'STRING'\" — the VAR_INFO struct's members are unmeasured (`types/system` binds none) and a struct stored into an elementary target is unchecked for every struct (task 4.5.3); `ARITHMETIC_RESULT_DIVERGENCES`",
    },
  },
  // CODESYS's refusal is a measured silence (`fixtures.test.ts` `MEASURED_SILENT`, `CODESYS_POUNAME_IS_SIZED_BY_ITS_BODY`);
  // TwinCAT has no `__POUNAME` and agrees
  fb("ar_pouname_type", "__POUNAME() into an INT — the compiler names the STRING it is", "\tn : INT;", "n := __POUNAME();"),
  typeProbe("ar_compare_and_swap_type", "__COMPARE_AND_SWAP on the address of an LWORD into a STRING", "\tlw : LWORD;", "", ["__COMPARE_AND_SWAP(ADR(lw), 0, 1)"]),
  typeProbe("ar_trunc_type", "TRUNC of a REAL and of an LREAL into STRINGs", "\trv : REAL;\n\tlr : LREAL;", "rv := 2.5;\nlr := 2.5;", ["TRUNC(rv)", "TRUNC(lr)"]),
  typeProbe("ar_trunc_int_type", "TRUNC_INT of a REAL and of an LREAL into STRINGs", "\trv : REAL;\n\tlr : LREAL;", "rv := 2.5;\nlr := 2.5;", ["TRUNC_INT(rv)", "TRUNC_INT(lr)"]),
  typeProbe("ar_abs_type", "ABS of a SINT, an INT, a UINT, a BYTE, a REAL and an LREAL into STRINGs",
    "\tsi : SINT;\n\ti : INT;\n\tui : UINT;\n\tbt : BYTE;\n\trv : REAL;\n\tlr : LREAL;", "si := -3;\ni := -3;\nui := 3;\nbt := 3;\nrv := -2.5;\nlr := -2.5;",
    ["ABS(si)", "ABS(i)", "ABS(ui)", "ABS(bt)", "ABS(rv)", "ABS(lr)"]),
  typeProbe("ar_move_type", "MOVE of a SINT, a BYTE, a REAL and a TIME into STRINGs",
    "\tsi : SINT;\n\tbt : BYTE;\n\trv : REAL;\n\tt : TIME;", "si := 3;\nbt := 3;\nrv := 2.5;\nt := T#1S;", ["MOVE(si)", "MOVE(bt)", "MOVE(rv)", "MOVE(t)"]),
]

/** Two interfaces extending IQueryInterface and an FB implementing both — `__QUERYINTERFACE`/`__QUERYPOINTER`'s setting. */
function QUERY_UNITS(tag = "query"): string {
  return (
    `INTERFACE ITF_LANG_ar_${tag}_a EXTENDS __SYSTEM.IQueryInterface\nMETHOD Ping : INT\nEND_METHOD\nEND_INTERFACE\n\n` +
    `INTERFACE ITF_LANG_ar_${tag}_b EXTENDS __SYSTEM.IQueryInterface\nMETHOD Pong : INT\nEND_METHOD\nEND_INTERFACE\n\n` +
    `FUNCTION_BLOCK FB_LANG_ar_${tag}_impl IMPLEMENTS ITF_LANG_ar_${tag}_a, ITF_LANG_ar_${tag}_b\nVAR\n\tn : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n` +
    `METHOD Ping : INT\nPing := 1;\nEND_METHOD\n\nMETHOD Pong : INT\nPong := 2;\nEND_METHOD\n\n`
  )
}

// ─── AR30/AR31 — the array bounds and the clock calls ────────────────────────────────────────────────────────────────

/** A FUNCTION taking an `ARRAY[*] OF INT` in-out that writes `bound(arr, 1)` into a STRING; PLC_PRG passes ARRAY[2..5]. */
function boundProbe(name: string, bound: "UPPER_BOUND" | "LOWER_BOUND"): LanguageTest {
  const pouName = `FUN_LANG_${name}`
  return {
    name,
    pouName,
    kind: "function",
    feature: `${bound} of an ARRAY[*] VAR_IN_OUT into a STRING — the compiler names its result type`,
    fromDoc: doc,
    plcPrgVar: `arr_${name} : ARRAY[2..5] OF INT;\nr_${name} : INT;`,
    plcPrgBody: `r_${name} := ${pouName}(arr_${name});`,
    source: `FUNCTION ${pouName} : INT\nVAR_IN_OUT\n\tarr : ARRAY[*] OF INT;\nEND_VAR\nVAR\n\tout1 : STRING;\nEND_VAR\nout1 := ${bound}(arr, 1);\nEND_FUNCTION\n`,
  }
}

const BOUNDS_AND_CLOCKS: LanguageTest[] = [
  boundProbe("ar_upper_bound_type", "UPPER_BOUND"),
  boundProbe("ar_lower_bound_type", "LOWER_BOUND"),
  typeProbe("ar_time_call", "TIME() into a STRING — the nullary clock call's result type", "", "", ["TIME()"]),
  typeProbe("ar_ltime_call", "LTIME() into a STRING — the nullary clock call's result type", "", "", ["LTIME()"]),
]

// ─── AR17/AR18 — temporal result types ───────────────────────────────────────────────────────────────────────────────

const TEMPORAL: LanguageTest[] = [
  typeProbe("ar_date_minus_date_type", "DATE − DATE, DT − DT and TOD − TOD into STRINGs",
    "\td1 : DATE;\n\td2 : DATE;\n\tdt1 : DT;\n\tdt2 : DT;\n\ttod1 : TOD;\n\ttod2 : TOD;", "", ["d1 - d2", "dt1 - dt2", "tod1 - tod2"]),
  typeProbe("ar_ldate_minus_ldate_type", "LDATE − LDATE, LDT − LDT and LTOD − LTOD into STRINGs (CODESYS's 64-bit dates)",
    "\td1 : LDATE;\n\td2 : LDATE;\n\tdt1 : LDT;\n\tdt2 : LDT;\n\ttod1 : LTOD;\n\ttod2 : LTOD;", "", ["d1 - d2", "dt1 - dt2", "tod1 - tod2"]),
  typeProbe("ar_date_plus_time_type", "DT + TIME, TIME + TOD and DATE − TIME into STRINGs",
    "\tdt1 : DT;\n\ttod1 : TOD;\n\td1 : DATE;\n\tt : TIME;", "t := T#1S;", ["dt1 + t", "t + tod1", "d1 - t"]),
  typeProbe("ar_time_times_int_type", "TIME × INT and INT × TIME into STRINGs", "\tt : TIME;\n\tn : INT;", "t := T#1S;\nn := 3;", ["t * n", "n * t"]),
  typeProbe("ar_time_div_int_type", "TIME ÷ DINT into a STRING", "\tt : TIME;\n\tn : DINT;", "t := T#1S;\nn := 4;", ["t / n"]),
  typeProbe("ar_ltime_div_int_type", "LTIME ÷ INT into a STRING", "\tt : LTIME;\n\tn : INT;", "t := LTIME#1S;\nn := 4;", ["t / n"]),
  typeProbe("ar_ltime_times_lint_type", "LTIME × LINT and LINT × LTIME into STRINGs", "\tt : LTIME;\n\tn : LINT;", "t := LTIME#1S;\nn := 3;", ["t * n", "n * t"]),
  typeProbe("ar_time_scaled_by_wide_or_unsigned_int_type", "TIME × LINT, LINT × TIME, TIME × UINT, TIME ÷ ULINT and TIME × SINT into STRINGs",
    "\tt : TIME;\n\tli : LINT;\n\tui : UINT;\n\tul : ULINT;\n\tsi : SINT;", "t := T#1S;\nli := 3;\nui := 3;\nul := 3;\nsi := 3;",
    ["t * li", "li * t", "t * ui", "t / ul", "t * si"]),
  // a duration scaled by an UNSIGNED integer of its OWN width — the cell between the narrower unsigned (kept) and the
  // wider integer (the integer) that no other fixture measures; review finding of 4b
  typeProbe("ar_duration_scaled_by_same_width_unsigned_type", "TIME × UDINT, UDINT × TIME, TIME ÷ UDINT, LTIME × ULINT, ULINT × LTIME and LTIME ÷ ULINT into STRINGs",
    "\tt : TIME;\n\tud : UDINT;\n\tltm : LTIME;\n\tul : ULINT;", "t := T#1S;\nud := 3;\nltm := LTIME#1S;\nul := 3;",
    ["t * ud", "ud * t", "t / ud", "ltm * ul", "ul * ltm", "ltm / ul"]),
  // …the 64-bit integer cells STORED into a matching integer, where no STRING refusal stands beside the operand's
  fb("ar_duration_scaled_stores", "TIME × LINT, LINT × TIME and TIME ÷ ULINT stored into a LINT / ULINT; TIME × UDINT and LTIME × ULINT stored back into the duration",
    "\tt : TIME;\n\tli : LINT;\n\tul : ULINT;\n\tud : UDINT;\n\tltm : LTIME;\n\tx : LINT;\n\tux : ULINT;",
    "t := T#1S;\nx := t * li;\nx := li * t;\nux := t / ul;\nt := t * ud;\nltm := ltm * ul;"),
]

export const ARITHMETIC_RESULT_TESTS: readonly LanguageTest[] = [
  ...SIGNS,
  ...LITERAL_OPERANDS,
  ...SHIFTS,
  ...SELECTIONS,
  ...BUILTINS,
  ...BOUNDS_AND_CLOCKS,
  ...TEMPORAL,
]
