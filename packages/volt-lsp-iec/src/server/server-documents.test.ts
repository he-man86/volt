/**
 * The server's DOCUMENT and WORKSPACE handlers over the harness (`handlers/documents.ts`, `handlers/lifecycle.ts`): open,
 * change, close and save; the eager disk index and its freshness on watched-file events; the live configuration; the
 * diagnostics gated until the workspace is indexed.
 */
import { test, expect } from "bun:test"
import { writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  DefinitionRequest,
  DidChangeConfigurationNotification,
  DidChangeTextDocumentNotification,
  DidChangeWatchedFilesNotification,
  DocumentDiagnosticRequest,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  DidSaveTextDocumentNotification,
  FileChangeType,
  HoverRequest,
  InitializedNotification,
  InitializeRequest,
  PublishDiagnosticsNotification,
} from "vscode-languageserver-protocol/node"
import { connect, SRC, URI, openF, td, initInDir, tempWorkspace, PRG, ENUM } from "../../test/server/sources.js"

test("server: didChange re-parses; didClose clears diagnostics", async () => {
  const client = connect()
  await openF(client)
  // change the body so `count` becomes `total` — a hover on the old name no longer resolves
  await client.sendNotification(DidChangeTextDocumentNotification.type, {
    textDocument: { uri: URI, version: 2 },
    contentChanges: [{ text: SRC.replace(/count/g, "total") }],
  })
  const h = await client.sendRequest(HoverRequest.type, { ...td, position: { line: 4, character: 0 } })
  expect((h as { contents: { value: string } })?.contents.value).toContain("total")
  // close → server publishes empty diagnostics for the uri
  const cleared = new Promise<{ diagnostics: unknown[] }>((res) =>
    client.onNotification(PublishDiagnosticsNotification.type, (p) => {
      if (p.uri === URI) res(p)
    }),
  )
  await client.sendNotification(DidCloseTextDocumentNotification.type, { textDocument: { uri: URI } })
  expect((await cleared).diagnostics).toEqual([])
  client.dispose()
})

// ─── eager workspace index: cross-file resolution from disk + freshness on file events ──────────

/** The next PublishDiagnostics for `uri`. Register BEFORE the action that triggers the publish. */
function onceDiag(client: ReturnType<typeof connect>, uri: string): Promise<{ message: string }[]> {
  return new Promise((res) => {
    const d = client.onNotification(PublishDiagnosticsNotification.type, (p) => {
      if (p.uri === uri) {
        d.dispose()
        res(p.diagnostics as { message: string }[])
      }
    })
  })
}

const notDefined = (diags: { message: string }[], name: string) =>
  diags.some((x) => x.message === `Identifier '${name}' not defined`)

test("server: a type in an unopened sibling file resolves (eager disk index)", async () => {
  const dir = tempWorkspace({ "PLC_PRG.pou": PRG, "E_Mode.dut": ENUM })
  const client = connect()
  await initInDir(client, dir)
  const prgUri = pathToFileURL(join(dir, "PLC_PRG.pou")).href
  const diags = onceDiag(client, prgUri)
  // Open ONLY the referencing file; E_Mode lives in an unopened sibling on disk.
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: prgUri, languageId: "iecst", version: 1, text: PRG },
  })
  expect(notDefined(await diags, "E_Mode")).toBe(false)
  client.dispose()
  rmSync(dir, { recursive: true, force: true })
})

test("server: an open buffer overrides the on-disk version", async () => {
  // Disk declares E_Mode; the open buffer renames it away → the reference no longer resolves.
  const dir = tempWorkspace({ "E_Mode.dut": ENUM })
  const client = connect()
  await initInDir(client, dir)
  const uri = pathToFileURL(join(dir, "E_Mode.dut")).href
  const diags = onceDiag(client, uri)
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri, languageId: "iecst", version: 1, text: `TYPE E_Other : (Idle, Run); END_TYPE` },
  })
  await diags // just ensure the buffer is analyzed, not disk
  // Now a referencing file should NOT see E_Mode (the buffer shadows the disk decl).
  const prgUri = pathToFileURL(join(dir, "PLC_PRG.pou")).href
  const prgDiags = onceDiag(client, prgUri)
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: prgUri, languageId: "iecst", version: 1, text: PRG },
  })
  expect(notDefined(await prgDiags, "E_Mode")).toBe(true)
  client.dispose()
  rmSync(dir, { recursive: true, force: true })
})

