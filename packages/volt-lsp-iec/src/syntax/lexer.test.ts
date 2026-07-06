import { test, expect } from "bun:test"
import { lex } from "./lexer.js"
import { isTrivia, type Token } from "./tokens.js"

// Non-trivia tokens, the stream the parser actually consumes.
const code = (src: string): Token[] => lex(src).filter((t) => !isTrivia(t.kind))

test("keywords are canonicalized case-insensitively", () => {
  const [t] = code("function_block")
  expect(t.kind).toBe("keyword")
  expect(t.keyword).toBe("FUNCTION_BLOCK")
  expect(t.text).toBe("function_block") // original casing preserved
})

test("multi-char punct beats single-char (`:=` not `:` `=`)", () => {
  const toks = code("x := 1")
  expect(toks.map((t) => t.text)).toEqual(["x", ":=", "1", ""]) // last is eof
})

test("range `..` does not eat the number's dot", () => {
  const toks = code("1..5")
  expect(toks.map((t) => t.kind).slice(0, 3)).toEqual(["int_lit", "punct", "int_lit"])
  expect(toks[1].text).toBe("..")
})

test("literal families", () => {
  expect(code("T#10ms")[0].kind).toBe("time_lit")
  expect(code("DT#2020-01-01-00:00:00")[0].kind).toBe("datetime_lit")
  expect(code("INT#42")[0].kind).toBe("typed_lit")
  expect(code("16#FF")[0].kind).toBe("int_lit")
  expect(code("1.5e3")[0].kind).toBe("real_lit")
  expect(code("%IX0.0")[0].kind).toBe("address_lit")
  expect(code("'hi'")[0].kind).toBe("string_lit")
})

// Gap found via a re-harvested corpus (IODrvEtherCAT enum): a typed BASED literal carries a SECOND `#`.
test("a typed based literal (`WORD#16#1`) lexes as one whole typed_lit token", () => {
  const toks = code("WORD#16#1").filter((t) => t.kind !== "eof")
  expect(toks).toHaveLength(1)
  expect(toks[0].kind).toBe("typed_lit")
  expect(toks[0].text).toBe("WORD#16#1")
  // As it appears in library enums: `START := WORD#16#1, DONE := DWORD#2#1010`
  expect(code("DWORD#2#1010")[0].text).toBe("DWORD#2#1010")
})

test("ExST set/reset assignment operators lex as one punct", () => {
  const toks = code("x S= 1")
  expect(toks[1].kind).toBe("punct")
  expect(toks[1].text).toBe("S=")
})

test("nestable block comments are trivia", () => {
  const all = lex("(* outer (* inner *) still *) x")
  expect(all.find((t) => t.kind === "block_comment")).toBeDefined()
  expect(code("(* outer (* inner *) still *) x").map((t) => t.text)).toEqual(["x", ""])
})

test("eof always terminates the stream", () => {
  const toks = lex("")
  expect(toks.at(-1)?.kind).toBe("eof")
})
