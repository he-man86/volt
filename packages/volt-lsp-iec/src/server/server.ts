/**
 * LSP server (Layer G, G.1) — LSP 3.17 over stdio, vendor-keyed. Wires the analysis diagnostics + every E service to the
 * protocol via `vscode-languageserver-protocol`'s connection; the `WorkspaceStore` (`workspace/`) holds the documents,
 * parsed as this process's environment says (`config.ts`). Thin dispatch: each handler converts LSP Position→offset and
 * calls the matching service — the heavy lifting lives in the layers below. This file is the capabilities and the
 * wiring: `runServer` builds one `ServerState` (`state.ts`) and registers the handler groups of `handlers/` over it,
 * one file per request group (openspec lsp-same-standard design.md §2.2).
 */
import type { Readable, Writable } from "node:stream"
import {
  createProtocolConnection,
  StreamMessageReader,
  StreamMessageWriter,
  TextDocumentSyncKind,
  LSPErrorCodes,
  ResponseError,
  type Message,
  type RequestMessage,
  type ResponseMessage,
  type InitializeResult,
} from "vscode-languageserver-protocol/node"
import type { Vendor } from "../analysis/index.js"
import { SEMANTIC_TOKEN_TYPES } from "../services/index.js"
import { registerAssistHandlers } from "./handlers/assist.js"
import { registerDiagnosticHandlers } from "./handlers/diagnostics.js"
import { registerDocumentHandlers } from "./handlers/documents.js"
import { registerFormattingHandlers } from "./handlers/formatting.js"
import { registerLifecycleHandlers } from "./handlers/lifecycle.js"
import { registerNavigationHandlers } from "./handlers/navigation.js"
import { registerStructureHandlers } from "./handlers/structure.js"
import { ServerState, type Exit } from "./state.js"

/** What this server answers: every provider here has its handler in a group under `handlers/`. */
const CAPABILITIES: InitializeResult["capabilities"] = {
  textDocumentSync: { openClose: true, change: TextDocumentSyncKind.Incremental, save: { includeText: false } },
  hoverProvider: true,
  definitionProvider: true,
  typeDefinitionProvider: true,
  implementationProvider: true,
  referencesProvider: true,
  documentHighlightProvider: true,
  documentSymbolProvider: true,
  renameProvider: { prepareProvider: true },
  callHierarchyProvider: true,
  typeHierarchyProvider: true,
  workspaceSymbolProvider: true,
  completionProvider: { triggerCharacters: ["."] },
  signatureHelpProvider: { triggerCharacters: ["(", ","] },
  foldingRangeProvider: true,
  selectionRangeProvider: true,
  inlayHintProvider: true,
  codeLensProvider: {},
  codeActionProvider: true,
  documentFormattingProvider: true,
  documentRangeFormattingProvider: true,
  documentOnTypeFormattingProvider: { firstTriggerCharacter: "\n" }, // `formatOnType` answers a newline only
  linkedEditingRangeProvider: true,
  semanticTokensProvider: { legend: { tokenTypes: [...SEMANTIC_TOKEN_TYPES], tokenModifiers: [] }, full: { delta: true }, range: true },
  // Pull diagnostics: they span the project (a sibling type changes a file's errors); workspace-wide pulls answered too.
  diagnosticProvider: { interFileDependencies: true, workspaceDiagnostics: true },
}

/** `flag`: the vendor the client stated (`--codesys|--twincat`), or undefined — `initialize` then reads the binding (`vendor.ts`).
 *  `exit`: how the process ends (the `exit` notification, a closed connection, a dead parent) — `bin.ts` passes
 *  `process.exit`, an in-process caller a recorder: the server never calls `process.exit` itself. */
export function runServer(input: Readable, output: Writable, flag: Vendor | undefined, version: string, exit: Exit): void {
  // A request the client cancelled while it still waited in jsonrpc's queue is answered RequestCancelled and never
  // run (the cancel is read in the reader callback; dispatch runs on `setImmediate`, so it reaches the requests queued
  // behind a running synchronous handler). Same-URI pulls coalesce through the client, which cancels a superseded one.
  const cancelUndispatched = (message: Message): ResponseMessage => ({
    jsonrpc: "2.0",
    id: (message as RequestMessage).id,
    error: new ResponseError(LSPErrorCodes.RequestCancelled, `${(message as RequestMessage).method} was cancelled before it ran`).toJson(),
  })
  const s = new ServerState(
    (logger) =>
      createProtocolConnection(new StreamMessageReader(input), new StreamMessageWriter(output), logger, {
        connectionStrategy: { cancelUndispatched },
      }),
    exit,
  )
  registerLifecycleHandlers(s, flag, version, CAPABILITIES)
  registerDocumentHandlers(s)
  registerDiagnosticHandlers(s)
  registerNavigationHandlers(s)
  registerAssistHandlers(s)
  registerStructureHandlers(s)
  registerFormattingHandlers(s)
  s.conn.listen()
}
