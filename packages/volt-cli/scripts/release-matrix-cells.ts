/**
 * The release matrix's DECISIONS, pure (`scripts/release-matrix.ts` runs them against the machine; openspec
 * environment-dependency-audit 3.1): which cells a machine's installs make, which are red before anything runs, how a
 * run's output is read, and when a cell is green. Tested offline in `test/unit/release-matrix.test.ts`.
 */
export type Vendor = "codesys" | "twincat"
/** A cell; `bits` is absent only on a vendor's `-none` cell, which is red by its refusal and never runs. */
export type Cell = { id: string; vendor: Vendor; version?: string; bits?: 32 | 64; fixture?: string; refusal?: string }
export type Outcome = { pass: number; fail: number; skip: number; exit: number | null }
export type Report = { vendor: string; bits: number; ideVersion: string | null; project: string }
export type Verdict = { cell: Cell; green: boolean; why: string; outcome?: Outcome }

/**
 * The fixture project NATIVE to a CODESYS version, or undefined. `CodesysTestProject.<version>.project` (2.5b) wins;
 * until it exists for a version, the two projects that were made IN their version stand: the default fixture is
 * 3.5.21.40's, `codesysSP18.project` was made in 3.5.18.30.
 */
export function codesysFixture(version: string, files: string[]): string | undefined {
	const own = `CodesysTestProject.${version}.project`
	if (files.includes(own)) return own
	if (version === "3.5.21.40" && files.includes("CodesysTestProject.project")) return "CodesysTestProject.project"
	if (version === "3.5.18.30" && files.includes("codesysSP18.project")) return "codesysSP18.project"
	return undefined
}

/**
 * The CODESYS cells from the two Program Files listings (folder names only). No CODESYS at all is ONE red cell,
 * `codesys-none` — never no cell, which would let a matrix of TwinCAT cells alone come out green (gate 2c+3 review).
 */
