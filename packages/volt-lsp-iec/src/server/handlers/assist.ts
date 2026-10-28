/**
 * THE ASSIST HANDLERS — hover, completion, signature help, inlay hints, code lenses and code actions.
 */
import {
  CodeActionRequest,
  CodeLensRequest,
  CompletionRequest,
  HoverRequest,
  InlayHintRequest,
  SignatureHelpRequest,
} from "vscode-languageserver-protocol/node"
import {
  clampedOffset,
  codeActions,
  codeLenses,
  completion,
  hover,
  inlayHints,
  pragmaHover,
  readOnlyBodyHover,
  signatureHelp,
} from "../../services/index.js"
import { documentDiagnostics } from "../document-diagnostics.js"
import type { ServerState } from "../state.js"

export function registerAssistHandlers(s: ServerState): void {
  s.onRequest(HoverRequest.type, (p) =>
    s.at(p.textDocument.uri, p.position, (d, o) =>
      readOnlyBodyHover(d, o) ?? hover(d, s.project(d.uri), o) ?? pragmaHover(d, s.project(d.uri), o),
    ),
  )
  s.onRequest(CompletionRequest.type, (p) =>
    s.at(p.textDocument.uri, p.position, (d, o) =>
      completion(d, s.project(d.uri), o),
    ),
  )
  s.onRequest(SignatureHelpRequest.type, (p) =>
    s.at(p.textDocument.uri, p.position, (d, o) => signatureHelp(d, s.project(d.uri), o)),
  )
  s.onRequest(InlayHintRequest.type, (p) => {
    const d = s.doc(p.textDocument.uri)
    if (d === undefined) return null
    return inlayHints(
      d,
      s.project(d.uri),
      clampedOffset(d.source, p.range.start),
      clampedOffset(d.source, p.range.end),
    )
  })
  s.onRequest(CodeLensRequest.type, (p) => s.whole(p.textDocument.uri, (d) => codeLenses(s.workspace(d.uri), s.project(d.uri), d)))
  // the document's own findings, asked only by a fix-all (`codeActions` `all`): they are computed as a pull would
  s.onRequest(CodeActionRequest.type, (p) =>
    s.whole(p.textDocument.uri, (d) => codeActions(d, p.context.diagnostics, () => documentDiagnostics(s.store, d), p.context.only)),
  )
}
