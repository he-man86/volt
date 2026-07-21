/**
 * CODESYS error-catalog conformance — one test per documented code (C0001–C0587). The catalog
 * (`docs/codesys-reference/error-catalog.json`) is the master checklist; this turns it into an executable
 * net that DISCOVERS LSP gaps and BURNS IN implemented ones:
 *
 *   - `implemented` → run the repro through the LSP and assert its exact IDE messages are emitted.
 *     A failure here is a real regression or a wrong-wording bug.
 *   - `checkable`   → the code is offline-analyzable but no check exists yet. A `todo` — flip it to
 *     `implemented` in the catalog when the check lands and this activates.
 *   - `ide-only`    → needs a live build / library resolution. `skip` (documented out of scope).
 *   - `pending`     → not harvested yet. A `todo` to fill message + repro.
 */
import { test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { errorCatalog, type ErrorCode } from "./error-codes.js"
import { parseSource } from "../syntax/index.js"
import { buildSymbolTable } from "../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig, EMPTY_WORKSPACE_REFS } from "../analysis/index.js"
import { obsoletePousInText } from "../workspace-refs.js"

const catalog = errorCatalog()

/** Diagnostic messages the LSP emits for a repro (a full ST source). Every check runs by default (errors always,
 *  warnings default-ON like CODESYS), so no per-lint config is needed. Includes warnings as well as errors. */
function lspMessages(repro: string, extra?: { uri: string; source: string }[]): string[] {
  const parseResult = parseSource(repro)
  const files = [
    { uri: "F.fb", parseResult, source: repro },
    ...(extra ?? []).map((f) => ({ uri: f.uri, source: f.source, parseResult: parseSource(f.source) })),
  ]
  const project = buildSymbolTable(files)
  // Reproduce the workspace obsolete-POU scan from the repro text, so workspace-scan-based checks (C0357) fire.
  const obsoletePous = new Map(files.flatMap((f) => obsoletePousInText(f.source)))
  const semantic = computeSemanticDiagnostics({
    parseResult,
    source: repro,
    project,
    config: resolveConfig({ vendor: "codesys" }),
    references: { ...EMPTY_WORKSPACE_REFS, obsoletePous },
  })
    .filter((d) => d.severity === "error" || d.severity === "warning")
    .map((d) => d.message)
  // The server surfaces unit/declaration parse errors too (`server/diagnostics.ts` pushes
  // `parseResult.errors`), so the burn-in must see them — else declaration-syntax codes look unimplemented.
  return [...parseResult.errors.map((e) => e.message), ...semantic]
}

// ── completeness: every documented code has an entry, and enriched entries are well-formed ──
test("catalog enumerates every code in _toc.json", () => {
  const toc = readFileSync(new URL("../../docs/codesys-reference/_toc.json", import.meta.url), "utf8")
  const tocCodes = new Set([...toc.matchAll(/_cds_(?:error|warning)_c(\d{4})/gi)].map((m) => "C" + m[1]))
  const have = new Set(catalog.map((e) => e.code))
  const missing = [...tocCodes].filter((c) => !have.has(c))
  expect(missing).toEqual([])
})

test("a harvested entry carries a message; an implemented/checkable entry carries a repro + expect", () => {
  const bad: string[] = []
  for (const e of catalog) {
    if (e.status !== "pending" && !e.message) bad.push(`${e.code}: harvested but no message`)
    if ((e.status === "implemented" || e.status === "checkable") && e.repro && (!e.expect || e.expect.length === 0))
      bad.push(`${e.code}: repro without expect`)
  }
  expect(bad).toEqual([])
})

// ── one test per code — the discovery/burn-in net ──
for (const e of catalog) {
  const name = `${e.code} — ${e.category ?? e.status}`
  if (e.status === "implemented") {
    test(name, () => {
      expect(e.repro, `${e.code} implemented but no repro`).not.toBeNull()
      // negative: the error example emits every expected message
      const bad = lspMessages(e.repro!, e.reproFiles)
      for (const want of e.expect ?? []) expect(bad).toContain(want)
      // positive: the correction (if the docs gave one) emits NONE of them
      if (e.fix) {
        const good = lspMessages(e.fix, e.reproFiles)
        for (const want of e.expect ?? []) expect(good).not.toContain(want)
      }
    })
  } else if (e.status === "ide-only") {
    test.skip(name, () => {})
  } else {
    // checkable (to build) or pending (to harvest) — a visible todo, not a failure.
    test.todo(name, () => {
      const msgs = lspMessages(e.repro!)
      for (const want of e.expect ?? []) expect(msgs).toContain(want)
    })
  }
}

export type { ErrorCode }
