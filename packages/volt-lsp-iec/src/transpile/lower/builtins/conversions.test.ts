/**
 * Lowering tests of `conversions.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { describe, expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import type { IrAssign } from "../../ir/index.js"
import { lowerSource } from "../index.js"

/** Lower and require success — most tests are about the SHAPE, not the failure path. */
function ir(src: string, name?: string) {
  const { pou, diagnostics } = lowerSource(src, name)
  expect(diagnostics).toEqual([])
  return pou!
}

const wrap = (body: string, vars = "iCount : INT;") => `PROGRAM P\nVAR\n  ${vars}\nEND_VAR\n${body}\nEND_PROGRAM\n`

/** The Standard library as the bridge materializes it (`Library Manager/Standard/LEN.pou`) — only what these call. */
const STANDARD_LEN = {
  uri: "Device/Plc Logic/Application/Library Manager/Standard/LEN.pou",
  source: "FUNCTION LEN : INT\nVAR_INPUT\n\tSTR : STRING(255);\nEND_VAR\nEND_FUNCTION\n",
}

describe("lower — STRING (design §18)", () => {
  test("two STRINGs compare as they are — no conversion to one capacity, which would cut the longer one", () => {
    const pou = ir(wrap("same := short3 = plain;", "short3 : STRING(3);\n  plain : STRING;\n  same : BOOL;"))
    const compare = (pou.body[0] as IrAssign).value
    expect(compare.kind === "binary" && [compare.left.kind, compare.right.kind]).toEqual(["load", "load"])
  })

  test("a Standard string function is an ordinary call — of the project's LEN, or of a library LEN that has a body", () => {
    const src = wrap("n := LEN(text);", "text : STRING;\n  n : INT;")
    // no library referenced → no LEN
    expect(lowerSource(src).diagnostics.map((d) => d.code)).toEqual(["expr-call"])
    // a project FUNCTION called LEN is the project's, and runs
    const own = `FUNCTION LEN : INT\nVAR_INPUT\n  STR : STRING(255);\nEND_VAR\nLEN := 7;\nEND_FUNCTION\n${src}`
    const p = run(lowerSource(own, "P").pou!)
    p.scan()
    expect(p.get("n")).toBe(7n)
    // the materialized declaration alone has no body to run — the library repo supplies one (test/libraries)
    expect(lowerSource(src, undefined, [STANDARD_LEN]).diagnostics.map((d) => d.code)).toEqual(["call-library"])
  })

  test("code CODESYS does not compile gets no meaning — `**` and `&` are refused, not mapped to an operator", () => {
    // This slot used to assert that LEN(WSTRING) is refused. That code does not compile in CODESYS, and the transpiler's
    // input is code that does (src/transpile/index.ts) — so the refusal and its test went; `**` and `&` had been given
    // IR meanings for the same non-existent input. Since frontend-conformance 2.5.3 the PARSER refuses them, in the
    // vendors' words (`cc_power_operator`, `cc_fp_op_ampersand`), so lowering meets a body that does not parse.
    for (const op of ["**", "&"]) {
      const { diagnostics } = lowerSource(wrap(`iCount := iCount ${op} 2;`))
      expect(diagnostics.map((d) => [d.code, d.message])).toEqual([["parse", `';' expected instead of '${op}'`]])
    }
  })
})

