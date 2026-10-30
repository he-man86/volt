/**
 * WHAT ONE SERVER PROCESS HOLDS — the workspace store, the vendor and root `initialize` decided (`vendor.ts`
 * `servedWorkspace`), what the client said it supports, the semantic-token cache — and the operations more than one
 * handler group runs over it: the crawl, the reference re-scan, the config, the log, the lifecycle gate every handler
 * is registered through, and the one way the process ends. The handler groups (`handlers/`) register their requests
 * over ONE `ServerState` and decide nothing about the vendor themselves (openspec lsp-same-standard design.md §8). The
 * diagnostics are the `DiagnosticsPublisher`'s (openspec lsp-server-scheduling).
 */
import {
  CodeLensRefreshRequest,
  DiagnosticRefreshRequest,
  ErrorCodes,
  InlayHintRefreshRequest,
  LogMessageNotification,
  MessageType,
  ResponseError,
  SemanticTokensRefreshRequest,
  WorkDoneProgress,
  WorkDoneProgressCreateRequest,
  type CancellationToken,
  type HandlerResult,
  type Logger,
  type NotificationHandler,
  type ProtocolConnection,
  type ProtocolNotificationType,
  type ProtocolRequestType,
} from "vscode-languageserver-protocol/node"
import { pathToFileURL } from "node:url"
import type { AnalysisInitOptions, Vendor } from "../analysis/index.js"
import type { Scope } from "../frontend/symbols/index.js"
import { offsetFromPosition, type Document } from "../services/index.js"
import {
  scanWorkspace,
  scanWorkspaceRefs,
  type ProjectSettings,
  type Unreadable,
  type WorkspaceRefScan,
} from "../workspace/workspace-refs.js"
import type { WorkspaceStore } from "../workspace/workspace-store.js"
import { DiagnosticsPublisher } from "./diagnostics-publisher.js"

/** What the editor configures: everything but the vendor, which `initialize` decides. */
export type EditorOptions = Omit<AnalysisInitOptions, "vendor">

/** How the process ends — `process.exit` in the binary, a recorder in process (a test must never end `bun test`). */
export type Exit = (code: 0 | 1) => void

/** How long the indexing progress waits for the client to accept its token before crawling without one. */
const PROGRESS_CREATE_MS = 2000

export class ServerState {
  readonly conn: ProtocolConnection
  // Decided once, at `initialize` (a refused one serves nothing); the crawl runs at `initialized`.
  vendor!: Vendor
  store!: WorkspaceStore
  root: string | undefined
  /** `initialize` answered: before it every request is refused (ServerNotInitialized) and every notification dropped. */
  started = false
  /** `shutdown` answered: every later request is refused (InvalidRequest); `exit` then ends with 0. */
  shutdown = false
  /** What the EDITOR asked for, kept so a re-scan can re-apply the project's settings on top of it. */
  editorOptions: EditorOptions = {}
  /** What each PLC PROJECT configures (its `.projectsettings`), refreshed by every reference scan. */
  projectSettings: readonly ProjectSettings[] = []
  /** The reference files the last scan read, by path (a deleted folder that held one re-scans the references). */
  refPaths: readonly string[] = []
  /** Source paths a watched batch could not read (EBUSY while the CLI or the IDE writes): re-read at the next batch. */
  readonly unread = new Set<string>()
  /** The last reference scan could not read a reference file: the references it last read stand, and the next watched
   *  batch re-scans them. */
  refsUnread = false
  // False until the first workspace crawl has seeded the disk layer. Diagnostics resolve cross-file symbols from the
  // WHOLE-project table, so computing them before the crawl reports every other-file reference as "unresolved" — a
  // burst of false errors that only clears once indexing finishes. The publisher gates on this.
  indexed = false
  clientWatchDynReg = false
  clientConfigPull = false
  clientProgress = false
  // When the client supports PULL diagnostics (it will call textDocument/diagnostic), we must NOT also push via
  // publishDiagnostics — doing both makes every diagnostic appear twice. We still declare the pull provider.
  clientSupportsPull = false
  // Which derived data the client will re-request when we send a refresh (after a re-index).
  readonly clientRefresh = { semanticTokens: false, inlayHint: false, codeLens: false, diagnostics: false }
  // Latest semantic-token result per URI (for `full/delta` diffing) + a monotonic result-id source.
  readonly semTok = new Map<string, { resultId: string; data: number[] }>()
  semTokSeq = 0
  readonly publisher = new DiagnosticsPublisher(this)
  /** What else holds the process open (the parent watchdog, the fallback file watcher): stopped when it ends. */
  readonly stops: (() => void)[] = []
  private ended = false
  private progressSeq = 0

