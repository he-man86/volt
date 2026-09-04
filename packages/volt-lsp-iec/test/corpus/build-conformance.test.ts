/**
 * Corpus build-conformance — the REAL oracle: every error-severity diagnostic the LSP emits on a corpus
 * project must be one the IDE's own build also emitted. This replaces the `corpus.test.ts` "zero errors"
 * assumption (which wrongly treated the projects as clean — they are NOT; see the C0371 demotion) with a
 * ground-truth comparison, exactly like `replay.test.ts` does per-fixture, but over whole projects.
 *
 * Ground truth lives in `test-corpus/<project>/expected-build.<vendor>.json`, captured by
 * `scripts/record-corpus-build.ts` from a LIVE build (needs the real project loaded in the IDE). Until a
 * project is recorded, its gate SKIPS — the comparison can't run without the compiler's answer. The message
 * set is the criterion (matching replay.test.ts), so an LSP detection with wording the IDE doesn't use reads
 * as a false positive until reconciled — which is the point: it forces parity and catches invented errors.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { extname, join } from "node:path"
import { DiagnosticSeverity } from "vscode-languageserver-protocol"
import { messagesFor, resolveConfig, type Vendor } from "../../src/analysis/index.js"
import { loadTaskRoots, loadWorkspaceRefs, scanWorkspace } from "../../src/workspace-refs.js"
import { WorkspaceStore } from "../../src/server/workspace-store.js"
import { documentDiagnostics } from "../../src/server/diagnostics.js"
import { SOURCE_EXTENSION_SET } from "../../src/source-extensions.js"

// Several diagnostics EMBED the offending source line (C0139 "The code '<line>' has no effect"). The LSP keeps
// the source whitespace (tabs between tokens), the IDE strips it — so the SAME warning renders differently
// (`InPosition\t\t;` vs `InPosition;`). Stripping ALL whitespace before comparing makes the identity the
// semantic content, not the formatting, so an identical warning never reads as a false positive. (Non-embedding
// messages are unaffected — their non-whitespace content is unique.)
const canon = (m: string): string => m.replace(/\s+/g, "")

/** The LSP error messages the build did NOT emit — the false positives. Whitespace-canonical message-set ⊆. */
export function buildFalsePositives(lspErrorMessages: readonly string[], buildMessages: Iterable<string>): string[] {
  const build = new Set<string>([...buildMessages].map(canon))
  return lspErrorMessages.filter((m) => !build.has(canon(m)))
}

// CODESYS truncates its message list at 100 warnings (emits a "More than 100 warnings occured" marker). Past
// that point the build is an INCOMPLETE oracle: an LSP warning absent from it may be a real one that was cut,
// not a false positive — so the ⊆ FP check is unsound and the project must be re-recorded with the cap raised.
const TRUNCATION_MARKER = /More than \d+ warnings/i
const isTruncated = (msgs: readonly string[]): boolean => msgs.some((m) => TRUNCATION_MARKER.test(m))

// ── the comparison logic is pure + verified regardless of whether any recording exists yet ──────────────
test("buildFalsePositives: an LSP error absent from the build is a false positive; a present one is not", () => {
  const build = ["'x' is no input of 'FB'", "Cannot convert type 'INT' to type 'BOOL'"]
  expect(buildFalsePositives(["'x' is no input of 'FB'"], build)).toEqual([])
  expect(buildFalsePositives(["No such label 'A'…"], build)).toEqual(["No such label 'A'…"]) // C0371-class: caught
  expect(buildFalsePositives([], build)).toEqual([])
})

test("buildFalsePositives ignores whitespace differences in an embedded source snippet", () => {
  const build = ["The code 'x.Status.InPosition;' has no effect. Is this the intent?"]
  const lsp = ["The code 'x.Status.InPosition\t\t\t\t\t;' has no effect. Is this the intent?"] // tabs from source
  expect(buildFalsePositives(lsp, build)).toEqual([]) // same warning, not a false positive
})

// ── per-project gate: activates the moment a recording is captured, skips until then ────────────────────
const CORPUS_ROOT = join(import.meta.dir, "..", "..", "test-corpus")
const VENDOR: Vendor = "codesys"

