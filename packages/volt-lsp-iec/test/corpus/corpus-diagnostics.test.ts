/**
 * THE CORPUS, QUESTION 2 — THE LSP INVENTS NOTHING: every error and warning it emits over the real projects is one the
 * IDE's own build also emitted; every code is a valid identity; no document carries a duplicate (range, code). The walk
 * and the other two questions: `corpus.test.ts` (the header there says why there is one walk).
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { DiagnosticSeverity } from "vscode-languageserver-protocol"
import { allowedCode } from "./support/diagnostic-codes.js"
import { documentsDiagnosingDeadCode, projectDocuments } from "./support/diagnostics.js"
import { effectivelyExcluded } from "../../src/analysis/index.js"
import { isLibrarySymbol } from "../../src/frontend/symbols/index.js"
import { corpusVendor } from "./support/project.js"
import { CORPUS, hasCorpus, projectDirs, norm } from "./support/walk.js"

// Per-pass budget. Kept at 120s: this was adequate until `checkDataRecursion` regressed to rebuilding the whole
// project composition graph per file (O(files × project size)) — it pushed the diagnostic passes past 120s and
// TIMED OUT, which read as a spurious failure while `scripts/corpus-fp.ts` (no timeout) stayed green. Root-caused
// and fixed (the graph is memoized per project). If it times out again, suspect a new O(n²) and profile per check
// (PROFILE_CHECKS=1) rather than raising this.
const CORPUS_TIMEOUT = 120_000

/** The LSP messages the build did NOT emit — the false positives. Normalized message-set ⊆. */
export function buildFalsePositives(lspMessages: readonly string[], buildMessages: Iterable<string>): string[] {
  const build = new Set<string>([...buildMessages].map(norm))
  return lspMessages.filter((m) => !build.has(norm(m)))
}

interface BuildRecording {
  recorded?: { at: string; vendor: string; buildSuccess?: boolean; count: number }
  diagnostics: { severity: string; message: string; line: number }[]
}

// CODESYS truncates its message list at 100 warnings (emits a "More than 100 warnings occured" marker). Past that
// point the build is an INCOMPLETE oracle: an LSP warning absent from it may be a real one that was cut, not a
// false positive — so the ⊆ check is unsound and the project must be re-recorded with the cap raised.
const isTruncated = (msgs: readonly string[]): boolean => msgs.some((m) => /More than \d+ warnings/i.test(m))

// Per-project compiler-warning settings come from the project's own `.projectsettings`, which `volt pull`
// materializes from the IDE's Compiler Warnings dialog — the same file the running server reads. This used to be a
// hand-kept table (pro2193 and lenze-mid, both "C0371 off, confirmed by its owner"), which was true and
// unmaintainable: it had to be rediscovered per project and could not be checked against anything.

/**
 * A corpus project whose LSP findings are KNOWN to include false positives, and where they are. The gate still runs on
 * it: the false positives must be non-empty (else the mark is stale and the test fails, naming it) and ALL under the
 * named folder (any other false positive fails as on an unmarked project).
 *
 * twincat-project14: TwinCAT names its library manager `References` (TcObjectModel.FindLibraryManager), and
 * `isLibraryUri` knows only `Library Manager`, so the library signatures there are read as project source — 216
 * "states no language" errors. This gate read only `expected-build.codesys.json`, so it never ran on the one TwinCAT
 * project and nothing went red (openspec lsp-quick-fixes 0.1; fixed or filed in 2.4).
 */
const CORPUS_DIVERGENCES: Readonly<Record<string, { folder: string; reason: string }>> = {
  "twincat-project14": { folder: "References", reason: "isLibraryUri does not know TwinCAT's `References` library folder (openspec lsp-quick-fixes 2.4)" },
}

