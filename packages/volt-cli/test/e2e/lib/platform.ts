/**
 * WHAT A CODESYS VERSION CANNOT HOLD — named, per version, and EXPECTED (openspec environment-dependency-audit 2.5b).
 *
 * <p>Each installed CODESYS version runs the suite on its own native fixture (`CodesysTestProject.<version>.project`,
 * `scripts/author-version-fixture.py`). An older version lacks things the bridge refuses BY NAME — 3.5.18.30's
 * graphical object model has no constructor Volt writes LD/FBD with, and it does not expose the Project Settings. On
 * that version those tests must not read as failures, and they must not be skipped either: a skip proves nothing, and
 * a version whose gap closed would go on skipping. So a test that meets a gap runs as written, and on a version the
 * gap table names it must end in exactly that gap's refusal — observed in the error it threw or in a push answer it
 * received. Any other failure stays a failure; a test that passes is fine (it did not need what the version lacks).</p>
 *
 * <p>This is the only sanctioned way for a test to know the CODESYS version it runs on, as `expectVendorDifference`
 * is for the vendor: every gap cites the record that tracks it.</p>
 */
import { beforeAll as bunBeforeAll, it as bunIt } from "bun:test"
import { bridge, pushReasons } from "./bridge"
import { VENDOR } from "./pipe"

export type PlatformGap = {
	/** The name an expected failure is logged under. */
	id: string
	/** The CODESYS platform versions (`health.ideVersion`) that lack it. */
	platforms: string[]
	/** The bridge's refusal, as the product words it — the ONLY failure the gap excuses. */
	refusal: string
	/** The record that tracks it. */
	record: string
}

export const PLATFORM_GAPS = {
	graphicalWrite: {
		id: "codesys-3.5.18.30-no-ldfbd-write",
		platforms: ["3.5.18.30"],
		refusal: "this CODESYS version cannot take an LD/FBD body from Volt",
		record: "DIALECT V2 / NwlInterop.New: SP18's NWLObject 4.1.0.0 has no Operand(string) constructor (measured 2026-10-10)",
	},
	projectSettings: {
		id: "codesys-3.5.18.30-no-project-settings",
		platforms: ["3.5.18.30"],
		refusal: "this CODESYS version cannot give Volt its Project Settings",
		record: "CodesysObjectModel.ProjectSettingsDescriptor: APEnvironment.LMServiceProvider is absent on 3.5.18.30 (measured 2026-10-10)",
	},
	libraryParameterDefaults: {
		id: "codesys-3.5.18.30-library-parameter-defaults",
		platforms: ["3.5.18.30"],
		refusal: "library parameter value(s)",
		record:
			"DIALECT V7 (gate 2a): up to 3.5.18.30 each reference archives its own `Params` - and SP18 archives a library's " +
			"DEFAULTS there: a project SP18's own scripting made (device + add_placeholder Analyzation) names 6 values " +
			"(measured 2026-10-14, environment-dependency-audit 2.5b), which Volt does not spell yet, so the Library " +
			"Manager is named unreadable",
	},
} satisfies Record<string, PlatformGap>

let platform: Promise<string | null> | undefined
/** The served IDE's platform version, read once from `health` (null on TwinCAT, which this table does not cover). */
export function servedPlatform(): Promise<string | null> {
	if (VENDOR !== "codesys") return Promise.resolve(null)
	platform ??= bridge.health().then((h: any) => (typeof h?.ideVersion === "string" ? h.ideVersion : null))
	return platform
}

/** Whether the served version lacks the gap. */
export async function lacks(gap: PlatformGap): Promise<boolean> {
	const p = await servedPlatform()
	return p !== null && gap.platforms.includes(p)
}

/**
 * Run `body`; on a version that lacks `gap`, a failure must be that gap's refusal (in the error, or in a push answer the
 * body received). True when the body ended in the gap. Exported for a test that is not registered through
 * {@link itGapped}.
 */
export async function expectGap(gap: PlatformGap, title: string, body: Body): Promise<boolean> {
	if (!(await lacks(gap))) {
		await body()
		return false
	}
	const seen = pushReasons.length
	try {
		await body()
		return false
	} catch (e) {
		const said = [String((e as Error)?.message ?? e), ...pushReasons.slice(seen)]
		if (!said.some((s) => s.includes(gap.refusal))) throw e
		console.log(`[e2e] expected on CODESYS ${await servedPlatform()}: ${gap.id} — "${title}" ended in "${gap.refusal}" (${gap.record})`)
		return true
	}
}

type Body = () => void | Promise<unknown>
type Register = (title: string, body: Body, timeout?: number) => void
type ItLike = Register & {
	skipIf: (cond: boolean) => Register
	/** A `beforeAll` whose setup writes what the version lacks: when it ends in the gap, the tests after it in the
	 *  file have nothing to run on and are reported as that expectation, by name, without running. */
	beforeAll: (body: Body) => void
}

/** `it`, with every test held to {@link expectGap} for `gap`. A file whose tests write what a version lacks imports
 *  `const it = itGapped(PLATFORM_GAPS.x)` in place of bun's. */
export function itGapped(gap: PlatformGap): ItLike {
	let setupMet = false
	const wrap = (register: Register): Register => (title, body, timeout) =>
		register(title, async () => {
			if (setupMet) {
				console.log(`[e2e] expected on CODESYS ${await servedPlatform()}: ${gap.id} — "${title}" not run: its setup ended in "${gap.refusal}"`)
				return
			}
			await expectGap(gap, title, body)
		}, timeout)
	const it = wrap(bunIt) as ItLike
	it.skipIf = (cond: boolean) => wrap(bunIt.skipIf(cond))
	it.beforeAll = (body: Body) => bunBeforeAll(async () => { setupMet = await expectGap(gap, "the suite's setup", body) })
	return it
}
