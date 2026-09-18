/**
 * WHEN DOES AN INFINITE REAL STOP THE TASK? — separating two explanations that fit the same four measurements.
 *
 * `interp/values.ts` says an infinity stops the scan and a NaN does not, from these:
 *
 *     SQRT(-1) -> REAL#NaN, completes        LN(-1) -> REAL#NaN, completes
 *     LN(0)    -> never completes            1.0/0  -> never completes
 *
 * Two readings fit all four:
 *
 *   (A) THE VALUE. Any operation that produces an infinity stops the task.
 *   (B) THE OPERATION. Dividing by zero traps — as an integer divide by zero does, and `cc_div_udint_dint` and
 *       `implicit_check_div_*` confirm integers do — and `LN(0)` is a divide by zero in the library routine. The
 *       infinity is then a coincidence of which operations happen to trap.
 *
 * `types/primitive-bounds.ts` split them halfway: `x : REAL := 3.5E38` is ACCEPTED and holds `REAL#Infinity`, and
 * the scan completes. So an infinity can exist in a variable — reading (A) is already too broad for a constant
 * conversion. What it does not settle is a RUNTIME overflow, which is what these ask: multiply and add two REALs
 * that are large but finite, with values the compiler cannot fold, and see whether the scan finishes.
 *
 *   completes, holding Infinity  ->  (B). The rule belongs on division, not on the value, and `fit` is wrong.
 *   never completes              ->  (A) for operations, with constant conversion carved out.
 *
 * The magnitudes come from variables the body has already written to, so there is no constant for the compiler to
 * fold — the same trap `probe_real_infinity_faults` fell into by dividing a seeded variable instead of a computed
 * zero (see `seeded-probes-hide-their-own-bug`).
 */
import type { LanguageTest } from "../../types.js"

function probe(slug: string, decls: string, body: string, feature: string): LanguageTest {
  const pou = `FB_LANG_${slug}`
  return {
    name: slug,
    pouName: pou,
    kind: "function_block" as const,
    feature,
    fromDoc: "06-data-types.md",
    plcPrgVar: `inst : ${pou};`,
    plcPrgBody: "inst();",
    source: `FUNCTION_BLOCK ${pou}\nVAR\n${decls}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n`,
  }
}

export const REAL_OVERFLOW_TESTS: readonly LanguageTest[] = [
  probe(
    "realovf_multiply_to_infinity",
    "\tbig : REAL;\n\tout : REAL;",
    "big := 3.0E38;\nout := big * big;",
    "a REAL multiplication that overflows at run time — does the scan finish?",
  ),
  probe(
    "realovf_add_to_infinity",
    "\tbig : REAL;\n\tout : REAL;",
    "big := 3.4E38;\nout := big + big;",
    "a REAL addition that overflows at run time — does the scan finish?",
  ),
  probe(
    "realovf_lreal_multiply_to_infinity",
    "\tbig : LREAL;\n\tout : LREAL;",
    "big := 1.7E308;\nout := big * big;",
    "an LREAL multiplication that overflows at run time — does the scan finish?",
  ),
  probe(
    "realovf_divide_small_by_smaller",
    "\tnum : REAL;\n\tden : REAL;\n\tout : REAL;",
    "num := 1.0E38;\nden := 1.0E-38;\nout := num / den;",
    "a REAL division that overflows WITHOUT dividing by zero — the case that separates the value rule from the divide rule",
  ),
  probe(
    "realovf_divide_by_computed_zero",
    "\tnum : REAL;\n\tzero : REAL;\n\tout : REAL;",
    "num := 1.0;\nzero := num - num;\nout := num / zero;",
    "a REAL division by a zero the body COMPUTED — the baseline the other four are measured against",
  ),
  probe(
    "realovf_infinity_survives_a_scan",
    "\tbig : REAL;\n\tout : REAL;\n\tstill : REAL;",
    "big := 3.0E38;\nout := big * big;\nstill := out;",
    "if an overflow does not stop the task, can the infinity it produced be read and copied afterwards?",
  ),
  probe(
    "realovf_times_zero_after_infinity",
    "\tbig : REAL;\n\tinf : REAL;\n\tout : REAL;",
    "big := 3.0E38;\ninf := big * big;\nout := inf * 0.0;",
    "infinity times zero — a NaN, if the infinity is allowed to exist at all",
  ),
]
