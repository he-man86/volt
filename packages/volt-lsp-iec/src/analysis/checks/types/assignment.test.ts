/**
 * assignment-type-mismatch — the duration literals (gap 8). The AST gives `T#` and `LTIME#` one literalKind, and inference
 * typed both TIME. Expectations are CODESYS's recorded answers (conformance `cc_ltime_literal_into_time`,
 * `cc_fp_ltime_literal_into_ltime`).
 */
import { expect, test } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../test-uri.js"

const mismatches = (vars: string, body: string): string[] => {
  const src = `PROGRAM PLC_PRG\nVAR\n${vars}\nEND_VAR\n${body}\nEND_PROGRAM`
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }])
  return computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "assignment-type-mismatch")
    .map((d) => d.message)
}

test("an LTIME literal into a TIME does not convert — it was silent", () => {
  expect(mismatches("t1 : TIME;", "t1 := LTIME#1S;")).toEqual(["Cannot convert type 'LTIME' to type 'TIME'"])
})

/** Every `assignment-type-mismatch` message for `x := E_Mode.Busy` with `x : <target>`, beside an enum `E_Mode`. */
const enumInto = (target: string, base = ""): string[] => {
  const src = `TYPE E_Mode :\n(\n\tIdle := 0,\n\tBusy := 1\n)${base};\nEND_TYPE\n\nPROGRAM PLC_PRG\nVAR\n\tx : ${target};\nEND_VAR\nx := E_Mode.Busy;\nEND_PROGRAM`
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }])
  return computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "assignment-type-mismatch")
    .map((d) => d.message)
}

test("an enum value converts as INT — into SINT, USINT and BYTE it does not, and the message upper-cases its name", () => {
  // `compat` widened an enum into every numeric type, so all three were silent (conformance `cc_enum_into_*`)
  expect(enumInto("SINT")).toEqual(["Cannot convert type 'E_MODE' to type 'SINT'"])
  expect(enumInto("USINT")).toEqual(["Cannot convert type 'E_MODE' to type 'USINT'"])
  expect(enumInto("BYTE")).toEqual(["Cannot convert type 'E_MODE' to type 'BYTE'"])
  for (const target of ["INT", "DINT", "LINT", "REAL", "LREAL", "UINT", "DWORD"]) expect(enumInto(target)).toEqual([])
})

test("an enum with a written base converts as that base: a DINT-based enum into a SINT or an INT is refused, into a DINT taken (cv_enum_base_dint_into_scalars)", () => {
  // this said "unmeasured, so silent" until the recording (CODESYS 2026-10-03)
  expect(enumInto("SINT", " DINT")).toEqual(["Cannot convert type 'E_MODE' to type 'SINT'"])
  expect(enumInto("INT", " DINT")).toEqual(["Cannot convert type 'E_MODE' to type 'INT'"])
  expect(enumInto("DINT", " DINT")).toEqual([])
  expect(enumInto("REAL", " DINT")).toEqual([])
})

/** Every `assignment-type-mismatch` message for a declaration-only FB. */
const initMismatches = (vars: string): string[] => {
  const src = `FUNCTION_BLOCK F\nVAR\n${vars}\nEND_VAR\nEND_FUNCTION_BLOCK`
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }])
  return computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "assignment-type-mismatch")
    .map((d) => d.message)
}

test("an untyped integer literal too wide for its target is an error, as its literal type (gap 13)", () => {
  // It was silent: inference types a bare integer literal UNKNOWN, and nothing checked an initializer at all.
  expect(mismatches("si : SINT;", "si := 300;")).toEqual(["Cannot convert type 'INT' to type 'SINT'"])
  expect(mismatches("si : SINT;", "si := -129;")).toEqual(["Cannot convert type 'INT' to type 'SINT'"])
  expect(mismatches("us : USINT;", "us := 256;")).toEqual(["Cannot convert type 'INT' to type 'USINT'"])
  expect(mismatches("u : UINT;", "u := 70000;")).toEqual(["Cannot convert type 'DINT' to type 'UINT'"])
  expect(initMismatches("b : BYTE := 300;")).toEqual(["Cannot convert type 'INT' to type 'BYTE'"])
  expect(initMismatches("w : WORD := 70000;")).toEqual(["Cannot convert type 'DINT' to type 'WORD'"])
})

