/**
 * The release matrix's decisions, offline (`packages/volt-cli/scripts/release-matrix-cells.ts`, run by `scripts/release-matrix.ts`, openspec environment-dependency-audit 3.1): which
 * cells a machine has, which are red before anything runs, and when a run is green. The live half (ide.ps1 + the e2e
 * suite per cell) is the matrix itself.
 */
import { describe, expect, it } from "bun:test"
import { bridgeBuilds, codesysCells, codesysFixture, dirtyPaths, judge, judgeParity, mixedVersionCell, PARITY_TWINCAT_FIXTURE, parseSummary, proofRefusal, runRecord, transcriptReference, twincatCells, TWINCAT_FIXTURE, upFailure, vendorParityCell, withTranscript, type Cell, type Verdict } from "../../scripts/release-matrix-cells"

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
describe("the mixed-version cell (volt-cli-rework 1.3)", () => {
	it("runs on CODESYS 3.5.21.40 64-bit, and is red by name where that cell cannot run", () => {
		const cells = codesysCells(["CODESYS 3.5.21.40"], [], ["CodesysTestProject.3.5.21.40.project"])
		expect(mixedVersionCell(cells)).toEqual({ id: "mixed-version", vendor: "codesys", version: "3.5.21.40", bits: 64, fixture: "CodesysTestProject.3.5.21.40.project", mixed: true, refusal: undefined })
		expect(mixedVersionCell(codesysCells(["CODESYS 3.5.22.40"], [], [])).refusal).toContain("has not installed")
		expect(mixedVersionCell(codesysCells(["CODESYS 3.5.21.40"], [], [])).refusal).toContain("cannot serve (no fixture project native")
	})

	it("needs the CODESYS bridge built like any CODESYS cell", () => {
		expect(bridgeBuilds([mixedVersionCell(codesysCells(["CODESYS 3.5.21.40"], [], ["CodesysTestProject.3.5.21.40.project"]))])).toEqual([{ project: "Volt.Ide.Codesys" }])
	})
})
/** THE TWO VENDORS COMPARED WITH EACH OTHER (gate 3.3 review): every other cell serves ONE vendor, so
 *  `test/e2e/vendor-parity.test.ts` and the cross-vendor half of `test/e2e/refusals` skipped in every cell and the matrix
 *  never compared CODESYS with TwinCAT. This cell serves both under one instance and is red when either half skips. */
describe("the vendor-parity cell", () => {
	const codesys = codesysCells(["CODESYS 3.5.18.30", "CODESYS 3.5.21.40", "CODESYS 3.5.22.40"], ["CODESYS 3.5.22.40"], [...FIXTURES, "CodesysTestProject.3.5.21.40.project"])
	it("serves the newest runnable 64-bit CODESYS and the 32-bit XAE on its one-PLC-project solution", () => {
		const cell = vendorParityCell(codesys, twincatCells([32, 64], false))
		expect(cell.id).toBe("vendor-parity")
		expect(cell.refusal).toBeUndefined()
		expect(cell.parity!.codesys.id).toBe("codesys-3.5.22.40-64")
		expect(cell.parity!.twincat).toMatchObject({ id: "twincat-32", bits: 32, fixture: PARITY_TWINCAT_FIXTURE })
	})
	it("is red by name where either vendor has no runnable cell", () => {
		expect(vendorParityCell(codesys, twincatCells([], false)).refusal).toContain("no runnable TwinCAT cell")
		expect(vendorParityCell(codesys, twincatCells([32], true)).refusal).toContain("no runnable TwinCAT cell")
		expect(vendorParityCell(codesysCells([], [], []), twincatCells([32], false)).refusal).toContain("no runnable CODESYS cell")
	})
	it("needs both bridges built", () => {
		expect(bridgeBuilds([vendorParityCell(codesys, twincatCells([32], false))])).toEqual([{ project: "Volt.Ide.Codesys" }, { project: "Volt.Ide.Twincat", rid: "win-x86" }])
	})
	const cell = vendorParityCell(codesys, twincatCells([32], false))
	const ran = { pass: 80, fail: 0, skip: 1, exit: 0 }
	it("is green only when both halves ran", () => {
		expect(judgeParity(cell, ran, "vendor-parity: the stub-manifest case SKIPPED — neither fixture serves a visualization or a text list\n").green).toBe(true)
	})
	it("is red when either half skipped for want of a second vendor", () => {
		for (const said of [
			"vendor-parity: SKIPPED — needs both bridges up (codesys: volt.bridge.codesys.1, twincat: down). Start both",
			"refusals: only codesys is up — the vendor-parity half (d) is SKIPPED",
			"refusals: SKIPPED — no fixture IDE of ours is up on either vendor",
		]) {
			const v = judgeParity(cell, ran, `x\n${said}\ny`)
			expect(v.green).toBe(false)
			expect(v.why).toContain(said)
		}
	})
	it("is red on a failed or unfinished run", () => {
		expect(judgeParity(cell, { ...ran, fail: 9, exit: 1 }, "").why).toBe("9 failed (exit 1)")
		expect(judgeParity(cell, undefined, "").green).toBe(false)
	})
})

