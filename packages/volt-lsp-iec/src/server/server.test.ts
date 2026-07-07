import { test, expect } from "bun:test"
import { PassThrough } from "node:stream"
import {
  CodeActionRequest,
  CodeLensRequest,
  CompletionRequest,
  createProtocolConnection,
  DefinitionRequest,
  DidChangeTextDocumentNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  DocumentFormattingRequest,
  DocumentHighlightRequest,
  DocumentSymbolRequest,
  FoldingRangeRequest,
  HoverRequest,
  ImplementationRequest,
  InitializeRequest,
  InlayHintRequest,
  PrepareRenameRequest,
  PublishDiagnosticsNotification,
  ReferencesRequest,
  RenameRequest,
  SelectionRangeRequest,
  SemanticTokensRequest,
  SignatureHelpRequest,
  StreamMessageReader,
  StreamMessageWriter,
  TypeDefinitionRequest,
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

test("server: a dead FB's diagnostics are suppressed by default, emitted with diagnoseDeadCode", async () => {
  // FB_Dead is never called/instantiated by the PROGRAM → structurally dead. Its genuine type error must
  // NOT surface by default (matches the compiler, which never compiles it).
  const mainSrc = `PROGRAM Main\nx := 1;\nEND_PROGRAM`
  const deadSrc = `FUNCTION_BLOCK FB_Dead\nVAR b : BOOL; i : INT;\nEND_VAR\ni := b;\nEND_FUNCTION_BLOCK`
  const deadUri = "file:///FB_Dead.fb"

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
      textDocument: { uri: "file:///Main.prg", languageId: "iecst", version: 1, text: mainSrc },
    })
    await client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: deadUri, languageId: "iecst", version: 1, text: deadSrc },
    })
    const params = await got
    client.dispose()
    return params.diagnostics
  }

  const suppressed = await diagsFor(false)
  expect(suppressed.some((d) => d.code === "assignment-type-mismatch")).toBe(false)

  const emitted = await diagsFor(true)
  expect(emitted.some((d) => d.code === "assignment-type-mismatch")).toBe(true)
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

// ─── remaining protocol handlers: drive each once so the routing + response shape is covered ───

const td = { textDocument: { uri: URI } }
const atCount = { ...td, position: { line: 4, character: 0 } } // the `count :=` usage

test("server: completion returns items in scope", async () => {
  const client = connect()
  await openF(client)
  const items = (await client.sendRequest(CompletionRequest.type, atCount)) as { label: string }[]
  expect(Array.isArray(items)).toBe(true)
  expect(items.some((i) => i.label === "count")).toBe(true)
  client.dispose()
})

test("server: references + documentHighlight cover every binding", async () => {
  const client = connect()
  await openF(client)
  const refs = (await client.sendRequest(ReferencesRequest.type, { ...atCount, context: { includeDeclaration: true } })) as unknown[]
  expect(refs.length).toBe(3) // decl + two uses
  const hl = (await client.sendRequest(DocumentHighlightRequest.type, atCount)) as unknown[]
  expect(hl.length).toBe(3)
  client.dispose()
})

test("server: prepareRename + rename produce a workspace edit", async () => {
  const client = connect()
  await openF(client)
  const range = await client.sendRequest(PrepareRenameRequest.type, atCount)
  expect(range).toBeDefined()
  const edit = (await client.sendRequest(RenameRequest.type, { ...atCount, newName: "tally" })) as { changes: Record<string, unknown[]> }
  expect(edit.changes[URI]?.length).toBe(3)
  client.dispose()
})

test("server: structural requests (selectionRange, foldingRange, semanticTokens, codeLens) respond", async () => {
  const client = connect()
  await openF(client)
  const sel = (await client.sendRequest(SelectionRangeRequest.type, { ...td, positions: [{ line: 4, character: 0 }] })) as unknown[]
  expect(sel.length).toBe(1)
  const folds = (await client.sendRequest(FoldingRangeRequest.type, td)) as unknown[]
  expect(folds.length).toBeGreaterThan(0)
  const tokens = (await client.sendRequest(SemanticTokensRequest.type, td)) as { data: number[] }
  expect(tokens.data.length % 5).toBe(0)
  const lenses = (await client.sendRequest(CodeLensRequest.type, td)) as unknown[]
  expect(Array.isArray(lenses)).toBe(true)
  client.dispose()
})

test("server: assist requests (signatureHelp, typeDefinition, implementation, inlayHint, codeAction, formatting) respond without error", async () => {
  const client = connect()
  await openF(client)
  // These may legitimately return null/empty for this source — the point is the handler runs + routes.
  await client.sendRequest(SignatureHelpRequest.type, atCount)
  await client.sendRequest(TypeDefinitionRequest.type, atCount)
  await client.sendRequest(ImplementationRequest.type, atCount)
  const hints = (await client.sendRequest(InlayHintRequest.type, { ...td, range: { start: { line: 0, character: 0 }, end: { line: 6, character: 0 } } })) as unknown[]
  expect(Array.isArray(hints)).toBe(true)
  const actions = (await client.sendRequest(CodeActionRequest.type, { ...td, range: { start: { line: 4, character: 0 }, end: { line: 4, character: 5 } }, context: { diagnostics: [] } })) as unknown[]
  expect(Array.isArray(actions)).toBe(true)
  const edits = (await client.sendRequest(DocumentFormattingRequest.type, { ...td, options: { tabSize: 2, insertSpaces: true } })) as unknown[]
  expect(Array.isArray(edits)).toBe(true)
  client.dispose()
})

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
    client.onNotification(PublishDiagnosticsNotification.type, (p) => p.uri === URI && res(p)),
  )
  await client.sendNotification(DidCloseTextDocumentNotification.type, { textDocument: { uri: URI } })
  expect((await cleared).diagnostics).toEqual([])
  client.dispose()
})