test("a literal the target holds, or one only a sign warning away, is no error", () => {
  expect(mismatches("b : BYTE; si : SINT; us : USINT; i : INT;", "b := 255; si := 127; us := 5; i := 200; si := 128; us := -1;")).toEqual([])
  expect(initMismatches("i : INT := 40000; u : UINT := -5;")).toEqual([])
})

test("a declaration's initial value is type-checked like an assignment, for every literal shape (gap 14)", () => {
  // Initializers were never checked; each expectation is a recording (conformance `cc_init_*`).
  expect(initMismatches("i : INT := TRUE;")).toEqual(["Cannot convert type 'BOOL' to type 'INT'"])
  expect(initMismatches("i : INT := 1.5;")).toEqual(["Cannot convert type 'LREAL' to type 'INT'"])
  expect(initMismatches("t : TIME := 5;")).toEqual(["Cannot convert type 'SINT' to type 'TIME'"])
  expect(initMismatches("i : INT := 'abc';")).toEqual(["Cannot convert type 'STRING(INT#3)' to type 'INT'"])
  expect(initMismatches("si : SINT := INT#5;")).toEqual(["Cannot convert type 'INT' to type 'SINT'"])
  expect(initMismatches("b : BOOL := 2;")).toEqual(["Cannot convert type 'SINT' to type 'BOOL'"])
  expect(initMismatches("re : REAL := T#1S;")).toEqual(["Cannot convert type 'TIME' to type 'REAL'"])
})

test("the initializers and assignments CODESYS accepts stay silent", () => {
  expect(initMismatches("b0 : BOOL := 0; b1 : BOOL := 1; re : REAL := 1.5; lr : LREAL := 1.5; si : SINT := 100 + 100;")).toEqual([])
  expect(mismatches("b : BOOL;", "b := 1;")).toEqual([])
})

test("a statement converts a literal the same way (conformance `cc_assign_*`)", () => {
  expect(mismatches("t : TIME;", "t := 5;")).toEqual(["Cannot convert type 'SINT' to type 'TIME'"])
  expect(mismatches("i : INT;", "i := 1.5;")).toEqual(["Cannot convert type 'LREAL' to type 'INT'"])
})

test("an L-prefixed date literal is the 64-bit type, printed as CODESYS prints it (consolidate-lsp-structure A2)", () => {
  // Inference typed every date literal without its `L`, so these were silent while lowering typed them right.
  expect(mismatches("d1 : DATE;", "d1 := LDATE#2024-02-28;")).toEqual(["Cannot convert type 'LDATE' to type 'DATE'"])
  expect(mismatches("t1 : TOD;", "t1 := LTOD#12:30:15;")).toEqual(["Cannot convert type 'LTIME_OF_DAY' to type 'TIME_OF_DAY'"])
  expect(mismatches("dt1 : DT;", "dt1 := LDT#2024-02-28-12:30:15;")).toEqual(["Cannot convert type 'LDATE_AND_TIME' to type 'DATE_AND_TIME'"])
  expect(mismatches("ld1 : LDATE; lt1 : LTOD; d1 : DATE;", "ld1 := LDATE#2024-02-28; lt1 := LTOD#12:30:15; d1 := D#2024-02-28;")).toEqual([])
})

test("an LTIME literal into an LTIME is clean — typed TIME, it was a false positive", () => {
  expect(mismatches("lt1 : LTIME;", "lt1 := LTIME#1S;")).toEqual([])
  expect(mismatches("t1 : TIME;", "t1 := T#1S;")).toEqual([])
})

/**
 * A REFERENCE DECLARATION BINDS, and the compiler type-checks what it binds TO. This check skipped it entirely: a
 * reference is neither `checkable` nor COMPOSITE, so both shapes below passed in silence.
 *
 * The expectations are CODESYS's own, recorded 2026-09-20 (`declarations/reference-binding.ts`):
 *   `refdecl_target_wrong_type`  Cannot convert type 'STRING' to type 'REFERENCE TO INT'
 *   `refdecl_target_undeclared`  Identifier 'nope' not defined | Cannot convert type 'Unknown type: 'nope'' to …
 *
 * The VALID bind must stay silent, which is the half that matters: this check runs over 29k corpus files, and a
 * reference bound correctly is the overwhelmingly common case.
 */
