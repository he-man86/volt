/**
 * THE ASSIST HANDLERS — hover, completion, signature help, inlay hints, code lenses and code actions. A network-text
 * body answers hover and completion through its own services.
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
  inNetworkText,
  networkCompletion,
  networkHover,
  pragmaHover,
  readOnlyBodyHover,
  signatureHelp,
} from "../../services/index.js"
import type { ServerState } from "../state.js"

export function registerAssistHandlers(s: ServerState): void {
  s.onRequest(HoverRequest.type, (p) =>
    s.at(p.textDocument.uri, p.position, (d, o) =>
      inNetworkText(d, o)
        ? networkHover(d, s.project(), o)
        : (readOnlyBodyHover(d, o) ?? hover(d, s.project(), o) ?? pragmaHover(d, s.project(), o)),
    ),
  )
  s.onRequest(CompletionRequest.type, (p) =>
    s.at(p.textDocument.uri, p.position, (d, o) =>
      inNetworkText(d, o) ? networkCompletion(d, s.project(), o) : completion(d, s.project(), o),
    ),
  )
  s.onRequest(SignatureHelpRequest.type, (p) =>
    s.at(p.textDocument.uri, p.position, (d, o) => signatureHelp(d, s.project(), o)),
  )
  s.onRequest(InlayHintRequest.type, (p) => {
    const d = s.doc(p.textDocument.uri)
    if (d === undefined) return null
    return inlayHints(
      d,
      s.project(),
      clampedOffset(d.source, p.range.start),
      clampedOffset(d.source, p.range.end),
    )
  })
  s.onRequest(CodeLensRequest.type, (p) => s.whole(p.textDocument.uri, (d) => codeLenses(s.workspace(), s.project(), d)))
  s.onRequest(CodeActionRequest.type, (p) =>
    s.whole(p.textDocument.uri, (d) => codeActions(d, s.project(), p.context.diagnostics)),
  )
}