/** WHY AN IDE DID NOT COME UP (gate 3.3 review): a twincat-32 attempt went red on a TcXaeShell OK-only dialog whose
 *  text nothing kept, and a rerun went green over it. The cell's verdict now quotes what `ide.ps1 up` said about it. */
describe("an IDE that did not come up", () => {
	it("is named by the dialogs and the exit ide.ps1 reported", () => {
		const text = "attaching a worker to XAE 15572 (attempt 1)...\nWARNING: XAE 15572 shows a modal dialog 'TcXaeShell': Something failed. (buttons: OK) - not one ide.ps1 answers; left as is\nXAE 15572 exited before a worker attached\n"
		expect(upFailure(text)).toBe("the IDE did not come up: XAE 15572 shows a modal dialog 'TcXaeShell': Something failed. (buttons: OK) - not one ide.ps1 answers; left as is | XAE 15572 exited before a worker attached")
	})
	it("says a dialog once when the exit line quotes it", () => {
		const d = "XAE 9 shows a modal dialog 'TcXaeShell': x (buttons: OK) - not one ide.ps1 answers; left as is"
		expect(upFailure(`WARNING: ${d}\nException: XAE 9 exited before a worker attached; it showed: ${d}\n`)).toBe(`the IDE did not come up: XAE 9 exited before a worker attached; it showed: ${d}`)
	})
	it("points at the log when ide.ps1 named nothing", () => {
		expect(upFailure("whatever\n")).toBe("the IDE did not come up (see the cell log)")
	})
})

/** WHICH COMMIT A RUN TESTED (gate 3.3 review): a partial run wrote nothing, so a small matrix's result was tied to its
 *  commit by nobody's record. Every run, partial or full, appends one of these to `runs.jsonl`. */
describe("a run's record", () => {
	const v: Verdict = { cell: { id: "twincat-32", vendor: "twincat", bits: 32 }, green: false, why: "the IDE did not come up" }
	it("names the commit, whether the checkout was dirty, why it was partial, and every cell's verdict", () => {
		expect(runRecord("abc", ["src/x.cs"], "2026-10-23T00:00:00.000Z", "--only", [v])).toEqual({
			commit: "abc", dirty: true, changed: ["src/x.cs"], partial: "--only", at: "2026-10-23T00:00:00.000Z", green: false,
			cells: [{ id: "twincat-32", green: false, why: "the IDE did not come up" }],
		})
	})
	it("is green only when every cell is and the checkout is HEAD", () => {
		const g: Verdict = { ...v, green: true }
		expect(runRecord("abc", [], "t", null, [g]).green).toBe(true)
		expect(runRecord("abc", ["a"], "t", null, [g]).green).toBe(false)
		expect(runRecord("abc", [], "t", null, []).green).toBe(false)
	})
})
