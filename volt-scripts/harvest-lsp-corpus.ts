/**
 * Harvest a COMPLETE LSP corpus from a live bridge — fetch every project item, materialize it, and write
 * the src-relative tree to <outDir>. For refreshing packages/volt-lsp-iec/test-corpus/<name>.
 *   bun volt-scripts/harvest-lsp-corpus.ts <outDir> [port]
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { materializeItem } from "../packages/volt-git/src/translate/materialize.js"
import { addExcludeMarker, addUncompiledMarker, isSourceFile } from "../packages/volt-git/src/translate/exclude-marker.js"

const outDir = process.argv[2]
const port = process.argv[3] ?? "8556"
if (!outDir) { console.error("usage: bun volt-scripts/harvest-lsp-corpus.ts <outDir> [port]"); process.exit(1) }

// `verbose` also returns referenced-library element SIGNATURES (build-free), materialized under each library's
// folder in the Library Manager — the harvest wants the complete picture for the LSP corpus.
const res = await fetch(`http://127.0.0.1:${port}/fetch`, {
	method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ knownItems: {}, verbose: true }),
})
if (!res.ok) { console.error(`/fetch failed: ${res.status} ${await res.text()}`); process.exit(1) }
const fetched = (await res.json()) as {
	changed: { name: string; folder?: string; sourceText: string; version: string }[]
	excludeFromBuild?: Record<string, boolean>
	deadCode?: Record<string, boolean>
	librarySignatures?: { path: string; content: string }[]
}
const excluded = fetched.excludeFromBuild ?? {}
const deadCode = fetched.deadCode ?? {}
console.log(`fetched ${fetched.changed.length} items`)

rmSync(outDir, { recursive: true, force: true })
// KIND source (analyzed by the LSP) + `.library` reference files (their NAMESPACE drives library resolution)
// + `.device` files (their filename = a device-tree instance name the LSP registers as a known global).
// Bridge-encoded filenames are Windows-safe. Bodies (.cfc/.sfc) and other reference kinds are skipped.
const KIND = new Set([".fb", ".prg", ".fun", ".itf", ".struct", ".enum", ".union", ".alias", ".gvl"])
const WRITE = new Set([...KIND, ".library", ".device", ".projectinfo", ".trace", ".recipe", ".symbols", ".task"])
let written = 0, kind = 0, lib = 0, dev = 0, info = 0, misc = 0, skipped = 0
for (const item of fetched.changed) {
	let files
	try { files = materializeItem(item) } catch { skipped++; continue } // non-source kind not in the registry
	for (const f of files) {
		const dot = f.path.lastIndexOf(".")
		const ext = dot < 0 ? "" : f.path.slice(dot).toLowerCase()
		if (!WRITE.has(ext)) { skipped++; continue }
		// Source files with no compiler ground truth carry an in-file marker the LSP reads (matches volt pull):
		// excluded-from-build, or dead/uncompiled code (an uncalled POU CODESYS never compiled).
		const bn = basename(f.path)
		const content = !isSourceFile(f.path) ? f.content
			: excluded[bn] ? addExcludeMarker(f.content)
			: deadCode[bn] ? addUncompiledMarker(f.content)
			: f.content
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
console.log(`wrote ${written} files (${kind} KIND source, ${lib} .library, ${dev} .device, ${info} .projectinfo, ${misc} .trace/.recipe/.symbols/.task), skipped ${skipped}`)

// Referenced-library SIGNATURES from the same verbose /fetch — each already pathed under its library's folder
// in the Library Manager (declaration-only, vendor libs; TwinCAT returns none).
let sigs = 0, sigSkip = 0
for (const it of fetched.librarySignatures ?? []) {
	try {
		const p = join(outDir, it.path)
		mkdirSync(dirname(p), { recursive: true })
		writeFileSync(p, it.content, "utf-8")
		sigs++
	} catch { sigSkip++ } // e.g. a path exceeding the OS limit — a handful of very long library names
}
console.log(`wrote ${sigs} library-signature files${sigSkip ? ` (skipped ${sigSkip} unwritable)` : ""}`)
