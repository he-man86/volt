/**
 * LSP behavior-conformance harness (test layer). Drives the running server as a real client over two
 * in-process pipes and records the *responses a client actually receives* — the layer the unit/conformance
 * gates can't see, because they test the analysis output (`DiagnosticItem`), not the wire.
 *
 * Generalises the `connect()` helper of `src/server/server.test.ts`: init with an arbitrary capability
 * set, drive the document lifecycle, and collect pushed notifications (publishDiagnostics) + server→client
 * refresh requests so a test can assert which delivery channel fired. Offline/deterministic by default: no root,
 * so the eager crawl + file watcher are no-ops.
 *
 * `initIn(root, …)` gives the server a temp-dir root instead (openspec lsp-server-scheduling, step 1): the crawl and
 * the watchers run, `watched` sends a watched-file batch, `workspacePull` sends back resultIds as VS Code does, and the
 * client records what the scheduling suites ask about — `window/logMessage`, the `$/progress` kinds in arrival order
 * (the progress create answered, refused or never answered, as the harness was told), the registrations, and every
 * process exit the server asks for through the exit seam.
 */
import { PassThrough } from "node:stream"
import { pathToFileURL } from "node:url"
import {
  createProtocolConnection,
  type ProtocolConnection,
  DiagnosticRefreshRequest,
  DidChangeConfigurationNotification,
  DidChangeTextDocumentNotification,
  DidChangeWatchedFilesNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  DidSaveTextDocumentNotification,
  DocumentDiagnosticRequest,
  InitializedNotification,
  InitializeRequest,
  LogMessageNotification,
  PublishDiagnosticsNotification,
  RegistrationRequest,
  ResponseError,
  StreamMessageReader,
  StreamMessageWriter,
  WorkDoneProgress,
  WorkDoneProgressCreateRequest,
  WorkspaceDiagnosticRequest,
  type CancellationToken,
  type ClientCapabilities,
  type Diagnostic,
  type DocumentDiagnosticReport,
  type FileEvent,
  type InitializeResult,
  type PreviousResultId,
  type Registration,
  type WorkspaceDiagnosticReport,
} from "vscode-languageserver-protocol/node"
import { runServer } from "../../src/server/index.js"
import type { Vendor } from "../../src/analysis/index.js"

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
  /** What VS Code (vscode-languageclient 10) advertises for the parts this server reads: pull + workspace pull +
   *  refresh, dynamic watchers, progress. The scheduling bench (`scripts/bench-server.ts`) is this client too. */
  vscode: {
    textDocument: { diagnostic: { dynamicRegistration: true, relatedDocumentSupport: false }, hover: {} },
    workspace: {
      diagnostics: { refreshSupport: true },
      didChangeWatchedFiles: { dynamicRegistration: true },
      semanticTokens: { refreshSupport: true },
      inlayHint: { refreshSupport: true },
      codeLens: { refreshSupport: true },
      configuration: true,
    },
    window: { workDoneProgress: true },
  } as ClientCapabilities,
  /** No pull support (the server pushes) and dynamic file watching — a push-mode editor with a workspace. */
  pushWatch: { workspace: { didChangeWatchedFiles: { dynamicRegistration: true } } } as ClientCapabilities,
} as const

/** How the client answers `window/workDoneProgress/create`: at once, with an error, or never. */
export type ProgressCreate = "answer" | "refuse" | "never"

/** One report of a workspace pull, as the scheduling suites read it. */
export interface WorkspaceReport {
  uri: string
  kind: "full" | "unchanged"
  resultId: string | undefined
  version: number | null
  items: Diagnostic[]
}

