/**
 * THE STORED NETWORK, BODY, PARALLEL, BRANCH AND IL STATES ON A LIVE CODESYS (openspec ide-model-mapping 2.2): every state the recording
 * `test/fixtures/nwl-schema/class-states.3.5.21.40.json` marks `live` stands as a PROGRAM in its own fixture, authored in
 * the IDE by the editor's own commands and, for a state no command makes, the object model:
 *
 *   powershell -File scripts/ide.ps1 up -Vendor codesys -Instance <yours> -Fixture test/fixtures/nwl-schema/CodesysClassStates.3.5.21.40.project -Wait
 *
 * A pull that changes for one of them fails, naming it. The offline twin over every row is `CodesysClassStatesTests`.
 *
 * CODESYS only (openspec: no TwinCAT live for now).
 */
import { describe, expect, setDefaultTimeout } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { requireHealthy, VENDOR, BASE } from "../harness"
import { itGapped, PLATFORM_GAPS } from "../lib/platform"
import { bridge } from "../lib/bridge"
import { pathIn, pathOf } from "../lib/workspace"

const it = itGapped(PLATFORM_GAPS.graphicalWrite)

setDefaultTimeout(1_800_000)

interface Row {
	id: string
	name: string
	language: string
	what: string
	live: boolean
	pull: string
}

const FIXTURES = join(import.meta.dir, "..", "..", "fixtures", "nwl-schema")
const recording = JSON.parse(readFileSync(join(FIXTURES, "class-states.3.5.21.40.json"), "utf8"))
const live: Row[] = recording.states.filter((s: Row) => s.live)

const items = VENDOR === "codesys" ? ((await bridge.refs()).items ?? {}) : {}
const served = VENDOR === "codesys" && live.length > 0 && pathIn(items, `${live[0]!.name}.pou`) !== undefined
if (VENDOR === "codesys" && !served)
	console.warn(`[nwl-class-states] ${BASE} serves no ${live[0]?.name ?? "clS*"} object: serve test/fixtures/nwl-schema/CodesysClassStates.3.5.21.40.project (ide.ps1 up -Fixture ...)`)

/** The body lines of a pulled item from its `%LANGUAGE` line on, as the recording holds them. */
function bodyLines(source: string): string {
	const text = source.replace(/\r\n/g, "\n")
	const body = text.slice(text.indexOf("%LANGUAGE")).replace(/\nEND_PROGRAM[\s\S]*$/, "")
	return body.split("\n").filter((l) => l.trim().length > 0).join(" / ")
}

describe.skipIf(VENDOR !== "codesys")(`graphical / stored network, body, parallel, branch and IL states, ide-model-mapping (${BASE})`, () => {
	it.skipIf(!served)("every stored state pulls as the recording says", async () => {
		await requireHealthy()
		const paths = await Promise.all(live.map((r) => pathOf(`${r.name}.pou`)))
		const answer = await bridge.fetch({ knownItems: {}, onlyItems: paths })
		const text = new Map<string, string>(answer.changed.map((i: any) => [i.name, i.sourceText]))
		const different = live.flatMap((r, i) => {
			const source = text.get(paths[i]!)
			if (source === undefined) return [`${r.id}: not in the fetch`]
			const pulled = bodyLines(source)
			return pulled === r.pull ? [] : [`${r.id} ${r.language} ${r.what}: pulled '${pulled}', recorded '${r.pull}'`]
		})
		expect(different.slice(0, 30)).toEqual([])
	})
})