// transpile-review-2026-09-29 task 10 (conformance `xf_*_to_date_call_once` / `xf_*_to_ldate_call_once`, recorded): a
// conversion INTO DATE/LDATE keeps whole days as `x - x MOD day`, and CODESYS reads a DT/LDT/TOD/LTOD source TWICE doing
// it — left first, wrapping in the destination (TOD 5s then 7s into a DATE is 5 - 7 = 16#FFFFFFFE). A DATE/LDATE source
// is already whole days and CODESYS reads it ONCE; the lowering masked it too, so `LDATE_TO_DATE(F(calls))` ran F twice.
test("a conversion into DATE/LDATE reads a DATE/LDATE call source once, any other date source twice as CODESYS does", () => {
  const walk: Record<string, [string, string]> = {
    DATE: ["D#1970-01-02", "D#1970-01-04"],
    LDATE: ["LDATE#1970-01-02", "LDATE#1970-01-04"],
    DT: ["DT#1970-01-02-00:00:05", "DT#1970-01-03-00:00:07"],
    LDT: ["LDT#1970-01-02-00:00:05", "LDT#1970-01-03-00:00:07"],
    TOD: ["TOD#00:00:05", "TOD#00:00:07"],
    LTOD: ["LTOD#00:00:05", "LTOD#00:00:07"],
  }
  // [source, destination, calls, raw] — the recorded values
  const recorded: readonly [string, string, bigint, bigint][] = [
    ["LDATE", "DATE", 1n, 86_400n],
    ["DT", "DATE", 2n, 86_398n],
    ["LDT", "DATE", 2n, 86_398n],
    ["TOD", "DATE", 2n, 4_294_967_294n],
    ["LTOD", "DATE", 2n, 4_294_967_294n],
    ["DATE", "LDATE", 1n, 86_400_000_000_000n],
    ["DT", "LDATE", 2n, 86_398_000_000_000n],
    ["LDT", "LDATE", 2n, 86_398_000_000_000n],
    ["TOD", "LDATE", 2n, 18_446_744_071_709_551_616n],
    ["LTOD", "LDATE", 2n, 18_446_744_071_709_551_616n],
  ]
  for (const [src, dst, calls, raw] of recorded) {
    const [first, later] = walk[src]!
    const source =
      `PROGRAM P
VAR calls : INT; d : ${dst}; END_VAR
d := ${src}_TO_${dst}(F_Walk(calls));
END_PROGRAM
` +
      `FUNCTION F_Walk : ${src}
VAR_IN_OUT calls : INT; END_VAR
calls := calls + 1;
` +
      `IF calls = 1 THEN F_Walk := ${first}; ELSE F_Walk := ${later}; END_IF
END_FUNCTION
`
    const runner = run(ir(source, "P"))
    runner.scan()
    expect([`${src}>${dst}`, runner.get("calls"), runner.get("d")]).toEqual([`${src}>${dst}`, calls, raw])
  }
})

// transpile-review 11: STRING<->WSTRING and STRING->number conversions cut the operand to 80 characters, and a
// WSTRING->number was refused. CODESYS (`tr_11_string_conversion_beyond_80`) converts the whole operand: 90 spaces then
// '5' is 5 through STRING_TO_INT and TO_INT, 85 spaces then '12345' is 12345 through WSTRING_TO_INT and TO_INT, a
// WSTRING of 100 narrows to a STRING of 100, a STRING of 91 widens to 91. (Up to 255: past it a conversion cuts — the
// 3.8 tests below, `string_conversion_result_capacity` and `string_parse_beyond_255`.)
test("a string conversion keeps the operand's own capacity past 80 characters", () => {
  const { pou, diagnostics } = lowerSource(
    "PROGRAM P\nVAR i : INT; txt : STRING(120); wide : WSTRING(120); w100 : WSTRING(120); narrow : STRING(120); widened : WSTRING(120);\n" +
      "namedInt : INT; bareInt : INT; crossNamed : INT; crossBare : INT; cnt : INT; wideLen : INT; END_VAR\n" +
      "FOR i := 0 TO 89 DO txt[i] := 32; END_FOR\ntxt[90] := 53;\ntxt[91] := 0;\n" +
      "FOR i := 0 TO 84 DO wide[i] := 32; END_FOR\nFOR i := 85 TO 89 DO wide[i] := INT_TO_WORD(i - 36); END_FOR\nwide[90] := 0;\n" +
      "FOR i := 0 TO 99 DO w100[i] := 120; END_FOR\nw100[100] := 0;\n" +
      "namedInt := STRING_TO_INT(txt);\nbareInt := TO_INT(txt);\ncrossNamed := WSTRING_TO_INT(wide);\ncrossBare := TO_INT(wide);\n" +
      "narrow := WSTRING_TO_STRING(w100);\ncnt := 0;\nFOR i := 0 TO 120 DO IF narrow[i] = 0 THEN EXIT; END_IF cnt := cnt + 1; END_FOR\nwidened := STRING_TO_WSTRING(txt);\n" +
      "wideLen := 0;\nFOR i := 0 TO 120 DO IF widened[i] = 0 THEN EXIT; END_IF wideLen := wideLen + 1; END_FOR\nEND_PROGRAM\n",
    "P",
  )
  expect(diagnostics.map((d) => d.code)).toEqual([])
  const runner = run(pou!)
  runner.scan()
  expect(["namedInt", "bareInt", "crossNamed", "crossBare", "cnt", "wideLen"].map((n) => runner.get(n))).toEqual([5n, 5n, 12345n, 12345n, 100n, 91n])
})

