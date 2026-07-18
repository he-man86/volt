/**
 * Harvest a COMPLETE LSP corpus from a live bridge — a plain verbose `/fetch`, written out verbatim.
 * NO filtering, NO materialization: every item the bridge returns (KIND source + referenced-library
 * signatures + `.library`/`.device`/… reference files) is written to `<outDir>/<folder>/<name>` exactly
 * as the bridge encoded it. For refreshing `packages/volt-lsp-iec/test-corpus/<name>`.
 *   bun packages/volt-lsp-iec/scripts/harvest-lsp-corpus.ts <outDir> [port]
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { call, pipeName } from "./bridge.js"

const outDir = process.argv[2]
const port = process.argv[3] ?? "8556"
if (!outDir) {
	console.error("usage: bun run harvest:corpus <outDir> [port]")
	process.exit(1)
}

// `verbose` = full library-element signatures. Dead (uncalled) code rides through as ordinary source now —
// the LSP suppresses its diagnostics structurally, so the corpus stays clean-compiling without a bridge flag.
const { changed } = (await call("fetch", { knownItems: {}, verbose: true }, pipeName(port))) as {
	changed: { name: string; folder?: string; sourceText: string }[]
}

rmSync(outDir, { recursive: true, force: true })
for (const item of changed) {
	const p = join(outDir, item.folder ?? "", item.name)
	mkdirSync(dirname(p), { recursive: true })
	writeFileSync(p, item.sourceText, "utf-8")
}
console.log(`wrote ${changed.length} items to ${outDir}`)
