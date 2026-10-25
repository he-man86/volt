import { landed } from "./workspace"
/**
 * COMPILING WHAT A TEST CREATED — instantiating a POU in the main program so the compiler reaches it, and
 * asserting the project builds clean.
 *
 * <p>Restoring the main program is the delicate part, and it used to be unsafe. See {@link withMainProgramRestored}.</p>
 */
import { expect } from "bun:test"
import { bridge } from "./bridge"
import { PREFIX, applications, fetchKnown, mainProgram, pushOps } from "./workspace"
import { drivenApplication, drivenDiagnostics } from "./main-program"

/**
 * `build`, as the application the suite drives sees it: the driven application alone, by the wire's own `applications`
 * (D46), so its verdict and its diagnostics are that application's. On TwinCAT MultiProject — the release cell — a whole
 * build also fails on Untitled1's own fault (`test/e2e/multi-application` pins it), and TwinCAT then writes a failed
 * build's line that names no item (`Error: The operation could not be completed…`, carried since wire-final-shape 3.6),
 * which no filter can place in an application: so the suite builds what it drives instead of filtering a whole build.
 */
export async function drivenBuild(): Promise<{ success: boolean; diagnostics: any[] }> {
	const apps = await applications()
	const driven = drivenApplication(apps)
	const r = await bridge.build(apps.length > 1 && driven !== null ? { applications: [driven] } : {})
	return { ...r, diagnostics: drivenDiagnostics(r.diagnostics ?? [], apps) }
}

/**
 * Run `body` and put the main program back exactly as it was, whatever happens.
 *
 * <p><b>This replaces a save/restore pair that could lose the original.</b> The old `savePlcPrg()`/`restorePlcPrg()`
 * kept the text in ONE module-level slot shared by 14 files: a second save before the matching restore silently
 * overwrote the first's original, and `restorePlcPrg()` nulled the slot even when its restoring push had been
 * REJECTED — it only `console.warn`ed. So a failed restore lost the original irrecoverably and left the fixture's
 * main program edited, in a suite whose whole job is to leave the project as it found it.</p>
 *
 * <p>A scoped wrapper fixes both halves: the original lives in a local, so nesting cannot clobber it, and `finally`
 * cannot be skipped by a throwing assertion. A restore that is refused now THROWS — the fixture is dirty and the
 * run must say so at the point it happened.</p>
 */
export async function withMainProgramRestored<T>(body: () => Promise<T>): Promise<T> {
	const main = await mainProgram()
	if (!main) return body() // a library project has no main program to disturb
	const original = (await fetchKnown(main)).item.sourceText
	try {
		return await body()
	} finally {
		const { item: current, projectVersion } = await fetchKnown(main)
		if (current.sourceText !== original) {
			const r = await pushOps([
				{ op: "set", name: main, sourceText: original, ifVersion: current.version },
			], projectVersion)
			if (!landed(r))
				throw new Error(
					`could not restore '${main}' — the fixture's main program is left edited: ` +
						JSON.stringify(r.conflicts).slice(0, 300),
				)
		}
	}
}

/**
 * Strip any `VltE2E_*` instance declarations a previous run left in the main program.
 *
 * <p>Needed because an instance of a POU that no longer exists is itself a compile error, and `ensureCompiles`
 * asserts the WHOLE project builds clean.</p>
 */
export async function clearTestInstances(): Promise<void> {
	const main = await mainProgram()
	if (!main) return
	const { item, projectVersion } = await fetchKnown(main)
	if (!item.sourceText.includes(PREFIX)) return
	const kept = item.sourceText.split("\n").filter((l: string) => !l.includes(PREFIX))
	const r = await pushOps([
		{ op: "set", name: main, sourceText: kept.join("\n"), ifVersion: item.version },
	], projectVersion)
	if (!landed(r))
		throw new Error(`could not clear stale test instances from '${main}': ${JSON.stringify(r.conflicts).slice(0, 300)}`)
}

/** Declare an instance of a POU in the main program so the compiler reaches it. Idempotent — a second declaration
 *  of the same name is itself a compile error, and a test that builds before AND after an edit calls this twice. */
export async function instantiate(pouName: string): Promise<void> {
	const main = await mainProgram()
	if (!main) return // CODESYS compiles every POU regardless; nothing to do
	const { item, projectVersion } = await fetchKnown(main)
	const lines = item.sourceText.split("\n")
	const endVar = lines.findIndex((l: string) => l.trim() === "END_VAR")
	if (endVar === -1) throw new Error(`${main} has no END_VAR`)
	const varName = `inst_${pouName.replace(PREFIX + "_", "")}`
	if (lines.some((l: string) => l.includes(`${varName} :`))) return
	lines.splice(endVar, 0, `\t${varName} : ${pouName};`)
	const r = await pushOps([
		{ op: "set", name: main, sourceText: lines.join("\n"), ifVersion: item.version },
	], projectVersion)
	expect(landed(r), `could not instantiate '${pouName}': ${JSON.stringify(r.conflicts)}`).toBe(true)
}

/**
 * Assert the POU compiles — by asserting the WHOLE PROJECT builds with zero errors.
 *
 * <p>On TwinCAT (which skips unreferenced POUs) the instance forces compilation; on CODESYS (which compiles
 * everything) the instantiate is a no-op and the build reaches it anyway.</p>
 *
 * <p><b>This assertion used to be vacuous, and about ten "and it compiles" tests rode on it.</b> It filtered the
 * build's diagnostics by the test-POU prefix — `JSON.stringify(d).includes(PREFIX)` — and NEITHER vendor puts an
 * item name in a diagnostic: the wire's diagnostic carries severity/message/line/column and nothing else, CODESYS
 * fills the message from raw compiler text (`Identifier 'Done' not defined` names no POU), and TwinCAT parses
 * `file(line,col) : error : text` and keeps only the text, discarding the file that carried the name. The filter
 * matched nothing, so `expect(0).toBe(0)` passed over exactly the errors each test existed to catch — including a
 * jump that did not compile at all (DIALECT C13).</p>
 *
 * <p>Zero-errors-project-wide is simpler AND stronger, and it is honest only because it was measured: with every
 * test POU removed, CodesysTestProject and TwinCAT Project14 each build 0 errors / 0 warnings, and so does TwinCAT
 * MultiProject's driven PLC project (its Untitled1 holds the fixture's one fault, outside it — `drivenBuild`). Any error is
 * therefore the POU under test or one an earlier test left behind, and failing loudly on the second is a feature.
 * If a fixture ever legitimately carries an error, snapshot the diagnostics first and assert the set does not
 * GROW — do not reintroduce a filter that can silently match nothing.</p>
 */
export async function ensureCompiles(pouName: string): Promise<void> {
	await instantiate(pouName)
	const r = await drivenBuild()
	const errors = r.diagnostics.filter((d: any) => d.severity === "error")
	if (errors.length > 0) console.warn("build errors:", JSON.stringify(errors).slice(0, 500))
	expect(errors.length, `the build reported ${errors.length} error(s) — see above`).toBe(0)
}

/** Every diagnostic the project currently reports, for tests that must assert a set does not GROW rather than
 *  that it is empty. */
export async function diagnostics(): Promise<any[]> {
	return (await drivenBuild()).diagnostics
}
