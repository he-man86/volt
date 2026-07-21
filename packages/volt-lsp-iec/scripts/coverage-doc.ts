#!/usr/bin/env bun
/**
 * Regenerate `docs/codesys-reference/compiler-warnings-coverage.md` from the error catalog — the map of every
 * code in the CODESYS "Compiler warnings" dialog and Volt's coverage. Run after changing a dialog code's status.
 *
 *   bun scripts/coverage-doc.ts
 *
 * A dialog code counts as implemented when it has an `ourCode` and status "implemented". Open codes are grouped
 * by their `gap` field (needs-live-verify / wont-fix / blocked) or, for build-dependent ones, status "ide-only".
 */
import { readFileSync, writeFileSync } from "node:fs"
import { CONFIGURABLE_CODES } from "../src/analysis/config.js"

// The ~66 codes shown in the CODESYS project-settings "Compiler warnings" dialog (harvested from screenshots).
const DIALOG = [
  "C0033","C0100","C0118","C0125","C0139","C0187","C0195","C0196","C0197","C0198","C0200","C0209","C0210","C0220",
  "C0223","C0228","C0245","C0266","C0269","C0298","C0308","C0312","C0315","C0316","C0325","C0327","C0335","C0339",
  "C0344","C0349","C0350","C0351","C0354","C0355","C0357","C0370","C0371","C0373","C0388","C0389","C0394","C0404",
  "C0406","C0410","C0421","C0422","C0426","C0441","C0447","C0508","C0513","C0514","C0515","C0516","C0517","C0522",
  "C0525","C0526","C0527","C0533","C0540","C0542","C0543","C0555","C0561","C0564",
]

const CATALOG = new URL("../docs/codesys-reference/error-catalog.json", import.meta.url)
const OUT = new URL("../docs/codesys-reference/compiler-warnings-coverage.md", import.meta.url)
type Entry = { code: string; status: string; ourCode?: string | null; category?: string | null; message?: string | null; gap?: string; note?: string; ideOnlyReason?: string }
const cat: Entry[] = JSON.parse(readFileSync(CATALOG, "utf8"))
const find = (code: string) => cat.find((x) => x.code === code)
const desc = (e?: Entry) => (e ? (e.category ?? (e.message ?? "").slice(0, 60)) : "—")
const isImpl = (e?: Entry) => !!(e && e.ourCode && e.status === "implemented")

let impl = 0
let md = `# CODESYS "Compiler warnings" — coverage in Volt

Every code in the CODESYS project-settings **Compiler warnings** dialog, and whether Volt implements a 3-state
control (off/warning/error) for it. Implemented codes get a \`volt.iec.diagnostics.<code>\` setting; the rest are
documented here as gaps, each with the concrete reason it isn't a setting yet. Regenerate with
\`bun scripts/coverage-doc.ts\`.

| CODESYS | Volt status | our code / setting | description |
|---|---|---|---|
`
let settings = 0
for (const code of DIALOG) {
  const e = find(code)
  const done = isImpl(e)
  if (done) impl++
  const configurable = done && CONFIGURABLE_CODES.has(e!.ourCode!)
  if (configurable) settings++
  const status = done ? (configurable ? "✅ **3-state setting**" : "✅ implemented (fixed error)") : e ? `⬜ ${e.gap ?? e.status}` : "⬜ absent"
  md += `| ${code} | ${status} | ${done ? "`" + e!.ourCode + "`" : "—"} | ${desc(e)} |\n`
}
md += `\n**${impl} of ${DIALOG.length}** dialog codes are implemented (${settings} as toggleable 3-state settings, ${impl - settings} as fixed errors). The other **${DIALOG.length - impl}** are gaps — grouped by why below.\n`

// Bucket the open codes.
const buckets: Record<string, [string, Entry | undefined][]> = { "needs-live-verify": [], "ide-only": [], "wont-fix": [], blocked: [], absent: [] }
for (const code of DIALOG) {
  const e = find(code)
  if (isImpl(e)) continue
  if (!e) buckets.absent.push([code, undefined])
  else if (e.status === "ide-only") buckets["ide-only"].push([code, e])
  else if (e.gap && buckets[e.gap]) buckets[e.gap]!.push([code, e])
  else buckets.absent.push([code, e])
}
const reason = (e: Entry) => (e.gap === undefined ? e.ideOnlyReason : e.note) ?? ""
const section = (title: string, key: string, blurb: string, col: string) => {
  const rows = buckets[key]!
  md += `\n### ${title} (${rows.length})\n\n${blurb}\n\n| CODESYS | what it flags | ${col} |\n|---|---|---|\n`
  for (const [code, e] of rows) md += `| ${code} | ${desc(e)} | ${e ? reason(e) : ""} |\n`
}
md += `\n## Closing the gaps\n\nRe-verify each against current CODESYS before acting — the catalog notes are dated observations, not standing facts (headless bridge: \`codesys-pipe.ps1 up\`, then \`scripts/record-gaps.ts\`). A check that fires on the IDE-clean corpus is a false positive, not a finding.\n`
section("Needs live-CODESYS verification", "needs-live-verify", "Offline-feasible in principle, but the exact trigger/wording is unverified and/or needs infrastructure the pipeline lacks.", "blocker")
section("Needs IDE build/runtime data — cannot be done offline", "ide-only", "These need device/library metadata, codegen, memory layout, or a project option a headless bridge does not have.", "why Volt cannot")
section("Won't-fix — would false-positive on legal code", "wont-fix", "Offline-decidable, but the trigger fires on code CODESYS accepts (proven against the corpus / live IDE).", "why not")
section("Blocked by architecture", "blocked", "", "blocker")
md += `\n### Not yet catalogued (${buckets.absent.length})\n\nDialog codes with no catalog entry — record each from live CODESYS, then it moves to a group above.\n\n\`${buckets.absent.map((x) => x[0]).join("`, `")}\`\n`

writeFileSync(OUT, md)
console.log(`wrote coverage doc — ${impl}/${DIALOG.length} implemented; gaps:`, Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])))
