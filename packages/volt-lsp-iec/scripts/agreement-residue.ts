/**
 * Why each fixture does NOT agree exactly with the IDE — the work list for closing the agreement gap.
 *
 *   bun run scripts/agreement-residue.ts            the buckets + the most-missed messages
 *   bun run scripts/agreement-residue.ts --detail   every incomplete fixture and what it misses
 *   bun run scripts/agreement-residue.ts <name>…    one fixture's source beside both sides in full
 *
 * `fixtures.test.ts` reports ONE number (exact agreement) and fails only on a false positive, so a fixture that is
 * merely INCOMPLETE — the LSP right about everything it says and silent about the rest — is invisible in it. This
 * buckets every disagreement into missing-only / extra-only / both / no-recording, then ranks the IDE messages the LSP
 * most often misses. It is how the parse-error cascade was found: 109 of 126 disagreements were missing-only, and the
 * missing messages were overwhelmingly one shape.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ALL_TESTS } from "../test/conformance/fixtures/index.js"
import { KNOWN_DIVERGENCES } from "../test/conformance/support/divergences.js"
import { replayDiagnostics, withReplayFixture } from "../test/conformance/support/replay.js"
import { comparable } from "../test/conformance/support/compare-message.js"

// WHICH VENDOR? `VOLT_VENDOR=twincat` picks the other recording AND the other dialect — since the vocabulary,
// the wording and one collapse rule all differ, reading TwinCAT's residue through a CODESYS analysis would invent
// differences that are not there.
const asked = process.env.VOLT_VENDOR
// NO FALLBACK. `VOLT_VENDOR=TwinCAT` reading the CODESYS recording through the CODESYS dialect would print a
// residue list for the wrong vendor and say nothing about it — a wrong answer is worse than no answer.
if (asked !== undefined && asked !== "twincat" && asked !== "codesys") {
  console.error(`VOLT_VENDOR="${asked}" is not a vendor — use "codesys" or "twincat"`)
  process.exit(1)
}
const vendor = asked === "twincat" ? ("twincat" as const) : ("codesys" as const)
const builds = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "test", "conformance", "recordings", `${vendor}.build.json`), "utf8"),
).tests as Record<string, { diagnostics: { severity: string; message: string }[] }>
const buckets = new Map<string, string[]>()
const add = (k: string, name: string) => buckets.set(k, [...(buckets.get(k) ?? []), name])
const missingMessages = new Map<string, number>()
const perFixture: [name: string, missing: string[], extra: string[]][] = []

const only = process.argv.slice(2).filter((a) => !a.startsWith("--"))

for (let i = 0; i < ALL_TESTS.length; i++) {
  const t = ALL_TESTS[i]!
  // A DOCUMENTED divergence is not a work item. Skipping them is what keeps this a WORK LIST: they are device
  // and application facts (no dynamic-memory pool, no structured exception handling on that code generator, no
  // VAR_PERSISTENT list) and reachability, and an editor can know none of them.
  if (KNOWN_DIVERGENCES[vendor].has(t.name)) continue
  if (only.length > 0 && !only.includes(t.name)) continue
  const rec = builds[t.name]
  if (rec === undefined) {
    // A vendor whose IDE REFUSED the push has no ground truth here and never will — that is a fact about the
    // fixture, not a gap in the recording, so it is bucketed as what it is.
    add(t.vendorRefuses?.[vendor] !== undefined ? `the ${vendor} IDE refuses this fixture` : "no recording at all", t.name)
    continue
  }
  const ide = rec.diagnostics.filter((d) => d.severity === "error" || d.severity === "warning").map((d) => `[${d.severity}] ${comparable(d.message)}`).sort()
  // THE REPLAY'S OWN ANSWER (`support/replay.ts` `replayDiagnostics`, analysis-conformance 2.6): the same project and the
  // same composition `fixtures.test.ts` gates, or this tool prints a work list for a compiler nobody runs. It built a
  // project of its own — every file parsed as a `.st` source rather than as the object its file holds — and two fixtures
  // answered differently here than in the replay (task 0.4: `cc5_deprecated_functionblock_keyword`,
  // `unit_namespace_method_after_fb`).
  const lsp = withReplayFixture(i, vendor, (files, project) => replayDiagnostics(files, project, vendor))
    .filter((d) => d.severity === "error" || d.severity === "warning")
    .map((d) => `[${d.severity}] ${comparable(d.message)}`)
  lsp.sort()
  if (only.length > 0) {
    console.log(`
=== ${t.name}
--- source
${t.source}--- IDE (${String(ide.length)})`)
    for (const m of ide) console.log(`  ${m}`)
    console.log(`--- LSP (${String(lsp.length)})`)
    for (const m of lsp) console.log(`  ${m}`)
    continue
  }
  if (lsp.length === ide.length && lsp.every((m, k) => m === ide[k])) continue
  const ideSet = new Set(ide)
  const lspSet = new Set(lsp)
  const missing = ide.filter((m) => !lspSet.has(m))
  const extra = lsp.filter((m) => !ideSet.has(m))
  for (const m of missing) missingMessages.set(m, (missingMessages.get(m) ?? 0) + 1)
  add(extra.length > 0 ? (missing.length > 0 ? "both extra and missing" : "extra only") : "missing only", t.name)
  if (missing.length > 0 || extra.length > 0) perFixture.push([t.name, missing, extra])
  if (extra.length === 0 && missing.length === 0) {
    const count = (list: string[]) => { const m = new Map<string, number>(); for (const x of list) m.set(x, (m.get(x) ?? 0) + 1); return m }
    const a = count(ide), b = count(lsp)
    for (const [msg, n] of a) if ((b.get(msg) ?? 0) !== n) add(`repeat: ide ${String(n)} vs lsp ${String(b.get(msg) ?? 0)} | ${msg.slice(0, 70)}`, t.name)
  }
}

if (only.length > 0) process.exit(0)
console.log("why a fixture does not agree:")
for (const [k, names] of [...buckets].sort((a, b) => b[1].length - a[1].length)) console.log(`  ${String(names.length).padStart(4)}  ${k}${k.startsWith("repeat") ? `  <- ${names.slice(0, 2).join(", ")}` : ""}`)
console.log("\nthe IDE messages the LSP most often MISSES:")
for (const [m, n] of [...missingMessages].sort((a, b) => b[1] - a[1]).slice(0, 22)) console.log(`  ${String(n).padStart(4)}  ${m.slice(0, 118)}`)

// `--detail` lists every incomplete fixture with what it misses (-) and wrongly adds (+) — the work list itself.
if (process.argv.includes("--detail")) {
  console.log("\nper fixture:")
  for (const [name, missing, extra] of perFixture.sort((a, b) => b[1].length + b[2].length - (a[1].length + a[2].length))) {
    console.log(`\n  ${name}`)
    for (const m of missing) console.log(`    - ${m.slice(0, 130)}`)
    for (const m of extra) console.log(`    + ${m.slice(0, 130)}`)
  }
}
