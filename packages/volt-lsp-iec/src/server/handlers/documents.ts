/**
 * THE DOCUMENT HANDLERS — open, change, close and save of a buffer, and the watched files whose create, change or
 * delete re-indexes the workspace (freshness).
 */
import {
  DidChangeTextDocumentNotification,
  DidChangeWatchedFilesNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  DidSaveTextDocumentNotification,
  PublishDiagnosticsNotification,
} from "vscode-languageserver-protocol/node"
import type { ServerState } from "../state.js"

export function registerDocumentHandlers(s: ServerState): void {
  const conn = s.conn
  conn.onNotification(DidOpenTextDocumentNotification.type, (p) => {
    const t = p.textDocument
    s.store.openDocument(t.uri, t.languageId, t.version, t.text)
    s.pushDiagnostics(t.uri)
  })
  conn.onNotification(DidChangeTextDocumentNotification.type, (p) => {
    if (!s.store.changeDocument(p.textDocument.uri, p.textDocument.version, p.contentChanges)) return
    s.pushDiagnostics(p.textDocument.uri)
  })
  conn.onNotification(DidCloseTextDocumentNotification.type, (p) => {
    s.store.closeDocument(p.textDocument.uri)
    s.semTok.delete(p.textDocument.uri) // drop the semantic-token result cache for the closed doc
    // The file may still be in the disk index; re-publish so any diagnostics reflect the on-disk copy.
    s.pushDiagnostics(p.textDocument.uri)
    // Clear diagnostics for a file no longer indexed — but only for push clients. A pull client owns its
    // channel (it re-pulls and gets []); pushing to it here would be the very double-channel the pull guard
    // forbids. (Guarded like pushDiagnostics; not `clientSupportsPull` inline so the intent reads.)
    if (!s.clientSupportsPull && s.doc(p.textDocument.uri) === undefined)
      void conn.sendNotification(PublishDiagnosticsNotification.type, { uri: p.textDocument.uri, diagnostics: [] })
  })
  // A save re-validates (a fallback for clients that don't emit watched-file events); the open buffer is
  // already current, so this is just a re-publish.
  conn.onNotification(DidSaveTextDocumentNotification.type, (p) => s.pushDiagnostics(p.textDocument.uri))

  // ─── watched files (freshness): re-index on create/change/delete of source + reference files ──
  // A full rescan reflects creates, deletes, and reference-file edits in one path (reads current disk).
  conn.onNotification(DidChangeWatchedFilesNotification.type, () => s.reindex())
}
