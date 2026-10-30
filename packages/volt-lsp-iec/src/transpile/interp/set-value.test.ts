/**
 * `Runner.set` WRITES ONLY A VALUE THE VARIABLE'S TYPE HOLDS (openspec `runner-set-checks`): anything else is refused by
 * name — a `RunnerValueError` naming the path, the declared type and the reason — and nothing is written, as CODESYS's
 * online write refuses it ("value out of range" / "invalid value"). Owner point 1 built as REFUSE (no wrap); point 2 — a
 * STRING longer than its capacity — built as REFUSE too, pending the owner. The sweep: every elementary type at min, max,
 * min-1, max+1 and a value of the wrong kind; NaN and the infinities for REAL and LREAL; the time and date types' ranges;
 * a struct, an array and an FB instance by their fields and elements; the hidden clock; a variable the byte image holds.
 */
import { describe, expect, test } from "bun:test"
import { lowerSource, run, RunnerValueError, type Runner } from "../index.js"
import { CLOCK } from "../lower/builtins/clock.js"
import { NaNBits } from "../semantics/index.js"

type Val = Parameters<Runner["set"]>[1]

function runner(vars: string, body = "", rest = ""): Runner {
  const { pou, diagnostics } = lowerSource(`PROGRAM P\nVAR\n${vars}END_VAR\n${body}END_PROGRAM\n${rest}`, "P")
  if (pou === undefined) throw new Error(diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"))
  return run(pou)
}

/** The refusal `set` throws, as [path, type, reason] — or "written". */
function refusal(p: Runner, path: string, value: Val): [string, string, string] | "written" {
  try {
    p.set(path, value)
    return "written"
  } catch (error) {
    if (!(error instanceof RunnerValueError)) throw error
    return [error.path, error.type, error.reason]
  }
}

const INTEGERS: readonly [string, bigint, bigint][] = [
  ["SINT", -128n, 127n],
  ["USINT", 0n, 255n],
  ["INT", -32768n, 32767n],
  ["UINT", 0n, 65535n],
  ["DINT", -2147483648n, 2147483647n],
  ["UDINT", 0n, 4294967295n],
  ["LINT", -(2n ** 63n), 2n ** 63n - 1n],
  ["ULINT", 0n, 2n ** 64n - 1n],
  ["BYTE", 0n, 255n],
  ["WORD", 0n, 65535n],
  ["DWORD", 0n, 4294967295n],
  ["LWORD", 0n, 2n ** 64n - 1n],
  // the durations and dates: an unsigned count of their unit, 32 or 64 bits (`frontend/types/elementary.ts`)
  ["TIME", 0n, 4294967295n],
  ["LTIME", 0n, 2n ** 64n - 1n],
  ["DATE", 0n, 4294967295n],
  ["TOD", 0n, 4294967295n],
  ["DT", 0n, 4294967295n],
  ["LDATE", 0n, 2n ** 64n - 1n],
  ["LTOD", 0n, 2n ** 64n - 1n],
  ["LDT", 0n, 2n ** 64n - 1n],
]

describe("the draft's five measured rows, each refused, the cell unchanged", () => {
  const p = runner("\ti : INT := 7;\n\tb : BYTE := 9;\n\tt : TIME := T#5MS;\n\tx : REAL := 1.5;\n")
  test.each([
    ["i", 70000n, ["i", "INT", "70000 is outside INT's range -32768..32767"], 7n],
    ["b", 300n, ["b", "BYTE", "300 is outside BYTE's range 0..255"], 9n],
    ["t", -1n, ["t", "TIME", "-1 is outside TIME's range 0..4294967295"], 5n],
    ["x", 1e40, ["x", "REAL", "1e+40 is outside REAL's range — no 32-bit float holds it"], 1.5],
    ["i", "abc", ["i", "INT", 'a string ("abc") is no INT — INT takes a bigint'], 7n],
  ] as const)("set(%p, %p)", (path, value, refused, kept) => {
    expect(refusal(p, path, value as Val)).toEqual(refused as never)
    expect(p.get(path)).toEqual(kept)
  })
})

describe("the sweep — every elementary type", () => {
  test.each(INTEGERS)("%s: min and max written, min-1 and max+1 refused, a number refused", (type, min, max) => {
    const p = runner(`\tv : ${type};\n`)
    for (const v of [min, max]) {
      expect(refusal(p, "v", v)).toBe("written")
      expect(p.get("v")).toBe(v)
    }
    expect(refusal(p, "v", min - 1n)).toEqual(["v", type, `${min - 1n} is outside ${type}'s range ${min}..${max}`])
    expect(refusal(p, "v", max + 1n)).toEqual(["v", type, `${max + 1n} is outside ${type}'s range ${min}..${max}`])
    expect(refusal(p, "v", 1)).toEqual(["v", type, `a number (1) is no ${type} — ${type} takes a bigint`])
    expect(p.get("v")).toBe(max)
  })

  test("BOOL and BIT take a boolean, nothing else", () => {
    const p = runner("\tb : BOOL;\n\tbits : ST_Bits;\n", "", "TYPE ST_Bits :\nSTRUCT\n\tbit0 : BIT;\nEND_STRUCT\nEND_TYPE\n")
    expect([refusal(p, "b", true), refusal(p, "bits.bit0", true), p.get("b"), p.get("bits.bit0")]).toEqual(["written", "written", true, true])
    expect(refusal(p, "b", 1n)).toEqual(["b", "BOOL", "a bigint (1) is no BOOL — BOOL takes a boolean"])
    expect(refusal(p, "bits.bit0", 0n)).toEqual(["bits.bit0", "BIT", "a bigint (0) is no BIT — BIT takes a boolean"])
  })

  test("REAL: a 32-bit float's range; the infinities and a NaN's bits held as a REAL holds them; a JS NaN and a bigint refused", () => {
    const p = runner("\trr : REAL;\n\tl : LREAL;\n")
    const max32 = 3.4028234663852886e38
    expect([refusal(p, "rr", max32), refusal(p, "rr", -max32), refusal(p, "rr", 1e-45), refusal(p, "rr", 0.1)]).toEqual(["written", "written", "written", "written"])
    expect(p.get("rr")).toBe(Math.fround(0.1))
    // a REAL holds its infinities and NaNs (the program makes them; the edge differential seeds them)
    for (const inf of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect([refusal(p, "rr", inf), p.get("rr"), refusal(p, "l", inf), p.get("l")]).toEqual(["written", inf, "written", inf])
    }
    const nan32 = new NaNBits(0xffa12345n, 32)
    expect([refusal(p, "rr", nan32), p.get("rr")]).toEqual(["written", nan32])
    expect(refusal(p, "l", nan32)).toEqual(["l", "LREAL", "a 32-bit NaN is no LREAL — LREAL holds 64-bit NaNs"])
    expect(refusal(p, "rr", Number.NaN)).toEqual(["rr", "REAL", "NaN is written as its bits (a NaNBits of 32 bits) — a JavaScript NaN states none"])
    expect(refusal(p, "l", Number.NaN)).toEqual(["l", "LREAL", "NaN is written as its bits (a NaNBits of 64 bits) — a JavaScript NaN states none"])
    expect(refusal(p, "rr", 0.1)).toBe("written")
    expect(refusal(p, "rr", 3.5e38)).toEqual(["rr", "REAL", "3.5e+38 is outside REAL's range — no 32-bit float holds it"])
    expect([refusal(p, "l", Number.MAX_VALUE), p.get("l")]).toEqual(["written", Number.MAX_VALUE])
    expect(refusal(p, "l", 2n)).toEqual(["l", "LREAL", "a bigint (2) is no LREAL — LREAL takes a number"])
    expect(p.get("rr")).toBe(Math.fround(0.1))
  })

  test("STRING and WSTRING: a string within the declared capacity; longer refused (owner point 2: refuse); the wrong kind refused", () => {
    const p = runner("\ttxt : STRING(5);\n\tw : WSTRING(3);\n\td : STRING;\n")
    expect([refusal(p, "txt", "abcde"), refusal(p, "w", "xyz"), refusal(p, "d", "a".repeat(80))]).toEqual(["written", "written", "written"])
    expect(refusal(p, "txt", "abcdef")).toEqual(["txt", "STRING(5)", "'abcdef' has 6 characters — a STRING(5) holds 5"])
    expect(refusal(p, "w", "wxyz")).toEqual(["w", "WSTRING(3)", "'wxyz' has 4 characters — a WSTRING(3) holds 3"])
    expect(refusal(p, "d", "a".repeat(81))).toEqual(["d", "STRING(80)", `'${"a".repeat(81)}' has 81 characters — a STRING(80) holds 80`])
    expect(refusal(p, "txt", 5n)).toEqual(["txt", "STRING(5)", "a bigint (5) is no STRING(5) — STRING(5) takes a string"])
    expect([p.get("txt"), p.get("w")]).toEqual(["abcde", "xyz"])
  })

  test("STRING and WSTRING: a character the variable cannot hold as written is refused — past ASCII, a surrogate pair; a NUL ends the buffer", () => {
    const p = runner("\ttxt : STRING(9);\n\tw : WSTRING(9);\n")
    expect(refusal(p, "txt", "é")).toEqual(["txt", "STRING(9)", "'é' holds a character past ASCII, whose byte in a STRING is not measured"])
    // the value is the buffer: a NUL ends what `get` shows, the residue behind it held as a PLC's buffer holds it
    expect([refusal(p, "txt", "a\0b"), p.get("txt")]).toEqual(["written", "a"])
    expect([refusal(p, "w", "é"), p.get("w")]).toEqual(["written", "é"])
    expect(refusal(p, "w", "😀")).toEqual(["w", "WSTRING(9)", "'😀' holds a character past one UTF-16 unit, whose units in a WSTRING are not measured"])
  })

  test("a subrange: its bounds, not its base's", () => {
    const p = runner("\tv : INT(0..10);\n")
    expect(refusal(p, "v", 10n)).toBe("written")
    expect(refusal(p, "v", 11n)).toEqual(["v", "INT(0..10)", "11 is outside INT(0..10)'s range 0..10"])
    expect(refusal(p, "v", -1n)).toEqual(["v", "INT(0..10)", "-1 is outside INT(0..10)'s range 0..10"])
  })
})

describe("the sweep — composites and the other places a write lands", () => {
  const STRUCT = "TYPE ST_Pair :\nSTRUCT\n\ta : INT;\n\tb : BOOL;\nEND_STRUCT\nEND_TYPE\n"
  test("a struct by its fields: every field, each checked, nothing more", () => {
    const p = runner("\tpair : ST_Pair;\n", "", STRUCT)
    expect([refusal(p, "pair", { A: 4n, B: true }), p.get("pair")]).toEqual(["written", { A: 4n, B: true }])
    expect(refusal(p, "pair", { A: 40000n, B: true })).toEqual(["pair.A", "INT", "40000 is outside INT's range -32768..32767"])
    expect(refusal(p, "pair", { A: 1n })).toEqual(["pair", "ST_Pair", "the value has no field B"])
    expect(refusal(p, "pair", { A: 1n, B: true, C: 3n })).toEqual(["pair", "ST_Pair", "ST_Pair has no field C"])
    expect(refusal(p, "pair", 1n)).toEqual(["pair", "ST_Pair", "a bigint (1) is no ST_Pair — ST_Pair takes a record of its fields"])
    expect(p.get("pair")).toEqual({ A: 4n, B: true })
  })

  test("an array by its elements: its length, each element checked; nested arrays and arrays of structs", () => {
    const p = runner("\tarr : ARRAY[1..3] OF SINT;\n\tgrid : ARRAY[0..1, 0..1] OF BOOL;\n\tpairs : ARRAY[0..1] OF ST_Pair;\n", "", STRUCT)
    expect([refusal(p, "arr", [1n, 2n, 3n]), p.get("arr")]).toEqual(["written", [1n, 2n, 3n]])
    expect(refusal(p, "arr", [1n, 2n])).toEqual(["arr", "ARRAY[1..3] OF SINT", "the value has 2 elements — the array holds 3"])
    expect(refusal(p, "arr", [1n, 200n, 3n])).toEqual(["arr[2]", "SINT", "200 is outside SINT's range -128..127"])
    expect(refusal(p, "arr[3]", -129n)).toEqual(["arr[3]", "SINT", "-129 is outside SINT's range -128..127"])
    expect(refusal(p, "grid", [[true, false], [false, 1n]])).toEqual(["grid[1][1]", "BOOL", "a bigint (1) is no BOOL — BOOL takes a boolean"])
    expect(refusal(p, "pairs", [{ A: 1n, B: true }, { A: 2n }])).toEqual(["pairs[1]", "ST_Pair", "the value has no field B"])
    expect(p.get("arr")).toEqual([1n, 2n, 3n])
  })

  test("an FB instance by its variables; written whole it is refused — CODESYS writes an instance's variables, never the instance", () => {
    const fb = "FUNCTION_BLOCK FB_C\nVAR_INPUT\n\tstep : INT;\nEND_VAR\nVAR_OUTPUT\n\tn : UINT;\nEND_VAR\nn := n + 1;\nEND_FUNCTION_BLOCK\n"
    const p = runner("\tc : FB_C;\n", "c();\n", fb)
    expect([refusal(p, "c.step", 3n), refusal(p, "c.n", 65535n)]).toEqual(["written", "written"])
    expect(refusal(p, "c.n", -1n)).toEqual(["c.n", "UINT", "-1 is outside UINT's range 0..65535"])
    expect(refusal(p, "c", { STEP: 1n, N: 1n })).toEqual(["c", "FB_C", "an FB instance is written by its variables, not whole"])
  })

  test("a global, the hidden clock, and a variable the byte image holds get the same check", () => {
    const list = { uri: "GVL.gvl", source: "VAR_GLOBAL\n\tg : USINT;\nEND_VAR\n" }
    const { pou } = lowerSource("PROGRAM P\nVAR\n\tw : WORD;\n\tp : POINTER TO WORD;\n\tt : TIME;\nEND_VAR\np := ADR(w);\nt := TIME();\nEND_PROGRAM\n", "P", [list])
    const p = run(pou!)
    expect(refusal(p, "GVL.g", 256n)).toEqual(["GVL.g", "USINT", "256 is outside USINT's range 0..255"])
    expect(refusal(p, CLOCK, -1n)).toEqual([CLOCK, "LTIME", "-1 is outside LTIME's range 0..18446744073709551615"])
    expect(refusal(p, CLOCK, 5n)).toBe("written")
    expect(refusal(p, "w", 65536n)).toEqual(["w", "WORD", "65536 is outside WORD's range 0..65535"])
    expect([refusal(p, "w", 65535n), p.get("w")]).toEqual(["written", 65535n])
  })

  test("a POINTER, a REFERENCE and an INTERFACE hold what the program stored, never a value written from outside", () => {
    const p = runner("\tw : WORD;\n\tp : POINTER TO WORD;\n", "p := ADR(w);\n")
    expect(refusal(p, "p", 0n)).toEqual(["p", "POINTER TO WORD", "a POINTER holds what the program stores in it — it is not written from outside"])
  })
})