  /** `connect` builds the connection with the server's logger — jsonrpc's own "handler failed" reports land in the
   *  client's log too (a throwing NOTIFICATION handler used to fail silently). */
  constructor(
    connect: (logger: Logger) => ProtocolConnection,
    private readonly exit: Exit,
  ) {
    this.conn = connect({
      error: (m) => this.log(MessageType.Error, m),
      warn: (m) => this.log(MessageType.Warning, m),
      info: (m) => this.log(MessageType.Info, m),
      log: (m) => this.log(MessageType.Log, m),
    })
  }

  /** A line in the client's log (`window/logMessage`). */
  log(type: MessageType, message: string): void {
    void this.conn.sendNotification(LogMessageNotification.type, { type, message }).catch(() => {})
  }

  /** The store's failure report: a document whose parse or bind threw, by name, with the stack. */
  readonly reportFailure = (uri: string, error: unknown): void =>
    this.log(
      MessageType.Error,
      `volt-lsp-iec: ${uri} could not be analysed and is left out of the project until it changes: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    )

  /** End the process once: `exit` after `shutdown` is 0, anything else (no `shutdown`, a closed connection, a dead
   *  parent) is 1. */
  end(): void {
    if (this.ended) return
    this.ended = true
    for (const stop of this.stops) stop()
    this.exit(this.shutdown ? 0 : 1)
  }

  /** Register a request through the lifecycle gate: refused before `initialize` and after `shutdown`. */
  onRequest<P, R, PR, E, RO>(
    type: ProtocolRequestType<P, R, PR, E, RO>,
    handler: (params: P, token: CancellationToken) => HandlerResult<R, E>,
  ): void {
    this.conn.onRequest(type, (params, token) => (this.refusal() as ResponseError<E> | undefined) ?? handler(params, token))
  }

  /** Register a notification through the lifecycle gate: dropped before `initialize` and after `shutdown`. */
  onNotification<P, RO>(type: ProtocolNotificationType<P, RO>, handler: NotificationHandler<P>): void {
    this.conn.onNotification(type, (params) => {
      if (this.started && !this.shutdown) handler(params)
    })
  }

  /** Why a request is refused now, or undefined when it is served. */
  refusal(): ResponseError<void> | undefined {
    if (!this.started) return new ResponseError(ErrorCodes.ServerNotInitialized, "volt-lsp-iec: `initialize` comes first")
    if (this.shutdown) return new ResponseError(ErrorCodes.InvalidRequest, "volt-lsp-iec: the server is shut down; only `exit` is served")
    return undefined
  }

  /** The table names in `uri` resolve against — its application's (`WorkspaceStore.project`); the whole project's when
   *  no document is named. */
  project(uri?: string): Scope {
    return this.store.project(uri)
  }

  /** The documents in `uri`'s scope — its application's and the pool's; every document when none is named. */
  workspace(uri?: string): Document[] {
    return this.store.workspace(uri)
  }

  doc(uri: string): Document | undefined {
    return this.store.doc(uri)
  }

  /** `fn` over the document at `uri` and the offset of `pos` in it — null where either is missing. */
  at<T>(uri: string, pos: { line: number; character: number }, fn: (d: Document, off: number) => T): T | null {
    const d = this.doc(uri)
    if (d === undefined) return null
    const off = offsetFromPosition(d.source, pos)
    return off < 0 ? null : (fn(d, off) ?? null)
  }

  /** `fn` over the document at `uri` — null where it is missing. */
  whole<T>(uri: string, fn: (d: Document) => T): T | null {
    const d = this.doc(uri)
    return d !== undefined ? fn(d) : null
  }

  /**
   * Resolve the config from both sources, PROJECT LAST.
   *
   * A compiler warning's state is a fact about the project, not a preference of whoever opened it: CODESYS
   * stores it in the project, the bridge mirrors it into `.projectsettings`, and it must therefore beat an
   * editor setting rather than be overridden by one. Editor options still own everything the project does
   * not speak to — `diagnoseDeadCode`, and any code the project leaves at its default. Each PLC project's settings
   * govern its own documents (`WorkspaceStore.configFor`).
   */
  applyResolvedConfig(): void {
    this.store.configure({ ...this.editorOptions, vendor: this.vendor }, this.projectSettings)
  }

  /** The whole reference state from one scan: refs and task roots in one store mutation, and the config re-resolved
   *  (any reference scan can carry a `.projectsettings` — the first pull, or a warning switched off in the IDE). */
  applyRefScan(scan: WorkspaceRefScan): void {
    this.store.setRefs(scan.refs, scan.taskRoots)
    this.refPaths = scan.paths
    this.projectSettings = scan.projectSettings
    this.applyResolvedConfig()
  }

  /** Re-read the reference files alone (no source). A scan that could not read one is no reference state: the last
   *  one stands (a project-disabled warning does not come back, a library does not unbind), the file is logged, and the
   *  next watched batch re-scans. Whether the references were applied. */
  rescanRefs(): boolean {
    if (this.root === undefined) return false
    const scan = scanWorkspaceRefs(this.root)
    this.refsUnread = scan.unreadable.length > 0
    if (this.refsUnread) {
      for (const u of scan.unreadable) this.logUnreadable(u, "the references it last read stand and are re-scanned")
      return false
    }
    this.applyRefScan(scan)
    return true
  }

  /** A file that exists and could not be read, logged by name: what is kept, and when it is read again. */
  logUnreadable(file: Unreadable, kept: string): void {
    this.log(
      MessageType.Warning,
      `volt-lsp-iec: ${pathToFileURL(file.path).href} could not be read (${file.code}); ${kept} at the next file event`,
    )
  }

  /** The crawl at `initialized`: every source and reference file into the store, then diagnostics may flow. A file it
   *  could not read is logged and read again at the next watched batch (there is no earlier state to keep). */
  crawl(): void {
    if (this.root === undefined) return
    const scan = scanWorkspace(this.root)
    this.applyRefScan(scan)
    this.refsUnread = scan.unreadable.length > 0
    for (const u of scan.unreadable) this.logUnreadable(u, "the references are re-scanned")
    const logged = new Set(scan.unreadable.map((u) => u.path)) // a folder it could not list is in both lists
    for (const u of scan.unreadableSources) {
      if (!logged.has(u.path)) this.logUnreadable(u, "it is read")
      this.unread.add(u.path)
    }
    this.store.seedDisk(scan.sources.map((s) => ({ uri: pathToFileURL(s.path).href, source: s.source })))
    this.indexed = true // the disk layer is fully seeded — diagnostics can now resolve cross-file symbols
    this.afterWorkspaceChange()
  }

  /** After the workspace moved under the open documents (the crawl, a watched batch): push mode re-publishes what
   *  moved; tokens, hints, lenses — and a pull client's diagnostics — have no push channel, so a refresh asks the
   *  client to re-request them. ONE set per crawl or batch. */
  afterWorkspaceChange(): void {
    this.publisher.republish()
    const conn = this.conn
    if (this.clientRefresh.semanticTokens) void conn.sendRequest(SemanticTokensRefreshRequest.type).catch(() => {})
    if (this.clientRefresh.inlayHint) void conn.sendRequest(InlayHintRefreshRequest.type).catch(() => {})
    if (this.clientRefresh.codeLens) void conn.sendRequest(CodeLensRefreshRequest.type).catch(() => {})
    if (this.clientRefresh.diagnostics) void conn.sendRequest(DiagnosticRefreshRequest.type).catch(() => {})
  }

  /** Live-apply a config change (`diagnoseDeadCode` + the opt-in `lints`) and re-publish open diagnostics.
   *  Returns false when the settings blob carries no recognized key (so the caller can fall back to a
   *  `workspace/configuration` pull). The vendor was decided at `initialize`, so it is not re-read here. */
  applyConfig(settings: unknown): boolean {
    if (settings === null || typeof settings !== "object") return false
    const s = settings as EditorOptions
    if (s.diagnoseDeadCode === undefined && s.diagnostics === undefined) return false
    this.editorOptions = { diagnoseDeadCode: s.diagnoseDeadCode === true, diagnostics: s.diagnostics }
    this.applyResolvedConfig()
    this.publisher.republish(true) // push-mode clients
    if (this.clientSupportsPull) void this.conn.sendRequest(DiagnosticRefreshRequest.type).catch(() => {}) // re-pull
    return true
  }

  /** The crawl, bracketed by the indexing progress. The token is created FIRST and `begin` sent only once the client
   *  accepted it (it cannot know a token it has not answered for); the create is bounded, so a client that never
   *  answers still gets its crawl — and with it its diagnostics. A refused or unanswered create crawls without
   *  progress; a late answer is ignored. Messages queued during the create run before the crawl: diagnostics are
   *  gated (`indexed`), tokens, hints and lenses get the post-crawl refresh. */
  async crawlWithProgress(): Promise<void> {
    if (this.root === undefined) return
    if (!this.clientProgress) return this.crawl()
    const token = `volt-index-${++this.progressSeq}`
    const accepted = await this.createProgress(token)
    if (accepted) void this.conn.sendProgress(WorkDoneProgress.type, token, { kind: "begin", title: "Indexing workspace" })
    this.crawl()
    if (accepted) void this.conn.sendProgress(WorkDoneProgress.type, token, { kind: "end" })
  }

  /** Whether the client accepted the progress `token` within {@link PROGRESS_CREATE_MS}. */
  private createProgress(token: string): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.log(MessageType.Warning, `volt-lsp-iec: no answer to window/workDoneProgress/create within ${PROGRESS_CREATE_MS} ms; indexing without progress`)
        resolve(false)
      }, PROGRESS_CREATE_MS)
      const settle = (accepted: boolean) => {
        clearTimeout(timer)
        resolve(accepted)
      }
      this.conn.sendRequest(WorkDoneProgressCreateRequest.type, { token }).then(
        () => settle(true),
        () => settle(false),
      )
    })
  }
}
