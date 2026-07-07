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
  createProtocolConnection,
  DefinitionRequest,
  DiagnosticSeverity,
  DidChangeTextDocumentNotification,
  DidChangeWatchedFilesNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  DocumentFormattingRequest,
  DocumentHighlightRequest,
  DocumentRangeFormattingRequest,
  DocumentSymbolRequest,
  ExitNotification,
  FoldingRangeRequest,
  HoverRequest,
  ImplementationRequest,
  InitializedNotification,
  InitializeRequest,
  InlayHintRequest,
  PrepareRenameRequest,
  PublishDiagnosticsNotification,
  ReferencesRequest,
  RegistrationRequest,
  RenameRequest,
  SelectionRangeRequest,
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
  WorkspaceSymbolRequest,
  CodeLensRequest,
  type Diagnostic,
  type InitializeResult,
} from "vscode-languageserver-protocol/node.js"
import { fileURLToPath, pathToFileURL } from "node:url"
import {
  computeSemanticDiagnostics,
  inDeadMember,
  messagesFor,
  ownerPou,
  resolveConfig,
  type DiagnosticItem,
  type Vendor,
} from "../analysis/index.js"
import { scanWorkspace, SOURCE_EXTENSIONS } from "../workspace-refs.js"
import type { Scope, Symbol } from "../symbols/index.js"
import { WorkspaceStore } from "./workspace-store.js"
import {
  callIncoming,
  callOutgoing,
  codeActions,
  codeLenses,
  completion,
  definition,
  documentHighlights,
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
  rangeFromSpan,
  selectionRange,
  semanticTokens,
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
  computeVgDiagnostics,
  documentSymbolsWithVg,
  inVgBody,
  prepareRenameAnywhere,
  referencesAnywhere,
  renameAnywhere,
  vgCompletion,
  vgDefinition,
  vgHover,
  vgMarkerHover,
  vgTypeDefinition,
} from "../graphical/index.js"

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

const SEVERITY: Record<DiagnosticItem["severity"], DiagnosticSeverity> = {
  error: DiagnosticSeverity.Error,
  warning: DiagnosticSeverity.Warning,
  information: DiagnosticSeverity.Information,
  hint: DiagnosticSeverity.Hint,
}

export function runServer(input: Readable, output: Writable, vendor: Vendor = "codesys"): void {
  const conn = createProtocolConnection(new StreamMessageReader(input), new StreamMessageWriter(output))
  const messages = messagesFor(vendor)
  const store = new WorkspaceStore(resolveConfig({ vendor }))
  // Set on initialize; the eager crawl + watcher registration run in the `initialized` handler.
  let root: string | undefined
  let clientWatchDynReg = false

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
    store.seedDisk(scan.sources.map((s) => ({ uri: pathToFileURL(s.path).href, source: s.source })))
    for (const uri of store.openUris()) pushDiagnostics(uri)
  }

  function pushDiagnostics(uri: string): void {
    const d = doc(uri)
    if (d === undefined) return
    // Suppress semantic diagnostics on a structurally-dead unit (the compiler never checks it either).
    // Parse errors always ride through — a genuinely broken parse is a real problem, not a dead-code FP.
    const owner = ownerPou(d.parseResult)
    const dead = owner !== undefined && store.deadSet().has(owner)
    // Excluded/uncalled methods inside this (live) file — their diagnostics are suppressed too. Keyed by the
    // resolved doc's URI (`d.uri`), which is the disk-crawl URI for a closed-but-on-disk file, not the raw
    // client URI — the deadMembers map is keyed the same way, so `uri` (client) would miss after a close.
    const dm = dead ? undefined : store.deadMembers().get(d.uri)
    const items = dead
      ? []
      : computeSemanticDiagnostics({
          parseResult: d.parseResult,
          source: d.source,
          project: project(),
          config: store.config,
          references: store.workspaceRefs,
        }).filter((it) => !inDeadMember(it.span, dm))
    const diagnostics: Diagnostic[] = [
      ...items.map(toLspDiagnostic),
      ...(dead ? [] : computeVgDiagnostics(d, project(), messages, store.workspaceRefs))
        .filter((it) => !inDeadMember(it.span, dm))
        .map(toLspDiagnostic),
      ...d.parseResult.errors.map((e) => ({
        range: rangeFromSpan(e.span),
        severity: DiagnosticSeverity.Error,
        source: "volt-lsp-iec",
        message: e.message,
      })),
    ]
    void conn.sendNotification(PublishDiagnosticsNotification.type, { uri, diagnostics })
  }

  // ─── lifecycle ───────────────────────────────────────────────────────────
  conn.onRequest(InitializeRequest.type, (params): InitializeResult => {
    const opts = params.initializationOptions as { diagnoseDeadCode?: boolean } | undefined
    if (opts?.diagnoseDeadCode !== undefined)
      store.config = resolveConfig({ vendor, diagnoseDeadCode: opts.diagnoseDeadCode })
    root = workspaceRoot(params.rootUri, params.rootPath)
    clientWatchDynReg = params.capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration === true
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
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
        semanticTokensProvider: {
          legend: { tokenTypes: [...SEMANTIC_TOKEN_TYPES], tokenModifiers: [] },
          full: true,
        },
      },
      serverInfo: { name: "volt-lsp-iec", version: "0.1.0" },
    }
  })

  // `initialized` follows the handshake — do the heavy eager crawl here so the InitializeResult stays
  // instant, then register the file watcher so `volt pull` changes re-index without a restart.
  conn.onNotification(InitializedNotification.type, () => {
    reindex()
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
    // The file may still be in the disk index; re-publish so any diagnostics reflect the on-disk copy.
    pushDiagnostics(p.textDocument.uri)
    if (doc(p.textDocument.uri) === undefined)
      void conn.sendNotification(PublishDiagnosticsNotification.type, { uri: p.textDocument.uri, diagnostics: [] })
  })

  // ─── watched files (freshness): re-index on create/change/delete of source + reference files ──
  // A full rescan reflects creates, deletes, and reference-file edits in one path (reads current disk).
  conn.onNotification(DidChangeWatchedFilesNotification.type, () => reindex())

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
      inVgBody(d, o) ? vgHover(d, project(), o) : (hover(d, project(), o) ?? pragmaHover(d, o) ?? vgMarkerHover(d, o)),
    ),
  )
  conn.onRequest(DefinitionRequest.type, (p) =>
    at(p.textDocument.uri, p.position, (d, o) =>
      inVgBody(d, o) ? vgDefinition(d, project(), o) : definition(d, project(), o),
    ),
  )
  conn.onRequest(TypeDefinitionRequest.type, (p) =>
    at(p.textDocument.uri, p.position, (d, o) =>
      inVgBody(d, o) ? vgTypeDefinition(d, project(), o) : typeDefinition(d, project(), o),
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
      (d, o) => documentHighlights(d, project(), o)?.map((range) => ({ range })) ?? null,
    ),
  )
  conn.onRequest(CompletionRequest.type, (p) =>
    at(p.textDocument.uri, p.position, (d, o) =>
      inVgBody(d, o) ? vgCompletion(d, project(), o) : completion(d, project(), o),
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
  conn.onRequest(SemanticTokensRequest.type, (p) => whole(p.textDocument.uri, (d) => semanticTokens(d, project())))
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

  conn.listen()
}

function toLspDiagnostic(item: DiagnosticItem): Diagnostic {
  return {
    range: rangeFromSpan(item.span),
    severity: SEVERITY[item.severity],
    source: item.source,
    code: item.code,
    message: item.message,
  }
}
