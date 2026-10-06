/**
 * constant-too-large (C0001). Only PROVABLE overflows — a literal no type can hold — are flagged; a value
 * that merely doesn't fit the assignment target is C0032's job, not this. Docs wording (13-error-messages
 * #C0001).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../test-uri.js"

const overflow = (body: string, vendor: "codesys" | "twincat" = "codesys"): string[] => {
  const src = `PROGRAM PLC_PRG\nVAR\n  i : INT;\n  rv : LREAL;\nEND_VAR\n${body}\nEND_PROGRAM`
  const parseResult = parseSource(src, { networkText: true }, vendor)
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }], [], vendor)
  return computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "constant-too-large")
    .map((d) => d.message)
}

test("the three documented cases (typed / ANY_INT / ANY_REAL)", () => {
  expect(overflow(`i := INT#123456;`)).toEqual(["Constant 'INT#123456' too large for type 'INT'"])
  expect(overflow(`i := 12345678912345566991923939292939911;`)).toEqual([
    "Constant '12345678912345566991923939292939911' too large for type 'ANY_INT'",
  ])
  expect(overflow(`rv := 10E500;`)).toEqual(["Constant '10E500' too large for type 'ANY_REAL'"])
})

test("a typed literal past a narrower prefix names that prefix", () => {
  expect(overflow(`i := SINT#200;`)).toEqual(["Constant 'SINT#200' too large for type 'SINT'"])
  expect(overflow(`i := WORD#16#10000;`)).toEqual(["Constant 'WORD#16#10000' too large for type 'WORD'"])
})

test("a typed REAL literal past REAL magnitude names REAL", () => {
  expect(overflow(`rv := REAL#1E40;`)).toEqual(["Constant 'REAL#1E40' too large for type 'REAL'"])
})

test("variable initializers are checked too", () => {
  const src = `FUNCTION_BLOCK F\nVAR x : INT := INT#99999; END_VAR\nEND_FUNCTION_BLOCK`
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }], [], "codesys")
  const msgs = computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "constant-too-large")
    .map((d) => d.message)
  expect(msgs).toEqual(["Constant 'INT#99999' too large for type 'INT'"])
})

test("representable constants stay quiet (0-FP)", () => {
  expect(overflow(`i := INT#123;`)).toEqual([]) // fits INT
  expect(overflow(`i := 999;`)).toEqual([]) // fits DINT — not this check's error (C0032 at most)
  expect(overflow(`rv := 1E38;`)).toEqual([]) // fits LREAL
  expect(overflow(`i := 18446744073709551615;`)).toEqual([]) // exactly ULINT max
})

test("byte-identical on both vendors", () => {
  expect(overflow(`i := INT#123456;`, "twincat")).toEqual(overflow(`i := INT#123456;`, "codesys"))
})

test("a calendar literal with a field out of range is too large for its type, named in full (N24)", () => {
  // `lit_date_month_13`, `lit_tod_hour_25`, `lit_dt_leap_day_non_leap` — both vendors, identically (2026-10-01)
  const cal = (decl: string, body: string) => {
    const src = `PROGRAM PLC_PRG\nVAR\n  ${decl}\nEND_VAR\n${body}\nEND_PROGRAM`
    const parseResult = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }])
    return computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "constant-too-large")
      .map((d) => d.message)
  }
  expect(cal("v : DATE;", "v := D#2024-13-01;")).toEqual(["Constant 'D#2024-13-01' too large for type 'DATE'"])
  expect(cal("v : TOD;", "v := TOD#25:00:00;")).toEqual(["Constant 'TOD#25:00:00' too large for type 'TIME_OF_DAY'"])
  expect(cal("v : DT;", "v := DT#2023-02-29-12:00:00;")).toEqual(["Constant 'DT#2023-02-29-12:00:00' too large for type 'DATE_AND_TIME'"])
  expect(cal("v : DT;", "v := DT#2024-02-29-12:00:00;")).toEqual([])
})

test("a 32-bit DATE or DT ends on 2106-02-07; an LDATE does not; hour 24 is out of range (N24)", () => {
  // `lit_date_year_2200`, `lit_date_last_32bit`, `lit_date_past_32bit`, `lit_dt_year_2200`, `lit_ldate_year_2200`,
  // `lit_tod_hour_24` — CODESYS and TwinCAT identically (TwinCAT has no LDATE), 2026-10-01
  const cal = (decl: string, body: string) => {
    const src = `PROGRAM PLC_PRG\nVAR\n  ${decl}\nEND_VAR\n${body}\nEND_PROGRAM`
    const parseResult = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }])
    return computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "constant-too-large")
      .map((d) => d.message)
  }
  expect(cal("v : DATE;", "v := D#2200-01-01;")).toEqual(["Constant 'D#2200-01-01' too large for type 'DATE'"])
  expect(cal("v : DATE;", "v := D#2106-02-08;")).toEqual(["Constant 'D#2106-02-08' too large for type 'DATE'"])
  expect(cal("v : DATE;", "v := D#2106-02-07;")).toEqual([])
  expect(cal("v : DT;", "v := DT#2200-01-01-00:00:00;")).toEqual(["Constant 'DT#2200-01-01-00:00:00' too large for type 'DATE_AND_TIME'"])
  expect(cal("v : LDATE;", "v := LDATE#2200-01-01;")).toEqual([])
  expect(cal("v : TOD;", "v := TOD#24:00:00;")).toEqual(["Constant 'TOD#24:00:00' too large for type 'TIME_OF_DAY'"])
})