test("a reference declaration type-checks its target, and a valid bind stays silent", () => {
  const decl = (init: string) => `\tv : INT;\n\tsx : STRING;\n\td : DINT;\n\tref_ : REFERENCE TO INT ${init};`
  expect(mismatches(decl("REF= v"), ";")).toEqual([])
  expect(mismatches(decl(":= v"), ";")).toEqual([]) // both spellings bind, and both are legal
  expect(mismatches(decl("REF= sx"), ";")).toEqual(["Cannot convert type 'STRING' to type 'REFERENCE TO INT'"])
  // an UNDECLARED target is the hole's (`unknown-source`): the conversion is said ONCE, beside "Identifier 'nope' not
  // defined" — both checks said it, and CODESYS says it once (`refdecl_target_undeclared`, the census's open FP, 3.2.3)
  expect(mismatches(decl("REF= nope"), ";")).toEqual([])
  const src = `PROGRAM PLC_PRG\nVAR\n${decl("REF= nope")}\nEND_VAR\n;\nEND_PROGRAM`
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }])
  expect(
    computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.severity === "error" && d.code !== "signature-name-mismatch")
      .map((d) => d.message),
  ).toEqual(["Identifier 'nope' not defined", "Cannot convert type 'Unknown type: 'nope'' to type 'REFERENCE TO INT'"])
  // EXACT TYPE, not assignability — the rule `checks/types/reference-assign.ts` measured for the statement form
  // (`cc3_reference_assign`). Using `isAssignable` made this inconsistent with itself: it flagged a DINT and
  // stayed silent on a SINT, though CODESYS refuses both.
  expect(mismatches(decl("REF= d"), ";")).toEqual(["Cannot convert type 'DINT' to type 'REFERENCE TO INT'"])
  // a reference with NO initializer is ordinary, and must not be reported
  expect(mismatches("\tref_ : REFERENCE TO INT;", ";")).toEqual([])
})

/**
 * THE NAMES A BARE `lookup` WOULD CALL UNDECLARED. `analysis/shared/resolution.ts` owns that question and excuses a long
 * list: a member inherited from an EXTENDS base that did not materialize, `SUPER`, a library namespace, a device
 * instance, a bare enum member. The first cut of the reference check asked `lookup` directly and reported
 * "Unknown type" for every one of them — a false positive on real code the corpus happens not to contain in this
 * shape, which is why a review caught it and the corpus gate did not.
 */
test("a reference bound to a name only the shared resolution oracle can excuse is not reported", () => {
  const fb = (decls: string, header = "FUNCTION_BLOCK FB_Derived EXTENDS FB_Missing") =>
    `${header}\nVAR\n${decls}\nEND_VAR\n;\nEND_FUNCTION_BLOCK`
  const codes = (src: string): string[] => {
    const parseResult = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }])
    return computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "assignment-type-mismatch")
      .map((d) => d.message)
  }
  // the base is not in the project, so `baseVar` COULD be its member — the oracle skips, and so must this
  expect(codes(fb("\tref_ : REFERENCE TO INT REF= baseVar;"))).toEqual([])
})

test("`S=` and `R=` set a BOOL from a BOOL: an INT target or operand does not convert (stmt_s_eq_non_bool_target, stmt_s_eq_non_bool_value, ST2)", () => {
  // both vendors 2026-10-02
  expect(mismatches("n : INT;\n\ty : BOOL := TRUE;", "n S= y;")).toEqual(["Cannot convert type 'INT' to type 'BOOL'"])
  expect(mismatches("x : BOOL;\n\tn : INT := 1;", "x S= n;")).toEqual(["Cannot convert type 'INT' to type 'BOOL'"])
  expect(mismatches("x : BOOL;\n\ty : BOOL;", "x S= y;\nx R= y;")).toEqual([])
})

