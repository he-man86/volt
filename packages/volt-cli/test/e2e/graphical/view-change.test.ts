/**
 * A PUSH CHANGES A BODY'S VIEW BETWEEN LD AND FBD (openspec `bridge-refusal-review` 2.22 / 2.31, measure 3.5).
 *
 * Network text states the view ONCE, on the body's `IMPLEMENTATION LD|FBD` line, and both vendors keep it as one member
 * of the body: CODESYS's `INWLImplementationObject.DefaultViewMode` (a writable string on SP21), TwinCAT's archive slot of
 * the same name. Both drivers refused a push that changed only that line ("Volt cannot change a body's view"), because
 * whether the member could be set on an update was not measured. This is the measurement: the line is flipped, the push
 * is accepted, and the next pull states the new view — the IDE holds it, not just Volt's text.
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { bridge, id, fid, cleanup, createItem, fetchItem, pushOps, requireHealthy, BASE, VENDOR } from "../harness"
import { ensureCompiles, withMainProgramRestored } from "../lib/compile"

setDefaultTimeout(180_000)

describe(`graphical / view change (${BASE})`, () => {
	beforeAll(async () => { await requireHealthy(); await cleanup() })
	afterAll(async () => { await cleanup() })

	it("flipping the IMPLEMENTATION line writes the view, both ways", async () => {
		const name = id("view_flip")
		const full = fid("view_flip", "pou")
		const src = `FUNCTION_BLOCK ${name}
VAR
	a : BOOL;
	b : BOOL;
	out : BOOL;
END_VAR
IMPLEMENTATION LD
NETWORK
  out := (a AND b);
END_NETWORK

END_FUNCTION_BLOCK
`
		await createItem(fid("view_flip"), src, "")
		const pulled = (await fetchItem(full)).sourceText
		expect(pulled).toContain("IMPLEMENTATION LD\n")

		for (const [from, to] of [["LD", "FBD"], ["FBD", "LD"]] as const) {
			const before = (await fetchItem(full)).sourceText
			const flipped = before.replace(`IMPLEMENTATION ${from}\n`, `IMPLEMENTATION ${to}\n`)
			expect(flipped, "the flip did not apply").not.toBe(before)

			const refs = await bridge.refs()
			const r = await pushOps([{ op: "set", name: full, sourceText: flipped, ifVersion: refs.items[full] }])
			expect(r.accepted, `push refused: ${JSON.stringify(r.conflicts)}`).toBe(true)
			expect((await fetchItem(full)).sourceText).toBe(flipped)
		}
	})

	/**
	 * A VOLT FLIP OF AN LD BODY HOLDING A PARALLEL IS THE VENDOR'S FLIP (DIALECT N23; `bridge-refusal-review` 3.10, review
	 * 3a). The vendor's own View command writes the view and nothing stored, a Parallel included, and draws it in FBD
	 * (`scripts/probe-view-switch.py`). This is the same through the shipped push: both Parallels (fed `BoxShortCircuit`,
	 * unfed `Sequential` under an AND) pull back unchanged under the flipped line, the project builds, and the flip back
	 * restores the LD text. CODESYS only: TwinCAT's import cannot build a Parallel (D30), refused by name before the
	 * import (`real-project-shapes.test.ts`).
	 */
	it.skipIf(VENDOR === "twincat")("an LD body holding a PARALLEL flips to FBD and back, unchanged, and builds", async () => {
		const name = id("view_flip_par")
		const full = fid("view_flip_par", "pou")
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
  out := PARALLEL(IN := go, a, b);
END_NETWORK
NETWORK
  out2 := (a AND PARALLEL(MODE := Sequential, b, go));
END_NETWORK

END_FUNCTION_BLOCK
`
		await createItem(fid("view_flip_par"), src, "")
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
				expect(r.accepted, `push refused: ${JSON.stringify(r.conflicts)}`).toBe(true)
				expect((await fetchItem(full)).sourceText).toBe(flipped)
				await ensureCompiles(name)
			}
		})
		expect((await fetchItem(full)).sourceText).toBe(ld)
	})
})
