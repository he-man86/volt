/**
 * ONE LSP DIAGNOSTIC PASS PER CORPUS PROJECT, shared by everything that needs it.
 *
 * `build-conformance.test.ts` and `warning-conformance.test.ts` — now both inside `corpus.test.ts` — each built
 * their own `WorkspaceStore`, seeded it from disk and ran `documentDiagnostics` over every document —
 * byte-identical code, differing only in which severity they kept afterwards. So the whole analysis ran twice
 * and each half threw the other's answers away: 72 seconds of the suite's 523, spent computing something that
 * was already in memory.
 *
 * Bun runs a test run's files in one process, so a module-scope cache is shared across them — which still matters:
 * `scripts/corpus-fp.ts` and the audit tooling call this too. The pass is pure — it
 * reads files and returns diagnostics, and the store it builds does not escape — so there is no state for one suite
 * to leak into another.
 *
 * `corpus.test.ts` is the ONLY caller now — the three gates that used this are one file. It used to build its
 * own store with a bare `resolveConfig({vendor})`, without the
 * `scanWorkspace(dir)` project settings the other two pass — a difference nothing explained, and the
 * cost of it was a THIRD full analysis of every corpus project. Passing the project's own diagnostic settings is
 * what the other two do and what a running server does, so that is the configuration to share; the gate that
 * consumes it checks code identity and duplicate ranges, over MORE diagnostics than before rather than fewer.
 *
 * WHY THE SERVER'S OWN FUNCTION AND NOT `computeDiagnostics`. Both callers used to call the lower one and
 * re-implement the server's suppression beside it (the library gate, dead POUs, dead members). That copy could
 * drift, and it silently covered only HALF the LSP: `computeDiagnostics` lives in `analysis` (layer D)
 * and network text in `network` (layer F), so the analysis layer structurally CANNOT return a graphical
 * diagnostic — the two are merged one layer up, in `documentDiagnostics`. Every network-text diagnostic was
 * therefore outside the oracle. Measured: lenze-mid's one "change of sign" warning sat in the MISSING coverage
 * list while the LSP emitted it correctly at `FB_Lenze_i550.pou:23` (`w1 := UINT_TO_WORD(ioUDT.Control
 * .AutoSpeed)`, and `AutoSpeed` is an `INT`) — a warning attributed to the product that belonged to the harness.
 * Going through the server's function is both less code and more coverage.
 *
 * It needs them grouped BY DOCUMENT — a duplicate `(range, code)` is only a duplicate within one file — so the pass
 * returns documents and the flat list is derived from them.
 */
import { resolveConfig, type Vendor } from "../../../src/analysis/index.js"
import { documentDiagnostics } from "../../../src/server/document-diagnostics.js"
import { WorkspaceStore } from "../../../src/workspace/workspace-store.js"
import { failLoud } from "../../support/fail-loud.js"
import { NETWORK_TEXT_ENABLED } from "../../../src/server/config.js"
import { scanWorkspace } from "../../../src/workspace/workspace-refs.js"
import type { Document } from "../../../src/services/index.js"

type Diag = ReturnType<typeof documentDiagnostics>[number]

/** One document's diagnostics, kept together so a per-FILE check (a duplicate range) can still be made. */
export interface DocumentDiagnostics {
  uri: string
  diagnostics: readonly Diag[]
}

const cache = new Map<string, readonly DocumentDiagnostics[]>()

/** The server's store over one corpus project, seeded as the server seeds it. */
function seededStore(dir: string, vendor: Vendor, diagnoseDeadCode: boolean): WorkspaceStore {
  // ONE scan for the settings, the reference catalogs, the task roots AND the sources, which it reads as the server
  // seeds them (`server.ts`). This walked the project a second time and read every source again (2026-10-02).
  const scan = scanWorkspace(dir)
  const store = new WorkspaceStore(resolveConfig({ vendor, diagnoseDeadCode }), { networkText: NETWORK_TEXT_ENABLED }, failLoud)
  store.configs.configure({ vendor, diagnoseDeadCode }, scan.projectSettings)
  store.setRefs(scan.refs, scan.taskRoots)
  store.seedDisk(scan.sources.map((s) => ({ uri: s.path, source: s.source })))
  return store
}

/** Every document in one corpus project with its diagnostics, computed once per process. */
export function projectDocuments(dir: string, vendor: Vendor): readonly DocumentDiagnostics[] {
  const key = `${vendor} ${dir}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const store = seededStore(dir, vendor, false)
  const out: DocumentDiagnostics[] = []
  for (const d of store.workspace())
    out.push({ uri: d.uri, diagnostics: documentDiagnostics(store, d) })
  cache.set(key, out)
  return out
}

/** The documents of one corpus project that `keep` selects, diagnosed with `diagnoseDeadCode` on, each with its source
 *  and parse. Not cached: only the exclusion oracle reads it (`corpus-diagnostics.test.ts`). */
export function documentsDiagnosingDeadCode(
  dir: string,
  vendor: Vendor,
  keep: (d: Document) => boolean,
): (DocumentDiagnostics & Pick<Document, "source" | "parseResult">)[] {
  const store = seededStore(dir, vendor, true)
  return store
    .workspace()
    .filter(keep)
    .map((d) => ({ uri: d.uri, source: d.source, parseResult: d.parseResult, diagnostics: documentDiagnostics(store, d) }))
}

/** The same pass, flattened — for the two gates that only compare messages. */
export function projectDiagnostics(dir: string, vendor: Vendor): readonly Diag[] {
  return projectDocuments(dir, vendor).flatMap((d) => d.diagnostics)
}
