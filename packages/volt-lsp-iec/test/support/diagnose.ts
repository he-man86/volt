/**
 * THE ONE-SOURCE DIAGNOSTICS HARNESS — parse a source, bind it and run the diagnostics pipeline over it, the file named
 * as a workspace names it (`uriFor`). The binder and the pipeline see the SAME uri: a harness that bound under `"F.pou"`
 * and diagnosed under `uriFor(...)` asked about a document the project did not hold. Shared by the colocated tests.
 */
import { parseSource } from "../../src/frontend/syntax/index.js"
import { build } from "../../src/frontend/symbols/index.js"
import { computeDiagnostics, resolveConfig, type ResolvedConfig, type Vendor } from "../../src/analysis/index.js"
import { uriFor } from "./test-uri.js"

/** Every diagnostic `computeDiagnostics` reports over `source` alone, on `vendor` — read under the config's project
 *  "Unicode identifiers", as the analysis requires (`computeDiagnostics`). */
export function diagnose(source: string, vendor: Vendor = "codesys", config: ResolvedConfig = resolveConfig({ vendor })) {
  const parseResult = parseSource(source, { networkText: true, unicodeIdentifiers: config.unicodeIdentifiers }, vendor)
  const uri = uriFor(parseResult)
  const project = build.buildSymbolTable([{ uri, parseResult, source }], [], vendor)
  return computeDiagnostics({ uri, parseResult, source, project, config })
}
