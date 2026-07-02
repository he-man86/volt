/**
 * Harvest a COMPLETE LSP corpus from a live bridge — fetch every project item, materialize it, and write
 * the src-relative tree to <outDir>. For refreshing packages/volt-lsp-codesys/test-corpus/<name>.
 *   bun volt-scripts/harvest-lsp-corpus.ts <outDir> [port]
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { materializeItem } from "../packages/volt-git/src/translate/materialize.ts"

const outDir = process.argv[2]
const port = process.argv[3] ?? "8556"
if (!outDir) { console.error("usage: bun volt-scripts/harvest-lsp-corpus.ts <outDir> [port]"); process.exit(1) }

const res = await fetch(`http://127.0.0.1:${port}/fetch`, {
	method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ knownItems: {} }),
})
if (!res.ok) { console.error(`/fetch failed: ${res.status} ${await res.text()}`); process.exit(1) }
const fetched = (await res.json()) as { changed: { name: string; folder?: string; sourceText: string; version: string }[] }
console.log(`fetched ${fetched.changed.length} items`)

rmSync(outDir, { recursive: true, force: true })
const KIND = new Set([".fb", ".prg", ".fun", ".itf", ".struct", ".enum", ".union", ".alias", ".gvl"])
// Items whose assembled sourceText is known-corrupt — omitted so the corpus keeps its 100%-parse invariant.
// SetErrorFB.fb: a CFC-bodied FB whose child methods assemble with the PARENT's declaration (StAssembler
// bug, tracked separately). Re-add once that's fixed.
const KNOWN_BAD = new Set(["SetErrorFB.fb"])
let written = 0, kind = 0, skipped = 0
for (const item of fetched.changed) {
	if (KNOWN_BAD.has(item.name)) { skipped++; continue }
	// Corpus hygiene: a CODESYS folder name may embed `/` or trailing spaces (e.g. "Interfaces / Data"),
	// which materialize to git-hostile trailing-space directories on Windows. Trim each path segment — the
	// folder path is irrelevant to what the LSP corpus tests (item name + content). This is a fixture-only
	// normalization; real materialize.ts must NOT trim (push round-trips the exact folder name).
	if (item.folder) item.folder = item.folder.split("/").map((s) => s.trim()).filter(Boolean).join("/")
	let files
	try { files = materializeItem(item) } catch { skipped++; continue } // non-source kind not in the registry
	for (const f of files) {
		const dot = f.path.lastIndexOf(".")
		if (dot < 0 || !KIND.has(f.path.slice(dot).toLowerCase())) { skipped++; continue } // KIND source only (reference kinds have invalid Windows names anyway)
		const p = join(outDir, f.path)
		mkdirSync(dirname(p), { recursive: true })
		writeFileSync(p, f.content, "utf-8")
		written++; kind++
	}
}
console.log(`wrote ${written} files (${kind} KIND source), skipped ${skipped} unrecognized`)
