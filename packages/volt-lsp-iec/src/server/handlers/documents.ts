/**
 * THE DOCUMENT HANDLERS — open, change, close and save of a buffer, and the watched files whose create, change or
 * delete reach the store one file at a time (`disk-sync.ts`).
 */
import {
  DidChangeTextDocumentNotification,
  DidChangeWatchedFilesNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  DidSaveTextDocumentNotification,
} from "vscode-languageserver-protocol/node"
import { applyWatchedChanges } from "../disk-sync.js"
import type { ServerState } from "../state.js"

export function registerDocumentHandlers(s: ServerState): void {
  // In push mode the named document is published, then every OTHER open document whose findings the change moved (a
  // change to A can move an open B's). A pull client re-pulls on its own.
  s.onNotification(DidOpenTextDocumentNotification.type, (p) => {
    const t = p.textDocument
    s.store.openDocument(t.uri, t.languageId, t.version, t.text)
    s.publisher.push(t.uri)
    s.publisher.republish()
  })
  s.onNotification(DidChangeTextDocumentNotification.type, (p) => {
    if (!s.store.changeDocument(p.textDocument.uri, p.textDocument.version, p.contentChanges)) return
    s.publisher.push(p.textDocument.uri)
    s.publisher.republish()
  })
  s.onNotification(DidCloseTextDocumentNotification.type, (p) => {
    s.store.closeDocument(p.textDocument.uri)
    s.semTok.delete(p.textDocument.uri) // drop the semantic-token result cache for the closed doc
    // The file may still be on disk: its findings are now the disk copy's — or none, which clears it.
    s.publisher.push(p.textDocument.uri)
    s.publisher.republish()
  })
  // A save re-validates (a fallback for clients that don't emit watched-file events); the open buffer is
  // already current, so this is just a re-publish.
  s.onNotification(DidSaveTextDocumentNotification.type, (p) => s.publisher.push(p.textDocument.uri))
  s.onNotification(DidChangeWatchedFilesNotification.type, (p) => applyWatchedChanges(s, p.changes))
}
