/**
 * Check-coverage fixtures — deliberately target diagnostic CHECKS that lacked conformance coverage, plus a
 * battery of FP-BAIT: compiler-ACCEPTED near-miss code where a type check is most likely to over-fire. The
 * FP-bait is the permanent guard against the class of bug that was `constant-overflow` (it errored on code
 * CODESYS accepts). Recorded against live CODESYS/TwinCAT like every other fixture — the replay then proves
 * the LSP emits ⊆ what the compiler emits (no false positives).
 */
import type { LanguageTest } from "../../types.js"

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

  // ── unify-conformance-suite §5.2: the execution programs' build warnings carry no line, so a program with several
  //    mixed expressions cannot say which one warned. One expression each. ──
  //    (`r` and `s` are not usable names — the IL operators R and S are reserved.)
  fb("cc_bitwise_sint_and_literal", "SINT AND an untyped literal that only an unsigned type holds", "sn : SINT := -1; res : INT;", "res := sn AND 255;"),
  fb("cc_bitwise_usint_xor_literal", "USINT XOR a small untyped literal", "un : USINT := 255; res : DINT;", "res := un XOR 1;"),
  fb("cc_bitwise_sint_and_usint", "SINT AND USINT, two variables", "sn : SINT; un : USINT; res : INT;", "res := sn AND un;"),
  fb("cc_max_usint_sint", "MAX of a USINT and a SINT", "un : USINT; sn : SINT; res : INT;", "res := MAX(un, sn);"),
  fb("cc_max_uint_int", "MAX of a UINT and an INT", "un : UINT; si : INT; res : DINT;", "res := MAX(un, si);"),
  fb("cc_add_usint_sint", "USINT + SINT", "un : USINT; sn : SINT; res : INT;", "res := un + sn;"),
  fb("cc_add_uint_int", "UINT + INT", "un : UINT; si : INT; res : DINT;", "res := un + si;"),
  fb("cc_typed_fold_usint", "USINT#200 + USINT#100 into an INT", "res : INT;", "res := USINT#200 + USINT#100;"),
  fb("cc_typed_fold_int", "INT#30000 + INT#30000 into a DINT", "res : DINT;", "res := INT#30000 + INT#30000;"),
  fb("cc_typed_fold_int_untyped", "INT#30000 + 30000 into a DINT", "res : DINT;", "res := INT#30000 + 30000;"),
  fb("cc_not_sint_into_int", "NOT of a SINT into an INT", "sn : SINT := -1; res : INT;", "res := NOT sn;"),
  fb("cc_not_usint_into_dint", "NOT of a USINT into a DINT", "un : USINT := 255; res : DINT;", "res := NOT un;"),
  fb("cc_bitwise_int_and_uint", "INT AND UINT", "si : INT; un : UINT; res : DINT;", "res := si AND un;"),
  fb("cc_bitwise_dint_and_udint", "DINT AND UDINT", "si : DINT; un : UDINT; res : LINT;", "res := si AND un;"),
  fb("cc_bitwise_byte_and_sint", "BYTE AND SINT", "bv : BYTE; sn : SINT; res : INT;", "res := bv AND sn;"),
  fb("cc_compare_uint_int", "UINT > INT", "un : UINT; si : INT; res : BOOL;", "res := un > si;"),
  fb("cc_add_ulint_lint", "ULINT + LINT", "un : ULINT; si : LINT; res : LINT;", "res := un + si;"),
  fb("cc_add_word_int", "WORD + INT", "wv : WORD; si : INT; res : DINT;", "res := wv + si;"),
  fb("cc_max_udint_dint", "MAX of a UDINT and a DINT", "un : UDINT; si : DINT; res : LINT;", "res := MAX(un, si);"),
  fb("cc_sub_udint_dint", "UDINT - DINT", "un : UDINT; si : DINT; res : LINT;", "res := un - si;"),
  fb("cc_mul_udint_dint", "UDINT * DINT", "un : UDINT; si : DINT; res : LINT;", "res := un * si;"),
  fb("cc_div_udint_dint", "UDINT / DINT", "un : UDINT; si : DINT; res : LINT;", "res := un / si;"),
  fb("cc_mod_udint_dint", "UDINT MOD DINT", "un : UDINT; si : DINT; res : LINT;", "res := un MOD si;"),
  fb("cc_or_int_uint", "INT OR UINT", "si : INT; un : UINT; res : DINT;", "res := si OR un;"),
  fb("cc_xor_int_uint", "INT XOR UINT", "si : INT; un : UINT; res : DINT;", "res := si XOR un;"),
  fb("cc_ne_udint_dint", "UDINT <> DINT", "un : UDINT; si : DINT; res : BOOL;", "res := un <> si;"),
  fb("cc_le_udint_dint", "UDINT <= DINT", "un : UDINT; si : DINT; res : BOOL;", "res := un <= si;"),
  fb("cc_ge_udint_dint", "UDINT >= DINT", "un : UDINT; si : DINT; res : BOOL;", "res := un >= si;"),
  fb("cc_not_int_into_dint", "NOT of an INT into a DINT", "si : INT; res : DINT;", "res := NOT si;"),
  fb("cc_typed_fold_int_into_int", "INT#30000 + INT#30000 into an INT", "res : INT;", "res := INT#30000 + INT#30000;"),
  fb("cc_typed_fold_sint_into_int", "SINT#100 + SINT#100 into an INT", "res : INT;", "res := SINT#100 + SINT#100;"),
  fb("cc_typed_fold_usint_fits", "USINT#1 + USINT#2 into an INT", "res : INT;", "res := USINT#1 + USINT#2;"),
  fb("cc_real_init_max", "the largest REAL written as a literal", "rv : REAL := 3.4028235E38;"),
  fb("cc_real_init_tiny", "a tiny REAL literal", "rv : REAL := 2.5E-10;"),
  fb("cc_real_init_sci_fraction", "1.5E8 into a REAL", "rv : REAL := 1.5E8;"),
  fb("cc_wstring_init_too_long_7", "an over-long WSTRING(7) initializer — which prefix is printed?", 'w : WSTRING(7) := "abcdefghij";'),
  fb("cc_wstring_init_too_long_2", "an over-long WSTRING(2) initializer", 'w : WSTRING(2) := "abc";'),

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
  // consolidate-lsp-structure A14 — CODESYS rejects IL operator names as identifiers (`lt`, `ld`, found by the execution
  // oracle). The LSP's keyword table has the comparison/arithmetic ones (LT, GT, EQ, ADD, CAL, JMP …); LD, LDN, ST, STN,
  // RET and the conditional/negated forms are not in it and are silent. Which does CODESYS reserve? (`cal` is in the
  // table but the LSP also says "Identifier 'cal' not defined" — is that CODESYS's too?)
  ...(["ld", "ldn", "st", "stn", "ret", "retc", "retcn", "jmpc", "jmpcn", "calc", "calcn", "andn", "orn", "xorn", "cal"] as const).map((n) =>
    fb(`cc_il_name_${n}`, `a variable named \`${n}\` (an IL operator) → compiler error?`, `${n} : INT;`, `${n} := 1;`),
  ),
  // consolidate-lsp-structure C8 — `types/compat` lets an enum value widen into ANY numeric type, REAL included, while a
  // deleted, never-called `isEnumIsolated` said an enum and a REAL do not mix. Which one is the compiler?
  // Recorded: REAL, LREAL and INT are silent and BYTE is "Cannot convert type 'DUT_LANG_CC_ENUM_BYTE' to type 'BYTE'" —
  // so the rest of the integers and bit strings, to find the rule rather than guess it.
  ...["REAL", "LREAL", "INT", "BYTE", "SINT", "USINT", "UINT", "DINT", "UDINT", "LINT", "WORD", "DWORD"].map((target) => ({
    name: `cc_enum_into_${target.toLowerCase()}`,
    pouName: `FB_LANG_cc_enum_into_${target.toLowerCase()}`,
    kind: "function_block" as const,
    feature: `an enum value assigned to a ${target} → ?`,
    fromDoc: "check-coverage",
    plcPrgVar: `inst_cc_enum_${target.toLowerCase()} : FB_LANG_cc_enum_into_${target.toLowerCase()};`,
    plcPrgBody: `inst_cc_enum_${target.toLowerCase()}();`,
    source: `TYPE DUT_LANG_cc_enum_${target.toLowerCase()} :\n(\n\tIdle := 0,\n\tBusy := 1\n);\nEND_TYPE\n\nFUNCTION_BLOCK FB_LANG_cc_enum_into_${target.toLowerCase()}\nVAR\n\tx : ${target};\nEND_VAR\nx := DUT_LANG_cc_enum_${target.toLowerCase()}.Busy;\nEND_FUNCTION_BLOCK\n`,
  })),
  // The rule above was measured for an enum VALUE. The bakon-nano build stores an enum-typed VARIABLE into a WORD with no
  // warning — is a variable different from a value, or was it the library enum? Recorded: a variable converts exactly as
  // a value does, so the difference is the library enum (or that project's warning settings) — unmeasured here.
  ...["WORD", "UINT", "SINT", "DINT"].map((target) => ({
    name: `cc_enum_var_into_${target.toLowerCase()}`,
    pouName: `FB_LANG_cc_enum_var_into_${target.toLowerCase()}`,
    kind: "function_block" as const,
    feature: `an enum-typed variable assigned to a ${target} → ?`,
    fromDoc: "check-coverage",
    plcPrgVar: `inst_cc_enum_var_${target.toLowerCase()} : FB_LANG_cc_enum_var_into_${target.toLowerCase()};`,
    plcPrgBody: `inst_cc_enum_var_${target.toLowerCase()}();`,
    source: `TYPE DUT_LANG_cc_enum_var_${target.toLowerCase()} :\n(\n\tIdle := 0,\n\tBusy := 1\n);\nEND_TYPE\n\nFUNCTION_BLOCK FB_LANG_cc_enum_var_into_${target.toLowerCase()}\nVAR\n\te : DUT_LANG_cc_enum_var_${target.toLowerCase()};\n\tx : ${target};\nEND_VAR\nx := e;\nEND_FUNCTION_BLOCK\n`,
  })),
  // consolidate-lsp-structure B6 — call arguments and comparisons typed enum values with their own copy of the enum
  // lookup, which the INT rule above never reached. Does an ARGUMENT convert like an assignment, and what does comparing
  // two different enums (variables and values) say? A differently-cased name of the SAME enum must stay silent.
  ...["SINT", "UINT"].map((target) => {
    const t = target.toLowerCase()
    return {
      name: `cc_enum_arg_into_${t}`,
      pouName: `FB_LANG_cc_enum_arg_into_${t}`,
      kind: "function_block" as const,
      feature: `an enum value passed to a ${target} input → ?`,
      fromDoc: "check-coverage",
      plcPrgVar: `inst_cc_enum_arg_${t} : FB_LANG_cc_enum_arg_into_${t};`,
      plcPrgBody: `inst_cc_enum_arg_${t}();`,
      source: `TYPE DUT_LANG_cc_enum_arg_${t} :\n(\n\tIdle := 0,\n\tBusy := 1\n);\nEND_TYPE\n\nFUNCTION F_LANG_cc_enum_arg_${t} : BOOL\nVAR_INPUT\n\tx : ${target};\nEND_VAR\nF_LANG_cc_enum_arg_${t} := TRUE;\nEND_FUNCTION\n\nFUNCTION_BLOCK FB_LANG_cc_enum_arg_into_${t}\nVAR\n\tok : BOOL;\nEND_VAR\nok := F_LANG_cc_enum_arg_${t}(DUT_LANG_cc_enum_arg_${t}.Busy);\nEND_FUNCTION_BLOCK\n`,
    }
  }),
  ...(
    [
      ["cc_enum_compare_two_enums", "two variables of different enum types compared → ?", "same := ea = eb;"],
      ["cc_enum_compare_two_enum_values", "values of two different enum types compared → ?", "same := DUT_LANG_cc_enum_cmp_a.A1 = DUT_LANG_cc_enum_cmp_b.B1;"],
      ["cc_fp_enum_compare_same_enum_other_case", "one enum type spelled in two casings, compared → accepted", "same := ea = ec;"],
    ] as const
  ).map(([name, feature, body]) => ({
    name,
    pouName: `FB_LANG_${name}`,
    kind: "function_block" as const,
    feature,
    fromDoc: "check-coverage",
    plcPrgVar: `inst_${name} : FB_LANG_${name};`,
    plcPrgBody: `inst_${name}();`,
    source: `TYPE DUT_LANG_cc_enum_cmp_a :\n(\n\tA0 := 0,\n\tA1 := 1\n);\nEND_TYPE\n\nTYPE DUT_LANG_cc_enum_cmp_b :\n(\n\tB0 := 0,\n\tB1 := 1\n);\nEND_TYPE\n\nFUNCTION_BLOCK FB_LANG_${name}\nVAR\n\tea : DUT_LANG_cc_enum_cmp_a;\n\teb : DUT_LANG_cc_enum_cmp_b;\n\tec : dut_lang_CC_ENUM_CMP_A;\n\tsame : BOOL;\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n`,
  })),
  // consolidate-lsp-structure A13 (gap 14) — a declaration's initial value is type-checked only for an untyped integer
  // literal (gap 13). What does CODESYS say for the other shapes an initializer takes?
  fb("cc_init_bool_into_int", "`i : INT := TRUE` → ?", "i : INT := TRUE;"),
  fb("cc_init_int_into_bool", "`b : BOOL := 1` → ?", "b : BOOL := 1;"),
  fb("cc_init_real_into_int", "`i : INT := 1.5` → ?", "i : INT := 1.5;"),
  fb("cc_init_int_into_time", "`t : TIME := 5` → ?", "t : TIME := 5;"),
  fb("cc_init_string_into_int", "`i : INT := 'abc'` → ?", "i : INT := 'abc';"),
  fb("cc_init_typed_int_into_sint", "`si : SINT := INT#5` → ?", "si : SINT := INT#5;"),
  fb("cc_init_constant_expr_into_sint", "`si : SINT := 100 + 100` → ?", "si : SINT := 100 + 100;"),
  // Recorded: an initializer converts as its literal's type (5 is SINT, 1.5 LREAL, INT#5 INT) — except `b : BOOL := 1`,
  // accepted. The edges before a rule: which integers a BOOL takes, whether a real literal is silent into REAL/LREAL, and
  // the statement forms. (`cc_init_time_into_real` named its variable `r`, a reserved word — re-measured as `re`.)
  fb("cc_init_zero_into_bool", "`b : BOOL := 0` → ?", "b : BOOL := 0;"),
  fb("cc_init_two_into_bool", "`b : BOOL := 2` → ?", "b : BOOL := 2;"),
  fb("cc_fp_init_real_literal_into_real", "`re : REAL := 1.5` → accepted?", "re : REAL := 1.5;"),
  fb("cc_fp_init_real_literal_into_lreal", "`lr : LREAL := 1.5` → accepted?", "lr : LREAL := 1.5;"),
  fb("cc_init_time_into_real_renamed", "`re : REAL := T#1S` → ?", "re : REAL := T#1S;"),
  fb("cc_assign_int_literal_into_time", "`t := 5` → ?", "t : TIME;", "t := 5;"),
  fb("cc_assign_real_literal_into_int", "`i := 1.5` → ?", "i : INT;", "i := 1.5;"),
  fb("cc_assign_one_into_bool", "`b := 1` → ?", "b : BOOL;", "b := 1;"),
  // consolidate-lsp-structure A10 — three rules for a string literal's length disagree on `$` escapes: the assignment
  // message counts raw characters (`STRING(INT#<n>)`), the too-long check counts any `$X` as one, the transpiler decodes
  // only the measured escapes. What does CODESYS count — and print?
  fb("cc_string_escape_literal_into_int", "`i := 'a$Tb'` → STRING(INT#3) or (INT#4)?", "i : INT;", "i := 'a$Tb';"),
  fb("cc_string_escape_init_too_long", "`s3 : STRING(3) := 'ab$T$T'` → too long (4 decoded)?", "s3 : STRING(3) := 'ab$T$T';"),
  fb("cc_fp_string_escape_init_fits", "`s3 : STRING(3) := 'a$Tb'` → accepted (3 decoded)", "s3 : STRING(3) := 'a$Tb';"),
  // Recorded: the escaped one is a WARNING, "String constant '...' too long…" — while the check, from the docs, emits an
  // ERROR worded "''...'". The plain case, before either is changed:
  fb("cc_string_plain_init_too_long", "`s4 : STRING(4) := '12345'` → warning or error, and which wording?", "s4 : STRING(4) := '12345';"),
  // Recorded: both are WARNINGS; plain '12345' prints `''...'`, escaped 'ab$T$T' prints `'...'`. What decides the form?
  fb("cc_string_plain_long_init_too_long", "`s2 : STRING(2) := 'abcdef'` → which form?", "s2 : STRING(2) := 'abcdef';"),
  fb("cc_string_escape_first_too_long", "`s2 : STRING(2) := '$Tabc'` → which form?", "s2 : STRING(2) := '$Tabc';"),
  fb("cc_string_escape_middle_too_long", "`s2 : STRING(2) := 'ab$Tc'` → which form?", "s2 : STRING(2) := 'ab$Tc';"),
  fb("cc_string_escape_last_too_long", "`s2 : STRING(2) := 'abc$T'` → which form?", "s2 : STRING(2) := 'abc$T';"),
  fb("cc_string_hex_escape_too_long", "`s2 : STRING(2) := 'ab$41'` → which form?", "s2 : STRING(2) := 'ab$41';"),
  // Recorded: the message shows a prefix of the literal AS WRITTEN (opening quote included), and its length follows the
  // destination, not the content — STRING(2) took 2 characters every time, STRING(4) 1, STRING(3) 0 ("length mod 3"
  // fits, from three lengths only). One literal into four more lengths; mod 3 predicts 1, 2, 0, 1.
  //
  // MOD 3 IS DEAD (2026-09-20). The sweep below runs every capacity from 1 to 10 and CODESYS prints prefixes of
  // 1, 2, 0, 1, 2, 3, 4, 5, 6 characters for 1..9 — i.e. `n - 3`, and `n` itself for the two capacities too small
  // to subtract from. That is the rule `messages.stringConstantTooLong` already implements, inferred from the
  // three points above; seven more points say it was inferred right. STRING(10) is an exact fit and silent.
  // …and then the family answered a question it was not asked. TwinCAT does not warn AT ALL when the
  // destination is STRING(1) or STRING(2) — silent on all eight of the small-destination fixtures above and on
  // `cc_string_prefix_len_1`, while agreeing with CODESYS word for word from STRING(3) up. One literal into
  // EVERY capacity from 1 to 10 turns that from an observation across differently-worded fixtures into a
  // controlled sweep with one variable: 10 is an exact fit and must be silent on both, so the sweep also says
  // where the warning STOPS rather than only where TwinCAT starts.
  ...([1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const).map((n) =>
    fb(`cc_string_prefix_len_${n}`, `'abcdefghij' into STRING(${n}) → how much of it is printed?`, `s${n} : STRING(${n}) := 'abcdefghij';`),
  ),
  // consolidate-lsp-structure A8 — `this-super-context.ts` compares `THIS`/`SUPER` exactly, so a lower-case `this` or
  // `super` in a PROGRAM is never flagged (two OOP checks upper-case first). PLC_PRG is a PROGRAM: the uses go in its body.
  ...(["this", "super", "THIS"] as const).map(
    (word): LanguageTest => ({
      name: `cc_self_${word === "THIS" ? "upper_this" : word}_in_program`,
      pouName: `FB_LANG_cc_self_${word === "THIS" ? "upper_this" : word}_in_program`,
      kind: "function_block",
      feature: `\`${word}\` in a PROGRAM (PLC_PRG) → compiler error?`,
      fromDoc: "check-coverage",
      plcPrgVar: `inst_self_${word === "THIS" ? "upper_this" : word} : FB_LANG_cc_self_${word === "THIS" ? "upper_this" : word}_in_program;\n\tpSelf_${word === "THIS" ? "upper_this" : word} : POINTER TO BYTE;`,
      plcPrgBody: `inst_self_${word === "THIS" ? "upper_this" : word}();\npSelf_${word === "THIS" ? "upper_this" : word} := ${word};`,
      source: `FUNCTION_BLOCK FB_LANG_cc_self_${word === "THIS" ? "upper_this" : word}_in_program\nVAR\n\tx : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n`,
    }),
  ),
  // consolidate-lsp-structure A4 — six `X_TO_Y` name parsers disagree on the spelled-out type names: the transpiler reads
  // `TIME_OF_DAY_TO_UDINT`, the narrowing / conversion-source / reference parsers do not. Is the spelled-out form a
  // conversion function in CODESYS at all — and if so, is its source checked like `TOD_TO_UDINT`'s?
  fb("cc_conv_spelled_source_mismatch", "`TIME_OF_DAY_TO_UDINT(anInt)` → ?", "i : INT; u : UDINT;", "u := TIME_OF_DAY_TO_UDINT(i);"),
  fb("cc_conv_spelled_source_ok", "`TIME_OF_DAY_TO_UDINT(aTod)` → ?", "t : TOD; u : UDINT;", "u := TIME_OF_DAY_TO_UDINT(t);"),
  fb("cc_conv_spelled_target_into_int", "`i := UDINT_TO_TIME_OF_DAY(u)` → ?", "u : UDINT; i : INT;", "i := UDINT_TO_TIME_OF_DAY(u);"),
  fb("cc_conv_spelled_target_into_tod", "`t := UDINT_TO_TIME_OF_DAY(u)` → ?", "u : UDINT; t : TOD;", "t := UDINT_TO_TIME_OF_DAY(u);"),
  fb("cc_conv_short_source_mismatch", "`TOD_TO_UDINT(anInt)` → compiler error (the short form, for comparison)", "i : INT; u : UDINT;", "u := TOD_TO_UDINT(i);"),
  // consolidate-lsp-structure A2 — inference typed every date literal without its `L` prefix (`LDATE#…` as DATE), while
  // lowering typed it right. An LTIME literal into a TIME is "Cannot convert type 'LTIME' to type 'TIME'" (recorded);
  // what do the calendar types say?
  fb("cc_ldate_literal_into_date", "an LDATE literal into a DATE → ?", "d1 : DATE;", "d1 := LDATE#2024-02-28;"),
  fb("cc_ltod_literal_into_tod", "an LTOD literal into a TOD → ?", "t1 : TOD;", "t1 := LTOD#12:30:15;"),
  fb("cc_ldt_literal_into_dt", "an LDT literal into a DT → ?", "dt1 : DT;", "dt1 := LDT#2024-02-28-12:30:15;"),
  fb("cc_fp_ldate_literal_into_ldate", "an LDATE literal into an LDATE → accepted", "ld1 : LDATE;", "ld1 := LDATE#2024-02-28;"),
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
  // gap 13 — an untyped integer literal out of its target's range: the execution oracle recorded `b : BYTE := 300` and
  //          `si := 300` as "Cannot convert type 'INT' to type 'BYTE'/'SINT'" — silent in the LSP, whose constant-overflow
  //          check was removed as a false positive. Which literal type does CODESYS name, where is the boundary, and
  //          which shapes compile?
  fb("cc_literal_300_into_byte_init", "`b : BYTE := 300` → compiler error", "b : BYTE := 300;"),
  fb("cc_literal_300_into_sint", "`si := 300` → compiler error", "si : SINT;", "si := 300;"),
  fb("cc_literal_40000_into_int", "`i := 40000` → ?", "i : INT;", "i := 40000;"),
  fb("cc_literal_70000_into_uint", "`u := 70000` → ?", "u : UINT;", "u := 70000;"),
  fb("cc_literal_minus129_into_sint", "`si := -129` → ?", "si : SINT;", "si := -129;"),
  fb("cc_literal_256_into_usint", "`us := 256` → ?", "us : USINT;", "us := 256;"),
  fb("cc_literal_3e9_into_dint", "`d := 3000000000` → ?", "d : DINT;", "d := 3000000000;"),
  fb("cc_literal_128_into_sint", "`si := 128` → ?", "si : SINT;", "si := 128;"),
  fb("cc_fp_literal_255_into_byte", "`b := 255` → accepted", "b : BYTE;", "b := 255;"),
  fb("cc_fp_literal_minus1_into_usint", "`us := -1` → accepted (wraps to 255, execution oracle)", "us : USINT;", "us := -1;"),
  fb("cc_fp_literal_127_into_sint", "`si := 127` → accepted", "si : SINT;", "si := 127;"),
  // Recorded: the literal takes the smallest of SINT/USINT/INT/UINT/DINT/UDINT/LINT/ULINT holding it, then converts like a
  // variable (128 is USINT: a sign-change warning into SINT). Before applying that everywhere: does a SMALL non-negative
  // literal (a SINT by that rule) warn into an unsigned, a bit string, or a REAL? Real code does this constantly.
  fb("cc_fp_literal_5_into_usint", "`us := 5` → ?", "us : USINT;", "us := 5;"),
  fb("cc_fp_literal_5_into_word", "`w := 5` → ?", "w : WORD;", "w := 5;"),
  fb("cc_fp_literal_0_into_byte", "`b := 0` → ?", "b : BYTE;", "b := 0;"),
  fb("cc_fp_literal_5_into_real", "`re := 5` → ?", "re : REAL;", "re := 5;"),
  fb("cc_fp_literal_200_into_int", "`i := 200` → ?", "i : INT;", "i := 200;"),
  // gap 5 — set/reset assignment had no fixture at all, and the LSP's parser rejected a valid chain.
  fb("cc_fp_set_reset", "S= and R= → accepted", "a : BOOL; b : BOOL;", "a S= b;\na R= b;"),
  fb("cc_fp_set_reset_chain", "chained `a S= b R= c` → accepted", "a : BOOL; b : BOOL; c : BOOL;", "a S= b R= c;"),
]
