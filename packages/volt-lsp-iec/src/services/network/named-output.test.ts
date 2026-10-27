/**
 * `inst : TYPE(…).name` reads as the instance's output (`inst.name`) AND as its call, so the instance spelled once in the
 * text is two expressions — a rename and the references must still edit / find it once.
 */
import { expect, test } from "bun:test"
import { parseSource } from "../../frontend/syntax/index.js"
import { build } from "../../frontend/symbols/index.js"
import { referencesAnywhere, renameAnywhere } from "./index.js"

const FB = `FUNCTION_BLOCK Capture
VAR_INPUT xEnable : BOOL; END_VAR
VAR_OUTPUT xBusy : BOOL; tElapsed : TIME; END_VAR
%LANGUAGE ST
xBusy := xEnable;
END_FUNCTION_BLOCK
`
const PRG = `PROGRAM P
VAR cap : Capture; go : BOOL; elapsed : TIME; END_VAR
%LANGUAGE FBD
NETWORK
  elapsed := cap : Capture(xEnable := go).tElapsed;
END_NETWORK
END_PROGRAM
`

function project() {
  const docs = [
    { uri: "file:///Capture.pou", source: FB },
    { uri: "file:///P.pou", source: PRG },
  ].map((d) => ({ ...d, parseResult: parseSource(d.source, { networkText: true }, "codesys") }))
  return { docs, scope: build.buildSymbolTable(docs, [], "codesys"), prg: docs[1] }
}

test("the instance of a named-output call is renamed once", () => {
  const { docs, scope, prg } = project()
  const at = prg.source.indexOf("cap :")
  const edits = renameAnywhere(docs, scope, prg, at, "fbCap")?.changes?.["file:///P.pou"] ?? []
  // the declaration and the one use in the network — each once
  expect(edits.map((e) => e.newText)).toEqual(["fbCap", "fbCap"])
  expect(new Set(edits.map((e) => `${e.range.start.line}:${e.range.start.character}`)).size).toBe(2)
})

test("the named output is the FB's output: its references reach the declaration", () => {
  const { docs, scope, prg } = project()
  const locs = referencesAnywhere(docs, scope, prg, prg.source.indexOf("tElapsed"))
  expect(locs?.map((l) => l.uri).sort()).toEqual(["file:///Capture.pou", "file:///P.pou"])
})
