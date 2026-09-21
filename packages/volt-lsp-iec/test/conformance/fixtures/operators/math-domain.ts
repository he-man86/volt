/**
 * THE EDGE OF EVERY ONE-ARGUMENT MATH FUNCTION — which inputs stop the task, which answer NaN, which answer an
 * infinity, and which just work.
 *
 * Four of the ten were asked before (`domain_sqrt_negative`, `domain_ln_negative`, `domain_ln_zero`,
 * `domain_nan_propagates`) and the rest never were. That mattered more than it looks: `LN(0)` stopping the scan is
 * the ONE measurement that does not fit "dividing by zero stops the task", and with a single data point there is no
 * way to tell whether the rule is about LN, about poles, about negative infinities, or about nothing in particular.
 *
 * So every function gets its domain edges:
 *
 *   SQRT   below zero                      LN, LOG   at zero, below zero
 *   ASIN, ACOS   outside [-1, 1]           EXP       large enough to overflow
 *   TAN    at the pole                     ATAN, SIN, COS   have no domain edge; asked anyway, for the baseline
 *
 * Each computes its argument from a variable the body has already written, so there is no constant for the compiler
 * to fold and the question reaches the runtime — see `seeded-probes-hide-their-own-bug`.
 *
 * WHAT CAME BACK, 2026-09-18, CODESYS 3.5.21.40:
 *
 *   acos_above_one             LREAL#NaN
 *   acos_at_one                LREAL#0
 *   acos_below_minus_one       LREAL#NaN
 *   asin_above_one             LREAL#NaN
 *   asin_at_one                LREAL#1.5707963267948966
 *   asin_below_minus_one       LREAL#NaN
 *   atan_large                 LREAL#1.5707963267948966
 *   cos_large                  LREAL#0.11965025504785125
 *   exp_overflow               LREAL#Infinity
 *   exp_underflow              LREAL#0
 *   ln_negative                LREAL#NaN
 *   ln_of_infinity             LREAL#Infinity
 *   ln_zero                    THE SCAN NEVER COMPLETES
 *   log_negative               LREAL#NaN
 *   log_zero                   THE SCAN NEVER COMPLETES
 *   sin_large                  LREAL#-0.99281610405300347
 *   sin_of_infinity            LREAL#NaN
 *   sqrt_negative              LREAL#NaN
 *   sqrt_of_infinity           LREAL#Infinity
 *   sqrt_zero                  LREAL#0
 *   tan_at_pole                LREAL#16331239353195370
 *
 * TWO INPUTS STOP THE TASK AND THEY ARE BOTH A LOGARITHM OF ZERO. Everything else completes, including every result
 * that is infinite — `EXP(1000)`, `SQRT(inf)` and `LN(inf)` all answer Infinity and carry on — which is what killed
 * the earlier "an infinity stops the task" reading for good. Together with division by zero (`operators/
 * real-overflow.ts`), that is the entire list of ways a CODESYS task stops on a number.
 *
 * `sin_large` and `cos_large` DIVERGE, and it is now known WHY: CODESYS computes trig with the x87 FPU, whose
 * argument reduction uses a 66-BIT approximation of pi. Reducing 1.0E18 by `round(pi * 2^64) / 2^64` reproduces
 * its COS to all seventeen digits and its SIN to sixteen, where an exact reduction (libm's, and ours) gives
 * 0.11837199021871073 against its 0.11965025504785125. Same hardware as `op_math_trig`, different half of it:
 * that one is below pi and reduces to itself, so its difference is the KERNEL's few-ULP error, not the reduction.
 * See `ir/values.ts` for why neither is emulated.
 */
import type { LanguageTest } from "../../types.js"

/** `arg` is built from `seed`, so the value is computed rather than folded. */
function domain(slug: string, seed: string, arg: string, feature: string): LanguageTest {
  const pou = `FB_LANG_${slug}`
  return {
    name: slug,
    pouName: pou,
    kind: "function_block" as const,
    feature,
    fromDoc: "05-operators.md",
    plcPrgVar: `inst : ${pou};`,
    plcPrgBody: "inst();",
    source:
      `FUNCTION_BLOCK ${pou}\nVAR\n\tseed : LREAL;\n\tout : LREAL;\nEND_VAR\n` +
      `seed := ${seed};\nout := ${arg};\nEND_FUNCTION_BLOCK\n`,
  }
}

const MATH_FUNCTIONS = ["SQRT", "LN", "LOG", "EXP", "SIN", "COS", "TAN", "ASIN", "ACOS", "ATAN"] as const

