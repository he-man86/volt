import { test, expect } from "bun:test"
import { PassThrough } from "node:stream"
import {
  createProtocolConnection,
  DefinitionRequest,
  DidOpenTextDocumentNotification,
  DocumentSymbolRequest,
  HoverRequest,
  InitializeRequest,
  PublishDiagnosticsNotification,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-languageserver-protocol/node.js"
import { runServer } from "./server.js"

/** A client connection wired to an in-process server over two pipes. */
function connect(vendor: "codesys" | "twincat" = "codesys") {
  const c2s = new PassThrough()
  const s2c = new PassThrough()
  runServer(c2s, s2c, vendor) // server reads c2s, writes s2c
  const client = createProtocolConnection(new StreamMessageReader(s2c), new StreamMessageWriter(c2s))
  client.listen()
  return client
}

const SRC = `FUNCTION_BLOCK F
VAR
	count : INT;
END_VAR
count := count + 1;
END_FUNCTION_BLOCK`
const URI = "file:///F.fb"

async function openF(client: ReturnType<typeof connect>) {
  await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: URI, languageId: "iecst", version: 1, text: SRC },
  })
}

test("server: initialize advertises the LSP capabilities", async () => {
  const client = connect()
  const init = await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
  expect(init.capabilities.hoverProvider).toBe(true)
  expect(init.capabilities.definitionProvider).toBe(true)
  expect(init.capabilities.completionProvider?.triggerCharacters).toContain(".")
  expect(init.capabilities.semanticTokensProvider).toBeDefined()
  client.dispose()
})

test("server: didOpen → hover returns the declaration", async () => {
  const client = connect()
  await openF(client)
  const h = await client.sendRequest(HoverRequest.type, {
    textDocument: { uri: URI },
    position: { line: 4, character: 0 },
  })
  expect((h as { contents: { value: string } })?.contents.value).toContain("count : INT")
  client.dispose()
})

test("server: definition resolves a body usage to its declaration", async () => {
  const client = connect()
  await openF(client)
  const def = await client.sendRequest(DefinitionRequest.type, {
    textDocument: { uri: URI },
    position: { line: 4, character: 0 }, // the `count` usage
  })
  expect((def as { range: { start: { line: number } } })?.range.start.line).toBe(2) // the declaration line
  client.dispose()
})

test("server: documentSymbol returns the outline", async () => {
  const client = connect()
  await openF(client)
  const syms = await client.sendRequest(DocumentSymbolRequest.type, { textDocument: { uri: URI } })
  expect((syms as { name: string }[])[0]?.name).toBe("F")
  client.dispose()
})

test("server: didOpen pushes diagnostics (type mismatch)", async () => {
  const client = connect()
  const got = new Promise<{ diagnostics: { code?: unknown }[] }>((resolve) => {
    client.onNotification(PublishDiagnosticsNotification.type, (p) => resolve(p as never))
  })
  await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
  const bad = `FUNCTION_BLOCK F\nVAR\n b : BOOL; i : INT;\nEND_VAR\ni := b;\nEND_FUNCTION_BLOCK`
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: URI, languageId: "iecst", version: 1, text: bad },
  })
  const params = await got
  expect(params.diagnostics.some((d) => d.code === "assignment-type-mismatch")).toBe(true)
  client.dispose()
})

test("server: didOpen pushes VG diagnostics for a graphical body", async () => {
  const client = connect()
  const got = new Promise<{ diagnostics: { code?: unknown }[] }>((resolve) => {
    client.onNotification(PublishDiagnosticsNotification.type, (p) => resolve(p as never))
  })
  await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
  const vg = `FUNCTION_BLOCK F\nVAR out : BOOL;\nEND_VAR\nNETWORK 0 LD\nout := TRUE;\nEND_FUNCTION_BLOCK` // no END_NETWORK
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: URI, languageId: "iecst", version: 1, text: vg },
  })
  const params = await got
  expect(params.diagnostics.some((d) => d.code === "VG_NETWORK_NOT_CLOSED")).toBe(true)
  client.dispose()
})

test("server: hover inside a VG body resolves a wire's inferred type", async () => {
  const client = connect()
  const vg = `FUNCTION_BLOCK F\nVAR a : BOOL; b : BOOL; out : BOOL;\nEND_VAR\nNETWORK 0 LD\nLET g := (a AND b);\nout := g;\nEND_NETWORK\nEND_FUNCTION_BLOCK`
  await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: URI, languageId: "iecst", version: 1, text: vg },
  })
  const h = await client.sendRequest(HoverRequest.type, {
    textDocument: { uri: URI },
    position: { line: 5, character: 7 }, // the `g` use in `out := g;`
  })
  expect((h as { contents: { value: string } })?.contents.value).toContain("g : BOOL")
  client.dispose()
})
