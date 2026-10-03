/**
 * ENUM CONVERSIONS — design.md §4 4.5 of openspec `frontend-conformance` (CV3–CV5, P14, P15; task 4.5.1), the cells no
 * recorded fixture decided.
 *
 *   CV3   a project enum without a base: two enums assigned to each other, and an enum as an operand of arithmetic
 *   CV4   an enum WITH a written base, through every scalar target, one base at a time; a LIBRARY enum (Util's WEEKDAY,
 *         StringUtils' EDATETIMEPLACEHOLDER, whose members run to 255) through the same targets
 *   CV5   a scalar INTO an enum — every family, a variable and a literal — with and without `{attribute 'strict'}` (P14),
 *         and with a written base
 *   P15   `{attribute 'to_string'}`: TO_STRING of every member of an enum, and of an enum with written values
 *
 * Every enum is the fixture's own (`DUT_LANG_<name>`, `Off := 0, On := 1` unless the cell says otherwise), its members
 * written qualified, so a cell measures the conversion and not the access form. The type-naming probes assign into a
 * STRING, which no enum converts into, so the compiler names the type it arrived at.
 */
import type { LanguageTest } from "../../types.js"

const doc = "frontend-conformance design.md §4 4.5 (enum conversions); docs/codesys-reference/06-data-types.md"

/** A function block `FB_LANG_<name>` with VAR `vars` and body `body`; `before` (whole units) is written ahead of it. */
function fb(name: string, feature: string, vars: string, body: string, before = ""): LanguageTest {
  const pouName = `FB_LANG_${name}`
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar: `inst_${name} : ${pouName};`,
    plcPrgBody: `inst_${name}();`,
    source: `${before}FUNCTION_BLOCK ${pouName}\nVAR\n${vars}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n`,
  }
}

/** The fixture's own enum `DUT_LANG_<name>` (`Off := 0, On := 1`, or `members`), `base` after the list, `attribute` above. */
function enumDecl(name: string, { base = "", attribute = "", members = "\tOff := 0,\n\tOn := 1" } = {}): string {
  return `${attribute}TYPE DUT_LANG_${name} :\n(\n${members}\n)${base === "" ? "" : ` ${base}`};\nEND_TYPE\n\n`
}

/** The scalar targets an enum value is stored into, one variable each (`v_<type>`). */
const TARGETS = ["SINT", "USINT", "BYTE", "INT", "UINT", "WORD", "DINT", "UDINT", "DWORD", "LINT", "ULINT", "LWORD", "REAL", "LREAL"]
const targetVars = (types: readonly string[]): string => types.map((t) => `\tv_${t.toLowerCase()} : ${t};`).join("\n")

/** `e` (of `enumType`, set to `value`) stored into a variable of every scalar target. */
function intoScalars(name: string, feature: string, enumType: string, value: string, before: string): LanguageTest {
  return fb(name, feature, `\te : ${enumType};\n${targetVars(TARGETS)}`,
    `e := ${value};\n${TARGETS.map((t) => `v_${t.toLowerCase()} := e;`).join("\n")}`, before)
}

/** The scalar SOURCES stored into an enum: every family, each a variable holding 1 (TRUE, '1', T#1MS). */
const SOURCES: readonly [string, string][] = [
  ["SINT", "1"], ["USINT", "1"], ["BYTE", "1"], ["INT", "1"], ["UINT", "1"], ["WORD", "1"], ["DINT", "1"], ["UDINT", "1"],
  ["LINT", "1"], ["REAL", "1.0"], ["BOOL", "TRUE"], ["STRING", "'1'"], ["TIME", "T#1MS"],
]

/** A variable of every scalar source, each holding 1, stored into `e` (of `enumType`). */
function scalarsInto(name: string, feature: string, enumType: string, before: string): LanguageTest {
  const vars = SOURCES.map(([t, v]) => `\ts_${t.toLowerCase()} : ${t} := ${v};`).join("\n")
  return fb(name, feature, `\te : ${enumType};\n${vars}`, SOURCES.map(([t]) => `e := s_${t.toLowerCase()};`).join("\n"), before)
}

