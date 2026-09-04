/**
 * LSP server (Layer G, G.1) — LSP 3.17 over stdio, vendor-keyed. Wires the analysis diagnostics + every
 * E service to the protocol via `vscode-languageserver-protocol`'s connection. Incremental document
 * sync (TextDocument), push diagnostics on change, one rebuilt project symbol table per workspace edit.
 *
 * Thin dispatch: each handler converts LSP Position→offset and calls the matching service. The heavy
 * lifting lives in the layers below; this file is glue + capability advertisement.
 */
import type { Readable, Writable } from "node:stream"
import {
  CallHierarchyIncomingCallsRequest,
  CallHierarchyOutgoingCallsRequest,
  CallHierarchyPrepareRequest,
  CodeActionRequest,
  CompletionRequest,
  ConfigurationRequest,
  createProtocolConnection,
  DefinitionRequest,
  DiagnosticRefreshRequest,
  DidChangeConfigurationNotification,
  DidChangeTextDocumentNotification,
  DidChangeWatchedFilesNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  DidSaveTextDocumentNotification,
  DocumentDiagnosticRequest,
  DocumentDiagnosticReportKind,
  DocumentFormattingRequest,
  DocumentHighlightRequest,
  DocumentOnTypeFormattingRequest,
  DocumentRangeFormattingRequest,
  DocumentSymbolRequest,
  ExitNotification,
  FoldingRangeRequest,
  HoverRequest,
  ImplementationRequest,
  InitializedNotification,
  InitializeRequest,
  InlayHintRefreshRequest,
  InlayHintRequest,
  LinkedEditingRangeRequest,
  PrepareRenameRequest,
  PublishDiagnosticsNotification,
  ReferencesRequest,
  RegistrationRequest,
  RenameRequest,
  SelectionRangeRequest,
  SemanticTokensDeltaRequest,
  SemanticTokensRangeRequest,
  SemanticTokensRefreshRequest,
  SemanticTokensRequest,
  ShutdownRequest,
  SignatureHelpRequest,
  StreamMessageReader,
  StreamMessageWriter,
  TextDocumentSyncKind,
  TypeDefinitionRequest,
  TypeHierarchyPrepareRequest,
  TypeHierarchySubtypesRequest,
  TypeHierarchySupertypesRequest,
  WorkDoneProgress,
  WorkDoneProgressCreateRequest,
  WorkspaceDiagnosticRequest,
  WorkspaceSymbolRequest,
  CodeLensRefreshRequest,
  CodeLensRequest,
  type DocumentDiagnosticReport,
  type InitializeResult,
  type WorkspaceDiagnosticReport,
} from "vscode-languageserver-protocol/node.js"
import { fileURLToPath, pathToFileURL } from "node:url"
import {
  messagesFor,
  resolveConfig,
  type AnalysisInitOptions,
  type ConfigurableCode,
  type DiagnosticState,
  type Vendor,
} from "../analysis/index.js"
import { scanWorkspace } from "../workspace-refs.js"
import { SOURCE_EXTENSIONS } from "../source-extensions.js"
import type { Scope, Symbol } from "../symbols/index.js"
import { WorkspaceStore } from "./workspace-store.js"
import { documentDiagnostics } from "./diagnostics.js"
import {
  callIncoming,
  callOutgoing,
  codeActions,
  codeLenses,
  completion,
  definition,
  foldingRanges,
  formatDocument,
  formatRange,
  hover,
  implementation,
  inlayHints,
  pragmaHover,
  prepareCallHierarchy,
  prepareTypeHierarchy,
  offsetFromPosition,
  selectionRange,
  diffSemanticTokens,
  semanticTokensData,
  semanticTokensRange,
  SEMANTIC_TOKEN_TYPES,
  signatureHelp,
  typeDefinition,
  typeSubtypes,
  typeSupertypes,
  workspaceSymbols,
  type Document,
  type HierItem,
} from "../services/index.js"
import {
  documentHighlightsAnywhere,
  documentSymbolsWithVg,
  inNetworkText,
  prepareRenameAnywhere,
  referencesAnywhere,
  renameAnywhere,
  networkCompletion,
  networkDefinition,
  networkHover,
  networkMarkerHover,
  networkTypeDefinition,
} from "../network/index.js"