/** Every error and warning for `body` in a PROGRAM with `vars`, beside `enums` (whole TYPE units). */
const storeDiagnostics = (enums: string, vars: string, body: string): string[] => {
  const src = `${enums}\n\nPROGRAM PLC_PRG\nVAR\n${vars}\nEND_VAR\n${body}\nEND_PROGRAM`
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }])
  return computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.severity === "error" || d.severity === "warning")
    .map((d) => d.message)
}

const STRICT_E = "{attribute 'strict'}\nTYPE E_Strict :\n(\n\tOff := 0,\n\tOn := 1\n);\nEND_TYPE"
const OTHER_E = "TYPE E_Other :\n(\n\tOff := 0,\n\tOn := 1\n);\nEND_TYPE"

test("a strict enum takes only its own values: a variable, another enum's value, a literal no member holds is refused by its text (cv_*_strict_enum, P14)", () => {
  const vars = "\te : E_Strict;\n\ti : INT := 1;\n\tf : E_Other;"
  expect(storeDiagnostics(`${STRICT_E}
${OTHER_E}`, vars, "e := i;")).toEqual(["'i' is not a valid value for strict ENUM type 'E_Strict'"])
  expect(storeDiagnostics(`${STRICT_E}\n${OTHER_E}`, vars, "e := f;")).toEqual(["'f' is not a valid value for strict ENUM type 'E_Strict'"])
  expect(storeDiagnostics(`${STRICT_E}
${OTHER_E}`, vars, "e := 5;")).toEqual(["'5' is not a valid value for strict ENUM type 'E_Strict'"])
  expect(storeDiagnostics(`${STRICT_E}
${OTHER_E}`, vars, "e := -1;")).toEqual(["'-1' is not a valid value for strict ENUM type 'E_Strict'"])
  expect(storeDiagnostics(`${STRICT_E}
${OTHER_E}`, vars, "e := TRUE;")).toEqual(["'TRUE' is not a valid value for strict ENUM type 'E_Strict'"])
  // a literal a member holds, typed or not, and its own member are taken
  expect(storeDiagnostics(`${STRICT_E}
${OTHER_E}`, vars, "e := 1;\ne := INT#1;\ne := E_Strict.On;")).toEqual([])
})

test("a REFERENCE TO the strict enum reads as its target and is taken (DT14, P14)", () => {
  expect(storeDiagnostics(STRICT_E, "\te : E_Strict;\n\trr : REFERENCE TO E_Strict;", "e := rr;")).toEqual([])
})

test("a call argument into a strict-enum input is unmeasured: no enum-conversion warning, no refusal (P14 recorded stores only)", () => {
  const fn = "FUNCTION K : BOOL\nVAR_INPUT x : E_Strict; END_VAR\nK := TRUE;\nEND_FUNCTION"
  const vars = "\tf : E_Other;\n\to : BOOL;\n\tse : E_Strict;"
  expect(storeDiagnostics(`${STRICT_E}\n${OTHER_E}\n${fn}`, vars, "o := K(x := f);\no := K(x := 7);\no := K(f);\no := K(x := se);")).toEqual([])
})

test("a value of another enum is a warning, and an enum with a written base converts as it (cv_enum_into_other_enum, cv_enum_base_*)", () => {
  expect(storeDiagnostics(`${OTHER_E}\nTYPE E_B :\n(\n\tOff := 0,\n\tOn := 1\n);\nEND_TYPE`, "\ta : E_Other;\n\tb : E_B;", "b := a;")).toEqual([
    "Implicit conversion from one enumeration type (E_OTHER) to another (E_B)",
  ])
})

test("arithmetic on a strict enum is refused once per operation; NOT converts it as its base (cv_strict_enum_arithmetic)", () => {
  const vars = "\te : E_Strict;\n\tout1 : INT;\n\tout2 : INT;\n\tout3 : INT;\n\tout4 : INT;"
  expect(storeDiagnostics(STRICT_E, vars, "out1 := e - INT#1;\nout2 := e * 2;\nout3 := e + e;\nout4 := NOT e;").sort()).toEqual([
    "Arithmetics not allowed on strict ENUM type 'E_Strict'",
    "Arithmetics not allowed on strict ENUM type 'E_Strict'",
    "Arithmetics not allowed on strict ENUM type 'E_Strict'",
    "Implicit conversion from signed Type 'E_STRICT' to unsigned Type 'UINT' : Possible change of sign",
    "Implicit conversion from unsigned Type 'UINT' to signed Type 'INT' : Possible change of sign",
  ])
})

