/**
 * THE PULL-DIAGNOSTICS HANDLERS — a document's and the workspace's, answered by the `DiagnosticsPublisher` (the one
 * owner of push vs pull, the `indexed` gate, resultIds and versions; openspec lsp-server-scheduling).
 */
import { DocumentDiagnosticRequest, WorkspaceDiagnosticRequest } from "vscode-languageserver-protocol/node"
import type { ServerState } from "../state.js"

export function registerDiagnosticHandlers(s: ServerState): void {
  s.onRequest(DocumentDiagnosticRequest.type, (p) => s.publisher.documentReport(p.textDocument.uri, p.previousResultId))
  s.onRequest(WorkspaceDiagnosticRequest.type, (p) => s.publisher.workspaceReport(p.previousResultIds))
}
