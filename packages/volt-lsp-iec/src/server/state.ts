/**
 * WHAT ONE SERVER PROCESS HOLDS — the workspace store, the vendor and root `initialize` decided (`vendor.ts`
 * `servedWorkspace`), what the client said it supports, the semantic-token cache — and the operations more than one
 * handler group runs over it: the crawl, the diagnostics push, the config. The handler groups (`handlers/`) register
 * their requests over ONE `ServerState` and decide nothing about the vendor themselves (openspec lsp-same-standard
 * design.md §8).
 */
import {
  CodeLensRefreshRequest,
  DiagnosticRefreshRequest,
  InlayHintRefreshRequest,
  PublishDiagnosticsNotification,
  SemanticTokensRefreshRequest,
  WorkDoneProgress,
  WorkDoneProgressCreateRequest,
  type ProtocolConnection,
} from "vscode-languageserver-protocol/node"
import { pathToFileURL } from "node:url"
import {
  resolveConfig,
  type AnalysisInitOptions,
  type ConfigurableCode,
  type DiagnosticState,
  type Vendor,
} from "../analysis/index.js"
import type { Scope } from "../frontend/symbols/index.js"
import { offsetFromPosition, type Document } from "../services/index.js"
import { scanWorkspace } from "../workspace/workspace-refs.js"
import type { WorkspaceStore } from "../workspace/workspace-store.js"
import { documentDiagnostics, libraryManifestDiagnostics } from "./document-diagnostics.js"

/** What the editor configures: everything but the vendor, which `initialize` decides. */
export type EditorOptions = Omit<AnalysisInitOptions, "vendor">

export class ServerState {
  // Decided once, at `initialize` (no request precedes it; a refused one serves nothing); the crawl runs at `initialized`.
  vendor!: Vendor
  store!: WorkspaceStore
  root: string | undefined
  /** What the EDITOR asked for, kept so a re-crawl can re-apply the project's settings on top of it. */
  editorOptions: EditorOptions = {}
  /** What the PROJECT configures (`.projectsettings`), refreshed by every crawl. */
  projectDiagnostics: Partial<Record<ConfigurableCode, DiagnosticState>> | undefined
  // False until the first workspace crawl has seeded the disk layer. Diagnostics resolve cross-file symbols from the
  // WHOLE-project table, so computing them before the crawl reports every other-file reference as "unresolved" — a
  // burst of false errors that only clears once indexing finishes. Gate all diagnostics on this; publish nothing
  // (not wrong things) until the project is indexed, then refresh.
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
  /** The manifest warnings a push-mode client was last sent (`pushManifestDiagnostics`). */
  private publishedManifests = new Set<string>()
  private progressSeq = 0

  constructor(readonly conn: ProtocolConnection) {}

  project(): Scope {
    return this.store.project()
  }

