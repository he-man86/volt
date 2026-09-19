/**
 * WHAT A COMPILE-TIME INITIALIZER MAY HOLD — the shapes real projects write, and what the compiler folds them to.
 *
 * The corpus's non-literal initializers were censused on 2026-09-19 and they are not exotic:
 *
 *   member        2157   `EAlarmByteOrder.Unknown`                       folds here already
 *   aggregate      963   a struct or array literal                       its own path
 *   CALL           633   `ANY_TO_DINT(16#80000000)`                      DOES NOT FOLD
 *   unary          489   `-1`                                            folds
 *   PAREN          451   `(SHL(UINT_TO_DWORD(x), 16) OR 16#1)`           DOES NOT FOLD — it holds a call
 *   ident_expr     358   `ERR_OK`                                        folds
 *   deref          111   `THIS^`                                         genuinely not constant
 *
 * So roughly 1080 initializers in five real projects are blocked by ONE thing: `constEval` returns undefined for a
 * call, and `init-not-constant` is the highest-reach refusal in the whole corpus (200 of 304 POUs with a body).
 *
 * The question is not *whether* to fold them — it is WHAT TO. A fold and a run-time conversion need not agree, and
 * the very first corpus sample is the case where they might not: `ANY_TO_DINT(16#80000000)` is out of DINT's range,
 * so the answer distinguishes "the compiler folds with the same wrapping the runtime uses" from "the compiler
 * refuses it" from "the compiler saturates". Every probe below is read back after a scan, so the recorded value is
 * the one the initializer actually produced.
 *
 * Asked in a VAR section of a PROGRAM, which is where the corpus writes them. The variables are named `rv`/`sv`
 * rather than `r`/`s` for the reason `docs/reserved-il-operators.md` gives: those two are IL operators and cannot
 * name anything — a fixture that uses one records a parse cascade instead of an answer.
 */
import type { LanguageTest } from "../../types.js"

function probe(slug: string, decls: string, reads: readonly string[], feature: string): LanguageTest {
  const pou = `FB_LANG_${slug}`
  return {
    name: slug,
    pouName: pou,
    kind: "function_block" as const,
    feature,
    fromDoc: "06-data-types.md",
    plcPrgVar: `inst : ${pou};`,
    plcPrgBody: "inst();",
    source: `FUNCTION_BLOCK ${pou}\nVAR\n${decls}\nEND_VAR\n${reads.map((r) => `${r} := ${r};`).join("\n")}\nEND_FUNCTION_BLOCK\n`,
  }
}

/** One declaration, one value read back. */
const one = (slug: string, decl: string, name: string, feature: string): LanguageTest =>
  probe(slug, `\t${decl}`, [name], feature)

/** THE CONVERSIONS — including the two where a fold and a run-time conversion could disagree. */
const conversions: LanguageTest[] = [
  one("cfold_any_to_dint_high", "d : DINT := ANY_TO_DINT(16#80000000);", "d", "the corpus's own sample: a value ABOVE DINT's range, folded"),
  one("cfold_int_to_byte_over", "b : BYTE := INT_TO_BYTE(300);", "b", "INT_TO_BYTE(300) — wraps at run time; does it fold the same?"),
  one("cfold_int_to_sint_over", "sv : SINT := INT_TO_SINT(200);", "sv", "INT_TO_SINT(200) — the signed edge"),
  one("cfold_uint_to_dword", "w : DWORD := UINT_TO_DWORD(3);", "w", "a widening conversion, the shape the SHL sample wraps"),
  one("cfold_real_to_int_half", "i : INT := REAL_TO_INT(2.5);", "i", "REAL_TO_INT(2.5) — half AWAY from zero at run time"),
  one("cfold_real_to_int_negative_half", "i : INT := REAL_TO_INT(-2.5);", "i", "and the negative half"),
  one("cfold_real_to_int_out", "i : DINT := REAL_TO_DINT(3.0E9);", "i", "REAL_TO_DINT above DINT's range — the destination-register rule, folded"),
  one("cfold_bool_to_int", "i : INT := BOOL_TO_INT(TRUE);", "i", "BOOL_TO_INT(TRUE)"),
  one("cfold_dint_to_real", "rv : REAL := DINT_TO_REAL(7);", "rv", "an integer into a REAL"),
  one("cfold_time_to_dint", "d : DINT := TIME_TO_DINT(T#1S500MS);", "d", "a duration folded to its tick count"),
]