const own = (name: string): string => `DUT_LANG_${name}`

// ─── CV3 — a project enum without a base: two enums, and arithmetic ────────────────────────────────────────────────

const CV3: LanguageTest[] = [
  fb("cv_enum_into_other_enum", "CV3 — a value of one project enum assigned to a variable of another (both `Off := 0, On := 1`)",
    `\ta : ${own("cv_enum_into_other_enum")};\n\tb : DUT_LANG_cv_enum_into_other_enum_b;`,
    `a := ${own("cv_enum_into_other_enum")}.On;\nb := a;`,
    enumDecl("cv_enum_into_other_enum") + enumDecl("cv_enum_into_other_enum_b")),
  // the type an enum operand of arithmetic computes in, named into a STRING: beside a typed literal, an untyped one, itself
  fb("cv_enum_arithmetic_type", "CV3 — an enum variable plus INT#1, plus 1, plus itself, times DINT#2, into STRINGs",
    `\te : ${own("cv_enum_arithmetic_type")};\n\td : DINT := 2;\n\tout1 : STRING;\n\tout2 : STRING;\n\tout3 : STRING;\n\tout4 : STRING;`,
    `e := ${own("cv_enum_arithmetic_type")}.On;\nout1 := e + INT#1;\nout2 := e + 1;\nout3 := e + e;\nout4 := e * d;`,
    enumDecl("cv_enum_arithmetic_type")),
  fb("cv_enum_arithmetic_values", "CV3 — an enum variable (On = 1) plus INT#1, plus 1, plus itself, into INTs",
    `\te : ${own("cv_enum_arithmetic_values")};\n\tout1 : INT;\n\tout2 : INT;\n\tout3 : INT;`,
    `e := ${own("cv_enum_arithmetic_values")}.On;\nout1 := e + INT#1;\nout2 := e + 1;\nout3 := e + e;`,
    enumDecl("cv_enum_arithmetic_values")),
]

// ─── CV4 — an enum with a written base; a library enum ─────────────────────────────────────────────────────────────

const BASES = ["BYTE", "SINT", "INT", "UINT", "WORD", "DINT", "UDINT", "LINT"]

const CV4: LanguageTest[] = [
  fb("cv_enum_with_base_into_int", "CV4 — a variable of an enum with base BYTE stored into an INT",
    `\te : ${own("cv_enum_with_base_into_int")};\n\tout : INT;`, `e := ${own("cv_enum_with_base_into_int")}.On;\nout := e;`,
    enumDecl("cv_enum_with_base_into_int", { base: "BYTE" })),
  ...BASES.map((base) => {
    const name = `cv_enum_base_${base.toLowerCase()}_into_scalars`
    return intoScalars(name, `CV4 — a variable of an enum with base ${base} stored into every scalar target`, own(name), `${own(name)}.On`,
      enumDecl(name, { base }))
  }),
  fb("cv_enum_with_base_type", "CV4 — a variable of an enum with base BYTE, and of one with base DINT, into STRINGs",
    `\te : ${own("cv_enum_with_base_type")};\n\tf : DUT_LANG_cv_enum_with_base_type_d;\n\tout1 : STRING;\n\tout2 : STRING;`,
    `out1 := e;\nout2 := f;`,
    enumDecl("cv_enum_with_base_type", { base: "BYTE" }) + enumDecl("cv_enum_with_base_type_d", { base: "DINT" })),
  fb("cv_library_enum_into_int", "CV4 — a variable of Util's WEEKDAY (a library enum) stored into an INT",
    "\tw : WEEKDAY;\n\tout : INT;", "w := WEEKDAY.WEDNESDAY;\nout := w;"),
  {
    ...intoScalars("cv_library_enum_into_scalars", "CV4 — a variable of Util's WEEKDAY stored into every scalar target", "WEEKDAY", "WEEKDAY.WEDNESDAY", ""),
    deferred: {
      lsp: "2026-10-03, CODESYS refuses WEEKDAY into SINT, USINT, BYTE — it converts as an unsigned 16-bit type, a base its materialized declaration does not carry (`types/enums` `enumBase` leaves a library enum unjudged); `LIBRARY_ENUM_BASE_NOT_MATERIALIZED`",
    },
  },
  intoScalars("cv_library_enum_255_into_scalars", "CV4 — a variable of StringUtils' EDATETIMEPLACEHOLDER (members to 255) stored into every scalar target",
    "EDATETIMEPLACEHOLDER", "EDATETIMEPLACEHOLDER.PLH_NOT_USED", ""),
  fb("cv_library_enum_type", "CV4 — a variable of Util's WEEKDAY and of StringUtils' EDATETIMEPLACEHOLDER, into STRINGs",
    "\tw : WEEKDAY;\n\tp : EDATETIMEPLACEHOLDER;\n\tout1 : STRING;\n\tout2 : STRING;", "out1 := w;\nout2 := p;"),
]

