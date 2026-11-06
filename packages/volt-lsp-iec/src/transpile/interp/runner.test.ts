/** Runner paths: a called PROGRAM's frame (openspec runner-program-paths), and a path resolved once stays right however
 *  the program replaces what it leads through (openspec runner-path-lookup-cost). */
import { describe, expect, test } from "bun:test"
import { lowerSource, run, type Runner } from "../index.js"

function runner(main: string, others: readonly string[] = []): Runner {
  const files = others.map((source, i) => ({ uri: `Other${i}.pou`, source }))
  const { pou, diagnostics } = lowerSource(main, "Main", files, "Main.pou")
  if (pou === undefined) throw new Error(diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"))
  return run(pou)
}

const MAIN = "PROGRAM Main\nVAR\n\ta : INT := 1;\nEND_VAR\nProg2();\nEND_PROGRAM\n"
const TICK = "FUNCTION_BLOCK Tick\nVAR_INPUT\n\tIN : BOOL;\nEND_VAR\nEND_FUNCTION_BLOCK\n"
const PROG2 =
  "PROGRAM Prog2\nVAR\n\ta : BOOL;\n\tn : INT := 5;\n\tseen : INT;\n\tin : INT;\n\tt1 : Tick;\n\tarr : ARRAY[1..2] OF INT := [10, 20];\nEND_VAR\n" +
  "a := TRUE;\nseen := in;\nt1(IN := a);\nEND_PROGRAM\n"

describe("a called program's variables by path", () => {
  test("read after a scan, down through an FB and an array, any case", () => {
    const r = runner(MAIN, [TICK, PROG2])
    r.scan()
    expect(r.get("Prog2.a")).toBe(true)
    expect(r.get("PROG2.A")).toBe(true)
    expect(r.get("Prog2.t1.IN")).toBe(true)
    expect(r.get("Prog2.arr[2]")).toBe(20n)
  })

  test("a write is what the program's next call sees", () => {
    const r = runner(MAIN, [TICK, PROG2])
    r.set("Prog2.in", 42n)
    r.scan()
    expect(r.get("Prog2.seen")).toBe(42n)
  })

  test("holds its initial values before its first call", () => {
    const r = runner(MAIN, [TICK, PROG2])
    expect(r.get("Prog2.n")).toBe(5n)
    expect(r.get("Prog2.arr[1]")).toBe(10n)
  })

  test("a write out of its type's range is refused as for any variable", () => {
    const r = runner(MAIN, [TICK, PROG2])
    expect(() => r.set("Prog2.n", 70000n)).toThrow()
    expect(r.get("Prog2.n")).toBe(5n)
  })

  test("a bare name stays the entry program's, and never reaches a program's member", () => {
    const r = runner(MAIN, [TICK, PROG2])
    r.scan()
    expect(r.get("a")).toBe(1n)
    expect(() => r.get("seen")).toThrow("no variable seen in Main")
  })

  test("an LD program's network state reads by path, as the network view needs it", () => {
    const LD = "PROGRAM Prog2\nVAR\n\ta : BOOL := TRUE;\n\tb : BOOL;\nEND_VAR\n%LANGUAGE LD\n%NETWORK\nVAR w1 : ANY; END_VAR\nw1 := a;\nASSIGN(w1, Q => b);\nEND_PROGRAM\n"
    const r = runner(MAIN, [LD])
    r.scan()
    expect(r.get("Prog2.__nw1_w1")).toBe(true)
    expect(r.get("Prog2.b")).toBe(true)
  })

  test("a program the entry program does not call has no frame, and says so", () => {
    expect(() => runner(MAIN, [TICK, PROG2, "PROGRAM Prog3\nVAR\n\tx : INT;\nEND_VAR\nx := 1;\nEND_PROGRAM\n"]).get("Prog3.x")).toThrow("no variable Prog3.x in Main")
  })
})

describe("a path read twice", () => {
  const STRUCT = "TYPE S :\nSTRUCT\n\tx : INT;\nEND_STRUCT\nEND_TYPE\n"
  const COPY =
    "PROGRAM Main\nVAR\n\ta : S;\n\tb : S;\n\tarr : ARRAY[0..1] OF INT;\n\tbrr : ARRAY[0..1] OF INT;\n\tt : INT;\nEND_VAR\nVAR_TEMP\n\ttemp : S;\nEND_VAR\n" +
    "a := b;\narr := brr;\nt := temp.x;\ntemp.x := temp.x + 1;\nEND_PROGRAM\n"

  test("follows a whole struct and a whole array the program assigned", () => {
    const r = runner(COPY, [STRUCT])
    r.set("b.x", 1n)
    r.set("brr[1]", 2n)
    r.scan()
    expect(r.get("a.x")).toBe(1n)
    expect(r.get("arr[1]")).toBe(2n)
    r.set("b.x", 3n)
    r.set("brr[1]", 4n)
    r.scan()
    expect(r.get("a.x")).toBe(3n)
    expect(r.get("arr[1]")).toBe(4n)
    // and a write through the path lands where the program reads it
    r.set("a.x", 9n)
    r.set("arr[1]", 8n)
    expect(r.get("a.x")).toBe(9n)
    expect(r.get("arr[1]")).toBe(8n)
    expect(r.get("b.x")).toBe(3n)
    expect(r.get("brr[1]")).toBe(4n)
  })

  test("an unknown path and a bad index are refused every time, not remembered", () => {
    const r = runner(COPY, [STRUCT])
    for (let i = 0; i < 2; i++) {
      expect(() => r.get("nope")).toThrow("no variable nope in Main")
      expect(() => r.get("arr[5]")).toThrow()
    }
    expect(r.get("arr[1]")).toBe(0n)
  })

  test("a value the type does not hold is refused on every set", () => {
    const r = runner(COPY, [STRUCT])
    r.set("t", 1n)
    for (let i = 0; i < 2; i++) expect(() => r.set("t", 70000n)).toThrow()
    expect(r.get("t")).toBe(1n)
  })
})
