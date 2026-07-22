import { test, expect } from "bun:test"
import { WorkspaceStore } from "./workspace-store.js"
import { resolveConfig, deadPous, deadMemberSpans } from "../analysis/index.js"
import { fileReachInfo } from "../analysis/index.js"
import { parseSource } from "../syntax/index.js"

// A tiny multi-POU project: MAIN (task root) calls A; B is dead; A has a called + an uncalled method.
const FILES = (aBody: string): { uri: string; source: string }[] => [
  { uri: "file:///P.prg", source: `PROGRAM PLC_PRG\nVAR a : A; END_VAR\na.Run();\nEND_PROGRAM` },
  { uri: "file:///A.fb", source: `FUNCTION_BLOCK A\n${aBody}\nEND_FUNCTION_BLOCK\nMETHOD Run\n;\nEND_METHOD\nMETHOD Unused\n;\nEND_METHOD` },
  { uri: "file:///B.fb", source: `FUNCTION_BLOCK B\nEND_FUNCTION_BLOCK` },
]
const freshDead = (files: { uri: string; source: string }[]) => {
  const inputs = files.map((f) => ({ uri: f.uri, source: f.source, parseResult: parseSource(f.source) }))
  return { dead: [...deadPous(inputs, undefined)].sort(), members: deadMemberSpans(inputs, deadPous(inputs, undefined)).size }
}
const storeDead = (store: WorkspaceStore) => ({ dead: [...store.deadSet()].sort(), members: store.deadMembers().size })

test("cached dead == fresh dead across edit types (whitespace, add-call, revert)", () => {
  const store = new WorkspaceStore(resolveConfig({ vendor: "codesys" }))
  const files = FILES("VAR x : INT; END_VAR")
  store.seedDisk(files)
  store.project()
  store.openDocument("file:///A.fb", "iecst", 1, files[1]!.source)
  // baseline
  expect(storeDead(store)).toEqual(freshDead(files))

  // 1. whitespace edit inside A's body — reachability unchanged; cache MUST hold and stay correct
  const ws = files[1]!.source.replace("VAR x : INT;", "VAR x : INT;  ")
  store.changeDocument("file:///A.fb", 2, [{ text: ws }])
  expect(storeDead(store)).toEqual(freshDead([files[0]!, { uri: "file:///A.fb", source: ws }, files[2]!]))

  // 2. add a call to the previously-uncalled method Unused — dead MEMBERS must change
  const call = files[1]!.source.replace("VAR x : INT; END_VAR", "VAR x : INT; END_VAR\nUnused();")
  store.changeDocument("file:///A.fb", 3, [{ text: call }])
  const s2 = storeDead(store), f2 = freshDead([files[0]!, { uri: "file:///A.fb", source: call }, files[2]!])
  expect(s2).toEqual(f2)

  // 3. add a call to the dead FB B — dead POUS must change (B no longer dead)
  const callB = call.replace("Unused();", "Unused();\nVAR_INST b : B; END_VAR\nb();")
  store.changeDocument("file:///A.fb", 4, [{ text: callB }])
  expect(storeDead(store)).toEqual(freshDead([files[0]!, { uri: "file:///A.fb", source: callB }, files[2]!]))

  // 4. revert to baseline — dead set must return to baseline
  store.changeDocument("file:///A.fb", 5, [{ text: files[1]!.source }])
  expect(storeDead(store)).toEqual(freshDead(files))
})
