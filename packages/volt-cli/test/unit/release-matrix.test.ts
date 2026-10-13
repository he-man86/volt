/**
 * The release matrix's decisions, offline (`packages/volt-cli/scripts/release-matrix-cells.ts`, run by `scripts/release-matrix.ts`, openspec environment-dependency-audit 3.1): which
 * cells a machine has, which are red before anything runs, and when a run is green. The live half (ide.ps1 + the e2e
 * suite per cell) is the matrix itself.
 */
import { describe, expect, it } from "bun:test"
import { codesysCells, codesysFixture, dirtyPaths, judge, parseSummary, proofRefusal, twincatCells, type Cell } from "../../scripts/release-matrix-cells"

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
		expect(twincatCells([32, 32], false)).toEqual([{ id: "twincat-32", vendor: "twincat", bits: 32, refusal: undefined }])
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
	it("a cell refused up front is red with its reason, whatever ran", () => {
		expect(judge({ ...cell, refusal: "why" }, parseSummary(summary, 0), drove)).toMatchObject({ green: false, why: "why" })
	})
})
