/**
 * `declaredTypes` — every position a declaration writes a type in, and how many things it declares of it (openspec
 * dut-unknown-field-type, the class sweep). Each position is asked by a source holding a type named after it, so a position
 * the walk misses is named by the test.
 */
import { expect, test } from "bun:test"
import { parseSource } from "../parse/parser.js"
import { declaredTypes } from "./declarations.js"
import type { TypeExpr } from "./nodes/index.js"

/** `<type>×<declares>` for every type `declaredTypes` yields for `source` (a wrapper is named by its kind). */
function written(source: string): string[] {
  const name = (t: TypeExpr): string => (t.kind === "named_type" ? t.name.text : t.kind)
  return [...declaredTypes(parseSource(source, { networkText: true, unicodeIdentifiers: false }, "codesys").units)].map((d) => `${name(d.type)}×${d.declares}`)
}

test("a STRUCT's and a UNION's fields, an alias's target, an enumeration's base", () => {
  expect(written("TYPE S :\nSTRUCT\n\ta : TField1;\n\tb, c : TField2;\nEND_STRUCT\nEND_TYPE\n")).toEqual(["TField1×1", "TField2×2"])
  expect(written("TYPE U :\nUNION\n\ta : TUnion;\nEND_UNION\nEND_TYPE\n")).toEqual(["TUnion×1"])
  expect(written("TYPE A : TAlias;\nEND_TYPE\n")).toEqual(["TAlias×1"])
  expect(written("TYPE E :\n(\n\ta,\n\tb\n) DINT;\nEND_TYPE\n")).toEqual(["DINT×1"])
  expect(written("TYPE E :\n(\n\ta,\n\tb\n);\nEND_TYPE\n")).toEqual([])
})

test("every VAR section of a function block, a program, a GVL — one per name declared", () => {
  const sections = ["VAR", "VAR_INPUT", "VAR_OUTPUT", "VAR_IN_OUT", "VAR_TEMP", "VAR_STAT", "VAR_EXTERNAL"]
  const fb = `FUNCTION_BLOCK FB\n${sections.map((s, i) => `${s}\n\tv${i} : T${i};\nEND_VAR`).join("\n")}\n%LANGUAGE ST\n;\nEND_FUNCTION_BLOCK\n`
  expect(written(fb)).toEqual(sections.map((_, i) => `T${i}×1`))
  expect(written("PROGRAM P\nVAR\n\ta, b, c : TProgram;\nEND_VAR\n%LANGUAGE ST\n;\nEND_PROGRAM\n")).toEqual(["TProgram×3"])
  expect(written("VAR_GLOBAL\n\tg : TGlobal;\nEND_VAR\n")).toEqual(["TGlobal×1"])
})

test("a FUNCTION's and a METHOD's result before its sections; a METHOD's VAR_INST", () => {
  expect(written("FUNCTION F : TResult\nVAR_INPUT\n\tx : TInput;\nEND_VAR\n%LANGUAGE ST\n;\nEND_FUNCTION\n")).toEqual(["TResult×1", "TInput×1"])
  expect(written("METHOD M : TMethod\nVAR_INST\n\tv : TInst;\nEND_VAR\n%LANGUAGE ST\n;\nEND_METHOD\n")).toEqual(["TMethod×1", "TInst×1"])
})

test("a PROPERTY: the property and each accessor; its accessors' sections", () => {
  expect(written("PROPERTY P : TProp\nGET\nVAR\n\tv : TGetLocal;\nEND_VAR\n%LANGUAGE ST\n;\nEND_GET\nEND_PROPERTY\n")).toEqual(["TProp×2", "TGetLocal×1"])
  expect(written("PROPERTY P : TProp\nGET\n%LANGUAGE ST\n;\nEND_GET\nSET\n%LANGUAGE ST\n;\nEND_SET\nEND_PROPERTY\n")).toEqual(["TProp×3"])
})

test("an INTERFACE's methods — result and sections — and its properties, one with no accessor declaring nothing", () => {
  const itf = "INTERFACE I\nMETHOD M : TItfResult\nVAR_INPUT\n\tx : TItfInput;\nEND_VAR\nEND_METHOD\nPROPERTY P : TItfProp\nGET\nEND_GET\nEND_PROPERTY\nPROPERTY Q : TItfBare\nEND_PROPERTY\nEND_INTERFACE\n"
  expect(written(itf)).toEqual(["TItfResult×1", "TItfInput×1", "TItfProp×2", "TItfBare×0"])
})

test("the type as written: a wrapper is yielded whole, inside a namespace too", () => {
  expect(written("FUNCTION_BLOCK FB\nVAR\n\ta : ARRAY[0..1] OF T;\n\tp : POINTER TO T;\nEND_VAR\n%LANGUAGE ST\n;\nEND_FUNCTION_BLOCK\n")).toEqual([
    "array_type×1",
    "pointer_type×1",
  ])
  expect(written("NAMESPACE N\nTYPE A : TInNamespace;\nEND_TYPE\nEND_NAMESPACE\n")).toEqual(["TInNamespace×1"])
})