/** THE PURE BUILTINS a constant expression reaches for. */
const builtins: LanguageTest[] = [
  one("cfold_shl", "w : DWORD := SHL(UINT_TO_DWORD(3), 16);", "w", "the corpus's SHL over a converted constant"),
  one("cfold_shr", "w : DWORD := SHR(16#FF00, 8);", "w", "SHR"),
  one("cfold_rol", "w : BYTE := ROL(16#81, 1);", "w", "ROL at the width's edge"),
  one("cfold_ror", "w : BYTE := ROR(16#81, 1);", "w", "ROR at the width's edge"),
  one("cfold_abs", "i : INT := ABS(-7);", "i", "ABS"),
  one("cfold_min_max", "i : INT := MIN(3, MAX(1, 2));", "i", "MIN over MAX — nested calls"),
  one("cfold_limit", "i : INT := LIMIT(1, 9, 5);", "i", "LIMIT"),
  one("cfold_sel", "i : INT := SEL(TRUE, 10, 20);", "i", "SEL, whose selector is a constant too"),
  one("cfold_mux", "i : INT := MUX(1, 10, 20, 30);", "i", "MUX"),
  one("cfold_trunc", "d : DINT := TRUNC(7.9);", "d", "TRUNC, which is not REAL_TO_INT's rounding — and returns a DINT"),
  one("cfold_expt", "i : DINT := REAL_TO_DINT(EXPT(2, 10));", "i", "EXPT folded and converted"),
  one("cfold_sqrt", "rv : REAL := SQRT(16.0);", "rv", "a math function in an initializer — folded, or refused?"),
]

/** THE SHAPES AROUND THE CALL — a paren, an operator over two calls, a call inside a call. */
const shapes: LanguageTest[] = [
  one(
    "cfold_paren_shl_or",
    "w : DWORD := (SHL(UINT_TO_DWORD(3), 16) OR 16#1);",
    "w",
    "THE CORPUS SHAPE, verbatim: a paren holding an operator over a call",
  ),
  one("cfold_nested_calls", "d : DINT := ANY_TO_DINT(INT_TO_DINT(5));", "d", "a call whose argument is a call"),
  one("cfold_call_plus_constant", "i : INT := ABS(-7) + 1;", "i", "an operator with a call on one side"),
  one("cfold_sizeof_type", "n : UDINT := SIZEOF(DINT);", "n", "SIZEOF of a TYPE, which is constant by definition"),
  one("cfold_sizeof_var", "n : UDINT := SIZEOF(other);\n\tother : DINT;", "n", "SIZEOF of a VARIABLE declared after it"),
]

/** AND THE ONES THAT SHOULD NOT FOLD — so the refusal is measured rather than assumed. */
const refused: LanguageTest[] = [
  {
    ...one("cfold_user_function", "i : INT := FUN_LANG_cfold_double(3);", "i", "a call to a USER FUNCTION — constant, or refused?"),
    source:
      "FUNCTION FUN_LANG_cfold_double : INT\nVAR_INPUT\n\tn : INT;\nEND_VAR\nFUN_LANG_cfold_double := n * 2;\nEND_FUNCTION\n\n" +
      "FUNCTION_BLOCK FB_LANG_cfold_user_function\nVAR\n\ti : INT := FUN_LANG_cfold_double(3);\nEND_VAR\ni := i;\nEND_FUNCTION_BLOCK\n",
  },
  one("cfold_non_constant_argument", "i : INT := ABS(other);\n\tother : INT := -7;", "i", "a builtin over a VARIABLE — not a constant at all"),
  // ...and the same pair the other way round. `cfold_non_constant_argument` answers 0 rather than 7 and does NOT
  // refuse, which has two readings: initializers run in DECLARATION ORDER and `other` was still at its default, or
  // a non-constant argument folds to the type's default wherever it stands. Swapping the two separates them.
  one("cfold_argument_declared_first", "other : INT := -7;\n\ti : INT := ABS(other);", "i", "the same, with the argument declared BEFORE its reader"),
  // A user FUNCTION folds (`cfold_user_function` is 6), which is a much larger claim than folding a conversion —
  // it means the compiler RUNS it. Whether it runs one that reads a GLOBAL says how far that goes; the global
  // starts at 41, so 42 means it ran with the global initialized and 1 means it ran before.
  {
    ...one("cfold_user_function_reads_global", "i : INT := FUN_LANG_cfold_global();", "i", "a user function that reads a GLOBAL — still folded?"),
    source:
      "FUNCTION FUN_LANG_cfold_global : INT\nVAR_EXTERNAL\n\tgCfoldSeed : INT;\nEND_VAR\nFUN_LANG_cfold_global := gCfoldSeed + 1;\nEND_FUNCTION\n\n" +
      "FUNCTION_BLOCK FB_LANG_cfold_user_function_reads_global\nVAR\n\ti : INT := FUN_LANG_cfold_global();\nEND_VAR\ni := i;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "cfold_global_list",
    pouName: "GVL_CFOLD",
    kind: "gvl" as const,
    feature: "the global the folded function reads",
    fromDoc: "06-data-types.md",
    plcPrgVar: "seedCopy : INT;",
    plcPrgBody: "seedCopy := GVL_CFOLD.gCfoldSeed;",
    source: "VAR_GLOBAL\n\tgCfoldSeed : INT := 41;\nEND_VAR\n",
  },
]

export const CONSTANT_FOLDING_TESTS: readonly LanguageTest[] = [...conversions, ...builtins, ...shapes, ...refused]
