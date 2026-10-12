/**
 * workspace-symbol (Layer E · structure). "Go to symbol in workspace" — the project's top-level symbols
 * (FBs, functions, programs, DUTs, interfaces, GVLs, namespaces) matching a case-insensitive substring
 * query, as LSP `SymbolInformation`. Reuses the ONE `lspSymbolKind` map (no second kind table). Spans the
 * whole project because the server's eager index seeds the project `Scope` from disk, not just open docs.
 *
 * …and their MEMBERS (openspec lsp-quick-fixes design.md §6 B5): a POU's methods, properties and actions, an interface's
 * methods and properties, an enum's values — each with its owner as `containerName`, so `Execute` in forty FBs is told
 * apart. Locals, parameters and struct fields stay out: they are a body's business, not the workspace's. A library's
 * top-level symbol carries its LIBRARY as the container; a library's members are not listed (its signatures are read
 * through their owner, and they would multiply an answer that already carries ten thousand library names).
 */
import type { SymbolInformation } from "vscode-languageserver-protocol"
import { libraryOf } from "../../frontend/library/index.js"
import { isLibrarySymbol, type Scope, type Symbol } from "../../frontend/symbols/index.js"
import { lspSymbolKind, rangeFromSpan } from "../shared/index.js"

/** The member kinds a workspace answer lists, under their owner. */
const MEMBER_KINDS: ReadonlySet<string> = new Set(["method", "property", "action", "interface_method", "interface_property", "enum_value"])
/** The scopes whose members those are. */
const OWNER_KINDS: ReadonlySet<string> = new Set(["pou", "interface", "enum"])

export function workspaceSymbols(project: Scope, query: string): SymbolInformation[] {
  const q = query.toLowerCase()
  const out: SymbolInformation[] = []
  const add = (sym: Symbol, containerName: string | undefined): void => {
    if (q.length > 0 && !sym.name.toLowerCase().includes(q)) return
    out.push({
      name: sym.name,
      kind: lspSymbolKind(sym.kind),
      location: { uri: sym.uri, range: rangeFromSpan(sym.declarationSpan) },
      ...(containerName !== undefined ? { containerName } : {}),
    })
  }
  for (const syms of project.symbols.values()) for (const sym of syms) add(sym, libraryOf(sym))
  for (const owner of ownerScopes(project))
    for (const syms of owner.symbols.values())
      for (const sym of syms) if (MEMBER_KINDS.has(sym.kind) && !isLibrarySymbol(sym)) add(sym, owner.name)
  return out
}

/** Every scope that owns members — the project's POUs, interfaces and enums, a namespace's included. */
function* ownerScopes(scope: Scope): Generator<Scope> {
  for (const child of scope.children) {
    if (OWNER_KINDS.has(child.kind)) yield child
    if (child.kind === "namespace") yield* ownerScopes(child)
  }
}