export function codesysCells(programFiles64: string[], programFiles32: string[], fixtures: string[]): Cell[] {
	const cells: Cell[] = []
	for (const [names, bits] of [[programFiles64, 64], [programFiles32, 32]] as const)
		for (const name of names) {
			const m = /^CODESYS (\d+\.\d+\.\d+\.\d+)$/.exec(name)
			if (!m) continue
			const version = m[1]
			const fixture = codesysFixture(version, fixtures)
			cells.push({
				id: `codesys-${version}-${bits}`, vendor: "codesys", version, bits, fixture,
				refusal: fixture ? undefined : `no fixture project native to CODESYS ${version} (CodesysTestProject.${version}.project, task 2.5b)`,
			})
		}
	if (cells.length === 0)
		return [{ id: "codesys-none", vendor: "codesys", refusal: "no CODESYS is installed (no `CODESYS <version>` under either Program Files) - the matrix cannot cover CODESYS" }]
	return cells.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * The TwinCAT cells, one per registered shell bitness; red up front where the customer's state is not this machine's.
 * No registered shell is ONE red cell, `twincat-none` (gate 2c+3 review: it used to be no cell, and a CODESYS-only
 * matrix promoted a build with zero TwinCAT coverage).
 */
export function twincatCells(shellBits: (32 | 64)[], vsProxy64Registered: boolean): Cell[] {
	if (shellBits.length === 0)
		return [{ id: "twincat-none", vendor: "twincat", refusal: "no TwinCAT XAE shell is registered (no TcXaeShell*.DTE.* ProgID) - the matrix cannot cover TwinCAT" }]
	return [...new Set(shellBits)].sort((a, b) => a - b).map((bits) => ({
		id: `twincat-${bits}`, vendor: "twincat" as const, bits,
		refusal: vsProxy64Registered
			? "Visual Studio's 64-bit msenvp proxy is registered (HKLM\\SOFTWARE\\Classes\\CLSID\\{E6D78900-BB40-4039-9C54-593A242B65DA}, 64-bit view) - not a customer's machine (DIALECT C2t)"
			: undefined,
	}))
}

/** Bun's summary lines (` 296 pass`, ` 0 fail`, ` 70 skip`); a missing count is 0, a missing summary is no outcome. */
export function parseSummary(text: string, exit: number | null): Outcome | undefined {
	const n = (word: string) => Number(new RegExp(`^\\s*(\\d+) ${word}$`, "m").exec(text)?.[1] ?? NaN)
	const pass = n("pass"), fail = n("fail"), skip = n("skip")
	if (Number.isNaN(pass) && Number.isNaN(fail)) return undefined
	return { pass: pass || 0, fail: fail || 0, skip: skip || 0, exit }
}

/** A cell's verdict from what its run printed and what the harness reported it drove. */
export function judge(cell: Cell, outcome: Outcome | undefined, reports: Report[]): Verdict {
	if (cell.refusal) return { cell, green: false, why: cell.refusal }
	if (!outcome) return { cell, green: false, why: "the suite printed no summary (it did not run to the end)" }
	const drove = reports.filter((r) => r.vendor === cell.vendor)
	if (drove.length === 0) return { cell, green: false, why: "the run reported no IDE it drove (VOLT_E2E_REPORT empty)", outcome }
	const wrong = drove.filter((r) => r.bits !== cell.bits || (cell.version !== undefined && r.ideVersion !== cell.version))
	if (wrong.length > 0)
		return { cell, green: false, why: `the run drove ${wrong.map((r) => `${r.ideVersion} ${r.bits}-bit`).join(", ")}, not this cell`, outcome }
	if (outcome.fail > 0 || outcome.exit !== 0)
		return { cell, green: false, why: `${outcome.fail} failed (exit ${outcome.exit})`, outcome }
	return { cell, green: true, why: `${outcome.pass} pass, ${outcome.skip} skip`, outcome }
}

export function renderMatrix(verdicts: Verdict[]): string {
	const rows = verdicts.map((v) => `${v.green ? "GREEN" : "RED  "}  ${v.cell.id.padEnd(24)}  ${v.why}`)
	return ["release matrix", ...rows].join("\n")
}


/**
 * The paths that make a checkout something other than its HEAD, from `git status --porcelain` (untracked files
 * INCLUDED: an untracked source file is built into the bridge under test, so a result recorded against HEAD would
 * describe a commit that does not hold it — gate 2c+3 review). Only `openspec/` is outside the build: other sessions
 * keep untracked proposals there, and no build step reads it.
 */
export function dirtyPaths(porcelain: string): string[] {
	return porcelain.split(/\r?\n/).filter((l) => l.length > 3).map((l) => {
		const path = l.slice(3)
		const arrow = path.indexOf(" -> ")
		return (arrow >= 0 ? path.slice(arrow + 4) : path).replace(/^"|"$/g, "")
	}).filter((p) => !p.startsWith("openspec/"))
}

/** `dist/release-matrix/result.json`, as `scripts/release-matrix.ts` writes it. */
export type MatrixResult = { commit: string; dirty: boolean; green: boolean; cells: { id: string; green: boolean; why: string }[] }

/**
 * Why a release-matrix result does NOT prove `sha` releasable, or undefined when it does. ONE judgement for both doors
 * to a release: `release.ts` (before it triggers `promote.yml`) and `promote.yml` itself, which checks the result
 * attached to the release (`release-matrix.json`) — so starting `promote` from the Actions UI cannot skip the matrix
 * (gate 2c+3 review).
 */
export function proofRefusal(result: unknown, sha: string): string | undefined {
	const r = result as Partial<MatrixResult> | null
	if (!r || typeof r !== "object" || typeof r.commit !== "string" || typeof r.green !== "boolean" || typeof r.dirty !== "boolean" || !Array.isArray(r.cells))
		return "not a release matrix result (commit, dirty, green, cells)"
	if (r.commit !== sha) return `the release matrix ran on ${r.commit}, not on ${sha}`
	if (r.dirty) return `the release matrix ran on a checkout with uncommitted changes, so it tested no commit`
	if (r.cells.length === 0) return "the release matrix holds no cell"
	const red = r.cells.filter((c) => !c.green)
	if (red.length > 0 || !r.green) return `the release matrix is red on ${sha}:\n` + red.map((c) => `    ${c.id}: ${c.why}`).join("\n")
	return undefined
}
