/**
 * The release matrix's decisions, offline (`packages/volt-cli/scripts/release-matrix-cells.ts`, run by `scripts/release-matrix.ts`, openspec environment-dependency-audit 3.1): which
 * cells a machine has, which are red before anything runs, and when a run is green. The live half (ide.ps1 + the e2e
 * suite per cell) is the matrix itself.
 */
import { describe, expect, it } from "bun:test"
import { bridgeBuilds, codesysCells, codesysFixture, dirtyPaths, judge, parseSummary, proofRefusal, transcriptReference, twincatCells, TWINCAT_FIXTURE, withTranscript, type Cell, type Verdict } from "../../scripts/release-matrix-cells"

const FIXTURES = ["CodesysTestProject.project", "CodesysOneToOne.project", "CodesysTestProject.3.5.18.30.project", "CodesysTestProject.3.5.22.40.project"]

describe("cells", () => {
	it("one CODESYS cell per installed version and bitness, its own fixture or red by name", () => {
		const cells = codesysCells(["CODESYS 3.5.18.30", "CODESYS 3.5.21.40", "CODESYS 3.5.22.40", "Common Files"], ["CODESYS 3.5.21.60"], FIXTURES)
		expect(cells.map((c) => [c.id, c.fixture ?? null])).toEqual([
			["codesys-3.5.18.30-64", "CodesysTestProject.3.5.18.30.project"],
			["codesys-3.5.21.40-64", null],
			["codesys-3.5.21.60-32", null],
			["codesys-3.5.22.40-64", "CodesysTestProject.3.5.22.40.project"],
		])
		expect(cells.find((c) => c.id === "codesys-3.5.21.60-32")!.refusal).toContain("no fixture project native to CODESYS 3.5.21.60")
	})
	// 2.5b: every version has its own generated project (scripts/author-version-fixture.py); the source project
	// CodesysTestProject.project is no cell's fixture, though 3.5.21.40 made it - one rule, one file name per version.
	it("only a version's own fixture counts", () => {
		expect(codesysFixture("3.5.21.40", [...FIXTURES, "CodesysTestProject.3.5.21.40.project"])).toBe("CodesysTestProject.3.5.21.40.project")
		expect(codesysFixture("3.5.21.40", FIXTURES)).toBeUndefined()
		expect(codesysFixture("3.5.21.60", FIXTURES)).toBeUndefined()   // never another version's file (owner: "you can't reuse them")
	})
	it("a TwinCAT cell per shell bitness, red where Visual Studio's 64-bit proxy is registered", () => {
		expect(twincatCells([32, 32], false)).toEqual([{ id: "twincat-32", vendor: "twincat", bits: 32, fixture: TWINCAT_FIXTURE, refusal: undefined }])
		const red = twincatCells([32, 64], true)
		expect(red.map((c) => c.id)).toEqual(["twincat-32", "twincat-64"])
		expect(red.every((c) => c.refusal?.includes("DIALECT C2t"))).toBe(true)
	})
	// A vendor the machine does not have is a RED cell, never no cell (gate 2c+3 review): with no XAE shell registered
	// the matrix held only CODESYS cells, came out green, and release.ts promoted with zero TwinCAT coverage.
	it("no XAE shell registered is a red TwinCAT cell, by name", () => {
		const cells = twincatCells([], false)
		expect(cells.map((c) => c.id)).toEqual(["twincat-none"])
		expect(cells[0].refusal).toContain("no TwinCAT XAE shell is registered")
	})
	it("no CODESYS installed is a red CODESYS cell, by name", () => {
		const cells = codesysCells(["Common Files"], [], FIXTURES)
		expect(cells.map((c) => c.id)).toEqual(["codesys-none"])
		expect(cells[0].refusal).toContain("no CODESYS is installed")
	})
	it("a missing vendor reddens the whole matrix", () => {
		const verdicts = [...codesysCells(["CODESYS 3.5.22.40"], [], FIXTURES), ...twincatCells([], false)].map((c) =>
			judge(c, { pass: 1, fail: 0, skip: 0, exit: 0 }, [{ vendor: "codesys", bits: 64, ideVersion: "3.5.22.40", project: "CodesysTestProject.3.5.22.40" }]))
		expect(verdicts.map((v) => [v.cell.id, v.green])).toEqual([["codesys-3.5.22.40-64", true], ["twincat-none", false]])
	})
})

