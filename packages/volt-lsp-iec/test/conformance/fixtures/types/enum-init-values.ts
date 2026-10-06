/**
 * WHAT AN ENUMERATION MEMBER MAY BE INITIALIZED WITH — openspec `analysis-conformance` task 3.2.1 (types B), the `enum-init`
 * check (C0124, `src/analysis/checks/types/enum-init.ts`) rule by rule, one value kind each: a REAL literal (the one cell
 * recorded, `cc5_enum_init_not_convertible`), a STRING literal, TRUE, a TIME literal, a typed INT literal, a GVL variable,
 * a GVL constant, another enum's member, and a sibling member plus one — and the duplicate-value warning three of them drew.
 *
 * GLOBAL NAMES ARE THE FIXTURE'S OWN (`FB_LANG_<name>`, `DUT_LANG_<name>`, `GVL_LANG_<name>`): the replay binds every fixture
 * into one project.
 */
import type { LanguageTest } from "../../types.js"

const doc = "openspec analysis-conformance 3.2.1 (enum-init); docs/codesys-reference/06-data-types.md"

/** An enum `DUT_LANG_<name>` with the member list `members` (its member `B` read), and the FB that reads it. */
function enumSource(name: string, members: string, before = ""): string {
  const dut = `DUT_LANG_${name}`
  return (
    `${before}TYPE ${dut} :\n(\n${members}\n);\nEND_TYPE\n\n` +
    `FUNCTION_BLOCK FB_LANG_${name}\nVAR\n\te : ${dut} := ${dut}.B;\n\tout : INT;\nEND_VAR\nout := e;\nEND_FUNCTION_BLOCK\n`
  )
}

/** The enum `(A := 0, B := <value>)` — or the member list `members` — read by an FB. */
function enumFb(name: string, feature: string, value: string, before = "", members = `\tA := 0,\n\tB := ${value}`): LanguageTest {
  const pouName = `FB_LANG_${name}`
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar: `inst_${name} : ${pouName};`,
    plcPrgBody: `inst_${name}();`,
    source: enumSource(name, members, before),
  }
}

/** `t` with a global list ahead of it, holding `decls` (`VAR_GLOBAL<header>`). */
function withList(t: LanguageTest, header: string, decls: string): LanguageTest {
  return { ...t, source: `VAR_GLOBAL${header}\n${decls}\nEND_VAR\n\n${t.source}`, gvlNames: [`GVL_LANG_${t.name}`] }
}

export const ENUM_INIT_VALUE_TESTS: readonly LanguageTest[] = [
  enumFb("eninit_real_literal", "an enum member initialized with the REAL literal 2.5", "2.5"),
  enumFb("eninit_string_literal", "an enum member initialized with the STRING literal 'x'", "'x'"),
  enumFb("eninit_bool_literal", "an enum member initialized with TRUE", "TRUE"),
  enumFb("eninit_time_literal", "an enum member initialized with T#1S", "T#1S"),
  enumFb("eninit_typed_int_literal", "an enum member initialized with INT#5", "INT#5"),
  enumFb("eninit_sibling_plus_one", "an enum member initialized with its sibling plus one: `A + 1`", "A + 1"),
  enumFb("eninit_other_enum_member", "an enum member initialized with another enum's member",
    "DUT_LANG_eninit_other_enum_member_src.X", "TYPE DUT_LANG_eninit_other_enum_member_src :\n(\n\tX := 3\n);\nEND_TYPE\n\n"),
  withList(enumFb("eninit_gvl_variable", "an enum member initialized with a (non-constant) global variable", "g_eninit_var"), "", "\tg_eninit_var : INT := 4;"),
  withList(enumFb("eninit_gvl_constant", "an enum member initialized with a global CONSTANT", "g_eninit_const"), " CONSTANT", "\tg_eninit_const : INT := 4;"),
  // …and the warning three invalid values drew, "The constant 0 is assigned to more than one enumeration": is it every
  // duplicate value, or the 0 an invalid value leaves behind?
  enumFb("eninit_explicit_duplicate", "two enum members written with the same value: `A := 0, B := 0`", "0"),
  enumFb("eninit_invalid_first_member", "the FIRST member invalid (2.5), the second written 1", "", "", "\tA := 2.5,\n\tB := 1"),
  enumFb("eninit_invalid_beside_nonzero", "an invalid member (2.5) beside members written 5 and 6", "", "", "\tA := 5,\n\tB := 2.5,\n\tC := 6"),
]
