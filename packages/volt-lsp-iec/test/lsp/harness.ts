/**
 * LSP behavior-conformance harness (test layer). Drives the running server as a real client over two
 * in-process pipes and records the *responses a client actually receives* — the layer the unit/conformance
 * gates can't see, because they test the analysis output (`DiagnosticItem`), not the wire.
 *
 * Generalises the `connect()` helper from `src/server/server.test.ts`: init with an arbitrary capability
 * set, drive the document lifecycle, and collect pushed notifications (publishDiagnostics) + server→client
 * refresh requests so a test can assert which delivery channel fired. Offline/deterministic: no root, so
 * the eager crawl + file watcher are no-ops.
 */
import { PassThrough } from "node:stream"
import {
  createProtocolConnection,
  DiagnosticRefreshRequest,
  DidChangeConfigurationNotification,
  DidChangeTextDocumentNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  DidSaveTextDocumentNotification,
  DocumentDiagnosticRequest,
  InitializeRequest,
  PublishDiagnosticsNotification,
  RegistrationRequest,
  StreamMessageReader,
  StreamMessageWriter,
  type ClientCapabilities,
  type Diagnostic,
  type InitializeResult,
} from "vscode-languageserver-protocol/node.js"
import { runServer } from "../../src/server/server.js"

/** Capability presets keyed to the delivery channel a client selects. */
export const CAPS = {
  /** No pull support → the server pushes via publishDiagnostics. */
  pushOnly: {} as ClientCapabilities,
  /** Advertises pull diagnostics → the server must NOT push. */
  pull: { textDocument: { diagnostic: { dynamicRegistration: false } } } as ClientCapabilities,
  /** Pull + refreshSupport → a config change prompts a DiagnosticRefreshRequest instead of a push. */
  pullRefresh: {
    textDocument: { diagnostic: { dynamicRegistration: false } },
    workspace: { diagnostics: { refreshSupport: true } },
  } as ClientCapabilities,
} as const

export interface Harness {
  init(capabilities: ClientCapabilities, initializationOptions?: unknown): Promise<InitializeResult>
  open(uri: string, text: string): Promise<void>
  /** Full-document replace (a whole-text contentChange). */
  change(uri: string, version: number, text: string): Promise<void>
  save(uri: string): Promise<void>
  close(uri: string): Promise<void>
  configure(settings: unknown): Promise<void>
  /** Escape hatch: send any request to the server (for navigation golden checks). */
  request<P, R>(type: { method: string }, params: P): Promise<R>
  /** The pull channel: textDocument/diagnostic → the report items. */
  pull(uri: string): Promise<Diagnostic[]>
  /** Last pushed diagnostics per URI (undefined if never pushed). */
  published(uri: string): Diagnostic[] | undefined
  /** How many publishDiagnostics the server pushed for a URI (0 if none). */
  pushCount(uri: string): number
  /** How many DiagnosticRefreshRequests the server sent. */
  refreshCount(): number
  dispose(): void
}

export function harness(vendor: "codesys" | "twincat" = "codesys"): Harness {
  const c2s = new PassThrough()
  const s2c = new PassThrough()
  runServer(c2s, s2c, vendor) // server reads c2s, writes s2c
  const client = createProtocolConnection(new StreamMessageReader(s2c), new StreamMessageWriter(c2s))

  const lastPush = new Map<string, Diagnostic[]>()
  const pushes = new Map<string, number>()
  let refreshes = 0

  client.onNotification(PublishDiagnosticsNotification.type, (p) => {
    lastPush.set(p.uri, p.diagnostics)
    pushes.set(p.uri, (pushes.get(p.uri) ?? 0) + 1)
  })
  client.onRequest(RegistrationRequest.type, () => null) // ack file-watcher dynamic registration
  client.onRequest(DiagnosticRefreshRequest.type, () => {
    refreshes += 1
    return null
  })
  client.listen()

  // The server processes notifications in order; a round-trip request after a notification guarantees the
  // notification's side effects (a push) have run before we assert. `pull` doubles as that barrier.
  const settled = () => client.sendRequest(DocumentDiagnosticRequest.type, { textDocument: { uri: "file:///_.st" } })

  return {
    async init(capabilities, initializationOptions) {
      return client.sendRequest(InitializeRequest.type, {
        processId: null,
        rootUri: null,
        capabilities,
        ...(initializationOptions !== undefined ? { initializationOptions } : {}),
      })
    },
    async open(uri, text) {
      await client.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: { uri, languageId: "iecst", version: 1, text },
      })
      await settled()
    },
    async change(uri, version, text) {
      await client.sendNotification(DidChangeTextDocumentNotification.type, {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      })
      await settled()
    },
    async save(uri) {
      await client.sendNotification(DidSaveTextDocumentNotification.type, { textDocument: { uri } })
      await settled()
    },
    async close(uri) {
      await client.sendNotification(DidCloseTextDocumentNotification.type, { textDocument: { uri } })
      await settled()
    },
    async configure(settings) {
      await client.sendNotification(DidChangeConfigurationNotification.type, { settings })
      await settled()
    },
    request: (type, params) => client.sendRequest(type as never, params as never) as never,
    async pull(uri) {
      const r = (await client.sendRequest(DocumentDiagnosticRequest.type, { textDocument: { uri } })) as {
        items: Diagnostic[]
      }
      return r.items
    },
    published: (uri) => lastPush.get(uri),
    pushCount: (uri) => pushes.get(uri) ?? 0,
    refreshCount: () => refreshes,
    dispose: () => client.dispose(),
  }
}
