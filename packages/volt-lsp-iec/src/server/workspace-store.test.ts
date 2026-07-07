/**
 * WorkspaceStore — the parse cache and the disk⊕open merge in isolation (the protocol path is covered by
 * server.test.ts). The cache is the thing that stops the pre-extraction closure's double-parse per request.
 */
import { test, expect } from "bun:test"
import { resolveConfig } from "../analysis/index.js"
import { WorkspaceStore } from "./workspace-store.js"

const cfg = () => resolveConfig({ vendor: "codesys" })
const URI = "file:///F.fb"
const SRC = `FUNCTION_BLOCK F\nVAR i : INT; END_VAR\ni := i + 1;\nEND_FUNCTION_BLOCK`

test("store: an open document is parsed once per version (cached parseResult identity)", () => {
  const store = new WorkspaceStore(cfg())
  store.openDocument(URI, "iecst", 1, SRC)
  const a = store.doc(URI)!
  const b = store.doc(URI)!
  expect(a.parseResult).toBe(b.parseResult) // same object → not reparsed

  // Editing bumps the version → a fresh parse, distinct identity.
  store.changeDocument(URI, 2, [{ text: SRC.replace("i", "j") }])
  const c = store.doc(URI)!
  expect(c.parseResult).not.toBe(a.parseResult)
})

test("store: an open buffer overrides its disk entry (open wins), close leaves disk intact", () => {
  const store = new WorkspaceStore(cfg())
  store.seedDisk([{ uri: URI, source: SRC }])
  const disk = store.doc(URI)!
  store.openDocument(URI, "iecst", 1, SRC.replace("INT", "DINT"))
  expect(store.doc(URI)!.source).toContain("DINT") // buffer wins
  store.closeDocument(URI)
  expect(store.doc(URI)!.source).toBe(disk.source) // disk survives the close
})

test("store: disk and open for the same URI yield one merged entry", () => {
  const store = new WorkspaceStore(cfg())
  store.seedDisk([{ uri: URI, source: SRC }])
  store.openDocument(URI, "iecst", 1, SRC)
  expect(store.workspace().length).toBe(1) // not duplicated across the two layers
})
