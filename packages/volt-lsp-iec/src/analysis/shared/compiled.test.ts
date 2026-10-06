/**
 * compiled — which FBs the vendor compiles, as CODESYS answered it (`fixtures/names/inheritance.ts`, 2026-10-02): an FB
 * reached from a PROGRAM, a FUNCTION or a GVL through the declarations of what is compiled — an instance, an array of
 * them, a POINTER or REFERENCE TO one — and every base of one. Instanced only inside an FB nothing reaches is NOT compiled
 * (`inh_override_instanced_in_uninstanced_fb` builds); reached only through a pointer or a reference IS
 * (`inh_override_pointer_only`, `_reference_only` refuse the override).
 */
import { expect, test } from "bun:test"
import { parseSource } from "../../frontend/syntax/index.js"
import { build } from "../../frontend/symbols/index.js"
import { compiledFbs } from "./compiled.js"

const compiled = (src: string): string[] => {
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }], [], "codesys")
  return [...compiledFbs(project)].map((s) => s.name).sort()
}
const fb = (name: string, vars = "", header = "") => `FUNCTION_BLOCK ${name}${header}\nVAR\n${vars}\nEND_VAR\nEND_FUNCTION_BLOCK\n`
const prg = (vars: string) => `PROGRAM P\nVAR\n${vars}\nEND_VAR\nEND_PROGRAM\n`

test("an FB a PROGRAM instances is compiled; one nothing instances is not", () => {
  expect(compiled(fb("A") + fb("B") + prg("a : A;"))).toEqual(["A"])
})

test("an array of an FB instances it", () => {
  expect(compiled(fb("A") + prg("a : ARRAY[1..2] OF A;"))).toEqual(["A"])
})

test("a POINTER TO or a REFERENCE TO an FB reaches it (`inh_override_pointer_only`, `_reference_only`)", () => {
  expect(compiled(fb("A") + fb("B") + prg("p : POINTER TO A;\nrb : REFERENCE TO B;"))).toEqual(["A", "B"])
})

test("an FB instanced only inside an FB nothing reaches is not compiled (`inh_override_instanced_in_uninstanced_fb`)", () => {
  expect(compiled(fb("A") + fb("Holder", "a : A;") + prg(""))).toEqual([])
})

test("…and is, transitively, when the holder is reached — through its VAR or a METHOD's", () => {
  expect(compiled(fb("A") + fb("Holder", "a : A;") + prg("h : Holder;"))).toEqual(["A", "Holder"])
  const method = `${fb("A")}${fb("Holder")}\nMETHOD M : INT\nVAR\n\ta : A;\nEND_VAR\nEND_METHOD\n${prg("h : Holder;")}`
  expect(compiled(method)).toEqual(["A", "Holder"])
})

test("every base of a compiled FB is compiled", () => {
  expect(compiled(fb("Base") + fb("D", "", " EXTENDS Base") + prg("d : D;"))).toEqual(["Base", "D"])
})

test("a GVL's instance and a STRUCT field of a reached STRUCT reach the FB", () => {
  expect(compiled(fb("A") + "VAR_GLOBAL\n\tg : A;\nEND_VAR\n")).toEqual(["A"])
  const struct = "TYPE S :\nSTRUCT\n\ta : A;\nEND_STRUCT\nEND_TYPE\n"
  expect(compiled(fb("A") + struct + prg("sv : S;"))).toEqual(["A"])
  expect(compiled(fb("A") + struct + prg(""))).toEqual([])
})
