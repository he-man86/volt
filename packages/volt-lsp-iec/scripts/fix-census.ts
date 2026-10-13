/**
 * THE QUICK-FIX CENSUS — every diagnostic code the LSP reports, ranked by how often it fires, as the work list for quick
 * fixes (openspec `lsp-quick-fixes` 0.1, and again at 3.1 for the share of findings that offer a fix).
 *
 *   bun scripts/fix-census.ts      # markdown table, codes ranked by corpus occurrences, then fixture occurrences
 *
 * CORPUS: the six projects through the server's own function (`documentDiagnostics`, what a user sees), every severity,
 * counted by the wire code; `confirmed` = matched (as a multiset, `normMessage`) against the project's recorded IDE build;
 * `fixable` = the findings the server's `codeActions` answers with at least one action (3.1's before/after figure).
 * The corpora compile clean, so their errors are false positives by definition and their warnings are the real load.
 * FIXTURES: every conformance fixture × vendor with a build recording, through the replay's composition (the pipeline
 * over `replayDocuments`, network text over `networkDocuments`, as `replayDiagnostics`), errors and warnings; `confirmed` =
 * matched against that fixture's recorded build; `fixable` as above (an ST finding — network text is out of the change's
 * scope). A fixture is a question asked once, so this counts the SHAPES a code has, not how often a user meets it.
 * C0002 BY MESSAGE: the syntax error is one code with many shapes, and only a few of them name ONE token to insert
 * (`C0002_FIXABLE`, design.md F4); the rest is recovery cascade. Its fixture findings are counted per family, per vendor,
 * so the size of F4 is measured here, not estimated (review 2026-10-12: the first census printed one C0002 row).
 */
import { DiagnosticSeverity } from "vscode-languageserver-protocol/node"
import { CODESYS_CODE_MAP, computeDiagnostics, computeNetworkTextDiagnostics, messagesFor, resolveConfig, type DiagnosticItem, type Vendor } from "../src/analysis/index.js"
import { codeActions } from "../src/services/index.js"
import { documentDiagnostics, toLspDiagnostic } from "../src/server/document-diagnostics.js"
import { NETWORK_TEXT_ENABLED } from "../src/server/config.js"
import { WorkspaceStore } from "../src/workspace/workspace-store.js"
import { scanWorkspace } from "../src/workspace/workspace-refs.js"
import { failLoud } from "../test/support/fail-loud.js"
import { corpusProjects, messagePool } from "../test/frontend/sources.js"
import { ALL_TESTS } from "../test/conformance/fixtures/index.js"
import { BUILDS } from "../test/conformance/support/fixture-suite.js"
import { networkDocuments, replayDocuments, withReplayFixture } from "../test/conformance/support/replay.js"
import { comparable } from "../test/conformance/support/compare-message.js"

const SEV = ["", "error", "warning", "information", "hint"] as const
const SLUG = new Map(Object.entries(CODESYS_CODE_MAP).map(([slug, [code]]) => [code, slug]))

interface Row {
  severities: Set<string>
  corpus: number
  corpusConfirmed: number
  corpusProjects: Set<string>
  corpusFixable: number
  codesys: number
  codesysConfirmed: number
  codesysFixable: number
  twincat: number
  twincatConfirmed: number
  twincatFixable: number
  example: string
}
const rows = new Map<string, Row>()
const row = (code: string): Row => {
  let r = rows.get(code)
  if (r === undefined)
    rows.set(code, (r = { severities: new Set(), corpus: 0, corpusConfirmed: 0, corpusProjects: new Set(), corpusFixable: 0, codesys: 0, codesysConfirmed: 0, codesysFixable: 0, twincat: 0, twincatConfirmed: 0, twincatFixable: 0, example: "" }))
  return r
}
const wireCode = (code: unknown): string => (code === undefined ? "(none)" : String(code))

/** The C0002 shapes whose message names the one token to insert at the parser's recovery point (design.md F4). */
const C0002_FIXABLE: readonly [family: string, shape: RegExp][] = [
  ["';' before end of POU", /^';' expected instead of end of POU$/i],
  ["';' before END_*", /^';' expected instead of 'END_[A-Z_]+'$/i],
  ["END_* missing", /^'END_[A-Z_]+' expected instead of ''$/i],
  ["END_* missing at end of file", /^Unexpected End-of-file found: 'END_[A-Z_]+' expected$/i],
  ["THEN missing", /^'THEN' expected instead of /i],
]
/** A message with its identifiers and literals blanked, so the cascade's shapes group (`';' expected instead of '<t>'`). */
const shapeOf = (message: string): string => message.replace(/\s+/g, " ").replace(/'[^']*'/g, (q) => (/^'(END_[A-Z_]+|THEN|;|end of POU)'$/i.test(q) ? q : "'<t>'"))
const c0002 = { codesys: new Map<string, number>(), twincat: new Map<string, number>() }

// ─── corpus ──────────────────────────────────────────────────────────────────────────────────────────────────
// The store `projectDocuments` (test/corpus/support/diagnostics.ts) builds, built here because the code actions need its
// project and documents too.
for (const p of corpusProjects()) {
  const pool = messagePool((p.build?.diagnostics ?? []).map((d) => d.message))
  const scan = scanWorkspace(p.dir)
  const store = new WorkspaceStore(resolveConfig({ vendor: p.vendor, diagnostics: scan.projectDiagnostics }), { networkText: NETWORK_TEXT_ENABLED }, failLoud)
  store.setRefs(scan.refs, scan.taskRoots)
  store.seedDisk(scan.sources.map((s) => ({ uri: s.path, source: s.source })))
  for (const doc of store.workspace()) {
    const diagnostics = documentDiagnostics(store, doc)
    for (const d of diagnostics) {
      const r = row(wireCode(d.code))
      r.severities.add(SEV[d.severity ?? DiagnosticSeverity.Error]!)
      r.corpus++
      r.corpusProjects.add(p.name)
      if (pool.take(d.message)) r.corpusConfirmed++
      if (codeActions(doc, [d], () => [d]).length > 0) r.corpusFixable++
      if (r.example === "") r.example = d.message.replace(/\s+/g, " ").slice(0, 90)
    }
  }
}

