/**
 * EVERY APPLICATION OF A PROJECT, EACH UNDER ITS OWN PATH — openspec `multi-application-tree` 2.1, against a live IDE.
 *
 * <p>The item's identity is its PATH in the IDE's own tree (design.md): the wire keys `refs`, `fetch` and every push op
 * by `<folder>/<name>.<kind>`, so two `PLC_PRG.pou` in two applications are two items. Measured 2026-10-17 before the
 * change: CODESYS returns ONE `PLC_PRG.pou` (Device_1's; Device's application is missing), TwinCAT returns the first PLC
 * project of the selected system project and nothing of the other three.</p>
 *
 * <p>The fixtures are the owner's two edited projects: `test/fixtures/CodesysTwoDevices.3.5.21.40.project` (two devices,
 * each with an application holding the same names) and `test/fixtures/TwinCAT MultiProject/` (system project
 * `TwinCAT Project14` with PLC projects Untitled2, Untitled1, Untitled3; system project `TwinCAT Project1` with Untitled1).
 * The suite is skipped against any other fixture.</p>
 *
 * <pre>
 *   powershell -File scripts/ide.ps1 up -Vendor codesys -Instance multi-app -Fixture test/fixtures/CodesysTwoDevices.3.5.21.40.project -Wait
 *   VOLT_E2E_INSTANCE=multi-app VOLT_VENDOR=codesys bun test test/e2e/multi-application
 *   powershell -File scripts/ide.ps1 up -Vendor twincat -Instance multi-app -Fixture "test/fixtures/TwinCAT MultiProject/TwinCAT MultiProject.sln" -Wait
 *   VOLT_E2E_INSTANCE=multi-app VOLT_VENDOR=twincat bun test test/e2e/multi-application
 * </pre>
 */
import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test"
import { basename } from "node:path"
import { bridge } from "../lib/bridge"
import { BASE, VENDOR } from "../lib/pipe"
import { servedSolutionDir } from "../lib/tc-files"
import { landedInFull, requireHealthy } from "../lib/workspace"

setDefaultTimeout(600_000)

const lf = (s: string) => s.replace(/\r\n/g, "\n")

/** Each application's main program, by its path, and the items every application must hold under its own path. */
type Expected = { mains: string[]; items: string[] }

const CODESYS: Expected = (() => {
	const app = (d: string) => `${d}/Plc Logic/Application`
	const devices = ["Device", "Device_1"]
	return {
		mains: devices.map((d) => `${app(d)}/PLC_PRG.pou`),
		items: devices.flatMap((d) => [
			`${d}/${d}.device`,
			`${app(d)}/PLC_PRG.pou`,
			`${app(d)}/VltFixtureCfc.pou`,
			`${app(d)}/VltFixtureMembers.pou`,
			`${app(d)}/VltFixtureSfc.pou`,
			`${app(d)}/Task Configuration/MainTask.task`,
		]),
	}
})()

const TWINCAT: Expected = (() => {
	const plc = (sys: string, p: string) => `${sys}/PLC/${p}`
	const P14 = "TwinCAT Project14"
	const P1 = "TwinCAT Project1"
	const mains = [
		`${plc(P14, "Untitled2")}/PLC_PRG.pou`,
		`${plc(P14, "Untitled1")}/POUs/PLC_PRG.pou`,
		`${plc(P14, "Untitled3")}/POUs/MAIN.pou`,
		`${plc(P1, "Untitled1")}/POUs/MAIN.pou`,
	]
	const plcs = [plc(P14, "Untitled2"), plc(P14, "Untitled1"), plc(P14, "Untitled3"), plc(P1, "Untitled1")]
	return {
		mains,
		items: [
			`${P14}/${P14}.device`,
			`${P1}/${P1}.device`,
			...mains,
			...plcs.map((p) => `${p}/PlcTask.task`),
			`${plc(P14, "Untitled2")}/POUs/POUexecute.pou`,
			`${plc(P14, "Untitled2")}/DUTs/E_PackML_Mode.dut`,
			`${plc(P14, "Untitled2")}/GVLs/GVL_PackML.gvl`,
		],
	}
})()

/** Is the served IDE holding one of the two multi-application fixtures? Read from what was OPENED, not from the wire
 *  under test: CODESYS names its project after the file, TwinCAT's XAE was launched on the solution's `.sln`. */
