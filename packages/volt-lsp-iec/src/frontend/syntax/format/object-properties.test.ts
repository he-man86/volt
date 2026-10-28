/**
 * A PROPERTY'S AND AN INTERFACE MEMBER'S `%FOLDER` — read where the push reads it, and nowhere else.
 *
 * A method or an action keeps its folder under its `%LANGUAGE` line (the member cases at the end of this file). A property
 * and an interface member have no body line to stand it under, so the writer closes their DECLARATION with it
 * (`StWriter.AssembleProperty`, `AssembleChild`) and the push peels exactly that last line back into the folder
 * (`StReader.PeelFolderClosing`). A `%FOLDER` line anywhere else in a declaration the push refuses by name
 * (`RefuseLinesInDeclarations`): it would be written into the IDE as code.
 *
 * The parser used to skip every `%FOLDER` line it met in these places, so the folder never reached the AST — and the
 * formatter, which prints from the AST, deleted it; the next push then moved the member to the POU's root.
 */
import { expect, test } from "bun:test"
import { type BodySpan, isPlainStNetworkBody, parseSource, bodyStatements, unitBodies } from "../index.js"

const FB = "FUNCTION_BLOCK F\nVAR\n\tx : INT;\nEND_VAR\n%LANGUAGE ST\nx := 1;\nEND_FUNCTION_BLOCK\n\n"

const folderErrors = (src: string) => parseSource(src, { networkText: true }, "codesys").errors.filter((e) => e.message.includes("%FOLDER"))

test("a property's folder is the last line of its declaration", () => {
  for (const [what, src] of Object.entries({
    "before GET": `${FB}PROPERTY P : INT\n%FOLDER sub/dir\nGET\n%LANGUAGE ST\nP := x;\nEND_GET\nEND_PROPERTY\n`,
    "a blank line after it": `${FB}PROPERTY PUBLIC P : INT\n%FOLDER  sub/dir \n\nSET\n%LANGUAGE ST\nx := P;\nEND_SET\nEND_PROPERTY\n`,
    "no accessor": `${FB}PROPERTY P : INT\n%FOLDER sub/dir\nEND_PROPERTY\n`,
  })) {
    const pr = parseSource(src, { networkText: true }, "codesys")
    expect({ what, errors: pr.errors }).toEqual({ what, errors: [] })
    const p = pr.units.find((u) => u.kind === "property")
    expect({ what, folder: p?.kind === "property" ? p.folder : "no property" }).toEqual({ what, folder: "sub/dir" })
  }
})

test("an interface method's folder is the line before END_METHOD, an interface property's the last before its accessors", () => {
  const src =
    "INTERFACE I\n\nMETHOD PUBLIC M : BOOL\nVAR_INPUT\n\ta : INT;\nEND_VAR\n%FOLDER Commands\nEND_METHOD\n\n" +
    "METHOD Bare\n%FOLDER Other\nEND_METHOD\n\n" +
    "PROPERTY PUBLIC Q : INT\n%FOLDER Props\nGET\nEND_GET\nEND_PROPERTY\n\nEND_INTERFACE\n"
  const pr = parseSource(src, { networkText: true }, "codesys")
  expect(pr.errors).toEqual([])
  const itf = pr.units[0]
  if (itf?.kind !== "interface") throw new Error("expected an interface")
  expect(itf.methods.map((m) => [m.name.text, m.folder, m.modifiers])).toEqual([
    ["M", "Commands", ["PUBLIC"]],
    ["Bare", "Other", []],
  ])
  expect(itf.properties.map((p) => [p.name.text, p.folder, p.modifiers])).toEqual([["Q", "Props", ["PUBLIC"]]])
})

