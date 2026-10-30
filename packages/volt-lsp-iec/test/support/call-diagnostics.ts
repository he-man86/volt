/**
 * THE CALL-ARGUMENT TESTS' HARNESS — the codes and messages `computeDiagnostics` reports over a few sources, each file
 * named after its first unit as a workspace names it, and the callee/caller sources the tests share. Shared by
 * `checks/calls/call-arguments.test.ts` and its helpers' tests (`_argument-types.test.ts`, `_in-out-arguments.test.ts`).
 */
import { parseSource } from "../../src/frontend/syntax/index.js"
import { computeDiagnostics, resolveConfig } from "../../src/analysis/index.js"
import { build } from "../../src/frontend/symbols/index.js"
import { uriFor } from "./test-uri.js"

/** Every diagnostic `computeDiagnostics` reports across the given sources on `vendor` (one project built from all). */
function diagnostics(vendor: "codesys" | "twincat", sources: string[]) {
  // Named after the POU each source declares, as a workspace is: one item, one file, and the file carries the
  // object's name. An arbitrary `u0.pou` is a real CODESYS error ("The name used in the signature is not identical
  // to the object name"), which `signature-name` now reports — so a harness that invents file names accuses its
  // own fixtures.
  const files = sources.map((source, i) => {
    const parseResult = parseSource(source, { networkText: true, unicodeIdentifiers: false }, vendor)
    const first = parseResult.units.find((u) => "name" in u) as { name?: { text: string } } | undefined
    return { uri: `${first?.name?.text ?? `u${i}`}.pou`, source, parseResult }
  })
  const project = build.buildSymbolTable(files, [], vendor)
  const config = resolveConfig({ vendor })
  return files.flatMap((f) =>
    computeDiagnostics({ uri: uriFor(f.parseResult), parseResult: f.parseResult, source: f.source, project, config }),
  )
}

/** All diagnostic codes emitted across the given source units (project built from all of them). */
export const codes = (...sources: string[]): string[] => diagnostics("codesys", sources).map((d) => d.code)

export const FB_ONE_INPUT = `FUNCTION_BLOCK FB_T\nVAR_INPUT\n\tn : INT;\nEND_VAR\nEND_FUNCTION_BLOCK`

// `sText`, not `s`: CODESYS rejects a variable named `s` — the set keyword (conformance cc_reserved_name_s_string) —
// so the "correct call is clean" premise of 4.5b never held for the caller this helper built.
export const caller = (body: string) => `PROGRAM P\nVAR\n\tfb : FB_T;\n\tsText : STRING;\nEND_VAR\n${body}\nEND_PROGRAM`

// ─── analysis-conformance 3.8 (`calls_*`, both vendors 2026-10-06) ──────────────────────────────────────────────────
/** Every message of every source, `[severity] message`, on `vendor`. */
export const messagesOf = (vendor: "codesys" | "twincat", ...sources: string[]): string[] =>
  diagnostics(vendor, sources).map((d) => `[${d.severity}] ${d.message}`)
