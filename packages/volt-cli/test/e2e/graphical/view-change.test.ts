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
import { bridge, id, fid, cleanup, createItem, fetchItem, pushOps, requireHealthy, BASE } from "../harness"

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
})
