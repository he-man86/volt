/**
 * WHAT IS A PRIMITIVE BEFORE ANYONE WRITES TO IT? — asked of every elementary type CODESYS has.
 *
 * The most basic question in the language, and it had never been asked as a set. Defaults were known for whichever
 * types a fixture happened to declare along the way, and assumed for the rest — which is the same standard that let
 * `-SINT` go unmeasured until `operators/unary-operand.ts` asked all twenty-nine.
 *
 * THE LIST IS THE VENDOR'S, NOT OURS. `docs/codesys-reference/06-data-types.md` names the Elementary group, and
 * `Standard` adds STRING and WSTRING. Twenty-nine distinct types once the aliases are folded in (DATE_AND_TIME=DT,
 * TIME_OF_DAY=TOD, LDATE_AND_TIME=LDT, LTIME_OF_DAY=LTOD) — and three of them, the platform-portable
 * `__XINT` / `__UXINT` / `__XWORD`, are NOT IN `src/types/elementary.ts` AT ALL. That gap is why they are here.
 *
 * `BIT` is declared like the rest: the reference restricts it to "STRUCT members or FB local variables only", and an
 * FB local is exactly what a fixture is.
 */
import type { LanguageTest } from "../../types.js"

/** One primitive, declared with no initializer, read after one scan. */
function def(type: string, note?: string): LanguageTest {
  const slug = `prim_default_${type.replace(/^__/, "x_").toLowerCase()}`
  const pou = `FB_LANG_${slug}`
  return {
    name: slug,
    pouName: pou,
    kind: "function_block" as const,
    feature: `the value a ${type} holds with no initializer`,
    fromDoc: "06-data-types.md",
    ...(note !== undefined ? { note } : {}),
    plcPrgVar: `inst : ${pou};`,
    plcPrgBody: "inst();",
    source: `FUNCTION_BLOCK ${pou}\nVAR\n\tx : ${type};\nEND_VAR\n\nEND_FUNCTION_BLOCK\n`,
  }
}

export const PRIMITIVE_DEFAULT_TESTS: readonly LanguageTest[] = [
  // ── boolean and bit ──────────────────────────────────────────────────────────────────────────
  def("BOOL"),
  def("BIT", "The reference allows BIT only as a STRUCT member or an FB local. This is the FB-local form."),

  // ── bit strings ──────────────────────────────────────────────────────────────────────────────
  def("BYTE"),
  def("WORD"),
  def("DWORD"),
  def("LWORD"),

  // ── signed integers ──────────────────────────────────────────────────────────────────────────
  def("SINT"),
  def("INT"),
  def("DINT"),
  def("LINT"),

  // ── unsigned integers ────────────────────────────────────────────────────────────────────────
  def("USINT"),
  def("UINT"),
  def("UDINT"),
  def("ULINT"),

  // ── floating point ───────────────────────────────────────────────────────────────────────────
  def("REAL"),
  def("LREAL"),

  // ── durations ────────────────────────────────────────────────────────────────────────────────
  def("TIME"),
  def("LTIME"),

  // ── dates and times of day. Both spellings of each alias are asked: the pair must agree, and if one
  //    of them ever does not, that is a fact about the vendor worth having rather than an assumption.
  def("DATE"),
  def("DT"),
  def("DATE_AND_TIME"),
  def("TOD"),
  def("TIME_OF_DAY"),
  def("LDATE"),
  def("LDT"),
  def("LDATE_AND_TIME"),
  def("LTOD"),
  def("LTIME_OF_DAY"),

  // ── strings ──────────────────────────────────────────────────────────────────────────────────
  def("STRING"),
  def("WSTRING"),

  // ── platform-portable integers. NOT IN `src/types/elementary.ts`: `elementaryType("__XINT")` is undefined, so
  //    every check that gates on `checkable()` skips them in silence. They are a CODESYS extension that compiles to
  //    DINT/LINT, UDINT/ULINT and DWORD/LWORD by target width — and the exec oracle runs one specific target, so
  //    what comes back is also the answer to "which width is the simulator".
  def("__XINT", "Platform-portable: DINT on a 32-bit target, LINT on a 64-bit one."),
  def("__UXINT", "Platform-portable: UDINT on a 32-bit target, ULINT on a 64-bit one. The pointer-sized integer."),
  def("__XWORD", "Platform-portable: DWORD on a 32-bit target, LWORD on a 64-bit one."),
]
