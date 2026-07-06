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
  CodeActionRequest,
  CompletionRequest,
  createProtocolConnection,
  DefinitionRequest,
  DiagnosticSeverity,
  DidChangeTextDocumentNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  DocumentFormattingRequest,
  DocumentHighlightRequest,
  DocumentRangeFormattingRequest,
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
  TextDocumentSyncKind,
  TypeDefinitionRequest,
  CodeLensRequest,
  type Diagnostic,
  type InitializeResult,
} from "vscode-languageserver-protocol/node.js"
import { TextDocument } from "vscode-languageserver-textdocument"
import { fileURLToPath } from "node:url"
import { parseSource } from "../syntax/index.js"
import { buildSymbolTable, type Scope } from "../symbols/index.js"
import {
  computeSemanticDiagnostics,
  deadPous,
  EMPTY_WORKSPACE_REFS,
  messagesFor,
  ownerPou,
  resolveConfig,
  type DiagnosticItem,
  type Vendor,
  type WorkspaceRefs,
} from "../analysis/index.js"
import { loadWorkspaceRefs, loadTaskRoots } from "../workspace-refs.js"
import {
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
  offsetFromPosition,
  prepareRename,
  rangeFromSpan,
  references,
  rename,
  selectionRange,
  semanticTokens,
  SEMANTIC_TOKEN_TYPES,
  signatureHelp,
  typeDefinition,
  type Document,
} from "../services/index.js"
import {
  computeVgDiagnostics,
  documentSymbolsWithVg,
  inVgBody,
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
  // Reassigned on initialize once the client's initializationOptions arrive (e.g. `diagnoseDeadCode`).
  let config = resolveConfig({ vendor })
  // Workspace reference-file names (library namespaces + device instances) — loaded once from the root on
  // initialize; the unresolved-identifier check skips them. Empty until then / when there is no root.
  let workspaceRefs: WorkspaceRefs = EMPTY_WORKSPACE_REFS
  // Task-entry PROGRAM names (from `.task` `Calls:`) — dead-code reachability seeds its roots from these.
  let taskRoots: ReadonlySet<string> | undefined
  const messages = messagesFor(vendor)
  const docs = new Map<string, TextDocument>()
  let cachedProject: Scope | undefined
  let cachedDead: Set<string> | undefined

  const project = (): Scope => (cachedProject ??= rebuild())
  const rebuild = (): Scope =>
    buildSymbolTable(
      [...docs.values()].map((td) => {
        const source = td.getText()
        return { uri: td.uri, source, parseResult: parseSource(source) }
      }),
    )
  const workspace = (): Document[] => [...docs.values()].map(toDoc)
  // Dead-POU set, rebuilt once per workspace edit. Empty when dead-code diagnosis is enabled.
  const deadSet = (): Set<string> =>
    (cachedDead ??= config.diagnoseDeadCode ? new Set() : deadPous(workspace(), taskRoots))
  const invalidate = (): void => {
    cachedProject = undefined
    cachedDead = undefined
  }

  function doc(uri: string): Document | undefined {
    const td = docs.get(uri)
    return td !== undefined ? toDoc(td) : undefined
  }

  function pushDiagnostics(uri: string): void {
    const d = doc(uri)
    if (d === undefined) return
    // Suppress semantic diagnostics on a structurally-dead unit (the compiler never checks it either).
    // Parse errors always ride through — a genuinely broken parse is a real problem, not a dead-code FP.
    const owner = ownerPou(d.parseResult)
    const dead = owner !== undefined && deadSet().has(owner)
    const items = dead
      ? []
      : computeSemanticDiagnostics({
          parseResult: d.parseResult,
          source: d.source,
          project: project(),
          config,
          references: workspaceRefs,
        })
    const diagnostics: Diagnostic[] = [
      ...items.map(toLspDiagnostic),
      ...(dead ? [] : computeVgDiagnostics(d, project(), messages, workspaceRefs)).map(toLspDiagnostic),
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
    if (opts?.diagnoseDeadCode !== undefined) config = resolveConfig({ vendor, diagnoseDeadCode: opts.diagnoseDeadCode })
    const root = workspaceRoot(params.rootUri, params.rootPath)
    if (root !== undefined) {
      workspaceRefs = loadWorkspaceRefs(root)
      taskRoots = loadTaskRoots(root)
    }
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

  // ─── document sync ───────────────────────────────────────────────────────
  conn.onNotification(DidOpenTextDocumentNotification.type, (p) => {
    const t = p.textDocument
    docs.set(t.uri, TextDocument.create(t.uri, t.languageId, t.version, t.text))
    invalidate()
    pushDiagnostics(t.uri)
  })
  conn.onNotification(DidChangeTextDocumentNotification.type, (p) => {
    const td = docs.get(p.textDocument.uri)
    if (td === undefined) return
    docs.set(p.textDocument.uri, TextDocument.update(td, p.contentChanges, p.textDocument.version ?? td.version))
    invalidate()
    pushDiagnostics(p.textDocument.uri)
  })
  conn.onNotification(DidCloseTextDocumentNotification.type, (p) => {
    docs.delete(p.textDocument.uri)
    invalidate()
    void conn.sendNotification(PublishDiagnosticsNotification.type, { uri: p.textDocument.uri, diagnostics: [] })
  })

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
      inVgBody(d, o) ? vgHover(d, project(), o) : (hover(d, project(), o) ?? vgMarkerHover(d, o)),
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
      (d, o) => references(workspace(), project(), d, o, p.context.includeDeclaration) ?? null,
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
    at(p.textDocument.uri, p.position, (d, o) => prepareRename(d, project(), o)),
  )
  conn.onRequest(RenameRequest.type, (p) =>
    at(p.textDocument.uri, p.position, (d, o) => rename(workspace(), project(), d, o, p.newName) ?? null),
  )
  conn.onRequest(SelectionRangeRequest.type, (p) => {
    const d = doc(p.textDocument.uri)
    if (d === undefined) return null
    return p.positions.map(
      (pos) => selectionRange(d, offsetFromPosition(d.source, pos)) ?? { range: { start: pos, end: pos } },
    )
  })

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

function toDoc(td: TextDocument): Document {
  const source = td.getText()
  return { uri: td.uri, source, parseResult: parseSource(source) }
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
