/**
 * object-name — an object or member the IDE refuses to create by its name, in the IDE's own words (openspec
 * lsp-field-followups 3). The oracle is the push's refusal, recorded per fixture (`vendorRefuses`: conformance
 * `names/word-positions.ts`, `names/object-names.ts`, `objects/removed-push-checks.ts`, `grammar/lexer.ts`), and the
 * create rule volt-cli's snapshot measured (`scripts/vendor-facts.<vendor>.json`, `refused-names`, `identifier-shapes`).
 */
import { expect, test } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeDiagnostics, resolveConfig, type Vendor } from "../../index.js"
import { refused } from "./object-name.js"

const findings = (uri: string, source: string, vendor: Vendor = "codesys", unicodeIdentifiers = false): string[] => {
  const parseResult = parseSource(source, { networkText: true }, vendor)
  const project = build.buildSymbolTable([{ uri, parseResult, source }], [], vendor)
  return computeDiagnostics({ uri, parseResult, source, project, config: resolveConfig({ vendor, unicodeIdentifiers }) }).map((d) => `${d.code}: ${d.message}`)
}
const CS = (name: string) => `object-name-refused: The name '${name}' is not valid for this object.`
const TC = (name: string) => `object-name-refused: Creating the child named '${name}' is not possible on node (Name mismatch)`
const fb = (name: string, members = "") => `FUNCTION_BLOCK ${name}\nVAR\n\tk : INT;\nEND_VAR\n%LANGUAGE ST\nk := 1;\nEND_FUNCTION_BLOCK\n${members}`

test("an object named by a reserved word is refused, and the refusal is all its text says (wp_fb_name_int, on_*)", () => {
  expect(findings("INT.pou", fb("INT"))).toEqual([CS("INT")])
  expect(findings("INT.pou", fb("INT"), "twincat")).toEqual([TC("INT")])
  // any case, every object kind — the name is the file's, the object the push creates
  expect(findings("int.pou", fb("int"))).toEqual([CS("int")])
  expect(findings("CASE.dut", "TYPE CASE :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE\n")).toEqual([CS("CASE")])
  expect(findings("ABS.gvl", "VAR_GLOBAL\n\tg : INT;\nEND_VAR\n")).toEqual([CS("ABS")])
  expect(findings("LD.itf", "INTERFACE LD\nMETHOD Run : INT\nEND_METHOD\nEND_INTERFACE\n")).toEqual([CS("LD")])
})

test("a member named by a reserved word is refused by the name the push reads off its header", () => {
  expect(findings("FB_A.pou", fb("FB_A", "\nMETHOD ABSTRACT : INT\nVAR_INPUT\nEND_VAR\n%LANGUAGE ST\nk := 2;\nEND_METHOD\n"))).toEqual([CS("ABSTRACT")])
  expect(findings("FB_A.pou", fb("FB_A", "\nACTION INT_TO_BOOL\n%LANGUAGE ST\nk := 2;\nEND_ACTION\n"))).toEqual([CS("INT_TO_BOOL")])
  expect(findings("FB_A.pou", fb("FB_A", "\nPROPERTY PUBLIC LD : INT // a comment\nSET\n%LANGUAGE ST\nk := 2;\nEND_SET\nEND_PROPERTY\n"), "twincat")).toEqual([TC("LD")])
  // the last word before the colon, blanks splitting — `My-Name` is one word to the push, two tokens to the parser
  // (rcc_member_name_not_identifier)
  expect(findings("FB_A.pou", fb("FB_A", "\nMETHOD My-Name : BOOL\n%LANGUAGE ST\nMy := TRUE;\nEND_METHOD\n"))).toEqual([CS("My-Name")])
  // between backticks: CODESYS creates it, TwinCAT refuses it (rcc_member_backtick_name)
  const quoted = fb("FB_A", "\nMETHOD `a b` : INT\n%LANGUAGE ST\nk := 2;\nEND_METHOD\n")
  expect(findings("FB_A.pou", quoted).filter((f) => f.startsWith("object-name-refused"))).toEqual([])
  expect(findings("FB_A.pou", quoted, "twincat")).toEqual([TC("`a b`")])
})

test("an interface's member was asked one word of the list, so only that word is refused there", () => {
  expect(findings("I_A.itf", "INTERFACE I_A\nMETHOD a__b : INT\nEND_METHOD\nEND_INTERFACE\n")).toEqual([CS("a__b")])
  expect(refused("codesys", false, "INT", new Set(["A__B"]))).toBe(false)
})

test("a name past ASCII: CODESYS's project option decides, TwinCAT refuses every one (DIALECT C28b, D39)", () => {
  const cjk = fb("FB_主控制")
  expect(findings("FB_主控制.pou", cjk)).toEqual([CS("FB_主控制")])
  expect(findings("FB_主控制.pou", cjk, "codesys", true)).toEqual([])
  expect(findings("FB_主控制.pou", cjk, "twincat")).toEqual([TC("FB_主控制")])
  // with the option on, a name that is no identifier in its script is still refused (`1点`, a no-break space)
  expect(refused("codesys", true, "1点", undefined)).toBe(true)
  expect(refused("codesys", true, "a b", undefined)).toBe(true)
  expect(refused("codesys", true, "a٣", undefined)).toBe(false)
  // the encoded URI a client sends names the same object
  expect(findings("file:///w/FB_%E4%B8%BB%E6%8E%A7%E5%88%B6.pou", cjk)).toEqual([CS("FB_主控制")])
})

test("what both IDEs create is no finding — an identifier, a soft keyword, CODESYS's backtick name", () => {
  for (const name of ["Run", "_lead", "With9", "Trail_", "_", "GET", "SET", "OVERRIDE", "LEN"])
    for (const vendor of ["codesys", "twincat"] as const) expect(refused(vendor, false, name, undefined)).toBe(false)
  expect(refused("codesys", false, "`INT`", undefined)).toBe(false)
  expect(refused("codesys", false, "`ab", undefined)).toBe(true)
  // text that is no workspace file creates nothing
  expect(findings("scratch.st", fb("INT"))).not.toContainEqual(CS("INT"))
})