/** WHAT THE BUILD IS MADE OF (gate 2c+3 review): an untracked source file is built into the bridge under test, so it
 *  makes the checkout dirty like a modified one; only `openspec/` (proposals, never built) is outside the build. */
describe("bridge builds", () => {
	// DIALECT C2t: only a worker of the XAE's bitness reads its Solution Explorer, so a TwinCAT cell serves the build of
	// its shell's bitness, as the connector picks it and ide.ps1 spawns it (bin\Release\net10.0-windows\<rid>).
	it("one TwinCAT build per cell bitness, CODESYS once, refused cells none", () => {
		const cells: Cell[] = [
			{ id: "codesys-3.5.21.40-64", vendor: "codesys", version: "3.5.21.40", bits: 64, fixture: "x.project" },
			{ id: "codesys-3.5.21.60-32", vendor: "codesys", version: "3.5.21.60", bits: 32, fixture: "y.project" },
			{ id: "twincat-32", vendor: "twincat", bits: 32 },
			{ id: "twincat-64", vendor: "twincat", bits: 64 },
		]
		expect(bridgeBuilds(cells)).toEqual([
			{ project: "Volt.Ide.Codesys" },
			{ project: "Volt.Ide.Twincat", rid: "win-x86" },
			{ project: "Volt.Ide.Twincat", rid: "win-x64" },
		])
		expect(bridgeBuilds([{ id: "twincat-32", vendor: "twincat", bits: 32, refusal: "no" }, { id: "twincat-none", vendor: "twincat", refusal: "none" }])).toEqual([])
	})
})

describe("dirty checkout", () => {
	it("a modified or an untracked file outside openspec/ is dirty", () => {
		expect(dirtyPaths(" M installer/Volt.iss\n?? packages/volt-cli/src/Volt.Ide.Codesys/Driver/CodesysRefusalWording.cs\n")).toEqual([
			"installer/Volt.iss", "packages/volt-cli/src/Volt.Ide.Codesys/Driver/CodesysRefusalWording.cs",
		])
	})
	it("an untracked openspec change is not", () => {
		expect(dirtyPaths("?? openspec/changes/some-proposal/\n")).toEqual([])
		expect(dirtyPaths("")).toEqual([])
	})
	it("a rename names its new path", () => {
		expect(dirtyPaths("R  scripts/a.ts -> scripts/b.ts\n")).toEqual(["scripts/b.ts"])
	})
})

/** THE PROOF promote.yml REQUIRES (gate 2c+3 review): starting `promote` from the Actions UI skipped release.ts and so
 *  the matrix. The result is attached to the release (`release-matrix.json`) and both doors judge it the same way. */
describe("matrix proof", () => {
	const sha = "a".repeat(40)
	const green = { commit: sha, dirty: false, green: true, cells: [{ id: "codesys-3.5.21.40-64", green: true, why: "1 pass" }] }
	it("green on the build's commit is accepted", () => {
		expect(proofRefusal(green, sha)).toBeUndefined()
	})
	it("another commit, a dirty run, a red cell or no cells is refused by name", () => {
		expect(proofRefusal({ ...green, commit: "b".repeat(40) }, sha)).toContain("not on")
		expect(proofRefusal({ ...green, dirty: true }, sha)).toContain("uncommitted")
		expect(proofRefusal({ ...green, green: false, cells: [{ id: "twincat-none", green: false, why: "no TwinCAT" }] }, sha)).toContain("twincat-none: no TwinCAT")
		expect(proofRefusal({ ...green, cells: [] }, sha)).toContain("no cell")
	})
	it("a cell marked red is refused even when the summary says green", () => {
		expect(proofRefusal({ ...green, cells: [...green.cells, { id: "twincat-32", green: false, why: "2 failed" }] }, sha)).toContain("twincat-32")
	})
	it("a file that is not a matrix result is refused, not read as green", () => {
		expect(proofRefusal({ commit: sha }, sha)).toContain("not a release matrix result")
		expect(proofRefusal(null, sha)).toContain("not a release matrix result")
	})
})