test("server: a newly added file re-indexes on didChangeWatchedFiles (create)", async () => {
  const dir = tempWorkspace({ "PLC_PRG.pou": PRG }) // no E_Mode yet
  const client = connect()
  await initInDir(client, dir)
  const prgUri = pathToFileURL(join(dir, "PLC_PRG.pou")).href
  const before = onceDiag(client, prgUri)
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: prgUri, languageId: "iecst", version: 1, text: PRG },
  })
  expect(notDefined(await before, "E_Mode")).toBe(true) // unresolved until the enum lands

  const enumPath = join(dir, "E_Mode.dut")
  writeFileSync(enumPath, ENUM)
  const after = onceDiag(client, prgUri) // reindex re-publishes for open docs
  await client.sendNotification(DidChangeWatchedFilesNotification.type, {
    changes: [{ uri: pathToFileURL(enumPath).href, type: FileChangeType.Created }],
  })
  expect(notDefined(await after, "E_Mode")).toBe(false)
  client.dispose()
  rmSync(dir, { recursive: true, force: true })
})

test("server: a deleted file re-indexes on didChangeWatchedFiles (delete)", async () => {
  const dir = tempWorkspace({ "PLC_PRG.pou": PRG, "E_Mode.dut": ENUM })
  const client = connect()
  await initInDir(client, dir)
  const prgUri = pathToFileURL(join(dir, "PLC_PRG.pou")).href
  const before = onceDiag(client, prgUri)
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: prgUri, languageId: "iecst", version: 1, text: PRG },
  })
  expect(notDefined(await before, "E_Mode")).toBe(false)

  const enumPath = join(dir, "E_Mode.dut")
  rmSync(enumPath)
  const after = onceDiag(client, prgUri)
  await client.sendNotification(DidChangeWatchedFilesNotification.type, {
    changes: [{ uri: pathToFileURL(enumPath).href, type: FileChangeType.Deleted }],
  })
  expect(notDefined(await after, "E_Mode")).toBe(true)
  client.dispose()
  rmSync(dir, { recursive: true, force: true })
})

test("server: a closed declaring file stays indexed from disk", async () => {
  const dir = tempWorkspace({ "PLC_PRG.pou": PRG, "E_Mode.dut": ENUM })
  const client = connect()
  await initInDir(client, dir)
  const prgUri = pathToFileURL(join(dir, "PLC_PRG.pou")).href
  const enumUri = pathToFileURL(join(dir, "E_Mode.dut")).href
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: prgUri, languageId: "iecst", version: 1, text: PRG },
  })
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: enumUri, languageId: "iecst", version: 1, text: ENUM },
  })
  // Close the declaring file — its disk copy must keep E_Mode resolvable in PLC_PRG.
  await client.sendNotification(DidCloseTextDocumentNotification.type, { textDocument: { uri: enumUri } })
  const diags = onceDiag(client, prgUri)
  await client.sendNotification(DidChangeTextDocumentNotification.type, {
    textDocument: { uri: prgUri, version: 2 },
    contentChanges: [{ text: PRG }], // touch to force a re-publish
  })
  expect(notDefined(await diags, "E_Mode")).toBe(false)
  client.dispose()
  rmSync(dir, { recursive: true, force: true })
})

