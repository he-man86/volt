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