export const MATH_DOMAIN_TESTS: readonly LanguageTest[] = [
  // ── the pole at zero. `LN(0)` is the measurement the whole question hangs on; LOG is its base-10 twin and had
  //    never been asked, so there was no way to know whether the rule was about LN or about the pole.
  domain("mathdom_ln_zero", "1.0", "LN(seed - seed)", "LN of a computed zero"),
  domain("mathdom_log_zero", "1.0", "LOG(seed - seed)", "LOG of a computed zero — LN's base-10 twin"),
  domain("mathdom_ln_negative", "1.0", "LN(0.0 - seed)", "LN of a computed negative"),
  domain("mathdom_log_negative", "1.0", "LOG(0.0 - seed)", "LOG of a computed negative"),

  // ── square root below zero
  domain("mathdom_sqrt_negative", "1.0", "SQRT(0.0 - seed)", "SQRT of a computed negative"),
  domain("mathdom_sqrt_zero", "1.0", "SQRT(seed - seed)", "SQRT of a computed zero — the baseline beside it"),

  // ── inverse trig outside [-1, 1]
  domain("mathdom_asin_above_one", "2.0", "ASIN(seed)", "ASIN above its domain"),
  domain("mathdom_asin_below_minus_one", "2.0", "ASIN(0.0 - seed)", "ASIN below its domain"),
  domain("mathdom_acos_above_one", "2.0", "ACOS(seed)", "ACOS above its domain"),
  domain("mathdom_acos_below_minus_one", "2.0", "ACOS(0.0 - seed)", "ACOS below its domain"),
  domain("mathdom_asin_at_one", "1.0", "ASIN(seed)", "ASIN exactly at its edge — must be accepted"),
  domain("mathdom_acos_at_one", "1.0", "ACOS(seed)", "ACOS exactly at its edge — must be accepted"),

  // ── EXP far enough to overflow the result
  domain("mathdom_exp_overflow", "1000.0", "EXP(seed)", "EXP with a result past LREAL's largest"),
  domain("mathdom_exp_underflow", "1000.0", "EXP(0.0 - seed)", "EXP with a result below LREAL's smallest"),

  // ── TAN at the pole, and the three with no domain edge, as the baseline
  domain("mathdom_tan_at_pole", "1.5707963267948966", "TAN(seed)", "TAN at pi/2, where the true value is infinite"),
  { ...domain("mathdom_sin_large", "1.0E18", "SIN(seed)", "SIN of a very large angle — no edge, asked for the baseline"), deferred: { transpile: "2026-09-19: CODESYS reduces a huge angle with the x87 FPU's 66-bit pi, not an exact one — SIN(1.0E18) is -0.9928161040530035 there and -0.9929693207404051 here. Reproducible, deliberately not emulated (`ir/values.ts`)." } },
  { ...domain("mathdom_cos_large", "1.0E18", "COS(seed)", "COS of a very large angle"), deferred: { transpile: "2026-09-19: CODESYS reduces a huge angle with the x87 FPU's 66-bit pi — reducing by round(pi * 2^64) / 2^64 reproduces its 0.11965025504785125 to all seventeen digits, against 0.11837199021871073 from an exact reduction. Deliberately not emulated (`ir/values.ts`)." } },
  domain("mathdom_atan_large", "1.0E18", "ATAN(seed)", "ATAN of a very large argument — approaches pi/2"),

  // ── and what the functions do with a NaN and an infinity they are HANDED, now that both are known to exist
  domain("mathdom_sqrt_of_infinity", "1.0E308", "SQRT(seed * seed)", "SQRT of an infinity produced by an overflow"),
  domain("mathdom_ln_of_infinity", "1.0E308", "LN(seed * seed)", "LN of an infinity"),
  domain("mathdom_sin_of_infinity", "1.0E308", "SIN(seed * seed)", "SIN of an infinity — undefined, so NaN or a stop"),

  // ── AND WHAT TYPE DOES EACH ONE RETURN? `cfold_sqrt` is `rv : REAL := SQRT(16.0)` and CODESYS warns twice
  //    about an LREAL losing information, so SQRT of an untyped real literal is LREAL. That is one data point
  //    for one function, and the catalog models no return type for any of them — which is why the LSP says
  //    nothing about a narrowing that the compiler reports. EXPT is the one that IS measured, and it is not
  //    always LREAL: `REAL when both arguments are REAL` (`types/arith.ts`). So ask all ten, with a REAL
  //    argument and with an LREAL one, and let the pair say whether the result follows the argument.
  ...MATH_FUNCTIONS.flatMap((fn) => [returns(fn, "REAL"), returns(fn, "LREAL")]),
]

/** `rv : REAL := <fn>(arg)` — silent when the result is a REAL, a narrowing warning when it is an LREAL. */
function returns(fn: string, argType: "REAL" | "LREAL"): LanguageTest {
  const slug = `mathret_${fn.toLowerCase()}_${argType.toLowerCase()}`
  const pou = `FB_LANG_${slug}`
  return {
    name: slug,
    pouName: pou,
    kind: "function_block" as const,
    feature: `the type ${fn} returns for a ${argType} argument — REAL, or LREAL narrowing into one?`,
    fromDoc: "05-operators.md",
    plcPrgVar: `inst : ${pou};`,
    plcPrgBody: "inst();",
    source:
      `FUNCTION_BLOCK ${pou}\nVAR\n\targ : ${argType} := 0.5;\n\trv : REAL;\nEND_VAR\n` +
      `rv := ${fn}(arg);\nEND_FUNCTION_BLOCK\n`,
  }
}