// ─── CV5 — a scalar into an enum (P14 `strict`) ────────────────────────────────────────────────────────────────────

const STRICT = "{attribute 'strict'}\n"

const CV5: LanguageTest[] = [
  fb("cv_int_into_enum", "CV5 — an INT variable (1) assigned to an enum", `\te : ${own("cv_int_into_enum")};\n\ti : INT := 1;`, "e := i;",
    enumDecl("cv_int_into_enum")),
  fb("cv_literal_into_enum", "CV5 — integer literals assigned to an enum: one a member names (1), one none names (5), a typed INT#1, a negative -1",
    `\te1 : ${own("cv_literal_into_enum")};\n\te2 : ${own("cv_literal_into_enum")};\n\te3 : ${own("cv_literal_into_enum")};\n\te4 : ${own("cv_literal_into_enum")};`,
    "e1 := 1;\ne2 := 5;\ne3 := INT#1;\ne4 := -1;", enumDecl("cv_literal_into_enum")),
  scalarsInto("cv_scalars_into_enum", "CV5 — a variable of every scalar family assigned to an enum without a base", own("cv_scalars_into_enum"),
    enumDecl("cv_scalars_into_enum")),
  scalarsInto("cv_scalars_into_enum_with_base", "CV5 — a variable of every scalar family assigned to an enum with base BYTE",
    own("cv_scalars_into_enum_with_base"), enumDecl("cv_scalars_into_enum_with_base", { base: "BYTE" })),
  fb("cv_int_into_strict_enum", "CV5/P14 — an INT variable (1) assigned to a `{attribute 'strict'}` enum",
    `\te : ${own("cv_int_into_strict_enum")};\n\ti : INT := 1;`, "e := i;", enumDecl("cv_int_into_strict_enum", { attribute: STRICT })),
  scalarsInto("cv_scalars_into_strict_enum", "CV5/P14 — a variable of every scalar family assigned to a `{attribute 'strict'}` enum",
    own("cv_scalars_into_strict_enum"), enumDecl("cv_scalars_into_strict_enum", { attribute: STRICT })),
  fb("cv_literals_into_strict_enum", "CV5/P14 — literals assigned to a `{attribute 'strict'}` enum: a member's value (1), none's (5), INT#1, -1, TRUE",
    [1, 2, 3, 4, 5].map((i) => `\te${i} : ${own("cv_literals_into_strict_enum")};`).join("\n"),
    "e1 := 1;\ne2 := 5;\ne3 := INT#1;\ne4 := -1;\ne5 := TRUE;", enumDecl("cv_literals_into_strict_enum", { attribute: STRICT })),
  fb("cv_strict_enum_into_int", "CV5/P14 — a `{attribute 'strict'}` enum variable stored into an INT",
    `\te : ${own("cv_strict_enum_into_int")};\n\tout : INT;`, `e := ${own("cv_strict_enum_into_int")}.On;\nout := e;`,
    enumDecl("cv_strict_enum_into_int", { attribute: STRICT })),
  intoScalars("cv_strict_enum_into_scalars", "CV5/P14 — a `{attribute 'strict'}` enum variable stored into every scalar target",
    own("cv_strict_enum_into_scalars"), `${own("cv_strict_enum_into_scalars")}.On`, enumDecl("cv_strict_enum_into_scalars", { attribute: STRICT })),
  fb("cv_strict_enum_arithmetic", "CV5/P14 — a `{attribute 'strict'}` enum variable minus INT#1, times 2, plus itself, and NOT, into INTs",
    `\te : ${own("cv_strict_enum_arithmetic")};\n\tout1 : INT;\n\tout2 : INT;\n\tout3 : INT;\n\tout4 : INT;`,
    `e := ${own("cv_strict_enum_arithmetic")}.On;\nout1 := e - INT#1;\nout2 := e * 2;\nout3 := e + e;\nout4 := NOT e;`,
    enumDecl("cv_strict_enum_arithmetic", { attribute: STRICT })),
  fb("cv_strict_enum_from_other_enum", "CV5/P14 — a value of another enum assigned to a `{attribute 'strict'}` enum",
    `\te : ${own("cv_strict_enum_from_other_enum")};\n\tf : DUT_LANG_cv_strict_enum_from_other_enum_b;`,
    "f := DUT_LANG_cv_strict_enum_from_other_enum_b.On;\ne := f;",
    enumDecl("cv_strict_enum_from_other_enum", { attribute: STRICT }) + enumDecl("cv_strict_enum_from_other_enum_b")),
]

