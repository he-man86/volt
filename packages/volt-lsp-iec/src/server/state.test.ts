/**
 * `ServerState` (`state.ts`) over the harness: the diagnostics PUSH — one channel, never to a client that pulls, and
 * nothing before the crawl has seeded the disk layer — the dead-code suppression it pushes under, and the eager crawl
 * that lets a type in an unopened file resolve.
 */
import { expect, test } from "bun:test"
import { rmSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  DocumentDiagnosticRequest,
  DidOpenTextDocumentNotification,
  InitializeRequest,
  PublishDiagnosticsNotification,
  InitializedNotification,
} from "vscode-languageserver-protocol/node"
import { connect, URI, initInDir, tempWorkspace, PRG, ENUM, onceDiag, notDefined } from "../../test/lsp/sources.js"

test("server: didOpen pushes diagnostics (type mismatch)", async () => {
  const client = connect()
  const got = new Promise<{ diagnostics: { code?: unknown }[] }>((resolve) => {
    client.onNotification(PublishDiagnosticsNotification.type, (p) => resolve(p as never))
  })
  await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
  const bad = `FUNCTION_BLOCK F\nVAR\n b : BOOL; i : INT;\nEND_VAR\n%LANGUAGE ST\ni := b;\nEND_FUNCTION_BLOCK`
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: URI, languageId: "iecst", version: 1, text: bad },
  })
  const params = await got
  expect(params.diagnostics.some((d) => d.code === "C0032")).toBe(true)
  client.dispose()
})

test("server: a pull-capable client gets NO push (avoids double diagnostics)", async () => {
  const client = connect()
  let pushed = false
  client.onNotification(PublishDiagnosticsNotification.type, () => {
    pushed = true
  })
  // Declare pull-diagnostics support — the client will call textDocument/diagnostic itself.
  await client.sendRequest(InitializeRequest.type, {
    processId: null,
    rootUri: null,
    capabilities: { textDocument: { diagnostic: { dynamicRegistration: false } } },
  })
  const bad = `FUNCTION_BLOCK F\nVAR\n b : BOOL; i : INT;\nEND_VAR\n%LANGUAGE ST\ni := b;\nEND_FUNCTION_BLOCK`
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: URI, languageId: "iecst", version: 1, text: bad },
  })
  // The pull channel returns the diagnostic…
  const report = (await client.sendRequest(DocumentDiagnosticRequest.type, { textDocument: { uri: URI } })) as {
    items: { code?: unknown }[]
  }
  expect(report.items.some((d) => d.code === "C0032")).toBe(true)
  // …and the server did NOT also push it.
  expect(pushed).toBe(false)
  client.dispose()
})

test("server: didOpen pushes network-text diagnostics for a graphical body", async () => {
  const client = connect()
  const got = new Promise<{ diagnostics: { code?: unknown }[] }>((resolve) => {
    client.onNotification(PublishDiagnosticsNotification.type, (p) => resolve(p as never))
  })
  await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
  const vg = `FUNCTION_BLOCK F\nVAR out : BOOL;\nEND_VAR\n%LANGUAGE LD\n%NETWORK\nout := out XOR TRUE;\nEND_FUNCTION_BLOCK` // XOR is a box: a call
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: URI, languageId: "iecst", version: 1, text: vg },
  })
  const params = await got
  expect(params.diagnostics.some((d) => d.code === "network-plain-st")).toBe(true)
  client.dispose()
})

test("server: a dead FB's diagnostics are suppressed by default, emitted with diagnoseDeadCode", async () => {
  // FB_Dead is never called/instantiated by the PROGRAM → structurally dead. Its genuine type error must
  // NOT surface by default (matches the compiler, which never compiles it).
  const mainSrc = `PROGRAM Main\n%LANGUAGE ST\nx := 1;\nEND_PROGRAM`
  const deadSrc = `FUNCTION_BLOCK FB_Dead\nVAR b : BOOL; i : INT;\nEND_VAR\n%LANGUAGE ST\ni := b;\nEND_FUNCTION_BLOCK`
  const deadUri = "file:///FB_Dead.pou"

  async function diagsFor(diagnoseDeadCode: boolean): Promise<{ code?: unknown }[]> {
    const client = connect()
    const got = new Promise<{ diagnostics: { code?: unknown }[] }>((resolve) => {
      client.onNotification(PublishDiagnosticsNotification.type, (p) => {
        if ((p as { uri: string }).uri === deadUri) resolve(p as never)
      })
    })
    await client.sendRequest(InitializeRequest.type, {
      processId: null,
      rootUri: null,
      capabilities: {},
      initializationOptions: { diagnoseDeadCode },
    })
    await client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: "file:///Main.pou", languageId: "iecst", version: 1, text: mainSrc },
    })
    await client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: deadUri, languageId: "iecst", version: 1, text: deadSrc },
    })
    const params = await got
    client.dispose()
    return params.diagnostics
  }

  const suppressed = await diagsFor(false)
  expect(suppressed.some((d) => d.code === "C0032")).toBe(false)

  const emitted = await diagsFor(true)
  expect(emitted.some((d) => d.code === "C0032")).toBe(true)
})

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

test("server: diagnostics are GATED until the workspace is indexed (no startup false-error flicker)", async () => {
  // PLC_PRG references E_Mode, defined in a SIBLING file — resolvable ONLY after the cross-file crawl. Before the
  // crawl the store holds just the open buffer, so E_Mode reads as "not defined": exactly the false error the gate
  // must suppress. (Removing the gate makes the first pull below report that error and this test fails.)
  const dir = tempWorkspace({ "E_Mode.dut": ENUM, "PLC_PRG.pou": PRG })
  const prgUri = pathToFileURL(join(dir, "PLC_PRG.pou")).href
  const client = connect()
  await client.sendRequest(InitializeRequest.type, {
    processId: null,
    rootUri: pathToFileURL(dir).href,
    capabilities: {},
  })
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: prgUri, languageId: "iecst", version: 1, text: PRG },
  })
  const pull = async () =>
    (
      (await client.sendRequest(DocumentDiagnosticRequest.type, { textDocument: { uri: prgUri } })) as {
        items: unknown[]
      }
    ).items
  expect(await pull()).toEqual([]) // pre-crawl: gated → EMPTY, not a false "E_Mode not defined"
  await client.sendNotification(InitializedNotification.type, {}) // runs the eager crawl → indexed
  expect(await pull()).toEqual([]) // post-crawl: E_Mode resolves across files → PLC_PRG is clean
  client.dispose()
  rmSync(dir, { recursive: true, force: true })
})
