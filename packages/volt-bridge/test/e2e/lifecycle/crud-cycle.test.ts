/**
 * THE core lifecycle test. For every kind, drive the full endpoint cycle and assert the version/hash
 * matrix at each step — so /refs, /fetch, /push and the three version stamps are all exercised together:
 *
 *   create → assert {item:new, project:Δ, structure:Δ}     (add)
 *   fetch  → kind + version match /refs, content present
 *   re-push the bridge's own output → assert NO change       (fixed point — idempotency)
 *   edit   → assert {item:Δ, project:Δ, structure:same}     (content edit)
 *   rename → new item keeps the content version; structure+project Δ   (rename)
 *   move   → item version Δ (folder ∈ hash), structure same, project Δ (move)
 *   delete → assert {item:gone, project:Δ, structure:Δ}     (delete)
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, setDefaultTimeout } from "bun:test"
import { id, cleanup, requireHealthy, snapshot, assertDelta, createItem, updateItem, fetchItem, fetchSource, pushOps, ensureCompiles, savePlcPrg, restorePlcPrg, fixPlcPrg, snapshotItem, snapshotHas, FOLDER, BASE } from "../harness"
import { LIFECYCLE_KINDS } from "../fixtures"

describe(`lifecycle / CRUD cycle (${BASE})`, () => {
	setDefaultTimeout(60_000) // TC COM calls are slow; default 5s is too tight
	beforeAll(async () => { await requireHealthy() })
	beforeEach(async () => { await fixPlcPrg(); await cleanup(); await savePlcPrg() })
	afterEach(async () => { await restorePlcPrg() })
	afterAll(cleanup)

	for (const k of LIFECYCLE_KINDS) {
		it(`${k.key}: create→fetch→fixedpoint→edit→rename→move→delete, versions track correctly`, async () => {
			const name = id(`lc_${k.key}`)

			// 1. baseline
			const s0 = await snapshot()
			expect(snapshotHas(s0, name)).toBe(false)

			// 2. CREATE
			await createItem(name, k.create(name))
			if (k.key === "fb" || k.key === "fbChildren") await ensureCompiles(name)
			const s1 = await snapshot()
			assertDelta(s0, s1, name, { item: "new", project: true, structure: true })

			// 3. FETCH — kind + version + folder consistent with /refs
			const fetched = await fetchItem(name)
			expect(fetched.version).toBe(snapshotItem(s1, name))
			expect(fetched.folder ?? "").toBe(FOLDER)

			// 4. RE-PUSH the bridge's own canonical output → FIXED POINT (nothing moves)
			await updateItem(name, fetched.sourceText)
			const s2 = await snapshot()
			assertDelta(s1, s2, name, { item: "same", project: false, structure: false })

			// 5. EDIT content → content-edit deltas (structure stays — same name)
			await updateItem(name, k.edit(name))
			const s3 = await snapshot()
			assertDelta(s2, s3, name, { item: "change", project: true, structure: false })
			expect(await fetchSource(name)).toMatch(k.editToken)

			// 6. RENAME → structure + project change; the renamed item keeps its content version
			const newName = id(`lc_${k.key}_r`)
			const rn = await pushOps([{ op: "renameItem", name, newName, ifVersion: snapshotItem(s3, name) }])
			expect(rn.accepted).toBe(true)
			const s4 = await snapshot()
			expect(snapshotHas(s4, name)).toBe(false)
			if (k.nameInSource) expect(snapshotItem(s4, newName)).not.toBe(snapshotItem(s3, name))
			else expect(snapshotItem(s4, newName)).toBe(snapshotItem(s3, name))
			expect(s4.structure).not.toBe(s3.structure)
			expect(s4.project).not.toBe(s3.project)

			// 7. MOVE → item version changes (folder is in the hash), names unchanged ⇒ structure same
			const mv = await pushOps([{ op: "moveItem", name: newName, newFolder: "POUs/Moved", ifVersion: snapshotItem(s4, newName) }])
			expect(mv.accepted).toBe(true)
			const s5 = await snapshot()
			expect(snapshotItem(s5, newName)).not.toBe(snapshotItem(s4, newName))
			expect(s5.structure).toBe(s4.structure)
			expect(s5.project).not.toBe(s4.project)
			expect((await fetchItem(newName)).folder).toBe("POUs/Moved")

			// 8. DELETE
			const del = await pushOps([{ op: "deleteItem", name: newName, ifVersion: snapshotItem(s5, newName) }])
			expect(del.accepted).toBe(true)
			const s6 = await snapshot()
			assertDelta(s5, s6, newName, { item: "gone", project: true, structure: true })
		})
	}
})
