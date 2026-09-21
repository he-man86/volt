/**
 * refused-name — a name CODESYS's parser refuses: an instruction-list operator, an elementary type name, or one
 * holding consecutive underscores. Wording recorded live on CODESYS SP21 (conformance `cc_reserved_name_r`,
 * `cc_reserved_name_s_upper`, `cc_il_name_*`, `cc4_type_name_*_as_variable`, `identifier_*_underscore*`); TwinCAT
 * unmeasured, so the check is CODESYS-only.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import type { Vendor } from "../../config.js"

function diagnose(src: string, vendor: Vendor = "codesys") {
  // the DIALECT too: an unknown literal prefix only exists as a token on the vendor that lacks the literal
  const parseResult = parseSource(src, vendor)
  const project = buildSymbolTable([{ uri: "F.prg", parseResult, source: src }], [], vendor)
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor }) })
}
const program = (decl: string, body = "") => `PROGRAM PLC_PRG\nVAR\n  ${decl}\nEND_VAR\n${body}\nEND_PROGRAM`
const flagged = (decl: string, vendor: Vendor = "codesys") =>
  diagnose(program(decl), vendor).filter((d) => d.code === "refused-name")

// The IDE does not stop at the name: it resyncs by demanding a `;`, reporting a PAIR for every token until it finds
// one (conformance `cc_reserved_name_r`: five errors, not one). Only the first was emitted here, which is why 22
// fixtures whose every IDE error belongs to such a cascade could not agree.
test("a variable named r is a CODESYS parse error, echoing the name as written, then the resync cascade", () => {
  const d = flagged("r : INT;")
  expect(d[0]?.severity).toBe("error")
  expect(d.map((x) => x.message)).toEqual([
    "Unexpected token 'r' found",
    "';' expected instead of ':'",
    "Unexpected token ':' found",
    "';' expected instead of 'INT'",
    "Unexpected token 'INT' found",
  ])
  expect(flagged("S : BOOL;")[0]?.message).toBe("Unexpected token 'S' found")
})

test("every recorded IL operator name is reserved the same way — LD, ST, RET, the conditional and negated forms", () => {
  // Found by the execution oracle (`lt`, `ld` would not compile) and recorded one by one (cc_il_name_*); all were silent.
  for (const n of ["ld", "ldn", "st", "stn", "ret", "retc", "retcn", "jmpc", "jmpcn", "calcn", "andn", "orn", "xorn"])
    expect(flagged(`${n} : INT;`).map((d) => d.message)).toEqual([
      `Unexpected token '${n}' found`,
      "';' expected instead of ':'",
      "Unexpected token ':' found",
      "';' expected instead of 'INT'",
      "Unexpected token 'INT' found",
    ])
})

test("`cal` is reported as written and its use is not an undefined identifier", () => {
  // CAL sat in the keyword table: the name was echoed 'CAL', and `cal := 1` added "Identifier 'cal' not defined" —
  // neither is in the recording (cc_il_name_cal), which reports 'cal' on the declaration and on the use.
  const d = diagnose(program("cal : INT;", "cal := 1;")).filter((x) => x.code === "refused-name")
  expect(d.map((x) => x.message).filter((m) => m.includes("'cal'"))).toEqual([
    "Unexpected token 'cal' found",
    "Unexpected token 'cal' found",
  ])
})

test("a USE is flagged too — CODESYS reports the declaration and every use", () => {
  // recorded: `s : STRING; s := 'abc';` → "Unexpected token 's' found" twice (cc_reserved_name_s_string)
  const d = diagnose(program("s : STRING;", "s := 'abc';")).filter((x) => x.code === "refused-name")
  expect(d.map((x) => x.message).filter((m) => m.includes("'s'"))).toEqual([
    "Unexpected token 's' found",
    "Unexpected token 's' found",
  ])
})

test("S= and R= stay operators — only a bare NAME is flagged", () => {
  expect(diagnose(program("a : BOOL; b : BOOL;", "a S= b;\na R= b;")).filter((x) => x.code === "refused-name")).toEqual([])
})

test("names that merely contain an operator are ordinary identifiers, and CALC is not claimed", () => {
  expect(flagged("rs : INT;")).toEqual([])
  expect(flagged("sValue : INT; ldCount : INT; stop : INT;")).toEqual([])
  // calc parses as a conditional call in CODESYS, with other messages — not modelled, so not flagged
  expect(flagged("calc : INT;")).toEqual([])
})

// TWINCAT MEASURED, 2026-09-20: it refuses the IL-operator names exactly as CODESYS does — the same ten-message
// cascade in the same order, differing in the one word its error list capitalises (`cc_il_name_*`, eighteen
// fixtures). This check was gated to CODESYS with the note "TwinCAT unmeasured", written when TwinCAT's recording
// covered 280 fixtures; it covers 2524 now.
test("TwinCAT refuses the same names, in its own spelling", () => {
  expect(flagged("r : INT;", "twincat").map((d) => d.message)).toEqual([
    "Unexpected Token 'r' found",
    "';' expected instead of ':'",
    "Unexpected Token ':' found",
    "';' expected instead of 'INT'",
    "Unexpected Token 'INT' found",
  ])
  expect(flagged("ld : INT;", "twincat").map((d) => d.message)[0]).toBe("Unexpected Token 'ld' found")
})

test("an identifier holding consecutive underscores is refused — the compiler reserves them", () => {
  // silent before: `foo__bar : INT;` and `__systemReserved : INT;` compiled clean here while the IDE reported the
  // name and cascaded (conformance `identifier_consecutive_underscores`, `identifier_double_underscore`).
  expect(flagged("foo__bar : INT;").map((d) => d.message)).toEqual([
    "Unexpected token 'foo__bar' found",
    "';' expected instead of ':'",
    "Unexpected token ':' found",
    "';' expected instead of 'INT'",
    "Unexpected token 'INT' found",
  ])
  expect(flagged("__systemReserved : INT;")[0]?.message).toBe("Unexpected token '__systemReserved' found")
  // a USE is not refused: `__NEW`, `__QUERYINTERFACE` and the rest are compiler operators spelled that way
  expect(diagnose(program("p : POINTER TO INT;", "p := __NEW(INT);")).filter((d) => d.code === "refused-name")).toEqual([])
})

test("an elementary type name is refused in the BODY too, and says which position it was in", () => {
  // Why missed: the name was reported only at its declaration, so `byte := 2;` and `n := byte;` — eight more IDE
  // errors — went unreported (conformance `cc4_type_name_byte_as_variable`).
  const msgs = diagnose(program("byte : INT; n : INT;", "byte := 2;\nn := byte;"))
    .filter((d) => d.code === "refused-name")
    .map((d) => d.message)
  // where the statement STARTS the parser wanted a target; anywhere else it wanted an operand and says so
  expect(msgs).toContain("Expression expected instead of 'byte'")
  expect(msgs.filter((m) => m === "Unexpected token 'byte' found")).toHaveLength(3) // declaration + both uses
  expect(msgs).toContain("';' expected instead of '2'")
})

test("a type name a call uses is NOT refused — as an argument or as the callee", () => {
  // `LTIME()` reads the clock and `XSIZEOF(DINT)` names a type; corpus pro2193 `StopwatchFB` calls the first, which
  // is how the callee exclusion was found (12 false positives in one file).
  const d = diagnose(program("n : UDINT; t : LTIME;", "t := LTIME();\nn := XSIZEOF(DINT);"))
  expect(d.filter((x) => x.code === "refused-name")).toEqual([])
})

// AN UNKNOWN LITERAL PREFIX CASCADES LIKE ANY OTHER REFUSED NAME. `LDATE#`/`LDT#`/`LTOD#`/`UCHAR#` are
// CODESYS's, so on TwinCAT they lex as an identifier ending in `#` and the compiler quotes the prefix WHOLE and
// then resyncs — a pair per token to the `;` (`xf_ldt_to_*`, `cc_ld*_literal_into_*`, its recording 2026-09-20).
// It is found by scanning tokens rather than walking the AST because there is no AST: the parser gives up at
// the first stray and the statement list comes back EMPTY.
test("an unknown literal prefix is refused on TwinCAT, and cascades", () => {
  const msgs = diagnose(
    program("v : LDT;", "v := LDT#2026-05-09-07:05:03;"),
    "twincat",
  ).map((d) => d.message)
  expect(msgs.slice(0, 5)).toEqual([
    "Expression expected instead of 'LDT#'",
    "';' expected instead of 'LDT#'",
    "Unexpected Token 'LDT#' found",
    "';' expected instead of '2026'",
    "Unexpected Token '2026' found",
  ])
  // …and CODESYS lexes the whole thing as one date literal, so nothing here fires at all
  expect(diagnose(program("v : LDT;", "v := LDT#2026-05-09-07:05:03;")).filter((d) => d.code === "refused-name")).toEqual([])
})
test("an IL operator's CALL FORM is refused — `ADD(a, b)` is not ST", () => {
  // `added := ADD(a, b);` is eleven IDE errors and was silent here: ADD lexes as a keyword, and the expression
  // parser accepts any non-operator keyword as a name (`LTIME()`), so the call parsed clean
  // (conformance `operator_call_form_arithmetic`, `_comparison`, `_extensible`).
  const msgs = diagnose(program("a : INT; b : INT; added : INT;", "added := ADD(a, b);"))
    .filter((d) => d.code === "refused-name")
    .map((d) => d.message)
  expect(msgs).toEqual([
    "Expression expected instead of 'ADD'",
    "';' expected instead of 'ADD'",
    "Unexpected token 'ADD' found",
    "';' expected instead of '('",
    "Unexpected token '(' found",
    // A VARIABLE in the resync is not echoed back as an unexpected token — it could START a statement, and
    // once the compiler supplies the `;` it was asking for that is what it becomes: a statement that reads a
    // variable and does nothing with it. Both vendors then say so, quoting the code they reconstructed
    // (`operator_call_form_arithmetic`, twelve of these).
    "';' expected instead of 'a'",
    "The code 'a;\n' has no effect. Is this the intent?",
    "';' expected instead of ','",
    "Unexpected token ',' found",
    "';' expected instead of 'b'",
    "The code 'b;\n' has no effect. Is this the intent?",
    "';' expected instead of ')'",
    "Unexpected token ')' found",
  ])
  // all ten, and only as the CALLEE the arg/callee exclusion would otherwise wave through
  for (const op of ["SUB", "MUL", "DIV", "GT", "LT", "LE", "GE", "EQ", "NE"])
    expect(diagnose(program("a : INT; b : INT; r1 : INT;", `r1 := ${op}(a, b);`)).map((d) => d.message)).toContain(
      `Expression expected instead of '${op}'`,
    )
})
