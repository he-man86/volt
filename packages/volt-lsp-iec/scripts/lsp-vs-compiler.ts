/**
 * Ground-truth validation: diff the LSP's diagnostics against the CODESYS COMPILER's.
 *
 * The real-corpus ratchet ASSUMES "the project compiles clean, so every LSP diagnostic is a false positive."
 * This proves (or refutes) that premise: it builds the live project (the compiler is the oracle) and compares
 * its diagnostics with the LSP's over the same harvested corpus.
 *
 *   - compiler ERRORS == 0        → premise holds; the LSP's remaining diagnostics are all false positives.
 *   - compiler ERRORS  > 0        → the corpus is NOT clean OR (common) the HEADLESS build lacks device
 *                                   descriptions the full IDE has. If the errors come with "Device description
 *                                   … missing" warnings, they are a headless artefact — ground truth for that
 *                                   project can only be captured from the full IDE (which is why we harvest the
 *                                   corpus once and commit it AS the ground truth).
 *   - compiler WARNINGS           → checks the compiler runs that the LSP may want to match (e.g. implicit
 *                                   LREAL→REAL narrowing). Listed so gaps are visible.
 *
 * The LSP side reuses computeCoverage (loads .library/.device reference files, skips build-excluded objects),
 * so its number is the same one the ratchet tracks.
 *
 * Usage (needs a LIVE bridge on the project the corpus was harvested from):
 *   bun packages/volt-lsp-iec/scripts/lsp-vs-compiler.ts <corpusDir> <port> [vendor]
 */
import { basename } from "node:path"
import { computeCoverage } from "./coverage-report.js"

const [corpusDir, portArg, vendorArg] = process.argv.slice(2)
if (!corpusDir || !portArg) {
	console.error("usage: bun lsp-vs-compiler.ts <corpusDir> <port> [vendor]")
	process.exit(2)
}
const port = Number(portArg)
const vendor = (vendorArg ?? "codesys") as "codesys" | "twincat"
const BASE = `http://127.0.0.1:${port}`

// ── LSP side (the exact number the ratchet tracks — loads .library/.device, skips excluded) ──
const cov = computeCoverage(corpusDir, vendor)

// ── compiler side: build the live project, partition diagnostics ──
const buildResp = await (await fetch(`${BASE}/build`, {
	method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ buildType: "full" }),
})).json()
const cDiags: { severity: string; object?: string; message: string }[] = buildResp.diagnostics ?? []
const cErrors = cDiags.filter((d) => d.severity === "error")
const cWarnings = cDiags.filter((d) => d.severity === "warning")
// The headless build environment lacks placeholder libraries + device descriptions the full IDE has; errors
// referencing those are an artefact of headless, not real code errors — and they name the SAME symbols the LSP
// flags as library-blind unresolved-identifiers.
const headlessGap = cDiags.some((d) => /device description.*missing|could not open library|placeholder library/i.test(d.message))

console.log(`\n══ LSP vs CODESYS compiler — ${basename(corpusDir)} (${vendor}) ══`)
console.log(`compiler:  ${cErrors.length} errors, ${cWarnings.length} warnings  (build ${buildResp.success ? "ok" : "FAILED"}, ${buildResp.duration ?? "?"}ms)`)
console.log(`LSP:       ${cov.totalDiags} diagnostics on built objects  ${JSON.stringify(cov.byCode)}  [+${cov.excludedDiags} suppressed on ${cov.excludedFiles} excluded]`)

console.log(`\nground truth:`)
if (cErrors.length === 0) {
	console.log(`  ✓ project compiles clean (0 errors) → every LSP diagnostic is a false positive`)
} else if (headlessGap) {
	console.log(`  ⚠ ${cErrors.length} compiler errors, but the HEADLESS build is missing libraries/device descriptions the full IDE has —`)
	console.log(`    these are a headless artefact, not real code errors, and name the same symbols the LSP flags as library-blind;`)
	console.log(`    ground truth for this project comes from the committed corpus (harvested once from the full IDE).`)
} else {
	console.log(`  ✗ compiler reports ${cErrors.length} ERRORS with no missing-device excuse — the corpus may NOT be clean; investigate.`)
}

const top = (list: typeof cDiags, label: string) => {
	if (list.length === 0) return
	console.log(`\ncompiler ${label} (top 12):`)
	const seen = new Map<string, number>()
	for (const d of list) { const k = `${d.object ?? "(project)"}: ${d.message}`; seen.set(k, (seen.get(k) ?? 0) + 1) }
	for (const [k, n] of [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${n}×  ${k.slice(0, 100)}`)
}
top(cErrors, "errors")
top(cWarnings, "warnings")
console.log("")
