
import { test, expect } from "bun:test"
import { rmSync } from "node:fs"
import {
  CallHierarchyPrepareRequest,
  CodeActionRequest,
  CodeLensRequest,
  CompletionRequest,
  DefinitionRequest,
  DidChangeTextDocumentNotification,
  DocumentDiagnosticRequest,
  DidOpenTextDocumentNotification,
  DocumentFormattingRequest,
  DocumentHighlightRequest,
  DocumentOnTypeFormattingRequest,
  DocumentRangeFormattingRequest,
  DocumentSymbolRequest,
  LinkedEditingRangeRequest,
  FoldingRangeRequest,
  HoverRequest,
  ImplementationRequest,
  InitializeRequest,
  InlayHintRequest,
  PrepareRenameRequest,
  ReferencesRequest,
  SelectionRangeRequest,
  SemanticTokensDeltaRequest,
  SemanticTokensRangeRequest,
  SemanticTokensRequest,
  SignatureHelpRequest,
  TypeDefinitionRequest,
  TypeHierarchyPrepareRequest,
  WorkspaceSymbolRequest,
} from "vscode-languageserver-protocol/node"
import { connect, SRC, URI, openF, td, atCount, initInDir, tempWorkspace, PRG, ENUM } from "../../test/server/sources.js"

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

test("server: structural requests (selectionRange, foldingRange, semanticTokens, codeLens) respond", async () => {
  const client = connect()
  await openF(client)
  const sel = (await client.sendRequest(SelectionRangeRequest.type, {
    ...td,
    positions: [{ line: 4, character: 0 }],
  })) as unknown[]
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
  const hints = (await client.sendRequest(InlayHintRequest.type, {
    ...td,
    range: { start: { line: 0, character: 0 }, end: { line: 6, character: 0 } },
  })) as unknown[]
  expect(Array.isArray(hints)).toBe(true)
  const actions = (await client.sendRequest(CodeActionRequest.type, {
    ...td,
    range: { start: { line: 4, character: 0 }, end: { line: 4, character: 5 } },
    context: { diagnostics: [] },
  })) as unknown[]
  expect(Array.isArray(actions)).toBe(true)
  const edits = (await client.sendRequest(DocumentFormattingRequest.type, {
    ...td,
    options: { tabSize: 2, insertSpaces: true },
  })) as unknown[]
  expect(Array.isArray(edits)).toBe(true)
  client.dispose()
})

test("parity: every advertised request capability answers (no dark handler)", async () => {
  // Guards the capability↔handler-parity requirement: an advertised provider with no registered handler
  // rejects with method-not-found (-32601) here. Self-guarding — a new capability with no entry below fails.
  const client = connect()
  const init = await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: URI, languageId: "iecst", version: 1, text: SRC },
  })
  const td = { textDocument: { uri: URI } }
  const at4 = { line: 4, character: 0 }
  const wholeRange = { start: { line: 0, character: 0 }, end: { line: 6, character: 0 } }
  const fmt = { options: { tabSize: 2, insertSpaces: true } }
  const send: Record<string, () => Promise<unknown>> = {
    hoverProvider: () => client.sendRequest(HoverRequest.type, { ...td, position: at4 }),
    definitionProvider: () => client.sendRequest(DefinitionRequest.type, { ...td, position: at4 }),
    typeDefinitionProvider: () => client.sendRequest(TypeDefinitionRequest.type, { ...td, position: at4 }),
    implementationProvider: () => client.sendRequest(ImplementationRequest.type, { ...td, position: at4 }),
    referencesProvider: () =>
      client.sendRequest(ReferencesRequest.type, { ...td, position: at4, context: { includeDeclaration: true } }),
    documentHighlightProvider: () => client.sendRequest(DocumentHighlightRequest.type, { ...td, position: at4 }),
    documentSymbolProvider: () => client.sendRequest(DocumentSymbolRequest.type, td),
    renameProvider: () => client.sendRequest(PrepareRenameRequest.type, { ...td, position: at4 }),
    callHierarchyProvider: () => client.sendRequest(CallHierarchyPrepareRequest.type, { ...td, position: at4 }),
    typeHierarchyProvider: () => client.sendRequest(TypeHierarchyPrepareRequest.type, { ...td, position: at4 }),
    workspaceSymbolProvider: () => client.sendRequest(WorkspaceSymbolRequest.type, { query: "" }),
    completionProvider: () => client.sendRequest(CompletionRequest.type, { ...td, position: at4 }),
    signatureHelpProvider: () => client.sendRequest(SignatureHelpRequest.type, { ...td, position: at4 }),
    foldingRangeProvider: () => client.sendRequest(FoldingRangeRequest.type, td),
    selectionRangeProvider: () => client.sendRequest(SelectionRangeRequest.type, { ...td, positions: [at4] }),
    inlayHintProvider: () => client.sendRequest(InlayHintRequest.type, { ...td, range: wholeRange }),
    codeLensProvider: () => client.sendRequest(CodeLensRequest.type, td),
    codeActionProvider: () =>
      client.sendRequest(CodeActionRequest.type, { ...td, range: wholeRange, context: { diagnostics: [] } }),
    documentFormattingProvider: () => client.sendRequest(DocumentFormattingRequest.type, { ...td, ...fmt }),
    documentRangeFormattingProvider: () =>
      client.sendRequest(DocumentRangeFormattingRequest.type, { ...td, range: wholeRange, ...fmt }),
    documentOnTypeFormattingProvider: () =>
      client.sendRequest(DocumentOnTypeFormattingRequest.type, { ...td, position: at4, ch: ";", ...fmt }),
    linkedEditingRangeProvider: () => client.sendRequest(LinkedEditingRangeRequest.type, { ...td, position: at4 }),
    semanticTokensProvider: () => client.sendRequest(SemanticTokensRequest.type, td),
    diagnosticProvider: () => client.sendRequest(DocumentDiagnosticRequest.type, td),
  }
  const NON_REQUEST = new Set(["textDocumentSync"]) // sync is notifications, not a request
  for (const [key, value] of Object.entries(init.capabilities)) {
    if (!value || NON_REQUEST.has(key)) continue
    const thunk = send[key]
    if (thunk === undefined) throw new Error(`capability '${key}' advertised but not covered by the parity test`)
    await thunk() // a missing handler rejects with -32601 → this test fails
  }
  client.dispose()
})

