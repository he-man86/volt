/**
 * data-recursion (C0101): an FB/struct that (transitively) contains an instance of itself. A POINTER/REFERENCE
 * member breaks the cycle and is not flagged.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../test-uri.js"

const rec = (src: string): string[] => {
  const pr = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "data-recursion")
    .map((d) => d.message)
}

test("a direct self-member is flagged", () => {
  expect(rec(`FUNCTION_BLOCK FB1\nVAR sv : FB1; END_VAR\nEND_FUNCTION_BLOCK`)).toEqual(["Data recursion: FB1 -> FB1"])
})

test("an indirect cycle is flagged (each participating unit reports its own path)", () => {
  const src = `FUNCTION_BLOCK FB1\nVAR x : FB2; END_VAR\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK FB2\nVAR y : FB1; END_VAR\nEND_FUNCTION_BLOCK`
  expect(rec(src)).toEqual(["Data recursion: FB1 -> FB2 -> FB1", "Data recursion: FB2 -> FB1 -> FB2"])
})

test("a POINTER TO self does not nest — not flagged; an ARRAY OF self does", () => {
  expect(rec(`FUNCTION_BLOCK FB1\nVAR p : POINTER TO FB1; END_VAR\nEND_FUNCTION_BLOCK`)).toEqual([])
  expect(rec(`FUNCTION_BLOCK FB1\nVAR a : ARRAY[0..1] OF FB1; END_VAR\nEND_FUNCTION_BLOCK`)).toEqual([
    "Data recursion: FB1 -> FB1",
  ])
})

test("a self-referential struct is flagged; a non-recursive one is not", () => {
  expect(rec(`TYPE sv :\nSTRUCT\nself : sv;\nEND_STRUCT\nEND_TYPE`)).toEqual(["Data recursion: SV -> SV"])
  expect(rec(`TYPE sv :\nSTRUCT\nn : INT;\nEND_STRUCT\nEND_TYPE`)).toEqual([])
})

test("an EDIT that introduces a recursion is reported — the incremental re-index keeps the project Scope", () => {
  // The live LSP re-indexes an edit by unbinding the file and binding its new text into the SAME project Scope
  // (`WorkspaceStore`). The composition graph was memoized on the Scope alone, so it kept answering for the text
  // before the edit: a recursion typed in was never reported, one removed was reported forever.
  const cfg = resolveConfig({ vendor: "codesys" })
  const before = "FUNCTION_BLOCK FB1\nVAR n : INT; END_VAR\nEND_FUNCTION_BLOCK"
  const after = "FUNCTION_BLOCK FB1\nVAR sv : FB1; END_VAR\nEND_FUNCTION_BLOCK"
  const project = build.buildSymbolTable([{ uri: "F", parseResult: parseSource(before, { networkText: true }), source: before }])
  const check = (src: string) =>
    computeSemanticDiagnostics({ uri: "F", parseResult: parseSource(src, { networkText: true }), source: src, project, config: cfg }).filter((d) => d.code === "data-recursion").length
  expect(check(before)).toBe(0)
  build.unbindFile(project, "F")
  build.bindFile(project, { uri: "F", parseResult: parseSource(after, { networkText: true }), source: after })
  expect(check(after)).toBe(1)
})

test("a cycle across two files follows an edit to EITHER one — a rebound file's scopes are new, the other's are kept", () => {
  // The graph is read lazily, with each scope's member types cached by the Scope object (2026-10-01): an edit makes the
  // edited file's scopes anew and leaves the other file's in place, so the cache must answer for both halves correctly.
  const cfg = resolveConfig({ vendor: "codesys" })
  const a = "FUNCTION_BLOCK FB_A\nVAR b : FB_B; END_VAR\nEND_FUNCTION_BLOCK"
  const bCycle = "FUNCTION_BLOCK FB_B\nVAR a : FB_A; END_VAR\nEND_FUNCTION_BLOCK"
  const bFlat = "FUNCTION_BLOCK FB_B\nVAR a : POINTER TO FB_A; END_VAR\nEND_FUNCTION_BLOCK"
  const file = (uri: string, src: string) => ({ uri, source: src, parseResult: parseSource(src, { networkText: true }) })
  const project = build.buildSymbolTable([file("A", a), file("B", bFlat)])
  const fileA = file("A", a)
  const onA = () =>
    computeSemanticDiagnostics({ uri: uriFor(fileA.parseResult), parseResult: fileA.parseResult, source: a, project, config: cfg })
      .filter((d) => d.code === "data-recursion")
      .map((d) => d.message)
  expect(onA()).toEqual([])
  build.unbindFile(project, "B")
  build.bindFile(project, file("B", bCycle))
  build.relink(project)
  expect(onA()).toEqual(["Data recursion: FB_A -> FB_B -> FB_A"])
  build.unbindFile(project, "B")
  build.bindFile(project, file("B", bFlat))
  build.relink(project)
  expect(onA()).toEqual([])
})

test("two same-named types are ONE node, with both declarations' members as its edges", () => {
  // Two libraries may export the same name; the composition graph has always merged them under it, in project order.
  const cfg = resolveConfig({ vendor: "codesys" })
  const first = "TYPE sv :\nSTRUCT\nn : INT;\nEND_STRUCT\nEND_TYPE"
  const second = "TYPE SV :\nSTRUCT\nloop : sv;\nEND_STRUCT\nEND_TYPE"
  const pr = parseSource(first, { networkText: true })
  const project = build.buildSymbolTable([
    { uri: "1", parseResult: pr, source: first },
    { uri: "2", parseResult: parseSource(second, { networkText: true }), source: second },
  ])
  expect(
    computeSemanticDiagnostics({ uri: uriFor(pr), parseResult: pr, source: first, project, config: cfg })
      .filter((d) => d.code === "data-recursion")
      .map((d) => d.message),
  ).toEqual(["Data recursion: SV -> SV"])
})
