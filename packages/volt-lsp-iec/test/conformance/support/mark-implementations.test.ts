import { expect, test } from "bun:test"
import { markImplementations } from "./mark-implementations.js"

test("an ST body gains IMPLEMENTATION ST, a body that states its language keeps its line and gains none", () => {
  const st = "FUNCTION_BLOCK F\nVAR\n\ta : BOOL;\nEND_VAR\na := TRUE;\nEND_FUNCTION_BLOCK\n"
  expect(markImplementations(st)).toBe("FUNCTION_BLOCK F\nVAR\n\ta : BOOL;\nEND_VAR\nIMPLEMENTATION ST\na := TRUE;\nEND_FUNCTION_BLOCK\n")
  const graphical = "FUNCTION_BLOCK F\nVAR\n\ta : BOOL;\nEND_VAR\nIMPLEMENTATION LD\nNETWORK\n  a := TRUE;\nEND_NETWORK\nEND_FUNCTION_BLOCK\n"
  expect(markImplementations(graphical)).toBe(graphical)
  const stated = "FUNCTION_BLOCK F\nVAR\n\ta : BOOL;\nEND_VAR\nIMPLEMENTATION ST\na := TRUE;\nEND_FUNCTION_BLOCK\n"
  expect(markImplementations(stated)).toBe(stated)
})

test("every kind with an implementation gains the line — method, action, both accessors — and an interface none", () => {
  const src =
    "FUNCTION_BLOCK F\nVAR\n\tx : INT;\nEND_VAR\nx := 1;\nEND_FUNCTION_BLOCK\n\n" +
    "METHOD M\nx := 2;\nEND_METHOD\n\nACTION A\nx := 3;\nEND_ACTION\n\n" +
    "PROPERTY P : INT\nGET\nP := x;\nEND_GET\nSET\nx := P;\nEND_SET\nEND_PROPERTY\n"
  expect(markImplementations(src).match(/^IMPLEMENTATION ST$/gm)?.length).toBe(5)
  const iface = "INTERFACE I\nMETHOD M : BOOL\nEND_METHOD\nEND_INTERFACE\n"
  expect(markImplementations(iface)).toBe(iface)
})

test("the line goes UNDER the declaration's last line — a trailing comment after END_VAR stays on it", () => {
  // The historical trap task 1.2 names: the body's first character is the comment on the END_VAR line, so walking back
  // to that character's line wrote the keyword ABOVE `END_VAR`, and `END_VAR` was pushed as body code.
  for (const trailing of ["(* trailing *)", "// trailing", "{warning 'w'}"]) {
    const src = `FUNCTION F : INT\nVAR\n\tx : INT;\nEND_VAR ${trailing}\nF := 1;\nEND_FUNCTION\n`
    expect(markImplementations(src)).toBe(`FUNCTION F : INT\nVAR\n\tx : INT;\nEND_VAR ${trailing}\nIMPLEMENTATION ST\nF := 1;\nEND_FUNCTION\n`)
  }
})

test("a body that shares its line with the declaration has no line to put the keyword on, and is refused", () => {
  // `VAR x : INT; END_VAR x := 1;` — any line the recorder wrote would move code across the boundary the parser drew,
  // so it is refused loudly rather than pushed with a boundary someone made up.
  expect(() => markImplementations("PROGRAM P\nVAR x : INT; END_VAR x := 1;\nEND_PROGRAM\n")).toThrow(/shares a line/)
  expect(() => markImplementations("FUNCTION F : INT\nVAR\nEND_VAR (* a\n b *) F := 1;\nEND_FUNCTION\n")).toThrow(/shares a line/)
})
