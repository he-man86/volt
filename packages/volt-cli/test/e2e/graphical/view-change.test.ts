import { landed } from "../harness"
/**
 * A PUSH CHANGES A BODY'S VIEW BETWEEN LD AND FBD (openspec `bridge-refusal-review` 2.22 / 2.31, measure 3.5).
 *
 * Network text states the view ONCE, on the body's `IMPLEMENTATION LD|FBD` line, and both vendors keep it as one member
 * of the body: CODESYS's `INWLImplementationObject.DefaultViewMode` (a writable string on SP21), TwinCAT's archive slot of
 * the same name. Both drivers refused a push that changed only that line ("Volt cannot change a body's view"), because
 * whether the member could be set on an update was not measured. This is the measurement: the line is flipped, the push
 * is accepted, and the next pull states the new view — the IDE holds it, not just Volt's text.
 */
import { describe, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { bridge, id, fid, cleanup, createItem, fetchItem, pushOps, requireHealthy, BASE, VENDOR, inFolder, projectRoot } from "../harness"
import { ensureCompiles, withMainProgramRestored } from "../lib/compile"

import { itGapped, PLATFORM_GAPS } from "../lib/platform"

/** On a CODESYS version that cannot take an LD/FBD write, every test here must end in that refusal (lib/platform.ts). */
const it = itGapped(PLATFORM_GAPS.graphicalWrite)

setDefaultTimeout(180_000)

describe(`graphical / view change (${BASE})`, () => {
	beforeAll(async () => { await requireHealthy(); await cleanup() })
	afterAll(async () => { await cleanup() })

	it("flipping the IMPLEMENTATION line writes the view, both ways", async () => {
		const name = id("view_flip")
		const full = inFolder(await projectRoot(), fid("view_flip", "pou"))
		const src = `FUNCTION_BLOCK ${name}
VAR
	a : BOOL;
	b : BOOL;
	out : BOOL;
END_VAR
IMPLEMENTATION LD
NETWORK
  out := a AND b;
END_NETWORK

END_FUNCTION_BLOCK
`
		await createItem(fid("view_flip"), src, await projectRoot())
		const pulled = (await fetchItem(full)).sourceText
		expect(pulled).toContain("IMPLEMENTATION LD\n")

		for (const [from, to] of [["LD", "FBD"], ["FBD", "LD"]] as const) {
			const before = (await fetchItem(full)).sourceText
			const flipped = before.replace(`IMPLEMENTATION ${from}\n`, `IMPLEMENTATION ${to}\n`)
			expect(flipped, "the flip did not apply").not.toBe(before)

			const refs = await bridge.refs()
			const r = await pushOps([{ op: "set", name: full, sourceText: flipped, ifVersion: refs.items[full] }])
			expect(landed(r), `push refused: ${JSON.stringify(r.conflicts)}`).toBe(true)
			expect((await fetchItem(full)).sourceText).toBe(flipped)
		}
	})

	/**
	 * A VOLT FLIP OF AN LD BODY HOLDING A PARALLEL IS THE VENDOR'S FLIP (DIALECT N23; `bridge-refusal-review` 3.10, review
	 * 3a). The vendor's own View command writes the view and nothing stored, a Parallel included, and draws it in FBD
	 * (`probe-view-switch.py (deleted; git show 5312b799fe:packages/volt-cli/scripts/probe-view-switch.py)`). This is the same through the shipped push: both Parallels (fed `BoxShortCircuit`,
	 * unfed `Sequential` under an AND) pull back unchanged under the flipped line, the project builds, and the flip back
	 * restores the LD text. CODESYS only: TwinCAT has never been seen to write a Parallel, so its native builder has no
	 * member list to build one from and refuses it by name (DIALECT N42, `real-project-shapes.test.ts`).
	 */
	it.skipIf(VENDOR === "twincat")("an LD body holding a PARALLEL flips to FBD and back, unchanged, and builds", async () => {
		const name = id("view_flip_par")
		const full = inFolder(await projectRoot(), fid("view_flip_par", "pou"))
		const src = `FUNCTION_BLOCK ${name}
VAR
	go : BOOL;
	a : BOOL;
	b : BOOL;
	out : BOOL;
	out2 : BOOL;
END_VAR
IMPLEMENTATION LD
NETWORK
  out := go BRANCH (a, b) SHORTCIRCUIT;
END_NETWORK
NETWORK
  out2 := a AND (BRANCH (b, go));
END_NETWORK

END_FUNCTION_BLOCK
`
		await createItem(fid("view_flip_par"), src, await projectRoot())
		const ld = (await fetchItem(full)).sourceText
		expect(ld).toBe(src)

		await withMainProgramRestored(async () => {
			for (const [from, to] of [["LD", "FBD"], ["FBD", "LD"]] as const) {
				const before = (await fetchItem(full)).sourceText
				const flipped = before.replace(`IMPLEMENTATION ${from}
`, `IMPLEMENTATION ${to}
`)
				expect(flipped, "the flip did not apply").not.toBe(before)

				const refs = await bridge.refs()
				const r = await pushOps([{ op: "set", name: full, sourceText: flipped, ifVersion: refs.items[full] }])
				expect(landed(r), `push refused: ${JSON.stringify(r.conflicts)}`).toBe(true)
				expect((await fetchItem(full)).sourceText).toBe(flipped)
				await ensureCompiles(name)
			}
		})
		expect((await fetchItem(full)).sourceText).toBe(ld)
	})
})
