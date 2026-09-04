/**
 * Corpus WARNING-conformance — the warning twin of build-conformance, and bidirectional. build-conformance
 * only ever diffed ERRORS, which structurally hid warning coverage (that is how C0371 sat mislabeled as a
 * deferred error while CODESYS warned on it 1300+ times). This gate compares our WARNING messages to the real
 * IDE build's warnings, both directions:
 *
 *   - ours-EXTRA  (a warning we emit that the build did NOT) → a false-positive. HARD gate = 0 — unless the
 *     build hit CODESYS's 100-warning display cap, in which case ours could be a real warning in the truncated
 *     tail, so it's reported UNCONFIRMED rather than failed.
 *   - ours-MISSING (a build warning we do NOT emit) → a coverage gap. Reported (the actionable list of warnings
 *     to implement); NOT a hard fail, because the LSP is deliberately a curated subset of the compiler, not a
 *     re-implementation of it.
 *
 * Ground truth: test-corpus/<project>/expected-build.<vendor>.json (errors+warnings, by record-corpus-build.ts).
 * Compared on the NORMALIZED message set (whitespace-collapsed), like replay.test.ts — so wording must match.
 */
import { test, expect } from "bun:test"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { extname, join } from "node:path"
import { parseSource } from "../../src/syntax/index.js"
import { buildSymbolTable } from "../../src/symbols/index.js"
import {
  computeSemanticDiagnostics,
  deadMemberSpans,
  deadPous,
  inDeadMember,
  ownerPou,
  resolveConfig,
  type Vendor,
} from "../../src/analysis/index.js"
import { loadTaskRoots, loadWorkspaceRefs, scanWorkspace } from "../../src/workspace-refs.js"
import { SOURCE_EXTENSION_SET } from "../../src/source-extensions.js"

const CORPUS_ROOT = join(import.meta.dir, "..", "..", "test-corpus")
const VENDOR: Vendor = "codesys"

const walk = (dir: string): string[] => {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (SOURCE_EXTENSION_SET.has(extname(p).toLowerCase())) out.push(p)
  }
  return out
}

const CORPUS_TIMEOUT = 120_000
// Collapse whitespace, and treat whitespace ADJACENT to `;` in an embedded source snippet as non-significant:
// CODESYS renders a flagged statement as `<expr>;\r\n`, we slice the raw source `<expr>\t\t\t;` — same code,
// incidental spacing. Real wording differences (different words/structure) still surface.
const norm = (m: string): string =>
  m
    .replace(/\s+/g, " ")
    .replace(/\s*;\s*/g, ";")
    .trim()

/** The unique normalized WARNING messages the LSP emits across a project (same dead-code suppression as the
 *  server, and the same PROJECT compiler-warning settings — a warning the project switched off is one the build
 *  never emitted, so reporting it here would be a false positive by construction). */
function lspWarnings(dir: string): Set<string> {
  const config = resolveConfig({ vendor: VENDOR, diagnostics: scanWorkspace(dir).projectDiagnostics })
  const inputs = walk(dir).map((uri) => {
    const source = readFileSync(uri, "utf8")
    return { uri, source, parseResult: parseSource(source) }
  })
  const project = buildSymbolTable(inputs)
  const references = loadWorkspaceRefs(dir)
  const dead = deadPous(inputs, loadTaskRoots(dir))
  const deadMembers = deadMemberSpans(inputs, dead)
  const out = new Set<string>()
  for (const f of inputs) {
    const owner = ownerPou(f.parseResult)
    if (owner !== undefined && dead.has(owner)) continue
    const dm = deadMembers.get(f.uri)
    for (const d of computeSemanticDiagnostics({ parseResult: f.parseResult, source: f.source, project, config, references }))
      if (d.severity === "warning" && !inDeadMember(d.span, dm)) out.add(norm(d.message))
  }
  return out
}

interface Recording {
  recorded?: { buildSuccess?: boolean }
  diagnostics: { severity: string; message: string }[]
}

const projects = existsSync(CORPUS_ROOT)
  ? readdirSync(CORPUS_ROOT).filter((p) => statSync(join(CORPUS_ROOT, p)).isDirectory())
  : []

for (const project of projects) {
  const recPath = join(CORPUS_ROOT, project, `expected-build.${VENDOR}.json`)
  const has = existsSync(recPath)
  test.skipIf(!has)(`warning-conformance: ${project} — no LSP warning the build didn't emit`, () => {
    const rec = JSON.parse(readFileSync(recPath, "utf8")) as Recording
    const buildWarnings = new Set(rec.diagnostics.filter((d) => d.severity === "warning").map((d) => norm(d.message)))
    const capped = [...buildWarnings].some((m) => /more than \d+ warnings/i.test(m))
    // A build that didn't compile clean never reaches the warning (typify) phase, so its warning set is
    // incomplete — the FP direction can't be trusted. (awa-palletizer: 129 library-not-found errors.)
    const buildFailed = rec.recorded?.buildSuccess === false || rec.diagnostics.some((d) => d.severity === "error")
    const ours = lspWarnings(join(CORPUS_ROOT, project))

    const oursExtra = [...ours].filter((m) => !buildWarnings.has(m)) // FP candidates
    const oursMissing = [...buildWarnings].filter((m) => !ours.has(m)) // coverage gaps

    // Coverage report (informational — the LSP is a curated subset of the compiler, not a re-implementation).
    const unreliable = capped || buildFailed
    console.log(
      `[${project}] warnings — ours:${ours.size} build:${buildWarnings.size} · missing(coverage):${oursMissing.length} · extra(FP):${oursExtra.length}${capped ? " · CAPPED" : ""}${buildFailed ? " · BUILD-FAILED" : ""}`,
    )
    if (oursMissing.length > 0) console.log(`  MISSING (build warns, we don't):`, oursMissing.slice(0, 8))
    if (oursExtra.length > 0) console.log(`  EXTRA (we warn, build doesn't)${unreliable ? " [unconfirmed]" : ""}:`, oursExtra.slice(0, 8))

    // Hard FP gate — a warning we emit the build never did. Skipped when the build capped or didn't compile
    // clean (its warning set is then incomplete, so an "extra" may be a real warning the build never reached).
    if (!unreliable) expect(oursExtra).toEqual([])
  }, CORPUS_TIMEOUT)
}

// A self-check so the file isn't vacuous when no recordings exist yet: the raw-source `<expr>\t\t\t;` we slice
// and CODESYS's `<expr>;\r\n` normalize to the same string.
test("normalization makes our raw-source snippet and CODESYS's rendered snippet compare equal", () => {
  expect(norm("The code 'a.b\t\t\t;' has\n no effect")).toBe("The code 'a.b;' has no effect")
  expect(norm("The code 'a.b;\r\n' has no effect")).toBe("The code 'a.b;' has no effect")
})
