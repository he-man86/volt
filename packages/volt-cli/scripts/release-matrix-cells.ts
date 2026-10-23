/**
 * The release matrix's DECISIONS, pure (`scripts/release-matrix.ts` runs them against the machine; openspec
 * environment-dependency-audit 3.1): which cells a machine's installs make, which are red before anything runs, how a
 * run's output is read, and when a cell is green. Tested offline in `test/unit/release-matrix.test.ts`.
 */
export type Vendor = "codesys" | "twincat"
/** A cell; `bits` is absent only on a vendor's `-none` cell, which is red by its refusal and never runs. `fixture` is
 *  relative to `test/fixtures`: a CODESYS `.project`, or the TwinCAT `.sln` (`TWINCAT_FIXTURE`). */
export type Cell = { id: string; vendor: Vendor; version?: string; bits?: 32 | 64; fixture?: string; refusal?: string; mixed?: true; parity?: { codesys: Cell; twincat: Cell } }
export type Outcome = { pass: number; fail: number; skip: number; exit: number | null }
export type Report = { vendor: string; bits: number; ideVersion: string | null; project: string }
export type Verdict = { cell: Cell; green: boolean; why: string; outcome?: Outcome }

/**
 * The fixture project NATIVE to a CODESYS version, or undefined: `CodesysTestProject.<version>.project`, made IN that
 * version by `scripts/author-version-fixture.py` (2.5b) - the file `ide.ps1` serves for that `-CodesysVersion`. One
 * name per version; the source project it is generated from is no cell's fixture.
 */
