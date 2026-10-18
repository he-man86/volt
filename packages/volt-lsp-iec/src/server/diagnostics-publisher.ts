/**
 * THE ONE OWNER OF HOW DIAGNOSTICS REACH A CLIENT (openspec lsp-server-scheduling 2.1) — push or pull, never both; the
 * `indexed` gate (nothing before the crawl has seeded the project: every other-file reference would read unresolved);
 * the versions of what an open buffer's report describes; and the manifest warnings beside the documents.
 *
 * Each URI's findings are cached with the store `generation` they were computed at: a pull at an unchanged generation
 * computes nothing. A `resultId` is the sha1 of the serialized findings, so after a change only the documents whose
 * findings MOVED answer `full` — the rest answer `unchanged` against the id the client sent back. Rejected:
 * `resultId = generation` (any keystroke would re-send every report of a 7.7k-file workspace); per-file dependency
 * tracking (there is no dependency graph — relink and dead code reach across files). The target is a pass per CHANGE,
 * not per pull. A document the store quarantined (its parse or bind threw) reports one `not-analysed` error, never a
 * clean `full []`; so does a document whose findings threw (input far deeper than real code overflows a recursive pass,
 * openspec lsp-deep-input-no-stack-overflow), which is logged and fails no other document's report.
 */
import { createHash } from "node:crypto"
import {
  DiagnosticSeverity,
  MessageType,
  DocumentDiagnosticReportKind,
  PublishDiagnosticsNotification,
  type Diagnostic,
  type DocumentDiagnosticReport,
  type PreviousResultId,
  type ProtocolConnection,
  type WorkspaceDiagnosticReport,
  type WorkspaceDocumentDiagnosticReport,
} from "vscode-languageserver-protocol/node"
import { sameDocument } from "../workspace/document-key.js"
import type { WorkspaceStore } from "../workspace/workspace-store.js"
import { documentDiagnostics, libraryManifestDiagnostics } from "./document-diagnostics.js"

/** What the publisher reads of the server: the store, whether the crawl has run, and which channel the client chose. */
export interface PublisherHost {
  readonly conn: ProtocolConnection
  readonly store: WorkspaceStore
  readonly indexed: boolean
  readonly clientSupportsPull: boolean
  /** A line in the client's log (`window/logMessage`). */
  log(type: MessageType, message: string): void
}

interface Findings {
  generation: number
  resultId: string
  items: Diagnostic[]
}

/** The one error a document the server could not analyse reports, on line 0; the log says why. */
const notAnalysed = (message: string): Diagnostic => ({
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
  severity: DiagnosticSeverity.Error,
  source: "volt-lsp-iec",
  code: "not-analysed",
  message,
})

/** Its parse or bind threw: the store quarantined it. */
const NOT_READ = notAnalysed(
  "The language server failed reading this file, so it is not analysed (the language server's log names the error). " +
    "Its declarations are left out of the project until the file changes: files that use them report them unresolved.",
)

/** Its findings threw. Its declarations were read, so the rest of the project still uses them. */
const NOT_COMPUTED = notAnalysed(
  "The language server failed computing this file's findings, so none are reported (the language server's log names " +
    "the error). Its declarations are still used by the rest of the project.",
)

const resultIdOf = (items: readonly Diagnostic[]): string => createHash("sha1").update(JSON.stringify(items)).digest("hex")

export class DiagnosticsPublisher {
  private readonly findings = new Map<string, Findings>()
  private manifests: { generation: number; byUri: Map<string, Diagnostic[]> } | undefined
  /** Push mode: the resultId last published per URI, and the manifests last published. */
  private readonly published = new Map<string, string>()
  private publishedManifests = new Set<string>()
  private sweptAt = -1

  constructor(private readonly host: PublisherHost) {}

  /** `textDocument/diagnostic`: before the crawl `full []` with no resultId (nothing cached — the post-crawl refresh
   *  re-pulls); after it the cached findings, `unchanged` when the client already holds them. */
  documentReport(uri: string, previousResultId: string | undefined): DocumentDiagnosticReport {
    if (!this.host.indexed) return { kind: DocumentDiagnosticReportKind.Full, items: [] }
    const f = this.of(uri)
    return f.resultId === previousResultId
      ? { kind: DocumentDiagnosticReportKind.Unchanged, resultId: f.resultId }
      : { kind: DocumentDiagnosticReportKind.Full, resultId: f.resultId, items: f.items }
  }