test("a %FOLDER line anywhere the push does not peel it is reported, as the push refuses it", () => {
  const misplaced = {
    "a property's, with a comment after it": `${FB}PROPERTY P : INT\n%FOLDER sub\n(* note *)\nGET\nEND_GET\nEND_PROPERTY\n`,
    "a property's, between its accessors": `${FB}PROPERTY P : INT\nGET\nEND_GET\n%FOLDER sub\nSET\nEND_SET\nEND_PROPERTY\n`,
    "a property's, twice": `${FB}PROPERTY P : INT\n%FOLDER a\n%FOLDER b\nGET\nEND_GET\nEND_PROPERTY\n`,
    "a property's, another case": `${FB}PROPERTY P : INT\n%folder sub\nGET\nEND_GET\nEND_PROPERTY\n`,
    "a property's, no path": `${FB}PROPERTY P : INT\n%FOLDER\nGET\nEND_GET\nEND_PROPERTY\n`,
    "a property's, after its header on one line": `${FB}PROPERTY P : INT %FOLDER sub\nGET\nEND_GET\nEND_PROPERTY\n`,
    "an interface method's, with a comment after it": "INTERFACE I\nMETHOD M : BOOL\n%FOLDER a\n// note\nEND_METHOD\nEND_INTERFACE\n",
    "between interface members": "INTERFACE I\nMETHOD M : BOOL\nEND_METHOD\n%FOLDER a\nMETHOD N : BOOL\nEND_METHOD\nEND_INTERFACE\n",
    "inside an interface accessor": "INTERFACE I\nPROPERTY Q : INT\nGET\n%FOLDER a\nEND_GET\nEND_PROPERTY\nEND_INTERFACE\n",
    "at file scope": `${FB}%FOLDER a\nMETHOD M\n%LANGUAGE ST\nx := 2;\nEND_METHOD\n`,
  }
  for (const [where, src] of Object.entries(misplaced))
    expect({ where, reported: folderErrors(src).length }).toEqual({ where, reported: 1 })
})

// ── a METHOD's or an ACTION's folder, under its %LANGUAGE line (rule FMT5) ─────────────────────────

/** A function block whose body is `impl` — its boundary line and what follows it. */
const fb = (impl: string): string =>
  `FUNCTION_BLOCK F\nVAR\n\ta : BOOL;\n\tout : BOOL;\nEND_VAR\n${impl}\nEND_FUNCTION_BLOCK\n`

/** Every syntax error of a file: its declarations' (the top-level parse) and each ST body's, as the `parse-errors`
 *  check drains them. A graphical body is the network parser's. */
function syntaxErrors(src: string): string[] {
  const parsed = parseSource(src, { networkText: true }, "codesys")
  const bodies = parsed.units.flatMap(unitBodies).filter((b) => !isPlainStNetworkBody(b))
  return [...parsed.errors, ...bodies.flatMap((b) => bodyStatements(b).errors)].map((e) => e.message)
}

const bodiesOf = (src: string): BodySpan[] => parseSource(src, { networkText: true }, "codesys").units.flatMap(unitBodies)

test("a member's %FOLDER is read where the push peels it, and nowhere else — elsewhere it is code the IDE would get", () => {
  // The push (`StReader.PeelFolderUnder`) takes `%FOLDER ` — that spelling, case and all, with a path — off the FIRST
  // line under a METHOD's or an ACTION's line, and nowhere else: a POU's own body and a property accessor have no
  // folder there, and a blank line or a comment above the directive leaves it in the body. Wherever the push leaves
  // it, it is pushed into the IDE as ST statement text — so the LSP reads it as the body's, and does not hide it.
  for (const [member, end] of [["METHOD M", "END_METHOD"], ["ACTION A", "END_ACTION"]] as const) {
    const src = `${fb("%LANGUAGE ST\n")}\n${member}\n%LANGUAGE ST\n%FOLDER  Sub/Deep \nout := a;\n${end}\n`
    expect({ member, errors: syntaxErrors(src) }).toEqual({ member, errors: [] })
    expect({ member, folder: bodiesOf(src)[1]!.languageLine?.folder }).toEqual({ member, folder: "Sub/Deep" })
  }
  const left = {
    "a POU's own body": "PROGRAM PRG\nVAR\n\tx : INT;\nEND_VAR\n%LANGUAGE ST\n%FOLDER Sub\nx := 1;\nEND_PROGRAM\n",
    "a property accessor": `${fb("%LANGUAGE ST\n")}\nPROPERTY P : INT\nGET\n%LANGUAGE ST\n%FOLDER Sub\nP := 1;\nEND_GET\nEND_PROPERTY\n`,
    "another case": `${fb("%LANGUAGE ST\n")}\nMETHOD M\n%LANGUAGE ST\n%folder Sub\nout := a;\nEND_METHOD\n`,
    "a blank line above it": `${fb("%LANGUAGE ST\n")}\nMETHOD M\n%LANGUAGE ST\n\n%FOLDER Sub\nout := a;\nEND_METHOD\n`,
    "a comment above it": `${fb("%LANGUAGE ST\n")}\nMETHOD M\n%LANGUAGE ST\n(* note *)\n%FOLDER Sub\nout := a;\nEND_METHOD\n`,
    "no path": `${fb("%LANGUAGE ST\n")}\nMETHOD M\n%LANGUAGE ST\n%FOLDER\nout := a;\nEND_METHOD\n`,
  }
  for (const [where, src] of Object.entries(left)) {
    const body = bodiesOf(src).at(-1)!
    expect({ where, folder: body.languageLine?.folder, inBody: body.tokens.some((t) => t.text === "%") }).toEqual({
      where,
      folder: undefined,
      inBody: true,
    })
    expect({ where, reported: syntaxErrors(src).length > 0 }).toEqual({ where, reported: true })
  }
})

