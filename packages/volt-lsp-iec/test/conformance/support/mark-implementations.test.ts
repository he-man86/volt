import { expect, test } from "bun:test"
import { markImplementations } from "./mark-implementations.js"

test("an ST body gains the bare marker, a graphical body keeps its own and gains none", () => {
  const st = "FUNCTION_BLOCK F\nVAR\n\ta : BOOL;\nEND_VAR\na := TRUE;\nEND_FUNCTION_BLOCK\n"
  expect(markImplementations(st)).toBe("FUNCTION_BLOCK F\nVAR\n\ta : BOOL;\nEND_VAR\n(* @volt-implementation *)\na := TRUE;\nEND_FUNCTION_BLOCK\n")
  const graphical = "FUNCTION_BLOCK F\nVAR\n\ta : BOOL;\nEND_VAR\n(* @volt-implementation LD *)\nNETWORK\n  a := TRUE;\nEND_NETWORK\nEND_FUNCTION_BLOCK\n"
  expect(markImplementations(graphical)).toBe(graphical)
})