describe("verdict", () => {
	const cell: Cell = { id: "codesys-3.5.21.40-64", vendor: "codesys", version: "3.5.21.40", bits: 64, fixture: "CodesysTestProject.3.5.21.40.project" }
	const drove = [{ vendor: "codesys", bits: 64, ideVersion: "3.5.21.40", project: "CodesysTestProject.3.5.21.40" }]
	const summary = "\n 296 pass\n 70 skip\n 0 fail\n 1200 expect() calls\nRan 366 tests across 80 files. [1200.00s]\n"

	it("bun's summary is read", () => {
		expect(parseSummary(summary, 0)).toEqual({ pass: 296, fail: 0, skip: 70, exit: 0 })
		expect(parseSummary("Segmentation fault", 3)).toBeUndefined()
	})
	it("green only when every test passed on the IDE the cell is about", () => {
		expect(judge(cell, parseSummary(summary, 0), drove).green).toBe(true)
	})
	it("red on a failure, a non-zero exit, a missing summary or report", () => {
		expect(judge(cell, parseSummary(summary.replace(" 0 fail", " 2 fail"), 1), drove).why).toBe("2 failed (exit 1)")
		expect(judge(cell, parseSummary(summary, 1), drove).green).toBe(false)
		expect(judge(cell, undefined, drove).why).toContain("no summary")
		expect(judge(cell, parseSummary(summary, 0), []).why).toContain("reported no IDE")
	})
	it("red when the run drove another version or bitness", () => {
		expect(judge(cell, parseSummary(summary, 0), [{ ...drove[0], bits: 32 }]).why).toContain("3.5.21.40 32-bit, not this cell")
		expect(judge(cell, parseSummary(summary, 0), [{ ...drove[0], ideVersion: "3.5.21.60" }]).green).toBe(false)
	})
	// 2.5b: the right IDE serving ANOTHER project (an upgraded one, or a `-Fixture` override) is not the cell either.
	it("red when the run served another project than the cell's fixture", () => {
		expect(judge(cell, parseSummary(summary, 0), [{ ...drove[0], project: "CodesysTestProject" }]).why)
			.toContain("served CodesysTestProject, not this cell's CodesysTestProject.3.5.21.40")
	})
	// The TwinCAT cell serves the multi-PLC-project solution; health names the project after the solution.
	it("a TwinCAT cell is green only on a 32-bit XAE serving TwinCAT MultiProject", () => {
		const [tc] = twincatCells([32], false)
		expect(tc!.fixture).toBe("TwinCAT MultiProject/TwinCAT MultiProject.sln")
		const ran = [{ vendor: "twincat", bits: 32, ideVersion: "3.1.4024.74", project: "TwinCAT MultiProject" }]
		expect(judge(tc!, parseSummary(summary, 0), ran).green).toBe(true)
		expect(judge(tc!, parseSummary(summary, 0), [{ ...ran[0]!, bits: 64 }]).why).toContain("64-bit, not this cell")
		expect(judge(tc!, parseSummary(summary, 0), [{ ...ran[0]!, project: "TwinCAT Project14" }]).why)
			.toContain("served TwinCAT Project14, not this cell's TwinCAT MultiProject")
	})
	it("a cell refused up front is red with its reason, whatever ran", () => {
		expect(judge({ ...cell, refusal: "why" }, parseSummary(summary, 0), drove)).toMatchObject({ green: false, why: "why" })
	})
})

describe("the wire transcript of a cell (volt-cli-rework 1.3)", () => {
	const cell: Cell = { id: "codesys-3.5.21.40-64", vendor: "codesys", version: "3.5.21.40", bits: 64, fixture: "CodesysTestProject.3.5.21.40.project" }
	const green: Verdict = { cell, green: true, why: "296 pass, 70 skip" }

	it("keeps a green cell green only when the transcript is identical to the reference, or was just recorded as it", () => {
		expect(withTranscript(green, { kind: "identical" })).toEqual({ cell, green: true, why: "296 pass, 70 skip; transcript identical" })
		expect(withTranscript(green, { kind: "recorded", reference: transcriptReference(cell) }).green).toBe(true)
		expect(withTranscript(green, undefined)).toBe(green)
	})

	it("turns a cell red by name when the transcript differs, has no reference, or was not recorded", () => {
		const differs = withTranscript(green, { kind: "differs", steps: 2 })
		expect(differs.green).toBe(false)
		expect(differs.why).toContain("DIFFERS from the reference in 2 step(s)")
		const none = withTranscript(green, { kind: "no-reference", reference: transcriptReference(cell) })
		expect(none.green).toBe(false)
		expect(none.why).toContain("test/transcripts/codesys-3.5.21.40-64.jsonl")
		expect(withTranscript(green, { kind: "failed", why: "the scenario exited 1" }).green).toBe(false)
	})

	it("never turns a red suite green", () => {
		expect(withTranscript({ ...green, green: false, why: "3 failed" }, { kind: "identical" }).green).toBe(false)
	})
})