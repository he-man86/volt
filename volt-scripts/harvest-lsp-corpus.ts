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
const namespaces = new Set<string>()   // referenced-library namespaces → libs/namespaces.json (Phase 1 catalog)
let written = 0, kind = 0, skipped = 0
for (const item of fetched.changed) {
	// A `.library` item's body is the reference manifest; capture its NAMESPACE for the library catalog.
	if (item.name.endsWith(".library")) {
		const m = item.sourceText.match(/^NAMESPACE (.+)$/m)
		if (m && m[1]!.trim()) namespaces.add(m[1]!.trim())
	}
	// Folder-segment names are already percent-encoded by the bridge (FolderPath) — a name like
	// "Interfaces / Data" arrives as "Interfaces %2F Data", a filesystem-safe segment — so materialize
	// produces clean paths with no normalization needed here.
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
// The library namespace catalog (Phase 1 of the library signature index) — sorted, so it's diffable.
const catalog = join(outDir, "libs", "namespaces.json")
mkdirSync(dirname(catalog), { recursive: true })
writeFileSync(catalog, JSON.stringify([...namespaces].sort(), null, "\t") + "\n", "utf-8")
console.log(`wrote ${written} files (${kind} KIND source), ${namespaces.size} library namespaces, skipped ${skipped} unrecognized`)
