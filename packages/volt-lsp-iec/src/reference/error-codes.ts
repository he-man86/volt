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
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

export type ErrorStatus = "implemented" | "checkable" | "ide-only" | "pending"

export interface ErrorCode {
  code: string // "C0077"
  url: string
  kind: "error" | "warning"
  category: string | null
  cause: string | null // one line, our words (never the docs' prose)
  message: string | null // exact template with <placeholder> tokens
  repro: string | null // the docs' "Example of the error:" code — the negative-test input (a draft; finalize per code)
  expect: string[] | null // the concrete exact messages `repro` produces
  fix: string | null // the docs' "Example of an error correction:" code — the positive-test input (compiles clean)
  status: ErrorStatus
  ourCheck: string | null // our check module, when covered
  ourCode: string | null // our diagnostic `code`, when covered
  lint: string | null // opt-in LintConfig flag to enable when running `repro`
  verified: { codesys: boolean; twincat: boolean } // message recorded from a live /build
}

const CATALOG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "docs",
  "codesys-reference",
  "error-catalog.json",
)

let cache: ErrorCode[] | undefined

/** The full catalog, one entry per documented code. */
export function errorCatalog(): ErrorCode[] {
  return (cache ??= JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as ErrorCode[])
}

/** One entry by code (`"C0077"`), or undefined. */
export function lookupErrorCode(code: string): ErrorCode | undefined {
  return errorCatalog().find((e) => e.code === code)
}