// ─── fixtures ────────────────────────────────────────────────────────────────────────────────────────────────
for (const vendor of ["codesys", "twincat"] as const satisfies readonly Vendor[]) {
  const recorded = BUILDS[vendor].tests
  for (let i = 0; i < ALL_TESTS.length; i++) {
    const rec = recorded[ALL_TESTS[i]!.name]
    if (rec === undefined) continue
    const left = new Map<string, number>()
    for (const d of rec.diagnostics) left.set(comparable(d.message), (left.get(comparable(d.message)) ?? 0) + 1)
    // [finding, how many code actions answer it]
    const items = withReplayFixture(i, vendor, (files, project) => {
      const config = resolveConfig({ vendor })
      const out: [DiagnosticItem, number][] = []
      for (const doc of replayDocuments(files))
        for (const it of computeDiagnostics({ uri: doc.uri, parseResult: doc.parseResult, source: doc.source, project, config })) {
          const d = toLspDiagnostic(it)
          out.push([it, codeActions(doc, [d], () => [d]).length])
        }
      for (const doc of networkDocuments(files))
        for (const it of computeNetworkTextDiagnostics({ uri: doc.uri, parseResult: doc.parseResult }, project, messagesFor(vendor))) out.push([it, 0])
      return out
    })
    for (const [it, actions] of items) {
      if (it.severity !== "error" && it.severity !== "warning") continue
      const code = CODESYS_CODE_MAP[it.code]?.[0] ?? it.code
      const r = row(code)
      r.severities.add(it.severity)
      r[vendor]++
      if (actions > 0) r[`${vendor}Fixable`]++
      if (code === "C0002") {
        const family = C0002_FIXABLE.find(([, re]) => re.test(it.message.trim()))?.[0] ?? `(cascade) ${shapeOf(it.message)}`
        c0002[vendor].set(family, (c0002[vendor].get(family) ?? 0) + 1)
      }
      const k = comparable(it.message)
      if ((left.get(k) ?? 0) > 0) {
        left.set(k, left.get(k)! - 1)
        r[`${vendor}Confirmed`]++
      }
      if (r.example === "") r.example = it.message.replace(/\s+/g, " ").slice(0, 90)
    }
  }
}

// ─── report ──────────────────────────────────────────────────────────────────────────────────────────────────
const ranked = [...rows].sort(([, a], [, b]) => b.corpus - a.corpus || b.codesys + b.twincat - (a.codesys + a.twincat))
console.log("| code | slug | sev | corpus (confirmed) | fixable | projects | fixtures CS (confirmed) | fixable | fixtures TC (confirmed) | fixable | example |")
console.log("|---|---|---|---|---|---|---|---|---|---|---|")
for (const [code, r] of ranked)
  console.log(
    `| ${code} | ${SLUG.get(code) ?? ""} | ${[...r.severities].join("/")} | ${r.corpus} (${r.corpusConfirmed}) | ${r.corpusFixable} | ${r.corpusProjects.size} | ${r.codesys} (${r.codesysConfirmed}) | ${r.codesysFixable} | ${r.twincat} (${r.twincatConfirmed}) | ${r.twincatFixable} | ${r.example.replace(/\|/g, "\\|")} |`,
  )
const sum = (f: (r: Row) => number) => [...rows.values()].reduce((n, r) => n + f(r), 0)
console.log(`\ncodes: ${rows.size}; corpus findings: ${sum((r) => r.corpus)} (confirmed ${sum((r) => r.corpusConfirmed)}); fixture findings CS ${sum((r) => r.codesys)} (confirmed ${sum((r) => r.codesysConfirmed)}), TC ${sum((r) => r.twincat)} (confirmed ${sum((r) => r.twincatConfirmed)})`)
console.log(
  `findings offering a fix: corpus ${sum((r) => r.corpusFixable)} of ${sum((r) => r.corpus)}, fixtures CS ${sum((r) => r.codesysFixable)} of ${sum((r) => r.codesys)}, TC ${sum((r) => r.twincatFixable)} of ${sum((r) => r.twincat)}`,
)

// ─── C0002 by message family ─────────────────────────────────────────────────────────────────────────────────
console.log("\n| C0002 family | fixtures CS | fixtures TC |\n|---|---|---|")
const families = new Set([...C0002_FIXABLE.map(([f]) => f), ...[...c0002.codesys, ...c0002.twincat].sort((a, b) => b[1] - a[1]).map(([f]) => f)])
const shown = [...families].filter((f) => C0002_FIXABLE.some(([n]) => n === f) || (c0002.codesys.get(f) ?? 0) + (c0002.twincat.get(f) ?? 0) >= 20)
for (const f of shown) console.log(`| ${f.replace(/\|/g, "\\|")} | ${c0002.codesys.get(f) ?? 0} | ${c0002.twincat.get(f) ?? 0} |`)
const total = (m: Map<string, number>) => [...m.values()].reduce((n, k) => n + k, 0)
const fixable = (m: Map<string, number>) => C0002_FIXABLE.reduce((n, [f]) => n + (m.get(f) ?? 0), 0)
console.log(`C0002 with one token to insert: CS ${fixable(c0002.codesys)} of ${total(c0002.codesys)}, TC ${fixable(c0002.twincat)} of ${total(c0002.twincat)} (shapes under 20 findings not listed)`)
