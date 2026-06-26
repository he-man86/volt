/**
 * Corpus harvester — capture every POU's raw PLCopenXML from a live bridge into the round-trip
 * coverage corpus. No authoring: open a real project in the IDE, point the bridge at it, run this.
 *
 *   bun volt-scripts/harvest-corpus.ts [port]      # default 8556 (CODESYS); 8555 = TwinCAT
 *
 * Writes packages/volt-bridge/test/Volt.Bridge.Tests/fixtures/corpus/<name>.plcopen.xml,
 * which FbdCorpusRoundTripTests then measures. Re-run on any project to grow the corpus.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const port = process.argv[2] ?? "8556"
const corpus = join(
	import.meta.dirname, "..",
	"packages", "volt-bridge", "test", "Volt.Bridge.Tests", "fixtures", "corpus",
)
mkdirSync(corpus, { recursive: true })

const res = await fetch(`http://127.0.0.1:${port}/raw`)
if (!res.ok) { console.error(`/raw failed on :${port}: ${res.status}`); process.exit(1) }
const { count, bodies } = (await res.json()) as { count: number; bodies: Record<string, string> }

let written = 0, graphical = 0
for (const [name, xml] of Object.entries(bodies)) {
	const safe = name.replace(/[^A-Za-z0-9._-]+/g, "_")
	writeFileSync(join(corpus, `${safe}.plcopen.xml`), xml, "utf-8")
	written++
	if (/<(FBD|LD)\b/.test(xml)) graphical++
}
console.log(`harvested ${count} POU(s) from :${port} → ${written} file(s) (${graphical} contain FBD/LD) in fixtures/corpus/`)