// ── every other %-line: the object's properties (openspec bridge-one-to-one §1.2) ─────────────────────────

const parsed = (src: string) => parseSource(src, { networkText: true }, "codesys")

test("a POU's, a member's, a DUT's, a GVL's, an interface's and a property's %-lines are read where the push peels them", () => {
  const pou = parsed(
    "FUNCTION_BLOCK F\nVAR\n\tx : INT;\nEND_VAR\n%LANGUAGE ST\n%EXCLUDE_FROM_BUILD\n%COMMENT 'it$'s'\nx := 1;\nEND_FUNCTION_BLOCK\n\n" +
      "METHOD M\n%LANGUAGE ST\n%CLASS CHECK CheckBounds\n%FOLDER Sub\n%LINK_ALWAYS\nx := 2;\nEND_METHOD\n",
  )
  expect(syntaxErrors(
    "FUNCTION_BLOCK F\nVAR\n\tx : INT;\nEND_VAR\n%LANGUAGE ST\n%EXCLUDE_FROM_BUILD\nx := 1;\nEND_FUNCTION_BLOCK\n",
  )).toEqual([])
  expect(pou.errors).toEqual([])
  const [fbBody, mBody] = pou.units.flatMap(unitBodies)
  expect(fbBody!.languageLine?.objectProperties).toEqual(["%EXCLUDE_FROM_BUILD", "%COMMENT 'it$'s'"])
  expect([mBody!.languageLine?.folder, mBody!.languageLine?.objectProperties]).toEqual([
    "Sub",
    ["%CLASS CHECK CheckBounds", "%LINK_ALWAYS"],
  ])

  const dut = parsed("TYPE E :\n(\n\ta,\n\tb\n);\nEND_TYPE\n%CLASS TEXTLIST_ENUM\n")
  expect(dut.errors).toEqual([])
  expect(dut.units[0]!.kind === "type_decl" && dut.units[0]!.objectProperties).toEqual(["%CLASS TEXTLIST_ENUM"])

  const gvl = parsed("VAR_GLOBAL\n\tg : INT;\nEND_VAR\n%CLASS PERSISTENT\n%NETVAR Pack: 1\n%NETVAR Cycle: ''\n")
  expect(gvl.errors).toEqual([])
  expect(gvl.units[0]!.kind === "global_var_list" && gvl.units[0]!.objectProperties).toEqual([
    "%CLASS PERSISTENT",
    "%NETVAR Pack: 1",
    "%NETVAR Cycle: ''",
  ])

  const itf = parsed("INTERFACE I\n%EXCLUDE_FROM_BUILD\nMETHOD M : BOOL\n%FOLDER A\n%EXTERNAL\nEND_METHOD\nEND_INTERFACE\n")
  expect(itf.errors).toEqual([])
  const i = itf.units[0]
  if (i?.kind !== "interface") throw new Error("expected an interface")
  expect([i.objectProperties, i.methods[0]!.folder, i.methods[0]!.objectProperties]).toEqual([
    ["%EXCLUDE_FROM_BUILD"],
    "A",
    ["%EXTERNAL"],
  ])

  const prop = parsed(`${FB}PROPERTY P : INT\n%FOLDER sub\n%ONLINE_CHANGE_RESERVE 64\nGET\n%LANGUAGE ST\nP := x;\nEND_GET\nEND_PROPERTY\n`)
  expect(prop.errors).toEqual([])
  const p = prop.units.find((u) => u.kind === "property")
  expect(p?.kind === "property" && [p.folder, p.objectProperties]).toEqual(["sub", ["%ONLINE_CHANGE_RESERVE 64"]])
})

