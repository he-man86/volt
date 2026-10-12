import { expect, test } from "bun:test"
import { findLastWord, insertText, removeConstruct, removeWord, spanOf, swapBoundsFix } from "./fixes.js"

const apply = (source: string, e: { span: { start: number; end: number }; newText: string }) =>
  source.slice(0, e.span.start) + e.newText + source.slice(e.span.end)

test("fixes: spanOf counts lines 1-based and columns 0-based, as the lexer does", () => {
  expect(spanOf("ab\ncd", 3, 5)).toEqual({ start: 3, end: 5, startLine: 2, startCol: 0, endLine: 2, endCol: 2 })
})

test("fixes: an edit carries the text it replaces", () => {
  expect(insertText("abc", 1, "X")).toMatchObject({ replaces: "", newText: "X" })
})

test("fixes: removeConstruct takes the whole line when the construct stands alone on it, else closes the text up", () => {
  const alone = "a;\n\tlevel;\nb;\n"
  expect(apply(alone, removeConstruct(alone, alone.indexOf("level"), alone.indexOf("level") + 6))).toBe("a;\nb;\n")
  const shared = "lbl: out := 1;\n"
  expect(apply(shared, removeConstruct(shared, 0, 4))).toBe("out := 1;\n")
  const crlf = "a;\r\nlevel;\r\nb;"
  expect(apply(crlf, removeConstruct(crlf, 4, 10))).toBe("a;\r\nb;")
})

test("fixes: removeWord takes the blanks before the keyword, or after it where none stand before", () => {
  const header = "FUNCTION_BLOCK ABSTRACT FINAL FB"
  expect(apply(header, removeWord(header, 0, header.indexOf("FB", 20), "FINAL")!)).toBe("FUNCTION_BLOCK ABSTRACT FB")
  const first = "ABSTRACT FB"
  expect(apply(first, removeWord(first, 0, 9, "ABSTRACT")!)).toBe("FB")
  const section = "VAR_INPUT RETAIN\n"
  expect(apply(section, removeWord(section, 0, section.length, "RETAIN")!)).toBe("VAR_INPUT\n")
})

test("fixes: findLastWord takes the last whole word, never one inside a quoted attribute", () => {
  const src = "{attribute 'abstract'}\nFUNCTION_BLOCK ABSTRACT FB"
  expect(findLastWord(src, 0, src.length, "abstract")?.start).toBe(src.indexOf("ABSTRACT"))
  expect(findLastWord("ABSTRACTX", 0, 9, "ABSTRACT")).toBeUndefined()
})

test("fixes: swapping two bounds exchanges their texts", () => {
  const src = "INT(10..0)"
  const fix = swapBoundsFix(src, spanOf(src, 4, 6), spanOf(src, 8, 9))
  const edited = [...fix.edits].sort((a, b) => b.span.start - a.span.start).reduce((s, e) => apply(s, e), src)
  expect(edited).toBe("INT(0..10)")
  expect(fix.preferred).toBe(true)
})