async function servesMultiAppFixture(): Promise<boolean> {
	try {
		if (VENDOR === "codesys") {
			const h = await bridge.health()
			return (h.projects ?? []).some((p: any) => String(p.project ?? "").startsWith("CodesysTwoDevices"))
		}
		return basename(servedSolutionDir()) === "TwinCAT MultiProject"
	} catch {
		return false
	}
}

const served = await servesMultiAppFixture()
if (!served)
	console.warn(`[multi-application] ${BASE} serves neither CodesysTwoDevices nor TwinCAT MultiProject — skipped (see the header)`)
const expected = VENDOR === "codesys" ? CODESYS : TWINCAT

/** What of `want` a version map lacks — named in the failure, so a red run says which application went missing. */
const missing = (map: Record<string, unknown>, want: string[]) => want.filter((p) => !(p in map))

describe.skipIf(!served)(`multi-application tree / ${VENDOR} (${BASE})`, () => {
	beforeAll(async () => {
		await requireHealthy(300_000)
	})

	it("refs holds every item of every application under its own path", async () => {
		const r = await bridge.refs()
		const items = r.items ?? {}
		expect(missing(items, expected.items), `refs keys (${Object.keys(items).length}): ${Object.keys(items).filter((k) => !k.endsWith(".library")).join(", ")}`).toEqual([])
	})

	it("a pull (fetch init) holds every item of every application under its own path", async () => {
		const f = await bridge.init()
		const pulled: Record<string, string> = {}
		for (const c of f.changed ?? []) pulled[c.name] = c.sourceText
		expect(missing(pulled, expected.items), `pulled names: ${Object.keys(pulled).filter((k) => !k.endsWith(".library")).join(", ")}`).toEqual([])
		// One file per application: the main programs are distinct items, read from their own application.
		expect(new Set(expected.mains.map((m) => pulled[m] !== undefined)).has(false)).toBe(false)
	})

	describe("an edit in each application round-trips to that application only", () => {
		const original: Record<string, string> = {}
		const marker = (path: string) => `// VltE2E multi-application: ${path}`

		afterAll(async () => {
			// Restore what was read, so a second run starts from the fixture; a path never read is left alone.
			const paths = Object.keys(original)
			if (paths.length === 0) return
			const refs = await bridge.refs()
			const ops = paths
				.filter((p) => refs.items?.[p])
				.map((p) => ({ op: "set", name: p, sourceText: original[p], ifVersion: refs.items[p] }))
			if (ops.length) await bridge.push({ expectedProjectVersion: refs.projectVersion, ops })
		})

		it("each main program is fetched by its path", async () => {
			const f = await bridge.fetch({ knownItems: {}, onlyItems: expected.mains })
			for (const c of f.changed ?? []) if (expected.mains.includes(c.name)) original[c.name] = lf(c.sourceText)
			expect(missing(original, expected.mains), `fetched: ${(f.changed ?? []).map((c: any) => `${c.folder ?? ""} :: ${c.name}`).join(", ")}`).toEqual([])
		})

		it("a push to each path lands in that application and no other", async () => {
			expect(missing(original, expected.mains), "the main programs were not all read (previous test)").toEqual([])
			const refs = await bridge.refs()
			const ops = expected.mains.map((p) => ({
				op: "set",
				name: p,
				sourceText: original[p]!.replace(/^IMPLEMENTATION ST$/m, `IMPLEMENTATION ST\n${marker(p)}`),
				ifVersion: refs.items?.[p] ?? null,
			}))
			const r = await bridge.push({ expectedProjectVersion: refs.projectVersion, ops })
			expect(landedInFull(r), `push: ${JSON.stringify(r.conflicts ?? r).slice(0, 600)}`).toBe(true)

			const back = await bridge.fetch({ knownItems: {}, onlyItems: expected.mains })
			const text: Record<string, string> = {}
			for (const c of back.changed ?? []) text[c.name] = lf(c.sourceText)
			for (const p of expected.mains) {
				expect(text[p], `${p} not fetched back`).toBeDefined()
				expect(text[p]!, `${p} lost its own edit`).toContain(marker(p))
				for (const other of expected.mains.filter((o) => o !== p))
					expect(text[p]!, `${p} holds the edit meant for ${other}`).not.toContain(marker(other))
			}
		})
	})
})