describe.skipIf(!hasCorpus)("2. the LSP invents nothing", () => {
  for (const project of projectDirs()) {
    const dir = join(CORPUS, project)
    // The project's OWN vendor and recording. This read `expected-build.codesys.json` only, so twincat-project14 was
    // never gated (CODESYS-only gate, openspec lsp-quick-fixes 0.1).
    const vendor = corpusVendor(dir)
    const recPath = join(dir, `expected-build.${vendor}.json`)
    const has = existsSync(recPath)

    test.skipIf(!has)(`${project}: every LSP error and warning is a real ${vendor} build diagnostic`, () => {
      const rec = JSON.parse(readFileSync(recPath, "utf8")) as BuildRecording
      const buildMsgs = rec.diagnostics.map((d) => d.message)
      // A TRUNCATED recording is reported, not thrown. `build-conformance.test.ts` threw here — and that is right
      // when the whole gate depends on completeness, which it no longer does: the ERROR half below is sound
      // against a truncated recording (the cap is on WARNINGS), so throwing would refuse to check the half that
      // still works. What truncation costs is the warning half, and that is what `complete` below withholds.
      if (isTruncated(buildMsgs))
        console.log(
          `  [corpus]   ${project}: build recording is TRUNCATED at CODESYS's 100-warning cap — re-record with the cap raised (Compiler Warnings → max) to gate warnings here.`,
        )

      const docs = projectDocuments(dir, vendor)
      const ours = docs
        .flatMap((d) => d.diagnostics)
        .filter((d) => d.severity === DiagnosticSeverity.Error || d.severity === DiagnosticSeverity.Warning)
        .map((d) => d.message)

      // THE COVERAGE REPORT, warnings only — informational. A build that did not compile clean never reaches the
      // warning (typify) phase, so its warning set is incomplete; awa-palletizer carries 129 library-not-found
      // errors. Reported either way, because the list of warnings still to implement is the actionable half.
      const buildWarnings = new Set(rec.diagnostics.filter((d) => d.severity === "warning").map((d) => norm(d.message)))
      const ourWarnings = new Set(
        docs
          .flatMap((d) => d.diagnostics)
          .filter((d) => d.severity === DiagnosticSeverity.Warning)
          .map((d) => norm(d.message)),
      )
      const missing = [...buildWarnings].filter((m) => !ourWarnings.has(m))
      const buildFailed = rec.recorded?.buildSuccess === false || rec.diagnostics.some((d) => d.severity === "error")
      console.log(
        `  [corpus] ${project} — warnings ours:${ourWarnings.size} build:${buildWarnings.size} · missing(coverage):${missing.length}${buildFailed ? " · BUILD-FAILED" : ""}`,
      )
      if (missing.length > 0) console.log(`  [corpus]   MISSING (build warns, we don't):`, missing.slice(0, 8))

      // THE HARD GATE, and WHICH SEVERITIES it covers depends on whether the build is a complete oracle.
      //
      // An ERROR we emit that the build never emitted is a false positive whatever phase the build stopped in —
      // that half is always gated. A WARNING is different: a build that did not compile clean never reaches the
      // warning (typify) phase, and a capped one cut its list at 100, so in both cases a warning of ours absent
      // from the recording may be a REAL warning the build never got to rather than an invention.
      //
      // `build-conformance.test.ts` gated both severities unconditionally and `warning-conformance.test.ts`
      // skipped the warning half exactly here; merging them is what made the disagreement visible. The sound
      // one wins. It changes nothing today — awa-palletizer is the only build-failed project and the LSP emits
      // no warning on it — but the unsound version fails falsely the first time that stops being true.
      const complete = !buildFailed && !isTruncated(buildMsgs)
      const gatedSeverities: readonly DiagnosticSeverity[] = complete ? [DiagnosticSeverity.Error, DiagnosticSeverity.Warning] : [DiagnosticSeverity.Error]
      if (!complete) console.log(`  [corpus]   warning FPs UNCONFIRMED here — the build is an incomplete oracle`)
      const mark = CORPUS_DIVERGENCES[project]
      if (mark === undefined) {
        const gated = docs.flatMap((d) => d.diagnostics).filter((d) => gatedSeverities.includes(d.severity!)).map((d) => d.message)
        expect(buildFalsePositives(gated, buildMsgs)).toEqual([])
        return
      }
      // A marked project: every false positive must sit under the named folder, and there must still be one.
      const inFolder = (uri: string) => uri.replace(/%20/g, " ").slice(dir.length).split(/[\\/]/).includes(mark.folder)
      const fps = docs.flatMap(({ uri, diagnostics }) =>
        buildFalsePositives(diagnostics.filter((d) => gatedSeverities.includes(d.severity!)).map((d) => d.message), buildMsgs).map((m) => ({ uri, m })),
      )
      console.log(`  [corpus]   ${project}: KNOWN divergence — ${fps.length} false positives (${mark.reason})`)
      expect(fps.filter((f) => !inFolder(f.uri)).map((f) => `${f.uri.slice(dir.length)}: ${f.m}`)).toEqual([])
      if (fps.length === 0) throw new Error(`${project} now matches its ${vendor} build — remove its CORPUS_DIVERGENCES mark (${mark.reason})`)
    }, CORPUS_TIMEOUT)
  }

  /**
   * Diagnostic-identity invariants over the FULL LSP wire path (`documentDiagnostics` — the exact bytes a client
   * receives), folded into the corpus so every real file is checked rather than synthetic cases:
   *   1. every code is a Cnnnn / NETWORK_* / parse (no code) / KNOWN_UNMAPPED (see `corpus/support/diagnostic-codes.ts`)
   *   2. no two diagnostics on one document share (range, code) — the duplicate PR #86 fixed cannot recur
   */
  test("every diagnostic has a valid code identity, and no document repeats a (range, code)", () => {
    const offenders: string[] = []
    const dupes: string[] = []
    for (const project of projectDirs()) {
      const dir = join(CORPUS, project)
      for (const { uri, diagnostics } of projectDocuments(dir, corpusVendor(dir))) {
        const seen = new Set<string>()
        for (const diag of diagnostics) {
          if (!allowedCode(diag.code)) offenders.push(`${project}${uri.slice(dir.length)} [${String(diag.code)}]`)
          const r = diag.range
          const key = `${r.start.line}:${r.start.character}-${r.end.line}:${r.end.character}|${String(diag.code)}`
          if (seen.has(key)) dupes.push(`${project}${uri.slice(dir.length)} ${key}`)
          seen.add(key)
        }
      }
    }
    expect(offenders).toEqual([])
    expect(dupes).toEqual([])
  }, CORPUS_TIMEOUT)
})

