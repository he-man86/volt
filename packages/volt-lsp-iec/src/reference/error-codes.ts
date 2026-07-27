/**
 * CODESYS compiler-error catalog (codes C0001–C0587). The canonical data lives in
 * `docs/codesys-reference/error-catalog.json` — one entry per documented code, sourced from the
 * CODESYS reference and the live build log. This module is the typed accessor over it, consumed by the
 * conformance test and (future) code-actions. We keep our OWN diagnostic `source`/`code`; the `Cnnnn`
 * here is the catalog identity we mirror, not what we emit.
 *
 * status: `implemented` (a check emits it) · `checkable` (offline-analyzable, to build) ·
 * `ide-only` (needs a live build / library resolution, out of LSP scope) · `pending` (not harvested yet).
 */
// The catalog is EMBEDDED via a static JSON import, NOT read from disk at runtime. The LSP ships as a
// bundle; a `readFileSync` off an `import.meta.url`-relative path baked the BUILD machine's absolute path
// into the bundle (ENOENT `D:\a\volt\...\error-catalog.json` on every other machine). A JSON import is
// inlined into the artifact by the bundler, so the data travels with the code.
import catalogData from "../../docs/codesys-reference/error-catalog.json" with { type: "json" }

export type ErrorStatus = "implemented" | "checkable" | "ide-only" | "pending"

export interface ErrorCode {
  code: string // "C0077"
  url: string
  kind: "error" | "warning"
  category: string | null
  cause: string | null // one line, our words (never the docs' prose)
  message: string | null // exact template with <placeholder> tokens
  repro: string | null // the docs' "Example of the error:" code — the negative-test input (a draft; finalize per code)
  reproFiles?: { uri: string; source: string }[] // extra context files (distinct uris) for cross-file codes — the symbol table is built from `repro` + these; diagnostics still run on `repro`
  expect: string[] | null // the concrete exact messages `repro` produces
  fix: string | null // the docs' "Example of an error correction:" code — the positive-test input (compiles clean)
  status: ErrorStatus
  ourCheck: string | null // our check module, when covered
  ourCode: string | null // our diagnostic `code`, when covered
  lint: string | null // legacy: the opt-in flag a repro once needed; unused now that every check runs by default
  verified: { codesys: boolean; twincat: boolean } // message recorded from a live /build
  note?: string // why an open code is deferred, or an implementation caveat — one line
  /** For an open code: the honest reason it is not implemented — "what's open and why" (see TRIAGE.md). */
  triage?: "parser" | "pragma" | "resolution" | "optionGated" | "ideOnly" | "skip"
}

/** The full catalog, one entry per documented code (embedded at build — see the import note above). */
export function errorCatalog(): ErrorCode[] {
  return catalogData as unknown as ErrorCode[]
}

// The runtime slug→(code,url) lookup (`codesysCodeFor`) lives in the generated `error-code-map.ts`, NOT here:
// this module embeds the full 230KB test catalog and is test-only, so the running LSP must not import it.
// A drift test (error-codes.test.ts) keeps that generated map in sync with this catalog.
