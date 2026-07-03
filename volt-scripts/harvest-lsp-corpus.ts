/**
 * Harvest a COMPLETE LSP corpus from a live bridge — fetch every project item, materialize it, and write
 * the src-relative tree to <outDir>. For refreshing packages/volt-lsp-iec/test-corpus/<name>.
 *   bun volt-scripts/harvest-lsp-corpus.ts <outDir> [port]
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { materializeItem } from "../packages/volt-git/src/translate/materialize.js"
import { addExcludeMarker, isSourceFile } from "../packages/volt-git/src/translate/exclude-marker.js"

const outDir = process.argv[2]
const port = process.argv[3] ?? "8556"
if (!outDir) { console.error("usage: bun volt-scripts/harvest-lsp-corpus.ts <outDir> [port]"); process.exit(1) }

const res = await fetch(`http://127.0.0.1:${port}/fetch`, {
	method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ knownItems: {} }),
})
if (!res.ok) { console.error(`/fetch failed: ${res.status} ${await res.text()}`); process.exit(1) }
const fetched = (await res.json()) as {
	changed: { name: string; folder?: string; sourceText: string; version: string }[]
	excludeFromBuild?: Record<string, boolean>
}
const excluded = fetched.excludeFromBuild ?? {}
console.log(`fetched ${fetched.changed.length} items`)

rmSync(outDir, { recursive: true, force: true })
// KIND source (analyzed by the LSP) + `.library` reference files (their NAMESPACE drives library resolution)
// + `.device` files (their filename = a device-tree instance name the LSP registers as a known global).
// Bridge-encoded filenames are Windows-safe. Bodies (.cfc/.sfc) and other reference kinds are skipped.
const KIND = new Set([".fb", ".prg", ".fun", ".itf", ".struct", ".enum", ".union", ".alias", ".gvl"])
const WRITE = new Set([...KIND, ".library", ".device", ".projectinfo", ".trace", ".recipe", ".symbols"])
let written = 0, kind = 0, lib = 0, dev = 0, info = 0, misc = 0, skipped = 0
for (const item of fetched.changed) {
	let files
	try { files = materializeItem(item) } catch { skipped++; continue } // non-source kind not in the registry
	for (const f of files) {
		const dot = f.path.lastIndexOf(".")
		const ext = dot < 0 ? "" : f.path.slice(dot).toLowerCase()
		if (!WRITE.has(ext)) { skipped++; continue }
		// Excluded-from-build source files carry the in-file marker the LSP reads (matches volt pull).
		const content = isSourceFile(f.path) && excluded[basename(f.path)] ? addExcludeMarker(f.content) : f.content
		const p = join(outDir, f.path)
		mkdirSync(dirname(p), { recursive: true })
		writeFileSync(p, content, "utf-8")
		written++
		if (ext === ".library") lib++
		else if (ext === ".device") dev++
		else if (ext === ".projectinfo") info++
		else if (KIND.has(ext)) kind++
		else misc++
	}
}
console.log(`wrote ${written} files (${kind} KIND source, ${lib} .library, ${dev} .device, ${info} .projectinfo, ${misc} .trace/.recipe/.symbols), skipped ${skipped}`)