export function codesysFixture(version: string, files: string[]): string | undefined {
	const own = `CodesysTestProject.${version}.project`
	return files.includes(own) ? own : undefined
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
 * The solution every TwinCAT cell serves: two system projects, four PLC projects (`TwinCAT Project14` holding Untitled2 —
 * the suite's fixture objects — Untitled1 and Untitled3; `TwinCAT Project1` holding Untitled1), so the release proves
 * several PLC projects in one tree as every CODESYS cell proves two devices. The suite drives the first PLC project the
 * walk states; `test/e2e/multi-application` covers all four.
 */
export const TWINCAT_FIXTURE = "TwinCAT MultiProject/TwinCAT MultiProject.sln"

/**
 * The TwinCAT cells, one per registered shell bitness; red up front where the customer's state is not this machine's.
 * No registered shell is ONE red cell, `twincat-none` (gate 2c+3 review: it used to be no cell, and a CODESYS-only
 * matrix promoted a build with zero TwinCAT coverage).
 */
export function twincatCells(shellBits: (32 | 64)[], vsProxy64Registered: boolean): Cell[] {
	if (shellBits.length === 0)
		return [{ id: "twincat-none", vendor: "twincat", refusal: "no TwinCAT XAE shell is registered (no TcXaeShell*.DTE.* ProgID) - the matrix cannot cover TwinCAT" }]
	return [...new Set(shellBits)].sort((a, b) => a - b).map((bits) => ({
		id: `twincat-${bits}`, vendor: "twincat" as const, bits, fixture: TWINCAT_FIXTURE,
		refusal: vsProxy64Registered
			? "Visual Studio's 64-bit msenvp proxy is registered (HKLM\\SOFTWARE\\Classes\\CLSID\\{E6D78900-BB40-4039-9C54-593A242B65DA}, 64-bit view) - not a customer's machine (DIALECT C2t)"
			: undefined,
	}))
}

/**
 * THE MIXED-VERSION CELL (openspec `volt-cli-rework` 1.3; `scripts/mixed-version.ts`): the current CLI against the
 * previous release's bridge and the reverse, on the CODESYS every recording is measured on (3.5.21.40, 64-bit). Red
 * before running, by name, on a machine without that CODESYS cell runnable.
 */
export const MIXED_VERSION_IDE = { version: "3.5.21.40", bits: 64 as const }

export function mixedVersionCell(codesys: Cell[]): Cell {
	const host = codesys.find((c) => c.version === MIXED_VERSION_IDE.version && c.bits === MIXED_VERSION_IDE.bits)
	return {
		id: "mixed-version", vendor: "codesys", version: MIXED_VERSION_IDE.version, bits: MIXED_VERSION_IDE.bits, fixture: host?.fixture, mixed: true,
		refusal: host && !host.refusal ? undefined
			: `the mixed-version cell runs on CODESYS ${MIXED_VERSION_IDE.version} ${MIXED_VERSION_IDE.bits}-bit, which this machine ${host ? `cannot serve (${host.refusal})` : "has not installed"}`,
	}
}

/**
 * THE VENDOR-PARITY CELL (gate 3.3 review): every other cell serves ONE vendor, so `test/e2e/vendor-parity.test.ts` and
 * the cross-vendor half (d) of `test/e2e/refusals` skip in all of them, and the matrix never compared CODESYS with
 * TwinCAT — the byte-identical wire the rework promises. This cell serves both under one instance: the newest runnable
 * CODESYS (64-bit first) on its own fixture, and the 32-bit XAE first on {@link PARITY_TWINCAT_FIXTURE}. Red by name where
 * either vendor has no runnable cell.
 */
export const PARITY_TWINCAT_FIXTURE = "TwinCAT Project14/TwinCAT Project14.sln"
/** The suites that compare the two vendors, and nothing else: the parity cell runs exactly these. */
export const PARITY_TESTS = ["test/e2e/vendor-parity.test.ts", "test/e2e/refusals"]

const versionKey = (v: string) => v.split(".").map((n) => n.padStart(6, "0")).join(".")

export function vendorParityCell(codesys: Cell[], twincat: Cell[]): Cell {
	const cs = codesys.filter((c) => !c.refusal && c.version && c.bits)
		.sort((a, b) => (b.bits! - a.bits!) || (versionKey(b.version!) < versionKey(a.version!) ? -1 : versionKey(b.version!) > versionKey(a.version!) ? 1 : 0))[0]
	const tc = twincat.filter((c) => !c.refusal && c.bits).sort((a, b) => a.bits! - b.bits!)[0]
	const missing = [cs ? "" : "no runnable CODESYS cell", tc ? "" : "no runnable TwinCAT cell"].filter(Boolean)
	return {
		id: "vendor-parity", vendor: "codesys",
		parity: cs && tc ? { codesys: cs, twincat: { ...tc, fixture: PARITY_TWINCAT_FIXTURE } } : undefined,
		refusal: missing.length ? `the vendor-parity cell serves both vendors at once, and this machine has ${missing.join(" and ")}` : undefined,
	}
}

/** What the two-vendor suites print when they ran against one vendor only — each a reason the parity cell is red. */
const ONE_VENDOR_ONLY = [/^vendor-parity: SKIPPED — needs both bridges.*$/m, /^refusals: only \w+ is up — the vendor-parity half \(d\) is SKIPPED$/m, /^refusals: SKIPPED — .*$/m]

/** The parity cell's verdict: its suites ran to the end with no failure, and neither compared one vendor with nothing. */
export function judgeParity(cell: Cell, outcome: Outcome | undefined, text: string): Verdict {
	if (cell.refusal) return { cell, green: false, why: cell.refusal }
	if (!outcome) return { cell, green: false, why: "the suite printed no summary (it did not run to the end)" }
	const skipped = ONE_VENDOR_ONLY.map((re) => re.exec(text)?.[0]).filter((l): l is string => l !== undefined)
	if (skipped.length > 0) return { cell, green: false, why: `the vendors were not compared: ${skipped.join(" | ")}`, outcome }
	if (outcome.fail > 0 || outcome.exit !== 0) return { cell, green: false, why: `${outcome.fail} failed (exit ${outcome.exit})`, outcome }
	return { cell, green: true, why: `${outcome.pass} pass, ${outcome.skip} skip`, outcome }
}

/** Why `ide.ps1 up` failed, in its own words: the modal dialogs it saw and an IDE that exited, so a red cell names the
 *  fault and a green rerun cannot hide it (gate 3.3 review: a TcXaeShell OK-only dialog was lost that way). */
export function upFailure(text: string): string {
	// From the pid on: PowerShell prefixes a warning with `WARNING: ` and a thrown error with the script's name.
	const said = text.split(/\r?\n/).map((l) => /(XAE \d+ (?:shows a modal dialog|exited before a worker attached).*)$/.exec(l.trim())?.[1])
		.filter((l): l is string => l !== undefined)
		// The exit line quotes the dialogs it showed: a dialog line it already holds is said once.
		.filter((l, i, all) => all.indexOf(l) === i && !all.some((o) => o !== l && o.includes(l)))
	return said.length ? `the IDE did not come up: ${said.join(" | ")}` : "the IDE did not come up (see the cell log)"
}

/** One bridge build the cells serve: a project, and for the TwinCAT worker the RID of a cell's shell bitness. */
export type BridgeBuild = { project: "Volt.Ide.Codesys" | "Volt.Ide.Twincat"; rid?: "win-x86" | "win-x64" }

/**
 * The bridges the runnable cells serve, built ONCE before they start: CODESYS's in-proc DLL once (AnyCPU, every edition
 * loads it), and the TwinCAT worker once per shell bitness - only a worker of the XAE's bitness reads its Solution
 * Explorer (DIALECT C2t), so a cell runs the build the connector would pick for it, from that RID's own output folder,
 * which is where `ide.ps1` spawns it from.
 */
export function bridgeBuilds(cells: Cell[]): BridgeBuild[] {
	const runnable = cells.filter((c) => !c.refusal).flatMap((c) => (c.parity ? [c.parity.codesys, c.parity.twincat] : [c]))
	const builds: BridgeBuild[] = []
	if (runnable.some((c) => c.vendor === "codesys")) builds.push({ project: "Volt.Ide.Codesys" })
	for (const bits of [32, 64] as const)
		if (runnable.some((c) => c.vendor === "twincat" && c.bits === bits))
			builds.push({ project: "Volt.Ide.Twincat", rid: bits === 32 ? "win-x86" : "win-x64" })
	return builds
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
	// The project health names: a CODESYS file's base name, a TwinCAT solution's.
	const project = cell.fixture?.replace(/^.*\//, "").replace(/\.(project|sln)$/, "")
	const other = project === undefined ? [] : drove.filter((r) => r.project !== project)
	if (other.length > 0)
		return { cell, green: false, why: `the run served ${other.map((r) => r.project).join(", ")}, not this cell's ${project}`, outcome }
	if (outcome.fail > 0 || outcome.exit !== 0)
		return { cell, green: false, why: `${outcome.fail} failed (exit ${outcome.exit})`, outcome }
	return { cell, green: true, why: `${outcome.pass} pass, ${outcome.skip} skip`, outcome }
}

/**
 * The wire transcript of a cell (openspec `volt-cli-rework` 1.3), as `wire-transcript.ts compare` exits: 0 identical to the
 * cell's reference, 1 different (the diff is the cell's `<cell>.transcript.diff`), 2 no reference recorded; `recorded`
 * when the run wrote the reference instead (`--record-transcripts`); `failed` when the scenario did not run to its end.
 */
export type TranscriptOutcome =
	| { kind: "identical" }
	| { kind: "differs"; steps: number }
	| { kind: "no-reference"; reference: string }
	| { kind: "recorded"; reference: string }
	| { kind: "failed"; why: string }

/** A cell's verdict with its transcript folded in: a suite verdict stays red; a green one goes red unless the transcript
 *  is identical to the reference (or was just recorded as it). A missing reference is red by name — it compares nothing. */
export function withTranscript(v: Verdict, t: TranscriptOutcome | undefined): Verdict {
	if (!t) return v
	const said = (why: string) => `${v.why}; transcript ${why}`
	switch (t.kind) {
		case "identical": return { ...v, why: said("identical") }
		case "recorded": return { ...v, why: said(`recorded to ${t.reference}`) }
		case "differs": return { ...v, green: false, why: said(`DIFFERS from the reference in ${t.steps} step(s) (see the cell's .transcript.diff)`) }
		case "no-reference": return { ...v, green: false, why: said(`has no reference (${t.reference}) - record it with --record-transcripts`) }
		case "failed": return { ...v, green: false, why: said(`not recorded: ${t.why}`) }
	}
}

/** Where a cell's reference transcript is committed, relative to the volt-cli package. */
export const transcriptReference = (cell: Cell): string => `test/transcripts/${cell.id}.jsonl`

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

/**
 * One run's record, appended to `dist/release-matrix/runs.jsonl` by EVERY run (partial too) and written as `result.json`
 * by a full one (gate 3.3 review: a partial run wrote nothing, so a small matrix's result was tied to its commit by no
 * record, and a red attempt was overwritten by its green rerun). Green only when every cell is and the checkout is HEAD.
 */
export function runRecord(commit: string, changed: string[], at: string, partial: string | null, verdicts: Verdict[]) {
	const dirty = changed.length > 0
	return {
		commit, dirty, changed, partial, at, green: verdicts.length > 0 && verdicts.every((v) => v.green) && !dirty,
		cells: verdicts.map((v) => ({ id: v.cell.id, green: v.green, why: v.why })),
	}
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