// transpile-restructure 3.8 (design §3.2 Decision, step 3d): a STRING<->WSTRING conversion's result is a STRING(255) /
// WSTRING(255), not a buffer sized by its source — `string_conversion_result_capacity` (CODESYS 3.5.21.40): 300 units in,
// 255 out, named and bare alike; 200 in, 200 out. The units behind its terminator are 0 in the model (stack residue in
// CODESYS, `string_conversion_result_tail`), so a 'Z'-filled STRING(400) keeps 'Z' from [256] only.
test("a STRING<->WSTRING conversion result is cut at 255 units, whatever its source's capacity", () => {
  const { pou, diagnostics } = lowerSource(
    "PROGRAM P\nVAR i : INT; n200 : STRING(200); n300 : STRING(300); w300 : WSTRING(300);\n" +
      "toWide200 : WSTRING(400); toWide300 : WSTRING(400); bareWide300 : WSTRING(400); toNarrow300 : STRING(400); bareNarrow300 : STRING(400);\n" +
      "zNarrow : STRING(400); kept : INT; END_VAR\n" +
      "FOR i := 0 TO 199 DO n200[i] := 120; END_FOR\nn200[200] := 0;\n" +
      "FOR i := 0 TO 299 DO n300[i] := 120; w300[i] := 121; END_FOR\nn300[300] := 0;\nw300[300] := 0;\n" +
      "FOR i := 0 TO 399 DO zNarrow[i] := 90; END_FOR\nzNarrow[400] := 0;\n" +
      "toWide200 := STRING_TO_WSTRING(n200);\ntoWide300 := STRING_TO_WSTRING(n300);\nbareWide300 := TO_WSTRING(n300);\n" +
      "toNarrow300 := WSTRING_TO_STRING(w300);\nbareNarrow300 := TO_STRING(w300);\nzNarrow := WSTRING_TO_STRING(w300);\n" +
      "kept := 0;\nFOR i := 0 TO 399 DO IF zNarrow[i] = 90 THEN kept := kept + 1; END_IF END_FOR\nEND_PROGRAM\n",
    "P",
  )
  expect(diagnostics.map((d) => d.code)).toEqual([])
  const runner = run(pou!)
  runner.scan()
  const len = (name: string) => (runner.get(name) as string).length
  expect(["toWide200", "toWide300", "bareWide300", "toNarrow300", "bareNarrow300"].map(len)).toEqual([200, 255, 255, 255, 255])
  // 255 units and the terminator at [255] written; [256..399] keep their 'Z' (`string_conversion_result_tail`: zNarrowKept)
  expect(runner.get("kept")).toBe(144n)
})

