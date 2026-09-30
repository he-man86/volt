/**
 * `IMPLEMENTATION` IS A RESERVED NAME (rule FMT8): every token spelled like it that is not a body's line is reported,
 * as the push refuses the name. The server's end-to-end case is `server/implementation-keyword-diagnostics.test.ts`.
 */
import { expect, test } from "bun:test"
import { parseSource } from "../index.js"

const reserved = (src: string): string[] => parseSource(src, { networkText: true }).errors.map((e) => e.message).filter((m) => m.includes("is reserved"))

test("a name spelled like the IMPLEMENTATION keyword is reported, in any case; a body's line is not", () => {
  const src =
    "FUNCTION_BLOCK F\nVAR\n\timplementation : INT;\nEND_VAR\nIMPLEMENTATION ST\nimplementation := 1;\nEND_FUNCTION_BLOCK\n"
  expect(reserved(src)).toHaveLength(2) // the declaration and the use; the line itself is the boundary
  expect(reserved("FUNCTION_BLOCK F\nVAR\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\nx := 1;\nEND_FUNCTION_BLOCK\n")).toEqual([])
})