test("server: a file open AND on disk contributes its symbols once (definition is single)", async () => {
  const dir = tempWorkspace({ "PLC_PRG.pou": PRG, "E_Mode.dut": ENUM })
  const client = connect()
  await initInDir(client, dir)
  const prgUri = pathToFileURL(join(dir, "PLC_PRG.pou")).href
  const enumUri = pathToFileURL(join(dir, "E_Mode.dut")).href
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: prgUri, languageId: "iecst", version: 1, text: PRG },
  })
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: enumUri, languageId: "iecst", version: 1, text: ENUM },
  })
  const def = await client.sendRequest(DefinitionRequest.type, {
    textDocument: { uri: prgUri },
    position: { line: 2, character: 9 }, // the `E_Mode` type ref in `mode : E_Mode;`
  })
  // One declaration, not two — the merge keyed the open buffer and its disk file to one entry.
  const locations = Array.isArray(def) ? def : def ? [def] : []
  expect(locations.length).toBe(1)
  client.dispose()
  rmSync(dir, { recursive: true, force: true })
})

test("server: didSave re-publishes diagnostics for the saved document", async () => {
  const client = connect()
  await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
  const bad = `FUNCTION_BLOCK F\nVAR\n b : BOOL; i : INT;\nEND_VAR\nIMPLEMENTATION ST\ni := b;\nEND_FUNCTION_BLOCK`
  const first = onceDiag(client, URI)
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: URI, languageId: "iecst", version: 1, text: bad },
  })
  await first
  const onSave = onceDiag(client, URI)
  await client.sendNotification(DidSaveTextDocumentNotification.type, { textDocument: { uri: URI } })
  const diags = (await onSave) as { code?: unknown }[]
  expect(diags.some((d) => d.code === "C0032")).toBe(true)
  client.dispose()
})

test("server: didChangeConfiguration live-toggles diagnoseDeadCode (no restart)", async () => {
  const client = connect()
  const mainSrc = `PROGRAM Main\nIMPLEMENTATION ST\nx := 1;\nEND_PROGRAM`
  const deadSrc = `FUNCTION_BLOCK FB_Dead\nVAR b : BOOL; i : INT;\nEND_VAR\nIMPLEMENTATION ST\ni := b;\nEND_FUNCTION_BLOCK`
  const deadUri = "file:///FB_Dead.pou"
  await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
  const initial = onceDiag(client, deadUri)
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: "file:///Main.pou", languageId: "iecst", version: 1, text: mainSrc },
  })
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: deadUri, languageId: "iecst", version: 1, text: deadSrc },
  })
  expect(((await initial) as { code?: unknown }[]).some((d) => d.code === "C0032")).toBe(false) // suppressed
  const afterCfg = onceDiag(client, deadUri)
  await client.sendNotification(DidChangeConfigurationNotification.type, { settings: { diagnoseDeadCode: true } })
  expect(((await afterCfg) as { code?: unknown }[]).some((d) => d.code === "C0032")).toBe(true) // now emitted
  client.dispose()
})

test("server: diagnostics are GATED until the workspace is indexed (no startup false-error flicker)", async () => {
  // PLC_PRG references E_Mode, defined in a SIBLING file — resolvable ONLY after the cross-file crawl. Before the
  // crawl the store holds just the open buffer, so E_Mode reads as "not defined": exactly the false error the gate
  // must suppress. (Removing the gate makes the first pull below report that error and this test fails.)
  const dir = tempWorkspace({ "E_Mode.dut": ENUM, "PLC_PRG.pou": PRG })
  const prgUri = pathToFileURL(join(dir, "PLC_PRG.pou")).href
  const client = connect()
  await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: pathToFileURL(dir).href, capabilities: {} })
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: prgUri, languageId: "iecst", version: 1, text: PRG },
  })
  const pull = async () =>
    ((await client.sendRequest(DocumentDiagnosticRequest.type, { textDocument: { uri: prgUri } })) as { items: unknown[] }).items
  expect(await pull()).toEqual([]) // pre-crawl: gated → EMPTY, not a false "E_Mode not defined"
  await client.sendNotification(InitializedNotification.type, {}) // runs the eager crawl → indexed
  expect(await pull()).toEqual([]) // post-crawl: E_Mode resolves across files → PLC_PRG is clean
  client.dispose()
  rmSync(dir, { recursive: true, force: true })
})
