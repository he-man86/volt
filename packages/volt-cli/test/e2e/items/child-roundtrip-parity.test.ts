/**
 * Child round-trip PARITY: an accepted `set` of a POU that carries a child MUST be enumerable in /refs and
 * fetchable back — on BOTH bridges. This is the strict "accepted ⇒ readable" contract; `accepted:true` for an
 * item that then never appears in /refs is a data-fidelity lie.
 *
 * WHY THIS EXISTS (2026-07-10): TwinCAT silently drops a FUNCTION_BLOCK containing a METHOD, and any INTERFACE
 * (with a method OR a property) — the push returns accepted:true but the item is absent from /refs and
 * unfetchable (it does reach the IDE tree, so a build compiles it, but the bridge can't read it back). CODESYS
 * round-trips all of them. Same suite, both bridges ⇒ a real parity bug in the Beckhoff push/materialize path.
 * FB+ACTION and FB+PROPERTY round-trip fine on both — the fault is METHOD children and INTERFACE members.
 *
 * The suite's shared cleanup() can only delete items it finds in /refs, so it CANNOT remove a dropped
 * (UNREADABLE, un-enumerated) item — that leftover then blocks the next create with "already exists". So this
 * file cleans with the UNREADABLE-sentinel delete, which removes the invisible items too.
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { id, fid, bridge, pushOps, requireHealthy, BASE } from "../harness"
import { fb, iface, METHOD, ACTION, PROPERTY, ITF_PROPERTY } from "../fixtures"

// A bodiless interface method (interfaces declare signatures only).
const ITF_METHOD = (n: string) => `METHOD ${n} : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nEND_METHOD\n`

type Case = { desc: string; wire: string; src: string }
const CASES: Case[] = [
	{ desc: "FB + METHOD", wire: fid("cp_fbm"), src: fb(id("cp_fbm"), { children: METHOD("Compute") }) },
	{ desc: "FB + ACTION", wire: fid("cp_fba"), src: fb(id("cp_fba"), { children: ACTION("Act1") }) },
	{ desc: "FB + PROPERTY", wire: fid("cp_fbp"), src: fb(id("cp_fbp"), { children: PROPERTY("Speed") }) },
	{ desc: "INTERFACE + METHOD", wire: fid("cp_itm", "itf"), src: iface(id("cp_itm"), ITF_METHOD("Go")) },
	{ desc: "INTERFACE + PROPERTY", wire: fid("cp_itp", "itf"), src: iface(id("cp_itp"), ITF_PROPERTY("Ready", true, false)) },
]

/** Delete each name with its /refs version, falling back to the UNREADABLE sentinel so a dropped/invisible
 *  item (accepted:true but not enumerated) is still removed and can't block a re-create. */
async function sentinelClean(names: string[]): Promise<void> {
	const items = (await bridge.refs()).items ?? {}
	for (const n of names) await pushOps([{ op: "deleteItem", name: n, ifVersion: items[n] ?? "UNREADABLE000000" }])
}

describe(`lifecycle / child round-trip parity (${BASE})`, () => {
	setDefaultTimeout(60_000)
	const names = CASES.map((c) => c.wire)
	beforeAll(async () => {
		await requireHealthy()
		await sentinelClean(names)
	})
	afterAll(async () => { await sentinelClean(names) })

	for (const c of CASES) {
		it(`${c.desc}: an accepted create is enumerable in /refs and fetchable`, async () => {
			await sentinelClean([c.wire])
			const r = await pushOps([{ op: "set", name: c.wire, toFolder: "", sourceText: c.src, ifVersion: null }])
			expect(r.accepted, `create '${c.wire}' was rejected: ${JSON.stringify(r.conflicts)}`).toBe(true)

			// The contract: accepted ⇒ readable. These fail on TwinCAT for METHOD/INTERFACE items (the bug).
			const refs = (await bridge.refs()).items ?? {}
			expect(refs[c.wire], `'${c.wire}' was accepted but is absent from /refs (silently dropped)`).toBeDefined()

			const f = await bridge.fetch({ knownItems: {}, onlyItems: [c.wire] })
			const fetched = (f.changed ?? []).find((i: any) => i.name === c.wire)
			expect(fetched, `'${c.wire}' was accepted but is not fetchable`).toBeDefined()
		})
	}
})