test("a scalar into a strict enum is the strict refusal alone, never a conversion warning beside it (cv_scalars_into_strict_enum)", () => {
  expect(storeDiagnostics(`${STRICT_E}\n${OTHER_E}`, "\te : E_Strict;\n\tu : UINT;\n\tf : E_Other;", "e := u;\ne := f;")).toEqual([
    "'u' is not a valid value for strict ENUM type 'E_Strict'",
    "'f' is not a valid value for strict ENUM type 'E_Strict'",
  ])
})

// Step 4d review, recorded (`dt_subrange_assign_variable`, both vendors 2026-10-03): a VARIABLE stored into a subrange is
// refused naming the target in its ASSIGNMENT form, as a constant is — `UINT (UINT#1..10)` on CODESYS — where the LSP
// named it as declared, `UINT (1..10)`.
test("a variable stored into a subrange names the target in its assignment form", () => {
  expect(mismatches("\tv : INT(0..10);\n\tw : UINT(1..10);\n\td : DINT;\n\ttxt : STRING;", "v := txt;\nw := txt;\nv := d;\nw := d;")).toEqual([
    "Cannot convert type 'STRING' to type 'INT (0..10)'",
    "Cannot convert type 'STRING' to type 'UINT (UINT#1..10)'",
    "Cannot convert type 'DINT' to type 'INT (0..10)'",
    "Cannot convert type 'DINT' to type 'UINT (UINT#1..10)'",
  ])
})

/** Every `assignment-type-mismatch` message of `units` (whole units, an FB `F` among them). */
const mismatchesIn = (units: string): string[] => {
  const parseResult = parseSource(units, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: units }])
  return computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: units, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "assignment-type-mismatch")
    .map((d) => d.message)
}

// A VALUE THAT IS NO ELEMENTARY ONE is refused into an elementary target, named as its type: an FB instance and an
// interface variable as declared, an array with its bounds, THIS^ and a name that denotes a declaration upper-cased
// (rules DT7, DT8, DT10; `dt_fb_instance_type_name`, `dt_interface_variable_type_name`, `dt_render_array_dims`,
// `dt_this_type`, `dt_static_base_*`, CODESYS 2026-10-03). Only a STRUCT was (`ty_version_into_string`).
test("an FB instance, an interface, an array, THIS^ and a static name stored into an elementary are refused (DT7, DT8, DT10)", () => {
  const units = `INTERFACE I_x\nMETHOD M : INT\nEND_METHOD\nEND_INTERFACE
FUNCTION_BLOCK Fb_other\nEND_FUNCTION_BLOCK
FUNCTION F_x : INT\nF_x := 1;\nEND_FUNCTION
PROGRAM Prg_x\nEND_PROGRAM
FUNCTION_BLOCK F
VAR
\tinst : Fb_other;
\titf : I_x;
\ta2 : ARRAY[1..2, 0..1] OF BYTE;
\ttxt : STRING;
\ti : INT;
END_VAR
txt := inst;
txt := itf;
i := a2;
txt := THIS^;
txt := F_x;
txt := Prg_x;
txt := I_x;
END_FUNCTION_BLOCK`
  expect(mismatchesIn(units)).toEqual([
    "Cannot convert type 'Fb_other' to type 'STRING'",
    "Cannot convert type 'I_x' to type 'STRING'",
    "Cannot convert type 'ARRAY [1..2, 0..1] OF BYTE' to type 'INT'",
    "Cannot convert type 'F' to type 'STRING'",
    "Cannot convert type 'F_X' to type 'STRING'",
    "Cannot convert type 'PRG_X' to type 'STRING'",
    "Cannot convert type 'I_X' to type 'STRING'",
  ])
})

