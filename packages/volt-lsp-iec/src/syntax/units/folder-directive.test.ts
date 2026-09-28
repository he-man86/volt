/**
 * A PROPERTY'S AND AN INTERFACE MEMBER'S `%FOLDER` — read where the push reads it, and nowhere else.
 *
 * A method or an action keeps its folder under its `IMPLEMENTATION` line (`implementation-keyword.test.ts`). A property
 * and an interface member have no body line to stand it under, so the writer closes their DECLARATION with it
 * (`StWriter.AssembleProperty`, `AssembleChild`) and the push peels exactly that last line back into the folder
 * (`StReader.PeelFolderClosing`). A `%FOLDER` line anywhere else in a declaration the push refuses by name
 * (`RefuseLinesInDeclarations`): it would be written into the IDE as code.
 *
 * The parser used to skip every `%FOLDER` line it met in these places, so the folder never reached the AST — and the
 * formatter, which prints from the AST, deleted it; the next push then moved the member to the POU's root.
 */
import { expect, test } from "bun:test"
import { parseSource } from "../index.js"

const FB = "FUNCTION_BLOCK F\nVAR\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\nx := 1;\nEND_FUNCTION_BLOCK\n\n"

const folderErrors = (src: string) => parseSource(src).errors.filter((e) => e.message.includes("%FOLDER"))

test("a property's folder is the last line of its declaration", () => {
  for (const [what, src] of Object.entries({
    "before GET": `${FB}PROPERTY P : INT\n%FOLDER sub/dir\nGET\nIMPLEMENTATION ST\nP := x;\nEND_GET\nEND_PROPERTY\n`,
    "a blank line after it": `${FB}PROPERTY PUBLIC P : INT\n%FOLDER  sub/dir \n\nSET\nIMPLEMENTATION ST\nx := P;\nEND_SET\nEND_PROPERTY\n`,
    "no accessor": `${FB}PROPERTY P : INT\n%FOLDER sub/dir\nEND_PROPERTY\n`,
  })) {
    const pr = parseSource(src)
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
  const pr = parseSource(src)
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
    "at file scope": `${FB}%FOLDER a\nMETHOD M\nIMPLEMENTATION ST\nx := 2;\nEND_METHOD\n`,
  }
  for (const [where, src] of Object.entries(misplaced))
    expect({ where, reported: folderErrors(src).length }).toEqual({ where, reported: 1 })
})