// ─── P15 — `{attribute 'to_string'}`: TO_STRING of every member ─────────────────────────────────────────────────────

const TO_STRING = "{attribute 'to_string'}\n"

const P15: LanguageTest[] = [
  fb("cv_enum_to_string_attribute", "P15 — TO_STRING of every member of a `to_string` enum with written values (TsIdle 10, TsBusy 20, TsDone 30 — prefixed: a bare `Done` elsewhere would bind to it) and of a variable, TO_WSTRING of one",
    `\te : ${own("cv_enum_to_string_attribute")};\n\ttxt1 : STRING;\n\ttxt2 : STRING;\n\ttxt3 : STRING;\n\ttxt4 : STRING;\n\twtxt : WSTRING;`,
    [
      `txt1 := TO_STRING(${own("cv_enum_to_string_attribute")}.TsIdle);`,
      `txt2 := TO_STRING(${own("cv_enum_to_string_attribute")}.TsBusy);`,
      `txt3 := TO_STRING(${own("cv_enum_to_string_attribute")}.TsDone);`,
      `e := ${own("cv_enum_to_string_attribute")}.TsBusy;`,
      "txt4 := TO_STRING(e);",
      "wtxt := TO_WSTRING(e);",
    ].join("\n"),
    enumDecl("cv_enum_to_string_attribute", { attribute: TO_STRING, members: "\tTsIdle := 10,\n\tTsBusy := 20,\n\tTsDone := 30" })),
  fb("cv_enum_to_string_implicit_members", "P15 — TO_STRING of every member of a `to_string` enum with implicit values (Red, Green, Blue)",
    `\ttxt1 : STRING;\n\ttxt2 : STRING;\n\ttxt3 : STRING;`,
    ["Red", "Green", "Blue"].map((m, i) => `txt${i + 1} := TO_STRING(${own("cv_enum_to_string_implicit_members")}.${m});`).join("\n"),
    enumDecl("cv_enum_to_string_implicit_members", { attribute: TO_STRING, members: "\tRed,\n\tGreen,\n\tBlue" })),
]

export const ENUM_CONVERSION_TESTS: readonly LanguageTest[] = [...CV3, ...CV4, ...CV5, ...P15]
