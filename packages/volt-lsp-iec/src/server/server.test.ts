/**
 * `runServer` (`server.ts`) over the harness: the capabilities it advertises, and every advertised request answered by a
 * registered handler — the capability↔handler parity. What each handler group answers is the test beside it in
 * `handlers/`; the server as a client sees it, end to end, is `test/lsp/`.
 */
import { expect, test } from "bun:test"
import {
  CallHierarchyPrepareRequest,
  CodeActionRequest,
  CodeLensRequest,
  CompletionRequest,
  DefinitionRequest,
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
  SemanticTokensRequest,
  SignatureHelpRequest,
  TypeDefinitionRequest,
  TypeHierarchyPrepareRequest,
  WorkspaceSymbolRequest,
} from "vscode-languageserver-protocol/node"
import { connect, SRC, URI, td } from "../../test/lsp/sources.js"

test("server: initialize advertises the LSP capabilities", async () => {
  const client = connect()
  const init = await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
  expect(init.capabilities.hoverProvider).toBe(true)
  expect(init.capabilities.definitionProvider).toBe(true)
  expect(init.capabilities.completionProvider?.triggerCharacters).toContain(".")
  expect(init.capabilities.semanticTokensProvider).toBeDefined()
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