interface BuildRecording {
  recorded: { at: string; vendor: string; buildSuccess: boolean; count: number }
  diagnostics: { severity: string; message: string; line: number }[]
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (SOURCE_EXTENSION_SET.has(extname(p).toLowerCase())) out.push(p)
  }
  return out
}

// Per-project compiler-warning settings come from the project's own `.projectsettings`, which `volt pull`
// materializes from the IDE's Compiler Warnings dialog — the same file the running server reads. This used to
// be a hand-kept table here (pro2193 and lenze-mid, both "C0371 off, confirmed by its owner"), which was true
// and unmaintainable: it had to be rediscovered per project and could not be checked against anything. Both
// projects' pulled settings now say `Disabled warnings: C0371`, so the fact is READ rather than remembered.

/**
 * Every ERROR+WARNING LSP message across a project, through `documentDiagnostics` — THE SERVER'S OWN PATH.
 *
 * It used to call `computeSemanticDiagnostics` and re-implement the server's suppression beside it (the
 * library gate, dead POUs, dead members), with a comment saying the harness "must apply the SAME skip". Two
 * consequences, and the second was costly: the copy could drift, and it silently covered only HALF the LSP.
 * `computeSemanticDiagnostics` lives in `analysis` (layer D) and network text in `network` (layer F), so the
 * analysis layer structurally CANNOT include graphical diagnostics — they are merged one layer up, in
 * `documentDiagnostics`. Calling the lower function put every network-text diagnostic outside the oracle:
 * nothing held them to the compiler, and the two that were wrong — a title that swallowed the first statement,
 * `EXECUTE(` read as a block opener — survived until a real pull made them numerous enough to notice.
 *
 * Going through the server's function is therefore both less code and more coverage, and it is what
 * `corpus.test.ts` already did.
 *
 * Warnings are compared too, not just errors: a lint the build never emitted is as much a false positive as a
 * phantom error.
 */
function lspMessages(dir: string): string[] {
  const store = new WorkspaceStore(
    resolveConfig({ vendor: VENDOR, diagnostics: scanWorkspace(dir).projectDiagnostics }),
  )
  store.workspaceRefs = loadWorkspaceRefs(dir)
  store.taskRoots = loadTaskRoots(dir)
  store.seedDisk(walk(dir).map((uri) => ({ uri, source: readFileSync(uri, "utf8") })))

  const messages: string[] = []
  for (const d of store.workspace())
    for (const diag of documentDiagnostics(store, messagesFor(VENDOR), d))
      if (diag.severity === DiagnosticSeverity.Error || diag.severity === DiagnosticSeverity.Warning)
        messages.push(diag.message)
  return messages
}

const projects = existsSync(CORPUS_ROOT)
  ? readdirSync(CORPUS_ROOT).filter((p) => statSync(join(CORPUS_ROOT, p)).isDirectory())
  : []

describe("corpus build-conformance (LSP errors+warnings ⊆ real IDE build)", () => {
  for (const project of projects) {
    const recPath = join(CORPUS_ROOT, project, `expected-build.${VENDOR}.json`)
    const has = existsSync(recPath)
    test.skipIf(!has)(`${project}: every LSP error/warning is a real ${VENDOR} build diagnostic`, () => {
      const rec = JSON.parse(readFileSync(recPath, "utf8")) as BuildRecording
      const buildMsgs = rec.diagnostics.map((d) => d.message)
      // A truncated recording (>100-warning cap) can't distinguish a real FP from a cut warning — the ⊆ check
      // would be unsound. Fail with an actionable message so the project gets re-recorded past the cap, rather
      // than silently green-lighting or red-flagging noise.
      if (isTruncated(buildMsgs))
        throw new Error(`${project}: build recording is TRUNCATED at CODESYS's 100-warning cap — re-record with the cap raised (Compiler Warnings → max) before this gate is meaningful.`)
      const fps = buildFalsePositives(lspMessages(join(CORPUS_ROOT, project)), buildMsgs)
      expect(fps).toEqual([])
    }, 120_000)
  }
})
