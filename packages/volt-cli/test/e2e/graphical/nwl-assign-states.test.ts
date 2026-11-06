/**
 * THE STORED ASSIGN AND OPERAND STATES ON A LIVE CODESYS (openspec ide-model-mapping 2.1): every state the recording
 * `test/fixtures/nwl-schema/assign-states.3.5.21.40.json` marks `live` stands as a PROGRAM in its own fixture, authored in
 * the IDE by the editor's own commands and, for a state no command makes, the object model:
 *
 *   powershell -File scripts/ide.ps1 up -Vendor codesys -Instance <yours> -Fixture test/fixtures/nwl-schema/CodesysAssignStates.3.5.21.40.project -Wait
 *
 * A pull that changes for one of them fails, naming it. The offline twin over every row is `CodesysAssignStatesTests`.
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
const recording = JSON.parse(readFileSync(join(FIXTURES, "assign-states.3.5.21.40.json"), "utf8"))
const live: Row[] = recording.states.filter((s: Row) => s.live)

const items = VENDOR === "codesys" ? ((await bridge.refs()).items ?? {}) : {}
const served = VENDOR === "codesys" && live.length > 0 && pathIn(items, `${live[0]!.name}.pou`) !== undefined
if (VENDOR === "codesys" && !served)
	console.warn(`[nwl-assign-states] ${BASE} serves no ${live[0]?.name ?? "asS*"} object: serve test/fixtures/nwl-schema/CodesysAssignStates.3.5.21.40.project (ide.ps1 up -Fixture ...)`)

/** The body lines of a pulled item, as the recording holds them. */
function bodyLines(source: string): string {
	const text = source.replace(/\r\n/g, "\n")
	const body = text.slice(text.indexOf("%LANGUAGE")).replace(/\nEND_PROGRAM[\s\S]*$/, "")
	return body.split("\n").slice(1).filter((l) => l.trim().length > 0 && l !== "%NETWORK").join(" / ")
}

describe.skipIf(VENDOR !== "codesys")(`graphical / stored assign and operand states, ide-model-mapping (${BASE})`, () => {
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
