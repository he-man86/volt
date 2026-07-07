/**
 * tokenAtOffset — the token under a cursor when there's no statement tree (declarations). Used by hover /
 * definition on type names + declared identifiers. Untested before; pin the inside/boundary/trivia cases.
 */
import { test, expect } from "bun:test"
import { tokenAtOffset } from "./token-scan.js"

// "x := foo;" → x[0,1) :=[2,4) foo[5,8) ;[8,9)   (offsets 1 and 4 are whitespace = trivia)
const SRC = "x := foo;"

test("returns the token whose span covers the offset (start inclusive)", () => {
  expect(tokenAtOffset(SRC, 0)?.text).toBe("x")
  expect(tokenAtOffset(SRC, 3)?.text).toBe(":=") // inside the operator
  expect(tokenAtOffset(SRC, 6)?.text).toBe("foo") // inside the identifier
  expect(tokenAtOffset(SRC, 8)?.text).toBe(";")
})

test("returns undefined in trivia (whitespace) and past the end", () => {
  expect(tokenAtOffset(SRC, 4)).toBeUndefined() // the space before 'foo'
  expect(tokenAtOffset(SRC, 99)).toBeUndefined() // past end of source
})

test("end offset is exclusive — a cursor at a token's end belongs to the next token", () => {
  // offset 1 is the end of 'x' (exclusive) AND the start of the following space (trivia) → no token.
  expect(tokenAtOffset(SRC, 1)).toBeUndefined()
})
