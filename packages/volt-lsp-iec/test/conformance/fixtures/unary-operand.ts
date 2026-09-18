/**
 * WHAT TYPE DOES A UNARY OPERATOR PRODUCE? — asked of CODESYS one operand type at a time.
 *
 * Four fixtures in `semantic.ts` asked whether `-x` and `NOT x` are errors on a non-number, and the answers were more
 * interesting than a yes: the vendor did not say "you cannot negate a STRING", it said
 *
 *     out := -text;   (text : STRING)  ->  Cannot convert type 'INT' to type 'STRING'
 *     out := -b;      (b : BOOL)       ->  Cannot convert type 'INT' to type 'BOOL'
 *     out := -t1;     (t1 : TIME)      ->  Cannot convert type 'DINT' to type 'TIME'
 *
 * So the operator SUCCEEDS and produces some type, and the error is the assignment that follows. Three points is not
 * a rule — INT for a STRING and for a BOOL, DINT for a TIME, and no idea what for the other sixteen elementary types
 * — and an inference rule guessed from three samples is exactly the kind of thing that then has to be unguessed.
 *
 * THE TRICK THESE USE: every probe assigns into a deliberately incompatible variable, so CODESYS has to NAME the type
 * it inferred in order to complain about it. A `STRING` destination does that for every numeric result, and the two
 * `intoInt` probes do it the other way for the ones that ARE strings or times. When the operator itself is invalid
 * for the operand, the message names that instead — also an answer.
 *
 * WHAT CAME BACK, 2026-09-18, CODESYS 3.5.21.40 - and it is a complete rule, not three points:
 *
 * UNARY MINUS produces the SIGNED integer of the operand's width, with a floor of 16 bits; REAL and LREAL pass
 * through unchanged. An 8-bit operand WIDENS: `-SINT` and `-BYTE` are both INT. A non-numeric operand also reports
 * its own conversion into that type ("Cannot convert type 'TIME' to type 'DINT'") - except BOOL, which converts
 * silently, and STRING, which reports only the failed conversion because there is no number to produce.
 *
 * NOT produces the UNSIGNED integer of the operand's width, and BOOL stays BOOL: `NOT INT` is UINT, `NOT DINT` is
 * UDINT, `NOT LWORD` is ULINT. REAL passes through as REAL and adds "Cannot convert type 'REAL' to type 'ANY_BIT'";
 * a STRING or WSTRING reports only that ANY_BIT complaint.
 *
 * Every message below is from that recording, and each fixture carries its own in `refused`:
 *
 *   neg_byte                 Cannot convert type 'INT' to type 'STRING'
 *   neg_date                 Cannot convert type 'DINT' to type 'STRING' | Cannot convert type 'DATE' to type 'DINT'
 *   neg_dint                 Cannot convert type 'DINT' to type 'STRING'
 *   neg_dt                   Cannot convert type 'DINT' to type 'STRING' | Cannot convert type 'DATE_AND_TIME' to type 'DINT'
 *   neg_dword                Cannot convert type 'DINT' to type 'STRING'
 *   neg_int                  Cannot convert type 'INT' to type 'STRING'
 *   neg_lint                 Cannot convert type 'LINT' to type 'STRING'
 *   neg_lreal                Cannot convert type 'LREAL' to type 'STRING'
 *   neg_ltime                Cannot convert type 'LINT' to type 'STRING' | Cannot convert type 'LTIME' to type 'LINT'
 *   neg_lword                Cannot convert type 'LINT' to type 'STRING'
 *   neg_real                 Cannot convert type 'REAL' to type 'STRING'
 *   neg_sint                 Cannot convert type 'INT' to type 'STRING'
 *   neg_string_into_int      Cannot convert type 'STRING' to type 'INT'
 *   neg_time_into_string     Cannot convert type 'DINT' to type 'STRING' | Cannot convert type 'TIME' to type 'DINT'
 *   neg_tod                  Cannot convert type 'DINT' to type 'STRING' | Cannot convert type 'TIME_OF_DAY' to type 'DINT'
 *   neg_udint                Cannot convert type 'DINT' to type 'STRING'
 *   neg_uint                 Cannot convert type 'INT' to type 'STRING'
 *   neg_ulint                Cannot convert type 'LINT' to type 'STRING'
 *   neg_usint                Cannot convert type 'INT' to type 'STRING'
 *   neg_word                 Cannot convert type 'INT' to type 'STRING'
 *   neg_wstring              Cannot convert type 'INT' to type 'STRING' | Cannot convert type 'WSTRING' to type 'INT'
 *   not_bool                 Cannot convert type 'BOOL' to type 'STRING'
 *   not_byte                 Cannot convert type 'USINT' to type 'STRING'
 *   not_date                 Cannot convert type 'UDINT' to type 'STRING' | Cannot convert type 'DATE' to type 'UDINT'
 *   not_dint                 Cannot convert type 'UDINT' to type 'STRING'
 *   not_dword                Cannot convert type 'UDINT' to type 'STRING'
 *   not_int                  Cannot convert type 'UINT' to type 'STRING'
 *   not_lint                 Cannot convert type 'ULINT' to type 'STRING'
 *   not_lword                Cannot convert type 'ULINT' to type 'STRING'
 *   not_real                 Cannot convert type 'REAL' to type 'STRING' | Cannot convert type 'REAL' to type 'ANY_BIT'
 *   not_sint                 Cannot convert type 'USINT' to type 'STRING'
 *   not_time                 Cannot convert type 'UDINT' to type 'STRING' | Cannot convert type 'TIME' to type 'UDINT'
 *   not_udint                Cannot convert type 'UDINT' to type 'STRING'
 *   not_word                 Cannot convert type 'UINT' to type 'STRING'
 *   not_wstring              Cannot convert type 'WSTRING' to type 'STRING' | Cannot convert type 'WSTRING' to type 'ANY_BIT'
 */
