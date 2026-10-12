/**
 * THE PULL-DIAGNOSTICS HANDLERS — a document's and the workspace's, the same compute as the push transport
 * (`ServerState.pushDiagnostics`) and, like it, nothing before the crawl has seeded the project.
 */
import {
  DocumentDiagnosticReportKind,
  DocumentDiagnosticRequest,
  WorkspaceDiagnosticRequest,
  type DocumentDiagnosticReport,
  type WorkspaceDiagnosticReport,
  type WorkspaceDocumentDiagnosticReport,
} from "vscode-languageserver-protocol/node"
import { sameDocument } from "../../workspace/workspace-store.js"
import { documentDiagnostics } from "../document-diagnostics.js"
import type { ServerState } from "../state.js"

export function registerDiagnosticHandlers(s: ServerState): void {
  const conn = s.conn
  conn.onRequest(DocumentDiagnosticRequest.type, (p): DocumentDiagnosticReport => {
    const d = s.doc(p.textDocument.uri)
    // Pre-index: report NO diagnostics (not false ones). The `initialized` refresh makes the client re-pull once
    // the crawl seeds the project, so the real diagnostics land a moment later instead of flickering wrong first.
    // A `.library` manifest is no Document: its one possible diagnostic is being stale (`manifestDiagnostics`).
    const manifest = () => [...s.manifestDiagnostics()].find(([uri]) => sameDocument(uri, p.textDocument.uri))?.[1] ?? []
    return {
      kind: DocumentDiagnosticReportKind.Full,
      items: !s.indexed ? [] : d !== undefined ? documentDiagnostics(s.store, d) : manifest(),
    }
  })
  conn.onRequest(
    WorkspaceDiagnosticRequest.type,
    (): WorkspaceDiagnosticReport => ({
      items: s.indexed
        ? [
            ...s.store.workspace().map((d): WorkspaceDocumentDiagnosticReport => ({
              kind: DocumentDiagnosticReportKind.Full,
              uri: d.uri,
              version: null,
              items: documentDiagnostics(s.store, d),
            })),
            ...[...s.manifestDiagnostics()].map(([uri, items]): WorkspaceDocumentDiagnosticReport => ({ kind: DocumentDiagnosticReportKind.Full, uri, version: null, items })),
          ]
        : [],
    }),
  )
}
