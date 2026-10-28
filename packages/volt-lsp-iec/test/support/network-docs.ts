/**
 * The network-text documents the colocated network checks share (`analysis/checks/network/`): a POU source parsed with
 * network text on, the project over it, and its network findings.
 */
import { parseSource } from "../../src/frontend/syntax/index.js"
import { build } from "../../src/frontend/symbols/index.js"
import { networkDiagnostics, type DiagnosticItem } from "../../src/analysis/index.js"

/** The network check's findings for `src`, the one document `file:///FB.pou` of its project. */
export function networkDiags(src: string, dialect: "codesys" | "twincat" = "codesys"): DiagnosticItem[] {
  const parseResult = parseSource(src, { networkText: true }, dialect)
  const project = build.buildSymbolTable([{ uri: "file:///FB.pou", source: src, parseResult }], [], dialect)
  return networkDiagnostics(parseResult, project)
}