/** Resolve the workspace root to a filesystem path from a `file://` `rootUri` (preferred) or `rootPath`. */
function workspaceRoot(rootUri: string | null | undefined, rootPath: string | null | undefined): string | undefined {
  if (rootUri != null && rootUri.length > 0) {
    try {
      return fileURLToPath(rootUri)
    } catch {
      // not a file:// URI — fall through to rootPath
    }
  }
  return rootPath != null && rootPath.length > 0 ? rootPath : undefined
}

export function runServer(input: Readable, output: Writable, vendor: Vendor = "codesys", version = "(dev)"): void {
  const conn = createProtocolConnection(new StreamMessageReader(input), new StreamMessageWriter(output))
  const messages = messagesFor(vendor)
  const store = new WorkspaceStore(resolveConfig({ vendor }))
  // Set on initialize; the eager crawl + watcher registration run in the `initialized` handler.
  let root: string | undefined
  /** What the EDITOR asked for, kept so a re-crawl can re-apply the project's settings on top of it. */
  let editorOptions: AnalysisInitOptions = {}
  /** What the PROJECT configures (`.projectsettings`), refreshed by every crawl. */
  let projectDiagnostics: Partial<Record<ConfigurableCode, DiagnosticState>> | undefined

  /**
   * Resolve the config from both sources, PROJECT LAST.
   *
   * A compiler warning's state is a fact about the project, not a preference of whoever opened it: CODESYS
   * stores it in the project, the bridge mirrors it into `.projectsettings`, and it must therefore beat an
   * editor setting rather than be overridden by one. Editor options still own everything the project does
   * not speak to — `diagnoseDeadCode`, and any code the project leaves at its default.
   */
  function applyResolvedConfig(): void {
    store.config = resolveConfig({
      vendor,
      diagnoseDeadCode: editorOptions.diagnoseDeadCode,
      diagnostics: { ...editorOptions.diagnostics, ...projectDiagnostics },
    })
  }
  // False until the first workspace crawl has seeded the disk layer. Diagnostics resolve cross-file symbols from the
  // WHOLE-project table, so computing them before the crawl reports every other-file reference as "unresolved" — a
  // burst of false errors that only clears once indexing finishes. Gate all diagnostics on this; publish nothing
  // (not wrong things) until the project is indexed, then refresh.
  let indexed = false
  let clientWatchDynReg = false
  let clientConfigPull = false
  let clientProgress = false
  // When the client supports PULL diagnostics (it will call textDocument/diagnostic), we must NOT also push via
  // publishDiagnostics — doing both makes every diagnostic appear twice. We still declare the pull provider.
  let clientSupportsPull = false
  // Which derived data the client will re-request when we send a refresh (after a re-index).
  const clientRefresh = { semanticTokens: false, inlayHint: false, codeLens: false, diagnostics: false }
  // Latest semantic-token result per URI (for `full/delta` diffing) + a monotonic result-id source.
  const semTok = new Map<string, { resultId: string; data: number[] }>()
  let semTokSeq = 0

  const project = () => store.project()
  const workspace = (): Document[] => store.workspace()
  const doc = (uri: string): Document | undefined => store.doc(uri)

  /** Re-crawl the workspace (source files + reference names + task roots) into the store, then refresh
   *  diagnostics for open documents. Run at `initialized` and on every watched-file event.
   *  ponytail: full rescan per event batch (client debounces); go incremental only if a project is big
   *  enough that a re-read stutters. */
  function reindex(): void {
    if (root === undefined) return
    const scan = scanWorkspace(root)
    store.workspaceRefs = scan.refs
    store.taskRoots = scan.taskRoots
    // A crawl can bring a NEW `.projectsettings` (first pull, or the user changed it in the IDE and pulled),
    // so the config is re-resolved here, not only when the editor pushes settings.
    projectDiagnostics = scan.projectDiagnostics
    applyResolvedConfig()
    store.seedDisk(scan.sources.map((s) => ({ uri: pathToFileURL(s.path).href, source: s.source })))
    indexed = true // the disk layer is fully seeded — diagnostics can now resolve cross-file symbols
    for (const uri of store.openUris()) pushDiagnostics(uri)
    // A re-index can change tokens/hints/lenses in already-open files; ask the client to re-request them
    // (diagnostics we pushed above; these have no push channel, so a refresh is the only way to un-stale them).
    if (clientRefresh.semanticTokens) void conn.sendRequest(SemanticTokensRefreshRequest.type).catch(() => {})
    if (clientRefresh.inlayHint) void conn.sendRequest(InlayHintRefreshRequest.type).catch(() => {})
    if (clientRefresh.codeLens) void conn.sendRequest(CodeLensRefreshRequest.type).catch(() => {})
    if (clientRefresh.diagnostics) void conn.sendRequest(DiagnosticRefreshRequest.type).catch(() => {}) // pull-mode clients re-pull
  }

  function pushDiagnostics(uri: string): void {
    if (clientSupportsPull) return // pull-mode client: it calls textDocument/diagnostic; pushing too would double up
    if (!indexed) return // pre-index: don't publish false cross-file errors — the crawl re-pushes once seeded
    const d = doc(uri)
    if (d === undefined) return
    void conn.sendNotification(PublishDiagnosticsNotification.type, {
      uri,
      diagnostics: documentDiagnostics(store, messages, d),
    })
  }

  /** Live-apply a config change (`diagnoseDeadCode` + the opt-in `lints`) and re-publish open diagnostics.
   *  Returns false when the settings blob carries no recognized key (so the caller can fall back to a
   *  `workspace/configuration` pull). Vendor is fixed at launch, so it is not re-read here. */
  function applyConfig(settings: unknown): boolean {
    if (settings === null || typeof settings !== "object") return false
    const s = settings as AnalysisInitOptions
    if (s.diagnoseDeadCode === undefined && s.diagnostics === undefined) return false
    editorOptions = { diagnoseDeadCode: s.diagnoseDeadCode === true, diagnostics: s.diagnostics }
    applyResolvedConfig()
    store.invalidate()
    for (const uri of store.openUris()) pushDiagnostics(uri) // push-mode clients
    if (clientSupportsPull) void conn.sendRequest(DiagnosticRefreshRequest.type).catch(() => {}) // pull-mode: re-pull with new config
    return true
  }

  let progressSeq = 0
  /** The eager crawl at startup. CRUCIAL: the crawl is synchronous and runs before any `await` — a didOpen/pull the
   *  client already queued behind `initialized` must not be answered against a half-seeded project (that's the
   *  false-errors-then-recover flicker). The progress create/begin round-trip is therefore fire-and-forget so it
   *  can never defer the crawl; since the crawl blocks the loop, the bar brackets it rather than animating. */
  function crawlWithProgress(): void {
    if (root === undefined) return
    let token: string | undefined
    if (clientProgress) {
      token = `volt-index-${++progressSeq}`
      void conn
        .sendRequest(WorkDoneProgressCreateRequest.type, { token })
        .then(() => conn.sendProgress(WorkDoneProgress.type, token!, { kind: "begin", title: "Indexing workspace" }))
        .catch(() => {})
    }
    reindex() // synchronous — completes (indexed = true) before this returns, i.e. before the loop handles anything else
    if (token !== undefined) void conn.sendProgress(WorkDoneProgress.type, token, { kind: "end" })
  }

  // ─── lifecycle ───────────────────────────────────────────────────────────
  conn.onRequest(InitializeRequest.type, (params): InitializeResult => {
    const opts = params.initializationOptions as AnalysisInitOptions | undefined
    if (opts !== undefined && (opts.diagnoseDeadCode !== undefined || opts.diagnostics !== undefined)) {
      editorOptions = { diagnoseDeadCode: opts.diagnoseDeadCode, diagnostics: opts.diagnostics }
      applyResolvedConfig()
    }
    root = workspaceRoot(params.rootUri, params.rootPath)
    // No workspace root ⇒ no crawl to wait for (single-file / bare client): the open buffer IS the project, so let
    // diagnostics flow at once. WITH a root, stay gated until the `initialized` crawl seeds the disk layer.
    indexed = root === undefined
    const ws = params.capabilities.workspace
    clientWatchDynReg = ws?.didChangeWatchedFiles?.dynamicRegistration === true
    clientRefresh.semanticTokens = ws?.semanticTokens?.refreshSupport === true
    clientRefresh.inlayHint = ws?.inlayHint?.refreshSupport === true
    clientRefresh.codeLens = ws?.codeLens?.refreshSupport === true
    clientRefresh.diagnostics = ws?.diagnostics?.refreshSupport === true
    clientConfigPull = ws?.configuration === true
    clientProgress = params.capabilities.window?.workDoneProgress === true
    clientSupportsPull = params.capabilities.textDocument?.diagnostic !== undefined
    return {
      capabilities: {
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
        documentOnTypeFormattingProvider: { firstTriggerCharacter: ";", moreTriggerCharacter: ["\n"] },
        linkedEditingRangeProvider: true,
        semanticTokensProvider: {
          legend: { tokenTypes: [...SEMANTIC_TOKEN_TYPES], tokenModifiers: [] },
          full: { delta: true },
          range: true,
        },
        // Pull diagnostics: our diagnostics span the project (a sibling type changes a file's errors), and we
        // answer workspace-wide pulls too.
        diagnosticProvider: { interFileDependencies: true, workspaceDiagnostics: true },
      },
      serverInfo: { name: "volt-lsp-iec", version },
    }
  })

  // `initialized` follows the handshake — do the heavy eager crawl here (synchronously, so nothing is diagnosed
  // against a half-seeded project) so the InitializeResult stays instant, then register the file watcher so
  // `volt pull` changes re-index without a restart.
  conn.onNotification(InitializedNotification.type, () => {
    crawlWithProgress()
    if (root !== undefined && clientWatchDynReg) {
      const exts = [...SOURCE_EXTENSIONS, ".library", ".device", ".task"]
      conn
        .sendRequest(RegistrationRequest.type, {
          registrations: [
            {
              id: "volt-watch",
              method: DidChangeWatchedFilesNotification.method,
              registerOptions: { watchers: exts.map((ext) => ({ globPattern: `**/*${ext}` })) },
            },
          ],
        })
        .catch(() => {}) // a client that advertised dynamicRegistration but can't register — degrade to fresh-at-init
    }
  })
  conn.onRequest(ShutdownRequest.type, () => null)
  conn.onNotification(ExitNotification.type, () => process.exit(0))

  // ─── document sync ───────────────────────────────────────────────────────
  conn.onNotification(DidOpenTextDocumentNotification.type, (p) => {
    const t = p.textDocument
    store.openDocument(t.uri, t.languageId, t.version, t.text)
    pushDiagnostics(t.uri)
  })
  conn.onNotification(DidChangeTextDocumentNotification.type, (p) => {
    if (!store.changeDocument(p.textDocument.uri, p.textDocument.version, p.contentChanges)) return
    pushDiagnostics(p.textDocument.uri)
  })
  conn.onNotification(DidCloseTextDocumentNotification.type, (p) => {
    store.closeDocument(p.textDocument.uri)
    semTok.delete(p.textDocument.uri) // drop the semantic-token result cache for the closed doc
    // The file may still be in the disk index; re-publish so any diagnostics reflect the on-disk copy.
    pushDiagnostics(p.textDocument.uri)
    // Clear diagnostics for a file no longer indexed — but only for push clients. A pull client owns its
    // channel (it re-pulls and gets []); pushing to it here would be the very double-channel the pull guard
    // forbids. (Guarded like pushDiagnostics; not `clientSupportsPull` inline so the intent reads.)
    if (!clientSupportsPull && doc(p.textDocument.uri) === undefined)
      void conn.sendNotification(PublishDiagnosticsNotification.type, { uri: p.textDocument.uri, diagnostics: [] })
  })
  // A save re-validates (a fallback for clients that don't emit watched-file events); the open buffer is
  // already current, so this is just a re-publish.
  conn.onNotification(DidSaveTextDocumentNotification.type, (p) => pushDiagnostics(p.textDocument.uri))

  // ─── live configuration ────────────────────────────────────────────────────
  conn.onNotification(DidChangeConfigurationNotification.type, (p) => {
    if (applyConfig(p.settings)) return // config pushed with the notification
    if (clientConfigPull)
      void conn
        .sendRequest(ConfigurationRequest.type, { items: [{ section: "volt" }] })
        .then((res) => applyConfig(Array.isArray(res) ? res[0] : undefined))
        .catch(() => {})
  })

  // ─── watched files (freshness): re-index on create/change/delete of source + reference files ──
  // A full rescan reflects creates, deletes, and reference-file edits in one path (reads current disk).
  conn.onNotification(DidChangeWatchedFilesNotification.type, () => reindex())

  // ─── pull diagnostics (same compute as the push transport) ─────────────────
  conn.onRequest(DocumentDiagnosticRequest.type, (p): DocumentDiagnosticReport => {
    const d = doc(p.textDocument.uri)
    // Pre-index: report NO diagnostics (not false ones). The `initialized` refresh makes the client re-pull once
    // the crawl seeds the project, so the real diagnostics land a moment later instead of flickering wrong first.
    return {
      kind: DocumentDiagnosticReportKind.Full,
      items: indexed && d !== undefined ? documentDiagnostics(store, messages, d) : [],
    }
  })
  conn.onRequest(
    WorkspaceDiagnosticRequest.type,
    (): WorkspaceDiagnosticReport => ({
      items: indexed
        ? store.workspace().map((d) => ({
            kind: DocumentDiagnosticReportKind.Full,
            uri: d.uri,
            version: null,
            items: documentDiagnostics(store, messages, d),
          }))
        : [],
    }),
  )

  // ─── position-based queries ──────────────────────────────────────────────
  const at = <T>(
    uri: string,
    pos: { line: number; character: number },
    fn: (d: Document, off: number) => T,
  ): T | null => {
    const d = doc(uri)
    if (d === undefined) return null
    const off = offsetFromPosition(d.source, pos)
    return off < 0 ? null : (fn(d, off) ?? null)
  }

  conn.onRequest(HoverRequest.type, (p) =>
    at(p.textDocument.uri, p.position, (d, o) =>
      inNetworkText(d, o) ? networkHover(d, project(), o) : (hover(d, project(), o) ?? pragmaHover(d, o) ?? networkMarkerHover(d, o)),
    ),
  )
  conn.onRequest(DefinitionRequest.type, (p) =>
    at(p.textDocument.uri, p.position, (d, o) =>
      inNetworkText(d, o) ? networkDefinition(d, project(), o) : definition(d, project(), o),
    ),
  )
  conn.onRequest(TypeDefinitionRequest.type, (p) =>
    at(p.textDocument.uri, p.position, (d, o) =>
      inNetworkText(d, o) ? networkTypeDefinition(d, project(), o) : typeDefinition(d, project(), o),
    ),
  )
  conn.onRequest(ImplementationRequest.type, (p) =>
    at(p.textDocument.uri, p.position, (d, o) => implementation(workspace(), project(), d, o) ?? null),
  )
  conn.onRequest(ReferencesRequest.type, (p) =>
    at(
      p.textDocument.uri,
      p.position,
      (d, o) => referencesAnywhere(workspace(), project(), d, o, p.context.includeDeclaration) ?? null,
    ),
  )
  conn.onRequest(DocumentHighlightRequest.type, (p) =>
    at(
      p.textDocument.uri,
      p.position,
      (d, o) => documentHighlightsAnywhere(d, project(), o)?.map((range) => ({ range })) ?? null,
    ),
  )
  conn.onRequest(CompletionRequest.type, (p) =>
    at(p.textDocument.uri, p.position, (d, o) =>
      inNetworkText(d, o) ? networkCompletion(d, project(), o) : completion(d, project(), o),
    ),
  )
  conn.onRequest(SignatureHelpRequest.type, (p) =>
    at(p.textDocument.uri, p.position, (d, o) => signatureHelp(d, project(), o)),
  )
  conn.onRequest(PrepareRenameRequest.type, (p) =>
    at(p.textDocument.uri, p.position, (d, o) => prepareRenameAnywhere(d, project(), o)),
  )
  conn.onRequest(RenameRequest.type, (p) =>
    at(p.textDocument.uri, p.position, (d, o) => renameAnywhere(workspace(), project(), d, o, p.newName) ?? null),
  )
  conn.onRequest(SelectionRangeRequest.type, (p) => {
    const d = doc(p.textDocument.uri)
    if (d === undefined) return null
    return p.positions.map(
      (pos) => selectionRange(d, offsetFromPosition(d.source, pos)) ?? { range: { start: pos, end: pos } },
    )
  })

  // ─── call / type hierarchy ─────────────────────────────────────────────────
  // The client re-sends the prepared item on the follow-up call; re-resolve it to its Symbol by mapping the
  // item's (uri, selectionRange) back to a document offset and running the same prepare — one resolution path.
  const reResolve = (
    item: HierItem,
    prepare: (d: Document, project: Scope, o: number) => { sym: Symbol } | undefined,
  ): { d: Document; sym: Symbol } | undefined => {
    const d = doc(item.uri)
    if (d === undefined) return undefined
    const off = offsetFromPosition(d.source, item.selectionRange.start)
    if (off < 0) return undefined
    const p = prepare(d, project(), off)
    return p !== undefined ? { d, sym: p.sym } : undefined
  }

  conn.onRequest(CallHierarchyPrepareRequest.type, (p) =>
    at(p.textDocument.uri, p.position, (d, o) => {
      const r = prepareCallHierarchy(d, project(), o)
      return r !== undefined ? [r.item] : null
    }),
  )
  conn.onRequest(CallHierarchyIncomingCallsRequest.type, (p) => {
    const r = reResolve(p.item, prepareCallHierarchy)
    return r === undefined
      ? null
      : callIncoming(workspace(), project(), r.sym).map((c) => ({ from: c.item, fromRanges: c.ranges }))
  })
  conn.onRequest(CallHierarchyOutgoingCallsRequest.type, (p) => {
    const r = reResolve(p.item, prepareCallHierarchy)
    return r === undefined
      ? null
      : callOutgoing(r.d, project(), r.sym).map((c) => ({ to: c.item, fromRanges: c.ranges }))
  })

  conn.onRequest(TypeHierarchyPrepareRequest.type, (p) =>
    at(p.textDocument.uri, p.position, (d, o) => {
      const r = prepareTypeHierarchy(d, project(), o)
      return r !== undefined ? [r.item] : null
    }),
  )
  conn.onRequest(TypeHierarchySupertypesRequest.type, (p) => {
    const r = reResolve(p.item, prepareTypeHierarchy)
    return r === undefined ? null : typeSupertypes(project(), r.sym)
  })
  conn.onRequest(TypeHierarchySubtypesRequest.type, (p) => {
    const r = reResolve(p.item, prepareTypeHierarchy)
    return r === undefined ? null : typeSubtypes(workspace(), r.sym)
  })

  conn.onRequest(WorkspaceSymbolRequest.type, (p) => workspaceSymbols(project(), p.query))

  // ─── document-wide queries ───────────────────────────────────────────────
  const whole = <T>(uri: string, fn: (d: Document) => T): T | null => {
    const d = doc(uri)
    return d !== undefined ? fn(d) : null
  }
  conn.onRequest(DocumentSymbolRequest.type, (p) => whole(p.textDocument.uri, documentSymbolsWithVg))
  conn.onRequest(FoldingRangeRequest.type, (p) => whole(p.textDocument.uri, foldingRanges))
  conn.onRequest(SemanticTokensRequest.type, (p) =>
    whole(p.textDocument.uri, (d) => {
      const data = semanticTokensData(d, project())
      const resultId = String(++semTokSeq)
      semTok.set(p.textDocument.uri, { resultId, data })
      return { resultId, data }
    }),
  )
  conn.onRequest(SemanticTokensRangeRequest.type, (p) => {
    const d = doc(p.textDocument.uri)
    if (d === undefined) return null
    return semanticTokensRange(
      d,
      project(),
      offsetFromPosition(d.source, p.range.start),
      offsetFromPosition(d.source, p.range.end),
    )
  })
  conn.onRequest(SemanticTokensDeltaRequest.type, (p) =>
    whole(p.textDocument.uri, (d) => {
      const data = semanticTokensData(d, project())
      const resultId = String(++semTokSeq)
      const prev = semTok.get(p.textDocument.uri)
      semTok.set(p.textDocument.uri, { resultId, data })
      // Diff against the client's prior result if it's the one we cached; else fall back to a full set.
      return prev !== undefined && prev.resultId === p.previousResultId
        ? { resultId, edits: diffSemanticTokens(prev.data, data) }
        : { resultId, data }
    }),
  )
  conn.onRequest(CodeLensRequest.type, (p) => whole(p.textDocument.uri, (d) => codeLenses(workspace(), project(), d)))
  conn.onRequest(InlayHintRequest.type, (p) => {
    const d = doc(p.textDocument.uri)
    if (d === undefined) return null
    return inlayHints(
      d,
      project(),
      offsetFromPosition(d.source, p.range.start),
      offsetFromPosition(d.source, p.range.end),
    )
  })
  conn.onRequest(CodeActionRequest.type, (p) =>
    whole(p.textDocument.uri, (d) => codeActions(d, project(), p.context.diagnostics)),
  )
  conn.onRequest(DocumentFormattingRequest.type, (p) =>
    whole(p.textDocument.uri, (d) => {
      const lineCount = d.source.split("\n").length
      // one whole-document edit spanning [0,0]..[lineCount,0]
      return [
        {
          range: { start: { line: 0, character: 0 }, end: { line: lineCount, character: 0 } },
          newText: formatDocument(d, p.options),
        },
      ]
    }),
  )
  conn.onRequest(DocumentRangeFormattingRequest.type, (p) =>
    whole(p.textDocument.uri, (d) => formatRange(d, p.range, p.options)),
  )
  // Format-on-type: reformat the line the trigger character landed on (reuses range formatting).
  conn.onRequest(DocumentOnTypeFormattingRequest.type, (p) =>
    whole(p.textDocument.uri, (d) => {
      const lineLen = (d.source.split("\n")[p.position.line] ?? "").length
      const range = {
        start: { line: p.position.line, character: 0 },
        end: { line: p.position.line, character: lineLen },
      }
      return formatRange(d, range, p.options)
    }),
  )
  // Linked editing: the occurrences of the identifier at the cursor, edited together (reuses highlights).
  conn.onRequest(LinkedEditingRangeRequest.type, (p) =>
    at(p.textDocument.uri, p.position, (d, o) => {
      const ranges = documentHighlightsAnywhere(d, project(), o)
      return ranges !== undefined && ranges.length > 0 ? { ranges } : null
    }),
  )

  conn.listen()
}
