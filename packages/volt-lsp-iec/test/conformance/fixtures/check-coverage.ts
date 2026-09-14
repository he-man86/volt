/**
 * Check-coverage fixtures — deliberately target diagnostic CHECKS that lacked conformance coverage, plus a
 * battery of FP-BAIT: compiler-ACCEPTED near-miss code where a type check is most likely to over-fire. The
 * FP-bait is the permanent guard against the class of bug that was `constant-overflow` (it errored on code
 * CODESYS accepts). Recorded against live CODESYS/TwinCAT like every other fixture — the replay then proves
 * the LSP emits ⊆ what the compiler emits (no false positives).
 */
import type { LanguageTest } from "../types.js"

/** A single self-contained FB fixture, instantiated in PLC_PRG so the compiler reaches it. */
function fb(name: string, feature: string, decls: string, body = ""): LanguageTest {
  const pou = `FB_LANG_${name}`
  return {
    name,
    pouName: pou,
    kind: "function_block",
    feature,
    fromDoc: "check-coverage",
    plcPrgVar: `inst_${name} : ${pou};`,
    plcPrgBody: `inst_${name}();`,
    source: `FUNCTION_BLOCK ${pou}\nVAR\n\t${decls}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n`,
  }
}

export const CHECK_COVERAGE_TESTS: readonly LanguageTest[] = [
  // ── positive: unterminated {IF} (had no conformance fixture — wording live-locked 2026-07-07) ──
  fb("cc_unterminated_if", "unterminated {IF} conditional-compile block → compiler error", "x : INT;", "{IF defined(FOO)}\nx := 1;"),

  // ── positive: unknown-member — a self-contained struct + FB (two units; the recorder splits them) ──
  {
    name: "cc_unknown_member",
    pouName: "FB_LANG_cc_unknown_member",
    kind: "function_block",
    feature: "reading a non-member of a project struct → compiler error",
    fromDoc: "check-coverage",
    plcPrgVar: "inst_cc_um : FB_LANG_cc_unknown_member;",
    plcPrgBody: "inst_cc_um();",
    source: `TYPE DUT_LANG_cc_um_pt :\nSTRUCT\n\tx : INT;\nEND_STRUCT\nEND_TYPE\n\nFUNCTION_BLOCK FB_LANG_cc_unknown_member\nVAR\n\tp : DUT_LANG_cc_um_pt;\n\ty : INT;\nEND_VAR\ny := p.nope;\nEND_FUNCTION_BLOCK\n`,
  },

  // ── FP-bait: the compiler ACCEPTS all of these (a warning at most) — the LSP must NOT emit an error ──
  fb("cc_fp_overflow_untyped", "untyped over-max literal → conversion warning, NOT a range error", "x : INT := 40000;"),
  fb("cc_fp_overflow_expr", "const-expr over max → accepted", "x : INT := 30000 + 10000;"),
  fb("cc_fp_widen", "widening assignment INT→DINT → accepted", "x : INT; y : DINT;", "y := x;"),
  fb("cc_fp_lit_to_real", "int literal to REAL → accepted", "rVal : REAL;", "rVal := 5;"),
  fb("cc_fp_lit_to_lreal", "int literal to LREAL → accepted", "lVal : LREAL;", "lVal := 5;"),
  fb("cc_fp_hex_to_word", "hex literal to WORD → accepted", "wVal : WORD;", "wVal := 16#FF;"),
  fb("cc_fp_string_assign", "string literal to STRING → accepted", "sVal : STRING;", "sVal := 'abc';"),
  fb("cc_fp_time_assign", "time literal to TIME → accepted", "t : TIME;", "t := T#1S;"),
  fb("cc_fp_mixed_arith", "mixed-width arithmetic INT+DINT → accepted", "a : INT; b : DINT; c : DINT;", "c := a + b;"),
  fb("cc_fp_real_plus_int", "REAL + INT → accepted", "x : REAL; y : INT; z : REAL;", "z := x + y;"),
  fb("cc_fp_bitwise_mixed", "bitwise AND across widths BYTE/WORD → accepted", "x : BYTE; y : WORD; z : WORD;", "z := x AND y;"),
  fb("cc_fp_ptr_deref", "valid pointer dereference → accepted", "p : POINTER TO INT; x : INT;", "x := p^;"),
  fb("cc_fp_word_to_int", "WORD→INT assignment → conversion warning, NOT an error", "x : INT; w : WORD;", "x := w;"),

  // ── network text (graphical) checks — canonical FBD/LD bodies (2-space indent); the recorder pushes them as real
  //    graphical POUs. Library types skip the LSP member/pin checks, so unknown-member/pin use a PROJECT type. ──
  {
    name: "cc_vg_undeclared",
    pouName: "FB_LANG_cc_vg_undeclared",
    kind: "function_block",
    feature: "network text: an operand declared nowhere → compiler error",
    fromDoc: "check-coverage",
    plcPrgVar: "inst_vgu : FB_LANG_cc_vg_undeclared;",
    plcPrgBody: "inst_vgu();",
    source: `FUNCTION_BLOCK FB_LANG_cc_vg_undeclared\nVAR\n\tout : BOOL;\nEND_VAR\nNETWORK 0 LD\n  out := nope;\nEND_NETWORK\nEND_FUNCTION_BLOCK\n`,
  },
  {
    name: "cc_vg_undefined_label",
    pouName: "FB_LANG_cc_vg_label",
    kind: "function_block",
    feature: "network text: a JMP to a missing label → compiler error",
    fromDoc: "check-coverage",
    plcPrgVar: "inst_vgl : FB_LANG_cc_vg_label;",
    plcPrgBody: "inst_vgl();",
    source: `FUNCTION_BLOCK FB_LANG_cc_vg_label\nVAR\n\tout : BOOL;\nEND_VAR\nNETWORK 0 LD\n  out := TRUE;\n  JMP Missing;\nEND_NETWORK\nEND_FUNCTION_BLOCK\n`,
  },
  {
    name: "cc_vg_unknown_member",
    pouName: "FB_LANG_cc_vg_member",
    kind: "function_block",
    feature: "network text: a non-member of a project struct → compiler error",
    fromDoc: "check-coverage",
    plcPrgVar: "inst_vgm : FB_LANG_cc_vg_member;",
    plcPrgBody: "inst_vgm();",
    source: `TYPE DUT_LANG_cc_vgm_pt :\nSTRUCT\n\tx : INT;\nEND_STRUCT\nEND_TYPE\n\nFUNCTION_BLOCK FB_LANG_cc_vg_member\nVAR\n\tp : DUT_LANG_cc_vgm_pt;\n\ty : INT;\nEND_VAR\nNETWORK 0 LD\n  y := p.nope;\nEND_NETWORK\nEND_FUNCTION_BLOCK\n`,
  },
  {
    name: "cc_vg_unknown_pin",
    pouName: "FB_LANG_cc_vg_pin",
    kind: "function_block",
    feature: "network text: a box wired to a pin the FB doesn't have → compiler error",
    fromDoc: "check-coverage",
    plcPrgVar: "inst_vgp : FB_LANG_cc_vg_pin;",
    plcPrgBody: "inst_vgp();",
    source: `FUNCTION_BLOCK FB_LANG_cc_vgpin_callee\nVAR_INPUT\n\tgoodPin : BOOL;\nEND_VAR\nEND_FUNCTION_BLOCK\n\nFUNCTION_BLOCK FB_LANG_cc_vg_pin\nVAR\n\tcallee : FB_LANG_cc_vgpin_callee;\nEND_VAR\nNETWORK 0 FBD\n  callee(badPin := TRUE);\nEND_NETWORK\nEND_FUNCTION_BLOCK\n`,
  },

  // ── LSP gaps the transpiler's execution oracle exposed (2026-09-14; tasks.md "Found along the way"). Each was a
  //    construct with NO fixture, so the zero-FP gate could not see a miss and the corpus never contains it. ──
  // gap 1 — `R`/`S` are set/reset keywords: `r : REAL` fails to compile in CODESYS; the LSP accepted it.
  fb("cc_reserved_name_r", "a variable named r → compiler error (R is the reset keyword)", "r : INT;"),
  fb("cc_reserved_name_s_upper", "a variable named S → compiler error (S is the set keyword)", "S : BOOL;"),
  // Three existing unit tests declare `s : STRING` as "compiler-accepted code" — never verified for the NAME. Measure
  // it exactly as they write it before touching them.
  fb("cc_reserved_name_s_string", "`s : STRING; s := 'abc';` → compiler-accepted, or the set keyword?", "s : STRING;", "s := 'abc';"),
  // gap 2 — `**` does not parse in CODESYS; the LSP parses it as a power. TwinCAT unmeasured.
  fb("cc_power_operator", "`**` → not an operator in CODESYS", "x : REAL;", "x := 2.0 ** 3.0;"),
  // gap 3 — a negated SINT is typed INT for checking (`sint := -sint` fails); the LSP says unary minus preserves the
  //         type. Measure which types: the rule is NOT "never narrow" (DINT → INT compiled in the exec oracle).
  fb("cc_neg_sint_into_sint", "negated SINT into SINT → compiler error (typed INT)", "a : SINT; b : SINT;", "b := -a;"),
  fb("cc_neg_usint_into_usint", "negated USINT into USINT → ?", "a : USINT; b : USINT;", "b := -a;"),
  fb("cc_neg_byte_into_byte", "negated BYTE into BYTE → ?", "a : BYTE; b : BYTE;", "b := -a;"),
  fb("cc_fp_neg_int_into_int", "negated INT into INT → accepted", "a : INT; b : INT;", "b := -a;"),
  fb("cc_fp_neg_dint_into_dint", "negated DINT into DINT → accepted", "a : DINT; b : DINT;", "b := -a;"),
  fb("cc_fp_neg_sint_into_int", "negated SINT into INT → accepted", "a : SINT; b : INT;", "b := -a;"),
  fb("cc_fp_sint_plus_one", "SINT := SINT + 1 → accepted (arithmetic promotes at run time, not for checking)", "a : SINT;", "a := a + 1;"),
  // Recorded: SINT/USINT/BYTE negate to INT, INT and DINT keep their type. Where do the WIDER unsigned types go?
  fb("cc_neg_uint_into_uint", "negated UINT into UINT → ?", "a : UINT; b : UINT;", "b := -a;"),
  fb("cc_neg_word_into_word", "negated WORD into WORD → ?", "a : WORD; b : WORD;", "b := -a;"),
  fb("cc_neg_udint_into_udint", "negated UDINT into UDINT → ?", "a : UDINT; b : UDINT;", "b := -a;"),
  fb("cc_neg_uint_into_int", "negated UINT into INT → ?", "a : UINT; b : INT;", "b := -a;"),
  fb("cc_fp_neg_lint_into_lint", "negated LINT into LINT → accepted", "a : LINT; b : LINT;", "b := -a;"),
  // gap 4 — EXPT's TYPE: values cannot tell, a narrowing WARNING can (LREAL → REAL warns; REAL → REAL does not).
  fb("cc_expt_real_into_real", "EXPT(REAL, REAL) into REAL → a narrowing warning only if EXPT is typed LREAL", "a : REAL; b : REAL; c : REAL;", "c := EXPT(a, b);"),
  fb("cc_expt_int_into_real", "EXPT(INT, INT) into REAL → narrowing warning expected (typed LREAL)", "i : INT; c : REAL;", "c := EXPT(i, i);"),
  // Recorded: EXPT(REAL, REAL) is typed REAL (no warning), EXPT(INT, INT) LREAL (warning). The mixed pair decides.
  fb("cc_expt_real_int_into_real", "EXPT(REAL, INT) into REAL → ?", "a : REAL; i : INT; c : REAL;", "c := EXPT(a, i);"),
  fb("cc_expt_lreal_real_into_real", "EXPT(LREAL, REAL) into REAL → ?", "l : LREAL; a : REAL; c : REAL;", "c := EXPT(l, a);"),
  // The class fix: every operator the grammar accepts gets at least one fixture (test/conformance/coverage.test.ts
  // enforces it). These six had NONE when it was first measured — the same blind spot `**` sat in.
  fb("cc_fp_op_divide", "`/` → accepted", "a : INT := 7; b : INT := 2; c : INT;", "c := a / b;"),
  fb("cc_fp_op_less_equal", "`<=` → accepted", "a : INT; ok : BOOL;", "ok := a <= 3;"),
  // Written as FP-bait; the compiler said otherwise — `&` is NOT an operator in CODESYS (a parse error, like `**`).
  // The name keeps its `fp_` prefix because the recording is keyed by it and is never edited by hand.
  fb("cc_fp_op_ampersand", "`&` → NOT an operator in CODESYS (measured: a parse error)", "a : BOOL; b : BOOL; c : BOOL;", "c := a & b;"),
  fb("cc_fp_op_xor", "`XOR` → accepted", "a : BOOL; b : BOOL; c : BOOL;", "c := a XOR b;"),
  fb("cc_fp_op_and_then", "`AND_THEN` → accepted", "a : BOOL; b : BOOL; c : BOOL;", "c := a AND_THEN b;"),
  fb("cc_fp_op_or_else", "`OR_ELSE` → accepted", "a : BOOL; b : BOOL; c : BOOL;", "c := a OR_ELSE b;"),
  // gap 7 — `T#1500US` does not compile in CODESYS (TIME is milliseconds; the execution oracle measured it); the LSP
  //         accepts it silently. gap 8 — the AST gives `LTIME#` and `T#` one literalKind, so an LTIME literal may be
  //         typed TIME for checking: does CODESYS reject one stored into a TIME?
  fb("cc_time_microsecond_literal", "`T#1500US` → not a TIME literal in CODESYS", "fine : TIME := T#1500US;"),
  // Recorded: the declaration shape is a parse cascade that stops at the unit. Before mirroring it — the body shape,
  // a nanosecond unit, and a unit after a valid component.
  fb("cc_time_microsecond_literal_in_body", "`t := T#1500US` in a body → ?", "t1 : TIME;", "t1 := T#1500US;"),
  fb("cc_time_nanosecond_literal", "`T#5NS` → ?", "t1 : TIME;", "t1 := T#5NS;"),
  fb("cc_time_seconds_then_microseconds", "`T#1S500US` → ?", "t1 : TIME;", "t1 := T#1S500US;"),
  fb("cc_fp_ltime_microsecond_literal", "`LTIME#1500US` → accepted", "lt1 : LTIME;", "lt1 := LTIME#1500US;"),
  // gap 12 — the declaration parser silently accepts a stray token after an initializer (why gap 7's declaration shape
  //          stayed silent). What does CODESYS say for the general case?
  fb("cc_decl_init_trailing_ident", "`x : INT := 5 abc;` → compiler error", "x : INT := 5 abc;"),
  fb("cc_decl_init_trailing_int", "`x : INT := 5 6;` → compiler error", "x : INT := 5 6;"),
  fb("cc_ltime_literal_into_time", "an LTIME literal into a TIME → ?", "t1 : TIME;", "t1 := LTIME#1S;"),
  fb("cc_fp_ltime_literal_into_ltime", "an LTIME literal into an LTIME → accepted", "lt1 : LTIME;", "lt1 := LTIME#1S;"),
  // gap 9 — a Standard FUNCTION's arguments were never checked (call-arguments skipped every library callee); CODESYS
  //         refuses a WSTRING for LEN's STRING(255) (execution oracle `standard_len_wstring_rejected`).
  fb("cc_standard_len_wstring", "Standard LEN given a WSTRING → compiler error", "w : WSTRING; n : INT;", "n := LEN(w);"),
  // gap 11 — arithmetic on a STRING is silent in the LSP; CODESYS: "Cannot convert type 'STRING' to type 'ANY_NUM'"
  //          (execution oracle `string_arithmetic_rejected`). Which operators, which side, and WSTRING too?
  fb("cc_string_plus_string", "STRING + STRING → compiler error", "a : STRING; b : STRING; c : STRING;", "c := a + b;"),
  fb("cc_string_minus_string", "STRING - STRING → ?", "a : STRING; b : STRING; c : STRING;", "c := a - b;"),
  fb("cc_string_times_int", "STRING * INT → ?", "a : STRING; i : INT; c : STRING;", "c := a * i;"),
  fb("cc_string_div_int", "STRING / INT → ?", "a : STRING; i : INT; c : STRING;", "c := a / i;"),
  fb("cc_int_plus_string", "INT + STRING → ?", "a : STRING; i : INT; j : INT;", "j := i + a;"),
  fb("cc_wstring_plus_wstring", "WSTRING + WSTRING → ?", "a : WSTRING; b : WSTRING; c : WSTRING;", "c := a + b;"),
  // gap 5 — set/reset assignment had no fixture at all, and the LSP's parser rejected a valid chain.
  fb("cc_fp_set_reset", "S= and R= → accepted", "a : BOOL; b : BOOL;", "a S= b;\na R= b;"),
  fb("cc_fp_set_reset_chain", "chained `a S= b R= c` → accepted", "a : BOOL; b : BOOL; c : BOOL;", "a S= b R= c;"),
]