test("a %-line the push refuses is reported on its line: order, repeat, flag value, missing value, value grammar", () => {
  const dut = (lines: string) => parsed(`TYPE E :\n(\n\ta\n);\nEND_TYPE\n${lines}`).errors.map((e) => e.message)
  const refused: Record<string, [string, string]> = {
    order: ["%LINK_ALWAYS\n%EXCLUDE_FROM_BUILD\n", "stands after '%LINK_ALWAYS'"],
    repeat: ["%EXTERNAL\n%EXTERNAL\n", "is written twice"],
    "flag value": ["%EXTERNAL yes\n", "is a flag and takes no value"],
    "missing value": ["%COMMENT\n", "takes a value"],
    "class word": ["%CLASS NOPE\n", "%CLASS names one of"],
    "check without its check": ["%CLASS CHECK\n", "names the check it is"],
    reserve: ["%ONLINE_CHANGE_RESERVE -1\n", "positive whole number"],
    "bare string": ["%COMMENT hello\n", "takes an ST string"],
    "bad escape": ["%COMMENT 'a$q'\n", "is no ST string escape"],
    "empty comment": ["%COMMENT ''\n", "is its absence"],
    netvar: ["%NETVAR 1\n", "%NETVAR <member>: <value>"],
    "file link": ["%FILE_LINK 'p'\n", "%FILE_LINK <link type> '<path>'"],
    "a DUT's folder": ["%FOLDER x\n", "stands only in a member's block"],
  }
  for (const [what, [lines, says]] of Object.entries(refused)) {
    const errors = dut(lines)
    expect({ what, reported: errors.length === 1 && errors[0]!.includes(says) }).toEqual({ what, reported: true })
  }
  expect(dut("%UNDEFINE 'A'\n%UNDEFINE 'B'\n%COMMENT 'x$N$27$$'\n%FILE_LINK Auto 'C:\a.txt'\n")).toEqual([])
})

/** A space or a tab separates the words of a %-line — the key from its value and a value's words from each other — as
 *  the push reads it (`PropertyLines.KeyEnd`). */
test("a tab separates a value's words as a space does", () => {
  const dut = (lines: string) => parsed(`TYPE E :\n(\n\ta\n);\nEND_TYPE\n${lines}`).errors.map((e) => e.message)
  for (const line of ["%CLASS\tCHECK CheckBounds", "%CLASS CHECK\tCheckBounds", "%CLASS CHECK \t CheckBounds", "%FILE_LINK Auto\t'C:\\a.txt'"])
    expect({ line, errors: dut(`${line}\n`) }).toEqual({ line, errors: [] })
})

test("a %-line that is no property is code, and one where the push peels none is reported", () => {
  // `%QB1` is a direct address the lexer reads as one token; `%class` and `%CLASSIC` are no closed key — code the IDE gets
  for (const code of ["%QB1 := TRUE;", "%class := 1;"]) {
    const body = bodiesOf(fb(`%LANGUAGE ST\n${code}`))[0]!
    expect({ code, props: body.languageLine?.objectProperties }).toEqual({ code, props: undefined })
  }
  const misplaced = {
    "a DUT's, before its end": "TYPE E :\n(\n\ta\n);\nEND_TYPE\n%EXTERNAL\nTYPE F :\n(\n\tb\n);\nEND_TYPE\n",
    "a POU's, at file scope": `${FB}%EXTERNAL\n`,
    "an interface's, after a member": "INTERFACE I\nMETHOD M : BOOL\nEND_METHOD\n%EXTERNAL\nEND_INTERFACE\n",
    "an accessor's declaration": "INTERFACE I\nPROPERTY Q : INT\nGET\n%EXTERNAL\nEND_GET\nEND_PROPERTY\nEND_INTERFACE\n",
  }
  for (const [where, src] of Object.entries(misplaced))
    expect({ where, reported: parsed(src).errors.filter((e) => e.message.includes("is no property")).length }).toEqual({
      where,
      reported: 1,
    })
  // a POU's own body peels no %FOLDER, and an accessor peels nothing: left as code
  const accessor = bodiesOf(`${FB}PROPERTY P : INT\nGET\n%LANGUAGE ST\n%EXTERNAL\nP := 1;\nEND_GET\nEND_PROPERTY\n`).at(-1)!
  expect(accessor.languageLine?.objectProperties).toBeUndefined()
})
