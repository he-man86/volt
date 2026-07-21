import { test, expect } from "bun:test"
import { WorkspaceStore } from "./workspace-store.js"
import { documentDiagnostics } from "./diagnostics.js"
import { resolveConfig, messagesFor } from "../analysis/index.js"

/**
 * Read-only library content (materialized signatures under `Library Manager/`, incl. visualization elements)
 * gets NO diagnostics — the user can't edit it, so its errors are un-actionable noise. But it stays in the
 * symbol table, so USING a library FB in project logic still resolves fully. `diagnoseDeadCode: true` here
 * disables dead-code suppression so these assertions isolate the library-uri skip.
 */
const store = () => new WorkspaceStore(resolveConfig({ vendor: "codesys", diagnoseDeadCode: true }))
const msgs = messagesFor("codesys")
const diag = (s: WorkspaceStore, uri: string) => documentDiagnostics(s, msgs, s.doc(uri)!).map((d) => d.message)

test("a read-only library document emits NO diagnostics (even with a real error in it)", () => {
  const s = store()
  const uri = "file:///C:/proj/src/Application/Library%20Manager/Util/G.fb"
  s.seedDisk([{ uri, source: `FUNCTION_BLOCK G\nVAR b : INT; END_VAR\nb := nope;\nEND_FUNCTION_BLOCK` }])
  expect(diag(s, uri)).toEqual([])
})

test("a project (editable) document is still fully checked", () => {
  const s = store()
  const uri = "file:///C:/proj/src/Main/F.fb"
  s.seedDisk([{ uri, source: `FUNCTION_BLOCK F\nVAR a : INT; END_VAR\na := nope;\nEND_FUNCTION_BLOCK` }])
  expect(diag(s, uri)).toEqual(["Identifier 'nope' not defined"])
})

test("a library FB stays usable in project logic — its symbol is bound, only its file is silent", () => {
  const s = store()
  const libUri = "file:///C:/proj/src/Application/Library%20Manager/Util/BLINK.fb"
  const userUri = "file:///C:/proj/src/Main/M.prg"
  s.seedDisk([
    { uri: libUri, source: `FUNCTION_BLOCK BLINK\nVAR_OUTPUT OUT : BOOL; END_VAR\nEND_FUNCTION_BLOCK\n\nMETHOD Reset : BOOL\nEND_METHOD` },
    { uri: userUri, source: `PROGRAM M\nVAR blk : BLINK; ok : BOOL; END_VAR\nok := blk.OUT;\nok := blk.Reset();\nEND_PROGRAM` },
  ])
  expect(diag(s, userUri)).toEqual([]) // library FB + its method + pin all resolve in user code
  expect(diag(s, libUri)).toEqual([]) // the library file itself is silent
})