// Another FB's METHOD named without its call, read inside a method OF THE SAME NAME: it is still that other method
// ('VALUE'), not the reading method's result variable — `insideOwnBody` matched by name only (step 4.7.4 review).
// CODESYS gives the 'VALUE' message alone for an uncalled method (`cc2_type_name_and_method_without_parens`).
test("another FB's uncalled method read inside a method of the same name is the method, not the result variable", () => {
  const units = `FUNCTION_BLOCK A\nEND_FUNCTION_BLOCK\nMETHOD Value : INT\nValue := 1;\nEND_METHOD
FUNCTION_BLOCK F
VAR
\ta : A;
\ttxt : STRING;
END_VAR
END_FUNCTION_BLOCK
METHOD Value : INT
txt := a.Value;
END_METHOD
METHOD Other : INT
txt := a.Value;
END_METHOD`
  const parseResult = parseSource(units, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: units }])
  const messages = computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: units, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.message.startsWith("Cannot convert"))
    .map((d) => d.message)
  expect(messages).toEqual(["Cannot convert type 'VALUE' to type 'STRING'", "Cannot convert type 'VALUE' to type 'STRING'"])
})

/** Every `assignment-type-mismatch` message for `body`, beside a struct `S_Lit`. */
const composite = (vars: string, body = ""): string[] => {
  const src = `TYPE S_Lit :\nSTRUCT\n\ta : INT;\n\tb : INT;\nEND_STRUCT\nEND_TYPE\n\nPROGRAM PLC_PRG\nVAR\n${vars}\nEND_VAR\n${body}\nEND_PROGRAM`
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }])
  return computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "assignment-type-mismatch")
    .map((d) => d.message)
}

test("an untyped 0 or 1 into a struct or an array is named BIT, any other integer by its own type — in an initial value and a statement (litc_*, both vendors)", () => {
  expect(composite("rec : S_Lit := 0;")).toEqual(["Cannot convert type 'BIT' to type 'S_Lit'"])
  expect(composite("rec : S_Lit := 1;")).toEqual(["Cannot convert type 'BIT' to type 'S_Lit'"])
  expect(composite("rec : S_Lit := (1);")).toEqual(["Cannot convert type 'BIT' to type 'S_Lit'"])
  expect(composite("rec : S_Lit := 2;")).toEqual(["Cannot convert type 'SINT' to type 'S_Lit'"])
  expect(composite("rec : S_Lit;", "rec := 1;")).toEqual(["Cannot convert type 'BIT' to type 'S_Lit'"])
  expect(composite("rec : S_Lit;", "rec := 2;")).toEqual(["Cannot convert type 'SINT' to type 'S_Lit'"])
  expect(composite("arr : ARRAY[0..1] OF INT := 1;")).toEqual(["Cannot convert type 'BIT' to type 'ARRAY [0..1] OF INT'"])
  expect(composite("arr : ARRAY[0..1] OF INT := 2;")).toEqual(["Cannot convert type 'SINT' to type 'ARRAY [0..1] OF INT'"])
  expect(composite("arr : ARRAY[0..1] OF INT;", "arr := 1;")).toEqual(["Cannot convert type 'BIT' to type 'ARRAY [0..1] OF INT'"])
})

test("…and so into a FUNCTION BLOCK instance: 1 is BIT, 2 SINT, in an initial value and a statement (litc_fb_*, both vendors)", () => {
  const fbInto = (vars: string, body = ""): string[] => {
    const src = `FUNCTION_BLOCK FB_Lit\nVAR\n\ta : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\nPROGRAM PLC_PRG\nVAR\n${vars}\nEND_VAR\n${body}\nEND_PROGRAM`
    const parseResult = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }])
    return computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "assignment-type-mismatch")
      .map((d) => d.message)
  }
  expect(fbInto("fbv : FB_Lit := 1;")).toEqual(["Cannot convert type 'BIT' to type 'FB_Lit'"])
  expect(fbInto("fbv : FB_Lit;", "fbv := 1;")).toEqual(["Cannot convert type 'BIT' to type 'FB_Lit'"])
  expect(fbInto("fbv : FB_Lit;", "fbv := 2;")).toEqual(["Cannot convert type 'SINT' to type 'FB_Lit'"])
})
