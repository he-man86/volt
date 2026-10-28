/**
 * the fixtures of `check-coverage.ts` — part A: positive: unterminated {IF} (had no conformance fixture — wording live-locked 2026-07-07); positive: unknown-member — a self-contained struct + FB (two units; the recorder splits them); FP-bait: the compiler ACCEPTS all of these (a warning at most) — the LSP must NOT emit an error; unify-conformance-suite §5.2: the execution programs' build warnings carry no line, so a program with several; network text (graphical) checks — canonical FBD/LD bodies (2-space indent); the recorder pushes them as real; labels and jumps the IDE HOLDS and its build reports (census 1.15, DIALECT N19; openspec.
 *
 * One slice of `check-coverage.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"
import { NOT_ST } from "../graphical/network-graphical-shared.js"
import { fb } from "./check-coverage-shared.js"

export const CHECK_COVERAGE_TESTS_A: readonly LanguageTest[] = [
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
    source: `FUNCTION_BLOCK FB_LANG_cc_vg_undeclared\nVAR\n\tout : BOOL;\nEND_VAR\n%LANGUAGE LD\n%NETWORK\nout := nope;\n\nEND_FUNCTION_BLOCK\n`,
  },
  {
    name: "cc_vg_undefined_label",
    // RECORDED ON TWINCAT 2026-09-22. This carried a `vendorRefuses` marker because `volt push` could
    // not create an unconditional jump, so the one sentence this fixture exists to hear — the
    // compiler's "No such label 'MISSING' within the scope of the JMP statement" — was unhearable on
    // that vendor. The shape became creatable when the driver learned to wire the jump to an empty
    // pin and swap the operand for a terminator, and the recording followed the same day.
    pouName: "FB_LANG_cc_vg_label",
    kind: "function_block",
    feature: "network text: a JMP to a missing label → compiler error",
    fromDoc: "check-coverage",
    plcPrgVar: "inst_vgl : FB_LANG_cc_vg_label;",
    plcPrgBody: "inst_vgl();",
    source: `FUNCTION_BLOCK FB_LANG_cc_vg_label\nVAR\n\tout : BOOL;\nEND_VAR\n%LANGUAGE LD\n%NETWORK\nout := TRUE;\nJMP Missing;\n\nEND_FUNCTION_BLOCK\n`,
  },
  // ── labels and jumps the IDE HOLDS and its build reports (census 1.15, DIALECT N19; openspec
  //    network-text-literal-nwl 5.6). None is a gate refusal, so each is the LSP's to say — with the build's words.
  {
    name: "cc_vg_duplicate_label",
    pouName: "FB_LANG_cc_vg_duplabel",
    kind: "function_block",
    feature: "network text: one LABEL on two networks, in two cases → 'The label … is a duplicate'",
    fromDoc: "check-coverage",
    plcPrgVar: "inst_vgd : FB_LANG_cc_vg_duplabel;",
    plcPrgBody: "inst_vgd();",
    source: `FUNCTION_BLOCK FB_LANG_cc_vg_duplabel\nVAR\n\tout : BOOL;\nEND_VAR\n%LANGUAGE LD\n%NETWORK\nJMP Done;\n%NETWORK\nDone:\nout := TRUE;\n%NETWORK\nDONE:\nout := FALSE;\n\nEND_FUNCTION_BLOCK\n`,
  },
  {
    name: "cc_vg_label_on_disabled_network",
    pouName: "FB_LANG_cc_vg_offlabel",
    kind: "function_block",
    feature: "network text: a JMP to the LABEL of a DISABLED network → no such label (a disabled network is no target)",
    fromDoc: "check-coverage",
    plcPrgVar: "inst_vgo : FB_LANG_cc_vg_offlabel;",
    plcPrgBody: "inst_vgo();",
    source: `FUNCTION_BLOCK FB_LANG_cc_vg_offlabel\nVAR\n\tout : BOOL;\nEND_VAR\n%LANGUAGE LD\n%NETWORK\nJMP Done;\n%NETWORK\n%DISABLED\nDone:\nout := TRUE;\n\nEND_FUNCTION_BLOCK\n`,
  },
  {
    name: "cc_vg_jump_in_disabled_network",
    pouName: "FB_LANG_cc_vg_offjump",
    execSkip: NOT_ST,
    kind: "function_block",
    feature: "network text: the only JMP to a label sits in a DISABLED network → the label is not referenced (a warning)",
    fromDoc: "check-coverage",
    plcPrgVar: "inst_vgj : FB_LANG_cc_vg_offjump;",
    plcPrgBody: "inst_vgj();",
    source: `FUNCTION_BLOCK FB_LANG_cc_vg_offjump\nVAR\n\tout : BOOL;\nEND_VAR\n%LANGUAGE LD\n%NETWORK\n%DISABLED\nJMP Done;\n%NETWORK\nDone:\nout := TRUE;\n\nEND_FUNCTION_BLOCK\n`,
  },
  {
    name: "cc_vg_unreferenced_label",
    pouName: "FB_LANG_cc_vg_idlelabel",
    execSkip: NOT_ST,
    kind: "function_block",
    feature: "network text: a LABEL no JMP names → the label is not referenced (a warning)",
    fromDoc: "check-coverage",
    plcPrgVar: "inst_vgi : FB_LANG_cc_vg_idlelabel;",
    plcPrgBody: "inst_vgi();",
    source: `FUNCTION_BLOCK FB_LANG_cc_vg_idlelabel\nVAR\n\tout : BOOL;\nEND_VAR\n%LANGUAGE LD\n%NETWORK\nDone:\nout := TRUE;\n\nEND_FUNCTION_BLOCK\n`,
  },
  {
    name: "cc_vg_unknown_member",
    pouName: "FB_LANG_cc_vg_member",
    kind: "function_block",
    feature: "network text: a non-member of a project struct → compiler error",
    fromDoc: "check-coverage",
    plcPrgVar: "inst_vgm : FB_LANG_cc_vg_member;",
    plcPrgBody: "inst_vgm();",
    source: `TYPE DUT_LANG_cc_vgm_pt :\nSTRUCT\n\tx : INT;\nEND_STRUCT\nEND_TYPE\n\nFUNCTION_BLOCK FB_LANG_cc_vg_member\nVAR\n\tp : DUT_LANG_cc_vgm_pt;\n\ty : INT;\nEND_VAR\n%LANGUAGE LD\n%NETWORK\ny := p.nope;\n\nEND_FUNCTION_BLOCK\n`,
  },
  {
    name: "cc_vg_unknown_pin",
    pouName: "FB_LANG_cc_vg_pin",
    kind: "function_block",
    feature: "network text: a box wired to a pin the FB doesn't have → compiler error",
    fromDoc: "check-coverage",
    plcPrgVar: "inst_vgp : FB_LANG_cc_vg_pin;",
    plcPrgBody: "inst_vgp();",
    source: `FUNCTION_BLOCK FB_LANG_cc_vgpin_callee\nVAR_INPUT\n\tgoodPin : BOOL;\nEND_VAR\nEND_FUNCTION_BLOCK\n\nFUNCTION_BLOCK FB_LANG_cc_vg_pin\nVAR\n\tcallee : FB_LANG_cc_vgpin_callee;\nEND_VAR\n%LANGUAGE FBD\n%NETWORK\nFB_LANG_cc_vgpin_callee(FB := callee, badPin := TRUE);\n\nEND_FUNCTION_BLOCK\n`,
  },
]
