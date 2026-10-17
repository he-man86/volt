/**
 * THE NAVIGATION HANDLERS — definition, type definition, implementation, references, highlights and linked editing,
 * rename, and the call and type hierarchies. Each converts the LSP position to an offset and calls the matching
 * service; a network-text body answers through its own services where it has them.
 */
import {
  CallHierarchyIncomingCallsRequest,
  CallHierarchyOutgoingCallsRequest,
  CallHierarchyPrepareRequest,
  DefinitionRequest,
  DocumentHighlightRequest,
  ImplementationRequest,
  LinkedEditingRangeRequest,
  LSPErrorCodes,
  PrepareRenameRequest,
  ReferencesRequest,
  RenameRequest,
  ResponseError,
  TypeDefinitionRequest,
  TypeHierarchyPrepareRequest,
  TypeHierarchySubtypesRequest,
  TypeHierarchySupertypesRequest,
} from "vscode-languageserver-protocol/node"
import type { Scope, Symbol } from "../../frontend/symbols/index.js"
import {
  callIncoming,
  callOutgoing,
  definition,
  documentHighlightsAnywhere,
  implementation,
  inNetworkText,
  networkDefinition,
  networkTypeDefinition,
  offsetFromPosition,
  prepareCallHierarchy,
  prepareRenameAnywhere,
  prepareTypeHierarchy,
  referencesAnywhere,
  renameAnywhere,
  renameChainRefusal,
  renameRefusal,
  typeDefinition,
  typeSubtypes,
  typeSupertypes,
  type Document,
  type HierItem,
} from "../../services/index.js"
import type { ServerState } from "../state.js"

export function registerNavigationHandlers(s: ServerState): void {
  s.onRequest(DefinitionRequest.type, (p) =>
    s.at(p.textDocument.uri, p.position, (d, o) =>
      inNetworkText(d, o) ? networkDefinition(d, s.project(d.uri), o) : definition(d, s.project(d.uri), o),
    ),
  )
  s.onRequest(TypeDefinitionRequest.type, (p) =>
    s.at(p.textDocument.uri, p.position, (d, o) =>
      inNetworkText(d, o) ? networkTypeDefinition(d, s.project(d.uri), o) : typeDefinition(d, s.project(d.uri), o),
    ),
  )
  s.onRequest(ImplementationRequest.type, (p) =>
    s.at(p.textDocument.uri, p.position, (d, o) => implementation(s.workspace(d.uri), s.project(d.uri), d, o) ?? null),
  )
  s.onRequest(ReferencesRequest.type, (p) =>
    s.at(
      p.textDocument.uri,
      p.position,
      (d, o) => referencesAnywhere(s.workspace(d.uri), s.project(d.uri), d, o, p.context.includeDeclaration) ?? null,
    ),
  )
  s.onRequest(DocumentHighlightRequest.type, (p) =>
    s.at(
      p.textDocument.uri,
      p.position,
      (d, o) => documentHighlightsAnywhere(d, s.project(d.uri), o)?.map((range) => ({ range })) ?? null,
    ),
  )
  // Linked editing: the occurrences of the identifier at the cursor, edited together (reuses highlights).
  s.onRequest(LinkedEditingRangeRequest.type, (p) =>
    s.at(p.textDocument.uri, p.position, (d, o) => {
      const ranges = documentHighlightsAnywhere(d, s.project(d.uri), o)
      return ranges !== undefined && ranges.length > 0 ? { ranges } : null
    }),
  )
  // a member whose override chain reaches a library's is refused BY NAME, at prepare and at rename (design.md §6 B6)
  s.onRequest(PrepareRenameRequest.type, (p) => {
    const chain = s.at(p.textDocument.uri, p.position, (d, o) => renameChainRefusal(d, s.project(d.uri), o) ?? null)
    if (chain !== null) return new ResponseError(LSPErrorCodes.RequestFailed, chain)
    return s.at(p.textDocument.uri, p.position, (d, o) => prepareRenameAnywhere(d, s.project(d.uri), o))
  })
  s.onRequest(RenameRequest.type, (p) => {
    const refused = renameRefusal(p.newName, s.project(p.textDocument.uri)) ?? s.at(p.textDocument.uri, p.position, (d, o) => renameChainRefusal(d, s.project(d.uri), o) ?? null) ?? undefined
    if (refused !== undefined) return new ResponseError(LSPErrorCodes.RequestFailed, refused)
    return s.at(p.textDocument.uri, p.position, (d, o) => renameAnywhere(s.workspace(d.uri), s.project(d.uri), d, o, p.newName) ?? null)
  })
  registerHierarchyHandlers(s)
}

/**
 * The call and type hierarchies. The client re-sends the prepared item on the follow-up call; re-resolve it to its
 * Symbol by mapping the item's (uri, selectionRange) back to a document offset and running the same prepare — one
 * resolution path.
 */
function registerHierarchyHandlers(s: ServerState): void {
  const reResolve = (
    item: HierItem,
    prepare: (d: Document, project: Scope, o: number) => { sym: Symbol } | undefined,
  ): { d: Document; sym: Symbol } | undefined => {
    const d = s.doc(item.uri)
    if (d === undefined) return undefined
    const off = offsetFromPosition(d.source, item.selectionRange.start)
    if (off < 0) return undefined
    const p = prepare(d, s.project(d.uri), off)
    return p !== undefined ? { d, sym: p.sym } : undefined
  }

  s.onRequest(CallHierarchyPrepareRequest.type, (p) =>
    s.at(p.textDocument.uri, p.position, (d, o) => {
      const r = prepareCallHierarchy(d, s.project(d.uri), o)
      return r !== undefined ? [r.item] : null
    }),
  )
  s.onRequest(CallHierarchyIncomingCallsRequest.type, (p) => {
    const r = reResolve(p.item, prepareCallHierarchy)
    return r === undefined
      ? null
      : callIncoming(s.workspace(r.d.uri), s.project(r.d.uri), r.sym).map((c) => ({ from: c.item, fromRanges: c.ranges }))
  })
  s.onRequest(CallHierarchyOutgoingCallsRequest.type, (p) => {
    const r = reResolve(p.item, prepareCallHierarchy)
    return r === undefined
      ? null
      : callOutgoing(r.d, s.project(r.d.uri), r.sym).map((c) => ({ to: c.item, fromRanges: c.ranges }))
  })

  s.onRequest(TypeHierarchyPrepareRequest.type, (p) =>
    s.at(p.textDocument.uri, p.position, (d, o) => {
      const r = prepareTypeHierarchy(d, s.project(d.uri), o)
      return r !== undefined ? [r.item] : null
    }),
  )
  s.onRequest(TypeHierarchySupertypesRequest.type, (p) => {
    const r = reResolve(p.item, prepareTypeHierarchy)
    return r === undefined ? null : typeSupertypes(s.project(r.d.uri), r.sym)
  })
  s.onRequest(TypeHierarchySubtypesRequest.type, (p) => {
    const r = reResolve(p.item, prepareTypeHierarchy)
    return r === undefined ? null : typeSubtypes(s.project(r.d.uri), r.sym)
  })
}