export interface Harness {
  init(capabilities: ClientCapabilities, initializationOptions?: unknown): Promise<InitializeResult>
  /** initialize with `root` as the workspace (`rootUri`), then `initialized` (the crawl, the watcher registration). */
  initIn(root: string, capabilities: ClientCapabilities, processId?: number | null): Promise<InitializeResult>
  /** `initIn`'s first half: `initialize` with `root`, and no `initialized` (the crawl has not run). */
  initializeIn(root: string, capabilities: ClientCapabilities): Promise<InitializeResult>
  /** `initIn`'s second half: the `initialized` notification, then the barrier. */
  initialized(): Promise<void>
  /** Escape hatch: send any notification with NO barrier after it (the barrier is a request, which a test before
   *  `initialize` cannot send). */
  notify<P>(type: { method: string }, params: P): Promise<void>
  open(uri: string, text: string, version?: number): Promise<void>
  /** Full-document replace (a whole-text contentChange). */
  change(uri: string, version: number, text: string): Promise<void>
  save(uri: string): Promise<void>
  close(uri: string): Promise<void>
  configure(settings: unknown): Promise<void>
  /** One `workspace/didChangeWatchedFiles` batch. */
  watched(changes: FileEvent[]): Promise<void>
  /** Escape hatch: send any request to the server (for navigation golden checks), cancellable with `token`. */
  request<P, R>(type: { method: string }, params: P, token?: CancellationToken): Promise<R>
  /** The pull channel: textDocument/diagnostic → the report items. */
  pull(uri: string): Promise<Diagnostic[]>
  /** The raw `textDocument/diagnostic` report, with the client's `previousResultId` when given. */
  pullReport(uri: string, previousResultId?: string): Promise<DocumentDiagnosticReport>
  /** `workspace/diagnostic` with `previousResultIds` (VS Code sends back every resultId the last pull returned). */
  workspacePull(previousResultIds?: PreviousResultId[]): Promise<WorkspaceReport[]>
  /** Last pushed diagnostics per URI (undefined if never pushed). */
  published(uri: string): Diagnostic[] | undefined
  /** The last push's `version` for a URI (undefined if never pushed, or pushed without one). */
  publishedVersion(uri: string): number | undefined
  /** How many publishDiagnostics the server pushed for a URI (0 if none). */
  pushCount(uri: string): number
  /** How many DiagnosticRefreshRequests the server sent. */
  refreshCount(): number
  /** Every `window/logMessage` the server sent, in order. */
  logs(): { type: number; message: string }[]
  /** The `$/progress` kinds (`begin` / `report` / `end`) in the order the client received them, any token. */
  progress(): string[]
  /** Every dynamic registration the server asked for. */
  registrations(): Registration[]
  /** Every exit code the server asked for through `runServer`'s exit seam (never a real `process.exit`). */
  exits(): number[]
  /** End the client→server stream (the client went away): the server's connection closes. */
  endInput(): void
  dispose(): void
}

/** The `file://` URI of `rel` under `root` — what the crawl's `pathToFileURL(path).href` names it. */
export const fileUri = (root: string, rel: string): string => pathToFileURL(`${root}/${rel}`).href

