/**
 * The `DiagnosticsPublisher` (`diagnostics-publisher.ts`) over a real `WorkspaceStore` and a recording connection: the
 * `indexed` gate, the generation cache, resultIds and `unchanged`, versions, the push re-publish that skips what did
 * not move, and the manifest set. The protocol-level questions (ten idle pulls, an edit, push mode over a workspace)
 * are `test/lsp/diagnostics-pull.test.ts`'s.
 */
import { expect, test } from "bun:test"
import type { Diagnostic, ProtocolConnection, PublishDiagnosticsParams } from "vscode-languageserver-protocol/node"
import { resolveConfig } from "../analysis/index.js"
import { parseLibraryManifest } from "../frontend/library/index.js"
import { WorkspaceStore } from "../workspace/workspace-store.js"
import { failLoud } from "../../test/support/fail-loud.js"
import { NETWORK_TEXT_ENABLED } from "./config.js"
import { DiagnosticsPublisher, type PublisherHost } from "./diagnostics-publisher.js"

const PRG = (name: string, body = "i := i + 1;") =>
  `PROGRAM ${name}\nVAR\n\tb : BOOL;\n\ti : INT;\nEND_VAR\n%LANGUAGE ST\n${body}\nEND_PROGRAM\n`
const A = "file:///PA.pou"
const B = "file:///PB.pou"

/** A publisher over a store holding PA and PB on disk, with every publish it sends recorded. */
function setup(options: { indexed?: boolean; pull?: boolean } = {}) {
  const store = new WorkspaceStore(resolveConfig({ vendor: "codesys" }), { networkText: NETWORK_TEXT_ENABLED }, failLoud)
  store.seedDisk([
    { uri: A, source: PRG("PA") },
    { uri: B, source: PRG("PB") },
  ])
  const sent: PublishDiagnosticsParams[] = []
  const conn = { sendNotification: async (_type: unknown, p: PublishDiagnosticsParams) => void sent.push(p) }
  const host: PublisherHost = {
    conn: conn as unknown as ProtocolConnection,
    store,
    indexed: options.indexed ?? true,
    clientSupportsPull: options.pull ?? true,
    log: () => {},
  }
  return { store, sent, publisher: new DiagnosticsPublisher(host) }
}
const codes = (items: Diagnostic[]) => items.map((d) => d.code)

test("before the crawl: `full []` with no resultId, for a document and for the workspace", () => {
  const { publisher } = setup({ indexed: false })
  expect(publisher.documentReport(A, undefined)).toEqual({ kind: "full", items: [] })
  expect(publisher.workspaceReport([])).toEqual({ items: [] })
})

test("a resultId sent back answers `unchanged`; another answers `full` with the same resultId", () => {
  const { publisher } = setup()
  const first = publisher.documentReport(A, undefined)
  expect(first.kind).toBe("full")
  const id = first.kind === "full" ? first.resultId : undefined
  expect(publisher.documentReport(A, id)).toEqual({ kind: "unchanged", resultId: id! })
  expect(publisher.documentReport(A, "stale")).toMatchObject({ kind: "full", resultId: id })
})

test("an edit that moves one document's findings changes its resultId and no other's", () => {
  const { store, publisher } = setup()
  const ids = () => new Map(publisher.workspaceReport([]).items.map((r) => [r.uri, r.resultId]))
  const before = ids()
  store.openDocument(A, "iecst", 2, PRG("PA", "i := b;"))
  const after = ids()
  expect(after.get(A)).not.toBe(before.get(A))
  expect(after.get(B)).toBe(before.get(B))
  const report = publisher.workspaceReport([...before].map(([uri, value]) => ({ uri, value: value! })))
  expect(report.items.map((r) => [r.uri, r.kind, r.version]).sort()).toEqual([
    [A, "full", 2],
    [B, "unchanged", null],
  ])
})

test("push mode: `push` always sends, with the buffer's version; `republish` skips what did not move", () => {
  const { store, sent, publisher } = setup({ pull: false })
  store.openDocument(A, "iecst", 3, PRG("PA", "i := b;"))
  store.openDocument(B, "iecst", 1, PRG("PB"))
  publisher.push(A)
  publisher.push(A)
  expect(sent.map((p) => [p.uri, p.version, codes(p.diagnostics)])).toEqual([
    [A, 3, ["C0032"]],
    [A, 3, ["C0032"]],
  ])
  sent.length = 0
  publisher.republish() // A was published as it is; B never was
  expect(sent.map((p) => p.uri)).toEqual([B])
  sent.length = 0
  publisher.republish() // nothing moved since the last sweep
  store.changeDocument(B, 2, [{ text: PRG("PB", "i := i + 2;") }]) // B's text moves, its findings do not
  publisher.republish()
  expect(sent).toEqual([])
  publisher.republish(true) // a config change: every open document, moved or not
  expect(sent.map((p) => p.uri).sort()).toEqual([A, B])
})

test("push mode: nothing is pushed before the crawl, and nothing to a pull client", () => {
  for (const options of [{ indexed: false, pull: false }, { indexed: true, pull: true }]) {
    const { sent, publisher } = setup(options)
    publisher.push(A)
    publisher.republish(true)
    expect(sent).toEqual([])
  }
})

test("a document that is gone is published empty, which clears it", () => {
  const { sent, publisher } = setup({ pull: false })
  publisher.push("file:///Gone.pou")
  expect(sent).toEqual([{ uri: "file:///Gone.pou", diagnostics: [] }])
})

test("a manifest an older Volt wrote is reported beside the documents, and cleared once it is brought up to date", () => {
  const { store, sent, publisher } = setup({ pull: false })
  // No MATERIALIZATION line: an older bridge wrote it.
  const text = "LIBRARY Old\nNAMESPACE Old\nRESOLUTION Old, 1.0.0.0 (x)\nPLACEHOLDER true\n"
  const manifest = parseLibraryManifest("/ws/Library Manager/Old/Old.library", text)!
  store.setRefs({ libraryManifests: [manifest], devices: [], applications: [] }, undefined)
  publisher.republish()
  expect(sent.map((p) => [p.uri.endsWith("Old.library"), codes(p.diagnostics)])).toEqual([[true, ["library-stale"]]])
  sent.length = 0
  store.setRefs({ libraryManifests: [], devices: [], applications: [] }, undefined)
  publisher.republish()
  expect(sent.map((p) => [p.uri.endsWith("Old.library"), p.diagnostics])).toEqual([[true, []]])
})
