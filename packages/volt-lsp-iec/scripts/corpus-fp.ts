/**
 * Corpus false-positive tally, grouped by check code — the zero-FP oracle in a debuggable form.
 *
 * The corpus (`test-corpus/`) compiles clean in the IDE, so EVERY error-severity diagnostic the LSP gives here is a
 * false positive. `corpus.test.ts` asserts the total is zero; this script is what you run when it isn't — it groups the
 * FPs by the code a client sees and shows the first few offenders per code with their file, so you can see which check
 * over-fires and on what.
 *
 * It asks the SERVER's function (`test/corpus/support/diagnostics.ts` `projectDocuments` — `documentDiagnostics` with
 * the project's own settings, each project as its own vendor), the one composition `corpus.test.ts` gates (analysis-
 * conformance 2.6). It used to re-implement the server's suppression beside the analysis — the library gate, dead POUs
 * and members — on a CODESYS analysis of every project, without network text or the project's settings: a second
 * answer that could drift from the one a user sees.
 *
 *   bun scripts/corpus-fp.ts            # all checks
 *   bun scripts/corpus-fp.ts C0032      # only codes containing "C0032"
 */
import { corpusProjects } from "../test/frontend/sources.js"
import { projectDocuments } from "../test/corpus/support/diagnostics.js"
import { DiagnosticSeverity } from "vscode-languageserver-protocol/node"

const filter = process.argv[2]

const byCode: Record<string, string[]> = {}
for (const p of corpusProjects())
  for (const d of projectDocuments(p.dir, p.vendor))
    for (const diag of d.diagnostics)
      if (diag.severity === DiagnosticSeverity.Error)
        (byCode[String(diag.code ?? "(no code: a body that states no language)")] ??= []).push(`${p.name}${d.uri.slice(p.dir.length)}: ${diag.message}`)

const codes = Object.keys(byCode)
  .filter((c) => !filter || c.includes(filter))
  .sort((a, b) => byCode[b].length - byCode[a].length)
if (codes.length === 0) {
  console.log("No false positives 🎉")
} else {
  let total = 0
  for (const code of codes) {
    total += byCode[code].length
    console.log(`\n### ${code}: ${byCode[code].length}`)
    for (const m of byCode[code].slice(0, 8)) console.log("  ", m)
    if (byCode[code].length > 8) console.log(`   … +${byCode[code].length - 8} more`)
  }
  console.log(`\nTOTAL false positives: ${total}`)
  process.exitCode = 1
}