  /** `workspace/diagnostic`: every document, every quarantined one and every manifest, each `unchanged` when its
   *  resultId is the one the client sent back, with the open buffer's version (null for a file only on disk). */
  workspaceReport(previousResultIds: readonly PreviousResultId[]): WorkspaceDiagnosticReport {
    if (!this.host.indexed) return { items: [] }
    const store = this.host.store
    const previous = new Map(previousResultIds.map((p) => [p.uri, p.value]))
    store.project() // built first: a bind that throws quarantines its document before the documents are listed
    const uris = [...store.workspace().map((d) => d.uri), ...store.quarantinedUris(), ...this.manifestReports().keys()]
    return {
      items: uris.map((uri): WorkspaceDocumentDiagnosticReport => {
        const f = this.of(uri)
        const version = store.openVersion(uri) ?? null
        return previous.get(uri) === f.resultId
          ? { kind: DocumentDiagnosticReportKind.Unchanged, uri, version, resultId: f.resultId }
          : { kind: DocumentDiagnosticReportKind.Full, uri, version, resultId: f.resultId, items: f.items }
      }),
    }
  }

  /** Push mode: publish `uri` — the document an open, change, save or close named, sent whatever it holds (an empty
   *  set clears a document that is gone). */
  push(uri: string): void {
    if (this.pushing()) this.publish(uri, true)
  }

  /** Push mode, after anything that can move OTHER documents' findings (an edit, a watched batch, the crawl): re-publish
   *  every open document and the manifest set, skipping each whose findings did not move. `everyOpen`: a config change
   *  re-publishes every open document whatever it holds, as it always did (the client sees the change was applied). */
  republish(everyOpen = false): void {
    if (!this.pushing() || (!everyOpen && this.sweptAt === this.host.store.generation)) return
    for (const uri of this.host.store.openUris()) this.publish(uri, everyOpen)
    const now = this.manifestReports()
    for (const uri of now.keys()) this.publish(uri, false)
    for (const uri of this.publishedManifests) if (!now.has(uri)) this.send(uri, [])
    this.publishedManifests = new Set(now.keys())
    this.sweptAt = this.host.store.generation
  }

  private pushing(): boolean {
    return !this.host.clientSupportsPull && this.host.indexed
  }

  private publish(uri: string, always: boolean): void {
    const f = this.of(uri)
    if (!always && this.published.get(uri) === f.resultId) return
    this.send(uri, f.items, f.resultId)
  }

  private send(uri: string, diagnostics: Diagnostic[], resultId = resultIdOf(diagnostics)): void {
    this.published.set(uri, resultId)
    const version = this.host.store.openVersion(uri)
    void this.host.conn.sendNotification(PublishDiagnosticsNotification.type, {
      uri,
      diagnostics,
      ...(version !== undefined ? { version } : {}),
    })
  }

  /** The findings at `uri`, computed at most once per generation. The generation is read AFTER the compute: a parse that
   *  throws inside it quarantines a document, and the findings are those of the project rebuilt without it. */
  private of(uri: string): Findings {
    const hit = this.findings.get(uri)
    if (hit !== undefined && hit.generation === this.host.store.generation) return hit
    const items = this.compute(uri)
    const f = { generation: this.host.store.generation, resultId: resultIdOf(items), items }
    this.findings.set(uri, f)
    return f
  }

  private compute(uri: string): Diagnostic[] {
    const store = this.host.store
    store.project() // built first: a bind that throws quarantines here, not after the document was found clean
    const d = store.doc(uri)
    if (store.quarantined(uri)) return [NOT_READ]
    if (d !== undefined) {
      try {
        return documentDiagnostics(store, d)
      } catch (e) {
        this.host.log(
          MessageType.Error,
          `volt-lsp-iec: the findings of ${uri} could not be computed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`,
        )
        return [NOT_COMPUTED]
      }
    }
    // A `.library` manifest is no document: its one possible diagnostic is being stale (`libraryManifestDiagnostics`).
    return [...this.manifestReports()].find(([m]) => sameDocument(m, uri))?.[1] ?? []
  }

  private manifestReports(): Map<string, Diagnostic[]> {
    const generation = this.host.store.generation
    if (this.manifests?.generation !== generation)
      this.manifests = { generation, byUri: libraryManifestDiagnostics(this.host.store.workspaceRefs.libraryManifests) }
    return this.manifests.byUri
  }
}
