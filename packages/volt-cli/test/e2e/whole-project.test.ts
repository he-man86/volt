/**
 * THE WHOLE-PROJECT SWEEP — every item in whatever project the bridge has open, not a shape Volt authored.
 *
 * WHY THIS EXISTS. Two bugs reached a user on the same day, and neither could have been caught by the suite as
 * it stood, for the same reason: **every graphical fixture Volt owns is one Volt itself created.** Bodies Volt
 * writes are regular — a null `En`, a title with no trailing newline, pins Volt named. Bodies an ENGINEER draws
 * are not, and that difference is where both bugs lived:
 *
 *   - a box whose unwired `En` pin read as `System.Boolean false` made a body unreadable, which made the ITEM
 *     unreadable, so an entire POU was absent from the workspace with no error anywhere (DIALECT C7);
 *   - a network title carrying the newline the engineer typed rendered as a quoted string spanning two lines —
 *     text that does not parse, so that POU could be pulled and never pushed back (C8).
 *
 * Both are caught by the two properties below, and neither needs to know what the project CONTAINS. That is the
 * point: this gate gets stronger every time a real project is opened in front of it, without being edited.
 *
 * RUNNING IT AGAINST A REAL PROJECT. It sweeps whatever the host has open, so no flag is needed — point the host
 * at a customer project and re-run:
 *
 *   pwsh scripts/codesys-pipe.ps1 down
 *   pwsh scripts/codesys-pipe.ps1 up -Project "<path>\Some_Customer.project"
 *   bun test test/e2e/whole-project.test.ts
 *
 * The push half writes each item's OWN bytes back, so a correct bridge changes nothing; that is exactly what
 * makes it safe to point at a real project, and exactly what fails loudly when it is not correct.
 */
import { describe, it, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { bridge, requireHealthy, BASE, libraryRoots, inLibrary } from "./harness"

/** The kinds an engineer edits — the ones a push may write. Library signatures and device/task descriptors are
 *  read-only and are swept for READABILITY only, never pushed. */
const WRITABLE = /\.(prg|fb|fun|dut|gvl|itf)$/i

describe(`whole project (${BASE})`, () => {
	setDefaultTimeout(600_000)
	beforeAll(async () => {
		await requireHealthy()
	})

	/** NOTHING VANISHED. An item Volt cannot materialize is tracked in the project hash and left out of the
	 *  index, so it has no file and no error — it is simply gone, which is how a POU disappeared from a real
	 *  project unnoticed. The wire now names those items; this asserts there are none. */
	it("every item in the project materializes — nothing is silently unreadable", async () => {
		const refs: any = await bridge.refs()
		const fetched: any = await bridge.fetch({ knownItems: {} })

		expect(refs.unreadable ?? [], `refs could not materialize: ${JSON.stringify(refs.unreadable)}`).toEqual([])
		expect(fetched.unreadable ?? [], `fetch could not materialize: ${JSON.stringify(fetched.unreadable)}`).toEqual([])

		// …and the two agree, so a client cannot get a clean answer from one and a loss from the other.
		expect(fetched.unreadable ?? []).toEqual(refs.unreadable ?? [])
	})

	/** NOTHING DRIFTS. Every editable item is pushed back EXACTLY as it was pulled. A correct bridge accepts it
	 *  and changes nothing; anything that cannot survive its own output — a title that re-reads as broken text,
	 *  a modifier dropped on the way out — fails here, on the item that actually has the shape. */
	it("every editable item is a fixed point: pull → push its own bytes → pull is identical", async () => {
		const first: any = await bridge.fetch({ knownItems: {} })
		// Library artefacts share the same extensions (`RS.fb`, `Global_Version.gvl`) and are READ-ONLY: they are
		// rendered signatures, deliberately absent from the refs index and not pushable. Excluded by where they
		// live, derived from the payload — see `libraryRoots`.
		const roots = libraryRoots(first.changed as any[])
		const items = (first.changed as any[]).filter(
			(i) => WRITABLE.test(String(i.name)) && !inLibrary(i.folder, roots),
		)
		expect(items.length, "the project has no editable items — is the right project open?").toBeGreaterThan(0)

		// FOUR CALLS, whatever the project's size. Doing this per item — refs, push, fetch each time — makes the
		// cost quadratic, because refs and fetch are each a FULL project walk: on a 9.9 MB customer project that
		// ran past ten minutes without finishing. One push carrying every op is also the STRONGER claim: the
		// whole project has to survive one write, not each item in isolation.
		const refs: any = await bridge.refs()

		const missing = items.filter((i) => !refs.items?.[i.name]).map((i) => String(i.name))
		expect(missing, "items present in fetch but absent from the refs index").toEqual([])

		const pushed: any = await bridge.push({
			expectedProjectVersion: refs.projectVersion,
			ops: items.map((i) => ({ op: "set", name: i.name, sourceText: i.sourceText, ifVersion: refs.items[i.name] })),
		})
		// The interesting failure: Volt produced text it will not take back.
		expect(
			pushed.accepted,
			`the project's own text was REFUSED: ${JSON.stringify(pushed.conflicts)?.slice(0, 2000)}`,
		).toBe(true)

		const after: any = await bridge.fetch({ knownItems: {} })
		const back = new Map((after.changed as any[]).map((i) => [String(i.name), String(i.sourceText)]))

		const drifted = items
			.filter((i) => back.get(String(i.name)) !== String(i.sourceText))
			.map((i) => (back.has(String(i.name)) ? `${i.name}: drifted` : `${i.name}: gone after its own bytes were pushed`))

		expect(drifted, `${drifted.length} of ${items.length} items did not survive their own round trip`).toEqual([])
	})
})
