/**
 * Position math — the offset↔position/range conversions under every cursor-based LSP request (hover,
 * definition, completion). Untested before; off-by-one here breaks all of them, so pin the line/col
 * boundaries, the end-of-source case, out-of-range, and the Span(1-based line)→Range(0-based) mapping.
 */
import { lex, spanContains } from "../../frontend/syntax/index.js"
import { test, expect } from "bun:test"
import type { Span } from "../../frontend/syntax/index.js"
import { offsetFromPosition, rangeFromSpan, tokenAtOffset } from "./positions.js"

const SRC = "abc\ndef\nghi" // offsets: a0 b1 c2 \n3 d4 e5 f6 \n7 g8 h9 i10  (length 11)

test("offsetFromPosition maps line/col to byte offset across line boundaries", () => {
  expect(offsetFromPosition(SRC, { line: 0, character: 0 })).toBe(0) // 'a'
  expect(offsetFromPosition(SRC, { line: 0, character: 2 })).toBe(2) // 'c'
  expect(offsetFromPosition(SRC, { line: 1, character: 0 })).toBe(4) // 'd' — start of 2nd line
  expect(offsetFromPosition(SRC, { line: 2, character: 2 })).toBe(10) // 'i'
})

test("offsetFromPosition: a position at end-of-source returns the length; out-of-range returns -1", () => {
  expect(offsetFromPosition(SRC, { line: 2, character: 3 })).toBe(11) // just past 'i' == length
  expect(offsetFromPosition(SRC, { line: 9, character: 0 })).toBe(-1) // line beyond the source
  expect(offsetFromPosition(SRC, { line: 0, character: 99 })).toBe(-1) // col beyond the line
})

test("rangeFromSpan: Span (1-based line / 0-based col) → LSP Range (0-based)", () => {
  const span: Span = { start: 4, end: 7, startLine: 2, startCol: 0, endLine: 2, endCol: 3 }
  expect(rangeFromSpan(span)).toEqual({ start: { line: 1, character: 0 }, end: { line: 1, character: 3 } })
})

test("spanContains: start inclusive, end exclusive", () => {
  const span: Span = { start: 4, end: 7, startLine: 1, startCol: 0, endLine: 1, endCol: 3 }
  expect(spanContains(span, 4)).toBe(true) // start inclusive
  expect(spanContains(span, 6)).toBe(true) // inside
  expect(spanContains(span, 7)).toBe(false) // end exclusive
  expect(spanContains(span, 3)).toBe(false) // before
})

// ── tokenAtOffset — the token under a cursor when there is no statement tree (declarations), for hover and
// definition on type names and declared identifiers (from `syntax/token-at.test.ts`, openspec frontend-conformance 1.10).

// "x := foo;" → x[0,1) :=[2,4) foo[5,8) ;[8,9)   (offsets 1 and 4 are whitespace = trivia)
const TOKENS = lex("x := foo;", "codesys")

test("returns the token whose span covers the offset (start inclusive)", () => {
  expect(tokenAtOffset(TOKENS, 0)?.text).toBe("x")
  expect(tokenAtOffset(TOKENS, 3)?.text).toBe(":=") // inside the operator
  expect(tokenAtOffset(TOKENS, 6)?.text).toBe("foo") // inside the identifier
  expect(tokenAtOffset(TOKENS, 8)?.text).toBe(";")
})

test("returns undefined in trivia (whitespace) and past the end", () => {
  expect(tokenAtOffset(TOKENS, 4)).toBeUndefined() // the space before 'foo'
  expect(tokenAtOffset(TOKENS, 99)).toBeUndefined() // past end of source
})

test("end offset is exclusive — a cursor at a token's end belongs to the next token", () => {
  // offset 1 is the end of 'x' (exclusive) AND the start of the following space (trivia) → no token.
  expect(tokenAtOffset(TOKENS, 1)).toBeUndefined()
})
