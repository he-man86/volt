/**
 * The network-text documents the colocated network tests share — the analysis checks' (`analysis/checks/network/`) and
 * the services' (`services/network/`), split out of one `network.test.ts` by openspec ld-fbd-coverage 2.1: a POU source
 * parsed with network text on, the project over it, its graphical body, and its network-text findings.
 */
import { type BodySpan, isGraphicalBody, parseSource, type ParseResult, unitBodies } from "../../src/frontend/syntax/index.js"
import { build, type Scope } from "../../src/frontend/symbols/index.js"
import type { LibraryManifest } from "../../src/frontend/library/index.js"
import { computeNetworkTextDiagnostics, messagesFor, type DiagnosticItem } from "../../src/analysis/index.js"

/** A parsed source, as the services take it (`services/shared` `Document`). */
export interface NetworkDoc {
  uri: string
  source: string
  parseResult: ParseResult
}

/** Parse a full POU source and return its (single) graphical body. */
export function vgBody(src: string): BodySpan {
  const { units } = parseSource(src, { networkText: true }, "codesys")
  const body = unitBodies(units[0]!).find(isGraphicalBody)
  if (body === undefined) throw new Error("no graphical body")
  return body
}

/** `src` as the one document `file:///FB.pou`, network text on. */
export function doc(src: string): NetworkDoc {
  return { uri: "file:///FB.pou", source: src, parseResult: parseSource(src, { networkText: true }, "codesys") }
}

/** The project of `d` alone, with the libraries `manifests` bind. */
export function project(d: NetworkDoc, manifests: readonly LibraryManifest[] = []): Scope {
  return build.buildSymbolTable([{ uri: d.uri, source: d.source, parseResult: d.parseResult }], manifests, "codesys")
}

/** network-text diagnostics for a single-doc project (codesys wording). */
export function vgDiags(src: string): DiagnosticItem[] {
  const d = doc(src)
  return computeNetworkTextDiagnostics(d, project(d), messagesFor("codesys"))
}

/** Network-text diagnostics of `uri` in a project of several files. */
export function projectDiags(files: Record<string, string>, uri: string): string[] {
  const docs = Object.entries(files).map(([u, source]) => ({ uri: u, source, parseResult: parseSource(source, { networkText: true }, "codesys") }))
  const d = docs.find((x) => x.uri === uri)!
  return computeNetworkTextDiagnostics(d, build.buildSymbolTable(docs, [], "codesys"), messagesFor("codesys")).map(
    (x) => `${x.code} [${d.source.slice(x.span.start, x.span.end)}] ${x.message}`,
  )
}
