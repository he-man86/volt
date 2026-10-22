/** The wire transcript's pure half (`scripts/wire-transcript-lib.ts`), offline: the normaliser replaces exactly what
 *  varies between two runs of one build on one fixture, and the comparer finds every other difference. */
import { describe, expect, it } from "bun:test"
import { compare, flatten, normaliseString, normaliseValue, parse, renderDiff, serialise, type Step } from "../../scripts/wire-transcript-lib"

const n = { tempDir: "C:\\Users\\eng\\AppData\\Local\\Temp\\" }

describe("wire transcript normaliser", () => {
	it("replaces the fixture copy, the temp dir, a pipe pid and a timestamp — in either slash direction and any case", () => {
		expect(normaliseString("C:\\Users\\eng\\AppData\\Local\\Temp\\volt-ide-codesys-sn-cds\\P.project is open", n)).toBe("<fixtureCopy>\\P.project is open")
		expect(normaliseString("c:/users/eng/appdata/local/temp/volt-ide-twincat-x/a/b.TcPOU", n)).toBe("<fixtureCopy>/a/b.TcPOU")
		expect(normaliseString("compiled in C:\\Users\\eng\\AppData\\Local\\Temp\\xyz", n)).toBe("compiled in <temp>\\xyz")
		expect(normaliseString("volt.bridge.twincat.31337 answered", n)).toBe("volt.bridge.twincat.<pid> answered")
		expect(normaliseString("at 2026-10-22T18:44:01.123Z", n)).toBe("at <timestamp>")
	})

	it("keeps everything else: versions, messages, item paths, numbers", () => {
		const v = { projectVersion: "a45949120b4948cc", items: { "Device/Plc Logic/Application/PLC_PRG.pou": "89f9" }, done: 40, total: 138 }
		expect(normaliseValue(v, n)).toEqual(v)
		expect(normaliseString("build 1203 ms, 0 errors", n)).toBe("build 1203 ms, 0 errors")
	})

	it("replaces a build's duration and the bridge's release by member, not every number or version", () => {
		expect(normaliseValue({ result: { success: true, duration: 1234, diagnostics: [] } }, n)).toEqual({ result: { success: true, duration: 0, diagnostics: [] } })
		expect(normaliseValue({ duration: 1234 }, n)).toEqual({ duration: 1234 })
		expect(normaliseValue({ result: { bridgeVersion: "0.1.17931", productVersion: "3.5.21.40" } }, n))
			.toEqual({ result: { bridgeVersion: "<bridgeVersion>", productVersion: "3.5.21.40" } })
	})
})

describe("wire transcript comparer", () => {
	const step = (name: string, result: unknown, request = `{"op":"${name}"}`): Step => ({ step: name, request, response: [{ result }] })

	it("round-trips a transcript through its file form", () => {
		const t = [step("refs", { items: { "A/X.pou": "1" } }), step("health", { ok: true })]
		expect(parse(serialise(t))).toEqual(t)
	})

	it("finds nothing between identical transcripts", () => {
		const t = [step("refs", { items: { "A/X.pou": "1" } })]
		expect(compare(t, structuredClone(t))).toEqual([])
		expect(renderDiff([])).toBe("transcripts are byte-identical\n")
	})

	it("names a changed, an added and a removed member by path", () => {
		const d = compare([step("refs", { items: { "A/X.pou": "1", "A/Y.pou": "2" } })], [step("refs", { items: { "A/X.pou": "9", "A/Z.pou": "3" } })])
		expect(d).toHaveLength(1)
		expect(d[0].lines).toEqual([
			'~ $response[0].result.items["A/X.pou"] = "1"  →  "9"',
			'- $response[0].result.items["A/Y.pou"] = "2"',
			'+ $response[0].result.items["A/Z.pou"] = "3"',
		])
	})

	it("names a member order change, which byte-identity forbids", () => {
		const d = compare([step("refs", { a: 1, b: 2 })], [step("refs", { b: 2, a: 1 })])
		expect(d[0].lines).toEqual(["order $response[0].result: a, b  →  b, a"])
	})

	it("names a changed request, a missing step and a new one", () => {
		const d = compare([step("refs", {}), step("build", {})], [step("refs", {}, '{"op":"refs","body":{}}'), step("grep", {})])
		const text = renderDiff(d)
		expect(text).toContain("- request")
		expect(text).toContain("── build\n  - the step is missing from the run")
		expect(text).toContain("── grep\n  + the step is new in the run")
		expect(text).toContain("(scenario)")
	})

	it("flattens empty containers so their appearance is a difference", () => {
		expect(flatten({ a: [], b: {} })).toEqual(["$.a = []", "$.b = {}"])
	})
})
