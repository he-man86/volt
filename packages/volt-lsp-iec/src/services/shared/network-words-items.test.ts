/**
 * The network words of an item (`network-words.ts`): the assignment item's marks (`y := NOT := a`), a jump's and the
 * return's marks, and the operand comment `COMMENT(a, 'why')` — coloured, explained and offered; and the operand a comment
 * wraps navigates as the operand it is.
 */
import { expect, test } from "bun:test"
import { parseSource } from "../../frontend/syntax/index.js"
import { build } from "../../frontend/symbols/index.js"
import { completion, hover } from "../assist/index.js"
import { definition, documentHighlights } from "../navigation/index.js"
import { networkTokens } from "../structure/index.js"
import type { Document } from "./document.js"

const ITEMS = `PROGRAM P
VAR
\ta : BOOL; b : BOOL; c : BOOL; x : BOOL; y : BOOL; t1 : TON;
END_VAR
%LANGUAGE LD
%NETWORK
l:
y := x := RISING NOT := a;
NOT JMP.l := c;
NOT RETURN := b;
y := COMMENT(a, 'why');
NOT COMMENT(x, 'why') := c;
t1(IN := COMMENT(b, 'in'), PT := T#1S, Q => COMMENT(y, 'out'));
`

function setup(src: string) {
  const parseResult = parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys")
  const doc: Document = { uri: "file:///P.pou", source: src, parseResult }
  const project = build.buildSymbolTable([{ uri: doc.uri, parseResult, source: src }], [], "codesys")
  return { doc, project }
}

const offsetOf = (src: string, from: string, word: string) => src.indexOf(from) + from.indexOf(word)

const hoverAt = (src: string, from: string, word: string) => {
  const { doc, project } = setup(src)
  return (hover(doc, project, offsetOf(src, from, word))?.contents as { value: string } | undefined)?.value
}

test("the item's marks, a jump's and the return's marks are keywords, COMMENT a function", () => {
  const kind = (from: string, word: string) => networkTokens(ITEMS).find((t) => t.start === offsetOf(ITEMS, from, word))?.kind
  expect(kind("y := x := RISING NOT := a;", "RISING")).toBe("keyword")
  expect(kind("y := x := RISING NOT := a;", "NOT")).toBe("keyword")
  expect(kind("NOT JMP.l := c;", "NOT")).toBe("keyword")
  expect(kind("NOT RETURN := b;", "NOT")).toBe("keyword")
  expect(kind("y := COMMENT(a, 'why');", "COMMENT")).toBe("function")
  expect(kind("y := COMMENT(a, 'why');", "a")).toBe("variable")
})

test("hover names what each mark stands on, and what COMMENT is", () => {
  expect(hoverAt(ITEMS, "y := x := RISING NOT := a;", "NOT")).toBe("a negation mark on the assignment: the value every target receives")
  expect(hoverAt(ITEMS, "y := x := RISING NOT := a;", "RISING")).toBe("a rising-edge mark on the assignment: the value every target receives")
  expect(hoverAt(ITEMS, "NOT JMP.l := c;", "NOT")).toBe("a negation mark on the jump to l")
  expect(hoverAt(ITEMS, "NOT RETURN := b;", "NOT")).toBe("a negation mark on the return")
  expect(hoverAt(ITEMS, "NOT COMMENT(x, 'why') := c;", "NOT")).toBe("a negation mark on the coil x")
  expect(hoverAt(ITEMS, "y := COMMENT(a, 'why');", "COMMENT")).toBe("an operand comment: the operand it wraps, the comment the engineer typed beside it")
})

test("COMMENT is offered where an operand stands: a value, a statement's start, an output's target", () => {
  const at = (src: string, marker: string) => {
    const offset = src.indexOf(marker)
    const { doc, project } = setup(src.replace(marker, ""))
    return completion(doc, project, offset).map((i) => i.label)
  }
  expect(at(ITEMS.replace("y := COMMENT(a, 'why');", "y := |"), "|")).toEqual(expect.arrayContaining(["COMMENT", "RISING", "FALLING"]))
  expect(at(ITEMS.replace("NOT RETURN := b;", "NOT RETURN := b;\n|"), "|")).toEqual(expect.arrayContaining(["COMMENT", "RAIL()", "BRANCH"]))
  expect(at(ITEMS.replace("Q => COMMENT(y, 'out')", "Q => |"), "|")).toContain("COMMENT")
  expect(at(ITEMS.replace("IN := COMMENT(b, 'in')", "IN := |"), "|")).not.toContain("RISING")
})

test("the operand a comment wraps navigates as the operand: its definition, its every occurrence", () => {
  const { doc, project } = setup(ITEMS)
  const def = definition(doc, project, offsetOf(ITEMS, "y := COMMENT(a, 'why');", "a,"))
  expect(def?.range.start.line).toBe(2)
  const highlights = documentHighlights(doc, project, offsetOf(ITEMS, "NOT COMMENT(x, 'why')", "x,")) ?? []
  expect(highlights.map((r) => ITEMS.split("\n")[r.start.line]!.slice(r.start.character, r.end.character))).toEqual(["x", "x", "x"])
})