// transpile-restructure 3.8, the two neighbours M5 left unmeasured, recorded (CODESYS 3.5.21.40, 2026-10-08):
// `string_conversion_same_width_255` — TO_STRING of a STRING(300) and TO_WSTRING of a WSTRING(300) give 80 units, the
// named type's default capacity (it was refused, "not measured yet"); `string_parse_beyond_255` — 290 spaces then '5'
// parses 0 (the operand is cut at 255), 250 spaces then '5' parses 5, through STRING_TO_INT, WSTRING_TO_INT and TO_INT.
test("a same-width TO_STRING / TO_WSTRING gives the default 80 units; a parse reads at most 255", () => {
  const { pou, diagnostics } = lowerSource(
    "PROGRAM P\nVAR i : INT; n300 : STRING(300); w300 : WSTRING(300); narrow : STRING(400); wide : WSTRING(400);\n" +
      "n290 : STRING(300); w290 : WSTRING(300); n250 : STRING(300); w250 : WSTRING(300);\n" +
      "named290 : INT; bare290 : INT; wideNamed290 : INT; wideBare290 : INT; named250 : INT; bare250 : INT; wideNamed250 : INT; wideBare250 : INT; END_VAR\n" +
      "FOR i := 0 TO 299 DO n300[i] := 120; w300[i] := 121; END_FOR\nn300[300] := 0;\nw300[300] := 0;\n" +
      "narrow := TO_STRING(n300);\nwide := TO_WSTRING(w300);\n" +
      "FOR i := 0 TO 289 DO n290[i] := 32; w290[i] := 32; END_FOR\nn290[290] := 53;\nw290[290] := 53;\n" +
      "FOR i := 0 TO 249 DO n250[i] := 32; w250[i] := 32; END_FOR\nn250[250] := 53;\nw250[250] := 53;\n" +
      "named290 := STRING_TO_INT(n290);\nbare290 := TO_INT(n290);\nwideNamed290 := WSTRING_TO_INT(w290);\nwideBare290 := TO_INT(w290);\n" +
      "named250 := STRING_TO_INT(n250);\nbare250 := TO_INT(n250);\nwideNamed250 := WSTRING_TO_INT(w250);\nwideBare250 := TO_INT(w250);\nEND_PROGRAM\n",
    "P",
  )
  expect(diagnostics.map((d) => d.code)).toEqual([])
  const runner = run(pou!)
  runner.scan()
  expect([(runner.get("narrow") as string).length, (runner.get("wide") as string).length]).toEqual([80, 80])
  const parsed = ["named290", "bare290", "wideNamed290", "wideBare290", "named250", "bare250", "wideNamed250", "wideBare250"]
  expect(parsed.map((n) => runner.get(n))).toEqual([0n, 0n, 0n, 0n, 5n, 5n, 5n, 5n])
})

// `{attribute 'to_string'}` on an enum (frontend-conformance 2.10, P15; `prag_to_string_*`, CODESYS 2026-10-02): TO_STRING,
// INT_TO_STRING and TO_WSTRING of its member print the member's NAME ('On'), where the same enum without the attribute
// prints the value ('1'). Lowering printed the value either way — a silent wrong answer. It has no member-name table yet
// (task 4.5.1 reads `to_string` from the AST), so the conversion is refused by name; without the attribute it lowers.
test("a `to_string` enum's STRING conversion is refused by name; the same enum without it prints its value", () => {
  const source = (attribute: string, conversion: string) =>
    `${attribute}TYPE DUT_Mode :\n(\n\tOff := 0,\n\tOn := 1\n);\nEND_TYPE\n` +
    `PROGRAM P\nVAR\n\te : DUT_Mode := DUT_Mode.On;\n\ttxt : STRING;\n\twtxt : WSTRING;\nEND_VAR\n${conversion}\nEND_PROGRAM\n`
  for (const conversion of ["txt := TO_STRING(DUT_Mode.On);", "txt := TO_STRING(e);", "txt := INT_TO_STRING(DUT_Mode.On);", "wtxt := TO_WSTRING(e);"]) {
    const refused = lowerSource(source("{attribute 'to_string'}\n", conversion), "P").diagnostics
    expect([conversion, refused.map((d) => [d.code, d.message])]).toEqual([
      conversion,
      [["conversion-type", "a STRING conversion of an enum under {attribute 'to_string'} prints the member's name, which lowering does not model yet"]],
    ])
  }
  const plain = lowerSource(source("", "txt := TO_STRING(e);"), "P")
  expect(plain.diagnostics).toEqual([])
  const runner = run(plain.pou!)
  runner.scan()
  expect(runner.get("txt")).toBe("1")
})