  workspace(): Document[] {
    return this.store.workspace()
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
   * not speak to — `diagnoseDeadCode`, and any code the project leaves at its default.
   */
  applyResolvedConfig(): void {
    this.store.config = resolveConfig({
      vendor: this.vendor,
      diagnoseDeadCode: this.editorOptions.diagnoseDeadCode,
      diagnostics: { ...this.editorOptions.diagnostics, ...this.projectDiagnostics },
    })
  }

  /** Re-crawl the workspace (source files + reference names + task roots) into the store, then refresh
   *  diagnostics for open documents. Run at `initialized` and on every watched-file event.
   *  ponytail: full rescan per event batch (client debounces); go incremental only if a project is big
   *  enough that a re-read stutters. */
  reindex(): void {
    if (this.root === undefined) return
    const scan = scanWorkspace(this.root)
    this.store.workspaceRefs = scan.refs
    this.store.taskRoots = scan.taskRoots
    // A crawl can bring a NEW `.projectsettings` (first pull, or the user changed it in the IDE and pulled),
    // so the config is re-resolved here, not only when the editor pushes settings.
    this.projectDiagnostics = scan.projectDiagnostics
    this.applyResolvedConfig()
    this.store.seedDisk(scan.sources.map((s) => ({ uri: pathToFileURL(s.path).href, source: s.source })))
    this.indexed = true // the disk layer is fully seeded — diagnostics can now resolve cross-file symbols
    for (const uri of this.store.openUris()) this.pushDiagnostics(uri)
    this.pushManifestDiagnostics()
    // A re-index can change tokens/hints/lenses in already-open files; ask the client to re-request them
    // (diagnostics we pushed above; these have no push channel, so a refresh is the only way to un-stale them).
    const conn = this.conn
    if (this.clientRefresh.semanticTokens) void conn.sendRequest(SemanticTokensRefreshRequest.type).catch(() => {})
    if (this.clientRefresh.inlayHint) void conn.sendRequest(InlayHintRefreshRequest.type).catch(() => {})
    if (this.clientRefresh.codeLens) void conn.sendRequest(CodeLensRefreshRequest.type).catch(() => {})
    if (this.clientRefresh.diagnostics) void conn.sendRequest(DiagnosticRefreshRequest.type).catch(() => {}) // pull-mode clients re-pull
  }

  pushDiagnostics(uri: string): void {
    if (this.clientSupportsPull) return // pull-mode client: it calls textDocument/diagnostic; pushing too would double up
    if (!this.indexed) return // pre-index: don't publish false cross-file errors — the crawl re-pushes once seeded
    const d = this.doc(uri)
    if (d === undefined) return
    void this.conn.sendNotification(PublishDiagnosticsNotification.type, {
      uri,
      diagnostics: documentDiagnostics(this.store, d),
    })
  }

  /** Each `.library` manifest an older bridge wrote, with the warning that says to re-pull it (`libraryManifestDiagnostics`). */
  manifestDiagnostics(): ReturnType<typeof libraryManifestDiagnostics> {
    return libraryManifestDiagnostics(this.store.workspaceRefs.libraryManifests)
  }

  /** The manifest warnings, for a push-mode client: published after every crawl, and cleared from a manifest a pull
   *  has since brought up to date. */
  pushManifestDiagnostics(): void {
    if (this.clientSupportsPull) return
    const now = this.manifestDiagnostics()
    for (const [uri, diagnostics] of now) void this.conn.sendNotification(PublishDiagnosticsNotification.type, { uri, diagnostics })
    for (const uri of this.publishedManifests)
      if (!now.has(uri)) void this.conn.sendNotification(PublishDiagnosticsNotification.type, { uri, diagnostics: [] })
    this.publishedManifests = new Set(now.keys())
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
    this.store.invalidate()
    for (const uri of this.store.openUris()) this.pushDiagnostics(uri) // push-mode clients
    if (this.clientSupportsPull) void this.conn.sendRequest(DiagnosticRefreshRequest.type).catch(() => {}) // pull-mode: re-pull with new config
    return true
  }

  /** The eager crawl at startup. CRUCIAL: the crawl is synchronous and runs before any `await` — a didOpen/pull the
   *  client already queued behind `initialized` must not be answered against a half-seeded project (that's the
   *  false-errors-then-recover flicker). The progress create/begin round-trip is therefore fire-and-forget so it
   *  can never defer the crawl; since the crawl blocks the loop, the bar brackets it rather than animating. */
  crawlWithProgress(): void {
    if (this.root === undefined) return
    let token: string | undefined
    if (this.clientProgress) {
      token = `volt-index-${++this.progressSeq}`
      const t = token
      void this.conn
        .sendRequest(WorkDoneProgressCreateRequest.type, { token: t })
        .then(() => this.conn.sendProgress(WorkDoneProgress.type, t, { kind: "begin", title: "Indexing workspace" }))
        .catch(() => {})
    }
    this.reindex() // synchronous — completes (indexed = true) before this returns, i.e. before the loop handles anything else
    if (token !== undefined) void this.conn.sendProgress(WorkDoneProgress.type, token, { kind: "end" })
  }
}