/**
 * AN OBJECT EXCLUDED FROM BUILD IS NO BUILT CODE (openspec lsp-excluded-from-build). CODESYS compiles no excluded object
 * (DIALECT C2j: no signature in any context), so the recorded build says nothing about one, whatever the LSP's dead-code
 * setting. With `diagnoseDeadCode` on, the reachability quiet is off, so a finding inside an excluded object can only
 * be kept out by the exclusion itself. Every `%EXCLUDE_FROM_BUILD` the project's own objects carry must sit in an object
 * `effectivelyExcluded` names, so the selection cannot miss one.
 */
describe.skipIf(!hasCorpus)("2b. an object excluded from build is no built code", () => {
  const FLAG_LINE = /^%EXCLUDE_FROM_BUILD[ \t]*\r?$/gm
  for (const project of projectDirs()) {
    const dir = join(CORPUS, project)
    const vendor = corpusVendor(dir)
    const recPath = join(dir, `expected-build.${vendor}.json`)
    test.skipIf(!existsSync(recPath))(`${project}: with dead-code diagnosis on, nothing inside an excluded object is invented`, () => {
      const rec = JSON.parse(readFileSync(recPath, "utf8")) as BuildRecording
      const docs = documentsDiagnosingDeadCode(dir, vendor, (d) => !isLibrarySymbol(d) && d.source.includes("%EXCLUDE_FROM_BUILD"))
      const unnamed: string[] = []
      const invented: string[] = []
      for (const d of docs) {
        const excluded = effectivelyExcluded(d.parseResult)
        const inside = (line: number, col: number): boolean =>
          excluded.file || excluded.objects.some((s) => (line > s.startLine - 1 || (line === s.startLine - 1 && col >= s.startCol)) && (line < s.endLine - 1 || (line === s.endLine - 1 && col < s.endCol)))
        for (const m of d.source.matchAll(FLAG_LINE)) {
          const before = d.source.slice(0, m.index)
          const line = before.split("\n").length - 1
          if (!inside(line, 0)) unnamed.push(`${d.uri.slice(dir.length)}:${line + 1}`)
        }
        const gated = d.diagnostics.filter((x) => (x.severity === DiagnosticSeverity.Error || x.severity === DiagnosticSeverity.Warning) && inside(x.range.start.line, x.range.start.character))
        for (const m of buildFalsePositives(gated.map((x) => x.message), rec.diagnostics.map((x) => x.message)))
          invented.push(`${d.uri.slice(dir.length)}: ${m}`)
      }
      console.log(`  [corpus] ${project} — ${docs.length} documents with an excluded object`)
      expect(unnamed).toEqual([])
      expect(invented).toEqual([])
    }, CORPUS_TIMEOUT)
  }
})

// The comparison logic is pure and is verified whether or not any recording exists yet.
test("buildFalsePositives: an LSP message absent from the build is a false positive; a present one is not", () => {
  const build = ["'x' is no input of 'FB'", "Cannot convert type 'INT' to type 'BOOL'"]
  expect(buildFalsePositives(["'x' is no input of 'FB'"], build)).toEqual([])
  expect(buildFalsePositives(["No such label 'A'…"], build)).toEqual(["No such label 'A'…"]) // C0371-class: caught
  expect(buildFalsePositives([], build)).toEqual([])
})

test("an embedded source snippet compares equal however it was spaced", () => {
  const build = ["The code 'x.Status.InPosition;' has no effect. Is this the intent?"]
  const lsp = ["The code 'x.Status.InPosition\t\t\t\t\t;' has no effect. Is this the intent?"] // tabs from source
  expect(buildFalsePositives(lsp, build)).toEqual([])
  expect(norm("The code 'a.b\t\t\t;' has\n no effect")).toBe("The code 'a.b;' has no effect")
  expect(norm("The code 'a.b;\r\n' has no effect")).toBe("The code 'a.b;' has no effect")
})