test("server: initialize advertises hierarchy + workspaceSymbol providers", async () => {
  const client = connect()
  const init = await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
  expect(init.capabilities.callHierarchyProvider).toBe(true)
  expect(init.capabilities.typeHierarchyProvider).toBe(true)
  expect(init.capabilities.workspaceSymbolProvider).toBe(true)
  client.dispose()
})

test("server: semanticTokens/range returns tokens for the viewport only (multiple of 5)", async () => {
  const client = connect()
  await openF(client)
  const tokens = (await client.sendRequest(SemanticTokensRangeRequest.type, {
    textDocument: { uri: URI },
    range: { start: { line: 0, character: 0 }, end: { line: 3, character: 0 } },
  })) as { data: number[] }
  expect(tokens.data.length).toBeGreaterThan(0)
  expect(tokens.data.length % 5).toBe(0)
  client.dispose()
})

test("server: semanticTokens/full/delta returns edits against the prior result id", async () => {
  const client = connect()
  await openF(client)
  const full = (await client.sendRequest(SemanticTokensRequest.type, td)) as { resultId: string; data: number[] }
  expect(typeof full.resultId).toBe("string")
  // Change a declared type (INT→REAL) so the token stream actually differs.
  await client.sendNotification(DidChangeTextDocumentNotification.type, {
    textDocument: { uri: URI, version: 2 },
    contentChanges: [{ text: SRC.replace("INT", "REAL") }],
  })
  const delta = (await client.sendRequest(SemanticTokensDeltaRequest.type, {
    textDocument: { uri: URI },
    previousResultId: full.resultId,
  })) as { resultId: string; edits?: { start: number; deleteCount: number; data: number[] }[]; data?: number[] }
  expect(typeof delta.resultId).toBe("string")
  expect(Array.isArray(delta.edits)).toBe(true) // matched the prior id → a diff, not a full set
  client.dispose()
})

test("server: workspaceSymbol finds a DUT in an unopened file and narrows by query", async () => {
  const dir = tempWorkspace({ "E_Mode.dut": ENUM, "PLC_PRG.pou": PRG })
  const client = connect()
  await initInDir(client, dir) // eager crawl indexes both files without opening them
  const all = (await client.sendRequest(WorkspaceSymbolRequest.type, { query: "E_Mode" })) as {
    name: string
    location: { uri: string }
  }[]
  expect(all.some((s) => s.name === "E_Mode")).toBe(true)
  // The query narrows — an unrelated substring returns no E_Mode.
  const narrowed = (await client.sendRequest(WorkspaceSymbolRequest.type, { query: "zzz" })) as { name: string }[]
  expect(narrowed.some((s) => s.name === "E_Mode")).toBe(false)
  client.dispose()
  rmSync(dir, { recursive: true, force: true })
})