/** Resolve `p`, or reject naming `what` after `ms` — every wait in a test has a timeout. */
export function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms: ${what}`)), ms)
  })
  return Promise.race([p, late]).finally(() => clearTimeout(timer))
}

/** Poll `ok` every 20 ms until it holds or `ms` passes — then reject naming `what`. */
export async function until(ok: () => boolean, ms: number, what: string): Promise<void> {
  const t0 = Date.now()
  while (!ok()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out after ${ms} ms: ${what}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

/**
 * The exit seam's default: a test that passes no recorder expects no exit, so an exit there (an unexpected `exit(1)`
 * from the watchdog or a closed connection) is a fault. It is thrown outside the server's handler — as an uncaught
 * error, which fails `bun test` — so no handler's catch can swallow it.
 */
export function noExitExpected(code: number): void {
  const fault = new Error(`the server asked to exit(${code}) in a test that expected no exit (pass an exit recorder)`)
  setTimeout(() => {
    throw fault
  })
}

/**
 * A CLIENT CONNECTED TO AN IN-PROCESS SERVER over two pipes — the five lines every server test needs.
 *
 * `server.test.ts` had its own copy as a local `connect()`, which is the shape a setup takes right before the two
 * drift: an ack the server starts expecting, or a stream option, lands in one and not the other, and the tests that
 * miss it fail for a reason that has nothing to do with what they assert. `harness()` builds its typed API on top of
 * this; `server.test.ts` drives the raw connection. Both start here.
 */
export function connectToServer(
  /** The vendor flag the client states (`--codesys|--twincat`); undefined ⇒ the server reads the workspace binding. */
  flag: Vendor | undefined,
  /** Register handlers HERE, not after the call: a handler added once the connection is listening can miss a
   *  notification the server already sent — which for `publishDiagnostics` is the very thing under test. A handler
   *  registered here for a request this function already answers (the registration ack) replaces it. */
  register?: (client: ProtocolConnection) => void,
  /** Where the server's process exits go (the `exit` notification, a closed connection, the parent watchdog). An
   *  in-process server must never reach `process.exit`: it would end `bun test` mid-suite and the later files would
   *  silently not run. Default: {@link noExitExpected} — an exit nobody asked about fails the run, never dropped. */
  exit: (code: number) => void = noExitExpected,
  /** The client→server stream, for a test that ends it. */
  input?: (c2s: PassThrough) => void,
): ProtocolConnection {
  const c2s = new PassThrough()
  const s2c = new PassThrough()
  input?.(c2s)
  // @ts-expect-error -- the exit seam (openspec lsp-server-scheduling 2.3) is not built yet; this marker fails typecheck once it is
  runServer(c2s, s2c, flag, "(test)", exit) // server reads c2s, writes s2c
  const client = createProtocolConnection(new StreamMessageReader(s2c), new StreamMessageWriter(c2s))
  client.onRequest(RegistrationRequest.type, () => {}) // ack the file-watcher dynamic registration
  register?.(client)
  client.listen()
  return client
}

/** What the client has seen of the server so far. */
interface Seen {
  lastPush: Map<string, Diagnostic[]>
  lastVersion: Map<string, number | undefined>
  pushes: Map<string, number>
  logs: { type: number; message: string }[]
  progress: string[]
  registrations: Registration[]
  exits: number[]
  refreshes: number
  input: PassThrough | undefined
}

/** A client that records everything `Seen` names, answering the progress create as told. */
function recordingClient(vendor: Vendor, progressCreate: ProgressCreate): { client: ProtocolConnection; seen: Seen } {
  const seen: Seen = {
    lastPush: new Map(),
    lastVersion: new Map(),
    pushes: new Map(),
    logs: [],
    progress: [],
    registrations: [],
    exits: [],
    refreshes: 0,
    input: undefined,
  }
  const client = connectToServer(
    vendor,
    (c) => {
      c.onNotification(PublishDiagnosticsNotification.type, (p) => {
        seen.lastPush.set(p.uri, p.diagnostics)
        seen.lastVersion.set(p.uri, p.version)
        seen.pushes.set(p.uri, (seen.pushes.get(p.uri) ?? 0) + 1)
      })
      c.onRequest(DiagnosticRefreshRequest.type, () => {
        seen.refreshes += 1
      })
      c.onNotification(LogMessageNotification.type, (p) => {
        seen.logs.push({ type: p.type, message: p.message })
      })
      c.onRequest(RegistrationRequest.type, (p) => {
        seen.registrations.push(...p.registrations)
      })
      c.onRequest(WorkDoneProgressCreateRequest.type, (p) => {
        // Listen on whatever token the server names, before answering: a `begin` may follow the answer at once.
        c.onProgress(WorkDoneProgress.type, p.token, (v) => {
          seen.progress.push(v.kind)
        })
        if (progressCreate === "refuse") return new ResponseError(-32603, "progress refused by the test client")
        if (progressCreate === "never") return new Promise<void>(() => {})
        return undefined
      })
    },
    (code) => seen.exits.push(code),
    (c2s) => (seen.input = c2s),
  )
  return { client, seen }
}

/** The document steps: each sends its notification, then waits for the barrier. */
function documentSteps(client: ProtocolConnection, settled: () => Promise<unknown>) {
  const notify = async <P>(type: { method: string }, params: P) => {
    await client.sendNotification(type as never, params as never)
    await settled()
  }
  return {
    open: (uri: string, text: string, version = 1) =>
      notify(DidOpenTextDocumentNotification.type, { textDocument: { uri, languageId: "iecst", version, text } }),
    change: (uri: string, version: number, text: string) =>
      notify(DidChangeTextDocumentNotification.type, { textDocument: { uri, version }, contentChanges: [{ text }] }),
    save: (uri: string) => notify(DidSaveTextDocumentNotification.type, { textDocument: { uri } }),
    close: (uri: string) => notify(DidCloseTextDocumentNotification.type, { textDocument: { uri } }),
    configure: (settings: unknown) => notify(DidChangeConfigurationNotification.type, { settings }),
    watched: (changes: FileEvent[]) => notify(DidChangeWatchedFilesNotification.type, { changes }),
  }
}

/** The pull steps: a document's report, its items, and the workspace's reports. */
function pullSteps(client: ProtocolConnection) {
  return {
    async pull(uri: string): Promise<Diagnostic[]> {
      const r = (await client.sendRequest(DocumentDiagnosticRequest.type, { textDocument: { uri } })) as {
        items: Diagnostic[]
      }
      return r.items
    },
    pullReport: (uri: string, previousResultId?: string): Promise<DocumentDiagnosticReport> =>
      client.sendRequest(DocumentDiagnosticRequest.type, {
        textDocument: { uri },
        ...(previousResultId !== undefined ? { previousResultId } : {}),
      }),
    async workspacePull(previousResultIds: PreviousResultId[] = []): Promise<WorkspaceReport[]> {
      const r = (await client.sendRequest(WorkspaceDiagnosticRequest.type, {
        previousResultIds,
      })) as WorkspaceDiagnosticReport
      return r.items.map((i) => ({
        uri: i.uri,
        kind: i.kind,
        resultId: i.resultId,
        version: i.version,
        items: i.kind === "full" ? i.items : [],
      }))
    },
  }
}

export function harness(vendor: Vendor = "codesys", progressCreate: ProgressCreate = "answer"): Harness {
  const { client, seen } = recordingClient(vendor, progressCreate)

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
    async initIn(root, capabilities, processId = null) {
      const r = await client.sendRequest(InitializeRequest.type, {
        processId,
        rootUri: pathToFileURL(root).href,
        capabilities,
      })
      await client.sendNotification(InitializedNotification.type, {})
      await settled()
      return r
    },
    initializeIn: (root, capabilities) =>
      client.sendRequest(InitializeRequest.type, { processId: null, rootUri: pathToFileURL(root).href, capabilities }),
    async initialized() {
      await client.sendNotification(InitializedNotification.type, {})
      await settled()
    },
    notify: (type, params) => client.sendNotification(type as never, params as never),
    ...documentSteps(client, settled),
    request: (type, params, token) =>
      (token === undefined
        ? client.sendRequest(type as never, params as never)
        : client.sendRequest(type as never, params as never, token)) as never,
    ...pullSteps(client),
    published: (uri) => seen.lastPush.get(uri),
    publishedVersion: (uri) => seen.lastVersion.get(uri),
    pushCount: (uri) => seen.pushes.get(uri) ?? 0,
    refreshCount: () => seen.refreshes,
    logs: () => seen.logs,
    progress: () => seen.progress,
    registrations: () => seen.registrations,
    exits: () => seen.exits,
    endInput: () => seen.input?.end(),
    dispose: () => client.dispose(),
  }
}
