/**
 * The override chain a rename follows (openspec lsp-quick-fixes design.md §6 B6, tasks.md 2.4): a rename renames every
 * member of the chain, and one whose chain reaches a library member is refused by name.
 */
import { expect, test } from "bun:test"
import { parseSource } from "../../frontend/syntax/index.js"
import { build } from "../../frontend/symbols/index.js"
import { overrideChain } from "./override-chain.js"
import { prepareRenameAnywhere, renameAnywhere, renameChainRefusal } from "../network/network-services.js"
import type { Document } from "../shared/index.js"

function setupFiles(files: Record<string, string>) {
  const docs: Document[] = Object.entries(files).map(([uri, source]) => ({ uri, source, parseResult: parseSource(source, { networkText: true }, "codesys") }))
  const project = build.buildSymbolTable(docs.map((d) => ({ uri: d.uri, parseResult: d.parseResult, source: d.source })), [], "codesys")
  return { docs, project }
}
const at = (src: string, needle: string) => src.indexOf(needle) + 1

const CHAIN = `INTERFACE I_Do
METHOD Act : BOOL
END_METHOD
END_INTERFACE
FUNCTION_BLOCK FB_Base IMPLEMENTS I_Do
END_FUNCTION_BLOCK
METHOD Act : BOOL
Act := TRUE;
END_METHOD
FUNCTION_BLOCK FB_Child EXTENDS FB_Base
VAR
\tok : BOOL;
END_VAR
%LANGUAGE ST
ok := Act();
END_FUNCTION_BLOCK
METHOD Act : BOOL
Act := FALSE;
END_METHOD
`

test("B6: renaming a method renames its override chain — the base's, the interface's, the derived override", () => {
  const { docs, project } = setupFiles({ "file:///chain.pou": CHAIN })
  const doc = docs[0]!
  const offset = at(CHAIN, "Act : BOOL\nEND_METHOD\nEND_INTERFACE")
  expect(renameChainRefusal(doc, project, offset)).toBeUndefined()
  const edit = renameAnywhere(docs, project, doc, offset, "Perform")!
  const lines = (edit.changes!["file:///chain.pou"] ?? []).map((e) => e.range.start.line).sort((a, b) => a - b)
  // the interface's METHOD, the base's and the child's declaration, and the child's call
  const lineOf = (needle: string, from = 0) => CHAIN.slice(0, CHAIN.indexOf(needle, from)).split("\n").length - 1
  expect(lines).toEqual(expect.arrayContaining([lineOf("METHOD Act"), lineOf("ok := Act()")]))
  expect(lines.filter((l) => CHAIN.split("\n")[l]!.startsWith("METHOD Act")).length).toBe(3)
})

test("B6: a rename whose chain reaches a LIBRARY member is refused by name", () => {
  const lib = "INTERFACE I_Lib\nMETHOD Act : BOOL\nEND_METHOD\nEND_INTERFACE\n"
  const own = "FUNCTION_BLOCK FB_Own IMPLEMENTS I_Lib\nEND_FUNCTION_BLOCK\nMETHOD Act : BOOL\nAct := TRUE;\nEND_METHOD\n"
  const { docs, project } = setupFiles({ "file:///w/Library%20Manager/Lib/1.0/I_Lib.itf": lib, "file:///w/FB_Own.pou": own })
  const doc = docs[1]!
  const offset = at(own, "Act : BOOL")
  expect(overrideChain(project, project.children.flatMap((c) => c.symbols.get("act") ?? []).find((s) => s.uri === doc.uri)!).length).toBe(2)
  expect(renameChainRefusal(doc, project, offset)).toContain("'I_Lib.Act'")
  expect(prepareRenameAnywhere(doc, project, offset)).toBeDefined() // the cursor itself is renameable; the chain refuses
  expect(renameAnywhere(docs, project, doc, offset, "Perform")).toBeUndefined()
})
