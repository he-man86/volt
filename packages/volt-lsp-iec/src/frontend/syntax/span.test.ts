/**
 * LINE ENDS IN RAW TEXT (openspec lsp-field-false-positives 8, class 2): every reader of the raw source counts a line
 * where the lexer does — LF, CRLF, and a lone CR, one line end each, offsets unchanged.
 */
import { expect, test } from "bun:test"
import { lex } from "./lex/lexer.js"
import { endsLineAt, lineBreakOf, lineColAt, lineStartOf, splitLines } from "./span.js"

const MIXED = ["a := 1;\rb := 2;\r\nc := 3;\nd := 4;\r\re := 5;", "(* one\rtwo\r\nthree *)\rx := 1; // c\ry := 2;"]

test("lineColAt agrees with the lexer's line and column at every token, over LF, CRLF and lone-CR line ends", () => {
  for (const text of MIXED)
    for (const t of lex(text, "codesys", false)) {
      expect(lineColAt(text, t.span.start)).toEqual({ line: t.span.startLine, col: t.span.startCol })
      expect(lineColAt(text, t.span.end)).toEqual({ line: t.span.endLine, col: t.span.endCol })
    }
})

test("a lone CR ends a line; the CR of a CRLF is its line's last character", () => {
  const text = "a\rb\r\nc\nd"
  expect([...text].map((_, i) => endsLineAt(text, i))).toEqual([false, true, false, false, true, false, true, false])
  expect(lineStartOf(text, text.indexOf("b"))).toBe(2)
  expect(lineStartOf(text, text.indexOf("c"))).toBe(5)
  expect(lineStartOf(text, text.indexOf("d"))).toBe(7)
  expect(splitLines(text)).toEqual(["a", "b", "c", "d"])
})

test("lineBreakOf: the document's own break — CRLF, else LF, else a lone CR", () => {
  expect(lineBreakOf("a\r\nb\rc")).toBe("\r\n")
  expect(lineBreakOf("a\nb")).toBe("\n")
  expect(lineBreakOf("a\rb")).toBe("\r")
  expect(lineBreakOf("a")).toBe("\n")
})
