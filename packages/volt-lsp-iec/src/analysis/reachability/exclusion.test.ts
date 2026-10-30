/**
 * `effectivelyExcluded` (`exclusion.ts`) — which objects of one document the compiler does not build: the file's own
 * object by its `%EXCLUDE_FROM_BUILD` (the whole file, its members included), else each member by its own.
 */
import { expect, test } from "bun:test"
import { parseDocument } from "../../frontend/syntax/index.js"
import { effectivelyExcluded } from "./exclusion.js"

const parse = (uri: string, source: string) => parseDocument(uri, source, { networkText: true, unicodeIdentifiers: false }, "codesys")
/** The excluded objects' first lines (1-based), or "file". */
function excluded(uri: string, source: string): "file" | number[] {
  const e = effectivelyExcluded(parse(uri, source))
  return e.file ? "file" : e.objects.map((s) => s.startLine)
}

const FB = (flag: string) => `FUNCTION_BLOCK F\nVAR\n\tx : INT;\nEND_VAR\n%LANGUAGE ST\n${flag}x := 1;\nEND_FUNCTION_BLOCK\n`
const METHOD = (name: string, flag: string) => `METHOD ${name}\n%LANGUAGE ST\n${flag}x := 2;\nEND_METHOD\n`
const EXCL = "%EXCLUDE_FROM_BUILD\n"

test("a POU's own flag excludes the whole file, its members included", () => {
  expect(excluded("C:/w/F.pou", FB(EXCL) + METHOD("M", ""))).toBe("file")
})

test("a PROGRAM, a FUNCTION, a DUT, a GVL and an interface: their own flag excludes the file", () => {
  expect(excluded("C:/w/P.pou", `PROGRAM P\n%LANGUAGE ST\n${EXCL}END_PROGRAM\n`)).toBe("file")
  expect(excluded("C:/w/G.pou", `FUNCTION G : INT\n%LANGUAGE ST\n%CLASS CHECK CheckPointer\n${EXCL}G := 1;\nEND_FUNCTION\n`)).toBe("file")
  expect(excluded("C:/w/T.dut", `TYPE T :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE\n${EXCL}`)).toBe("file")
  expect(excluded("C:/w/V.gvl", `VAR_GLOBAL\n\tg : INT;\nEND_VAR\n${EXCL}`)).toBe("file")
  expect(excluded("C:/w/I.itf", `INTERFACE I\n${EXCL}METHOD M : BOOL\nEND_METHOD\nEND_INTERFACE\n`)).toBe("file")
})

test("a member's own flag excludes only that member: a method, an action, a property", () => {
  expect(excluded("C:/w/F.pou", FB("") + METHOD("A", "") + METHOD("B", EXCL))).toEqual([12])
  expect(excluded("C:/w/F.pou", FB("") + `ACTION Act\n%LANGUAGE ST\n${EXCL}x := 3;\nEND_ACTION\n`)).toEqual([8])
  const property = FB("") + `PROPERTY P : INT\n${EXCL}GET\n%LANGUAGE ST\nP := x;\nEND_GET\nEND_PROPERTY\n`
  expect(excluded("C:/w/F.pou", property)).toEqual([8])
})

test("an interface member's own flag excludes only that member", () => {
  expect(excluded("C:/w/I.itf", `INTERFACE I\nMETHOD A : BOOL\nEND_METHOD\nMETHOD B : BOOL\n${EXCL}END_METHOD\nEND_INTERFACE\n`)).toEqual([4])
})

test("no flag, a flag in a comment, or a flag that is no property line excludes nothing", () => {
  expect(excluded("C:/w/F.pou", FB("") + METHOD("M", ""))).toEqual([])
  expect(excluded("C:/w/F.pou", FB("// %EXCLUDE_FROM_BUILD\n"))).toEqual([])
  // after a blank line it is no property line: the push hands it to the IDE as code, and nothing is excluded
  expect(excluded("C:/w/F.pou", FB("\n" + EXCL))).toEqual([])
})
