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
]