import type { LanguageTest } from "../types.js"

/** `out := <op> x;` where `out` is chosen to be incompatible with anything the operator can produce. */
function probe(slug: string, op: string, decl: string, outType: string, refused: string): LanguageTest {
  const pou = `FB_LANG_${slug}`
  return {
    name: slug,
    pouName: pou,
    kind: "function_block" as const,
    feature: `the type CODESYS infers for \`${op} x\` where x is ${decl.split(":")[1]?.trim().replace(/;$/, "") ?? decl}`,
    fromDoc: "03-operators.md",
    refused,
    plcPrgVar: `inst : ${pou};`,
    plcPrgBody: "inst();",
    source: `FUNCTION_BLOCK ${pou}\nVAR\n\t${decl}\n\tout : ${outType};\nEND_VAR\nout := ${op} x;\nEND_FUNCTION_BLOCK\n`,
  }
}

const neg = (slug: string, decl: string, refused: string, outType = "STRING"): LanguageTest =>
  probe(`uop_neg_${slug}`, "-", decl, outType, refused)
const not = (slug: string, decl: string, refused: string, outType = "STRING"): LanguageTest =>
  probe(`uop_not_${slug}`, "NOT", decl, outType, refused)

export const UNARY_OPERAND_TESTS: readonly LanguageTest[] = [
  // ── unary minus, one elementary type at a time ──────────────────────────────────────────────────
  neg("sint", "x : SINT := 1;", "Cannot convert type 'INT' to type 'STRING'"),
  neg("usint", "x : USINT := 1;", "Cannot convert type 'INT' to type 'STRING'"),
  neg("int", "x : INT := 1;", "Cannot convert type 'INT' to type 'STRING'"),
  neg("uint", "x : UINT := 1;", "Cannot convert type 'INT' to type 'STRING'"),
  neg("dint", "x : DINT := 1;", "Cannot convert type 'DINT' to type 'STRING'"),
  neg("udint", "x : UDINT := 1;", "Cannot convert type 'DINT' to type 'STRING'"),
  neg("lint", "x : LINT := 1;", "Cannot convert type 'LINT' to type 'STRING'"),
  neg("ulint", "x : ULINT := 1;", "Cannot convert type 'LINT' to type 'STRING'"),
  neg("byte", "x : BYTE := 1;", "Cannot convert type 'INT' to type 'STRING'"),
  neg("word", "x : WORD := 1;", "Cannot convert type 'INT' to type 'STRING'"),
  neg("dword", "x : DWORD := 1;", "Cannot convert type 'DINT' to type 'STRING'"),
  neg("lword", "x : LWORD := 1;", "Cannot convert type 'LINT' to type 'STRING'"),
  neg("real", "x : REAL := 1.0;", "Cannot convert type 'REAL' to type 'STRING'"),
  neg("lreal", "x : LREAL := 1.0;", "Cannot convert type 'LREAL' to type 'STRING'"),
  neg("ltime", "x : LTIME := LTIME#2S;", "Cannot convert type 'LINT' to type 'STRING'"),
  neg("date", "x : DATE := D#2024-01-01;", "Cannot convert type 'DINT' to type 'STRING'"),
  neg("tod", "x : TOD := TOD#12:00:00;", "Cannot convert type 'DINT' to type 'STRING'"),
  neg("dt", "x : DT := DT#2024-01-01-12:00:00;", "Cannot convert type 'DINT' to type 'STRING'"),
  neg("wstring", "x : WSTRING := \"ab\";", "Cannot convert type 'INT' to type 'STRING'"),
  // A STRING and a TIME already produce a number, so a STRING destination would not fail. Ask them the other way.
  neg("string_into_int", "x : STRING := 'abc';", "Cannot convert type 'STRING' to type 'INT'", "INT"),
  neg("time_into_string", "x : TIME := T#2S;", "Cannot convert type 'DINT' to type 'STRING'"),

  // ── NOT ────────────────────────────────────────────────────────────────────────────────────────
  not("bool", "x : BOOL := TRUE;", "Cannot convert type 'BOOL' to type 'STRING'"),
  not("byte", "x : BYTE := 1;", "Cannot convert type 'USINT' to type 'STRING'"),
  not("word", "x : WORD := 1;", "Cannot convert type 'UINT' to type 'STRING'"),
  not("dword", "x : DWORD := 1;", "Cannot convert type 'UDINT' to type 'STRING'"),
  not("lword", "x : LWORD := 1;", "Cannot convert type 'ULINT' to type 'STRING'"),
  not("sint", "x : SINT := 1;", "Cannot convert type 'USINT' to type 'STRING'"),
  not("int", "x : INT := 1;", "Cannot convert type 'UINT' to type 'STRING'"),
  not("dint", "x : DINT := 1;", "Cannot convert type 'UDINT' to type 'STRING'"),
  not("udint", "x : UDINT := 1;", "Cannot convert type 'UDINT' to type 'STRING'"),
  not("lint", "x : LINT := 1;", "Cannot convert type 'ULINT' to type 'STRING'"),
  not("real", "x : REAL := 1.0;", "Cannot convert type 'REAL' to type 'STRING'"),
  not("time", "x : TIME := T#2S;", "Cannot convert type 'UDINT' to type 'STRING'"),
  not("date", "x : DATE := D#2024-01-01;", "Cannot convert type 'UDINT' to type 'STRING'"),
  not("wstring", "x : WSTRING := \"ab\";", "Cannot convert type 'WSTRING' to type 'STRING'"),
]
