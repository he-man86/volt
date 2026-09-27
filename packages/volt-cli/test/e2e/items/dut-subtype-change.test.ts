/**
 * A DUT SUBTYPE CHANGE IS ONE UPDATE OF THE SAME IDE OBJECT — openspec `dut-subtype-on-the-wire`, the push rule,
 * against a live IDE.
 *
 * <p>A DUT's wire name carries its subtype (`X.struct`), so rewriting a struct as an enum changes the NAME a
 * client holds. Below the vendor seam the two names are one object `X`. Git hands the CLI that change in one of two
 * shapes — a rename (`set X.struct toName X.enum`) or a delete plus an add (`deleteItem X.struct` + `set X.enum`, when
 * the texts share too little for git to pair them) — and both must land as a content update of `X`: the folder it
 * lives in is kept, and `refs` afterwards publishes `X.enum` and not `X.struct`. Before this rule the delete+add
 * shape either half-applied or was refused for good, depending on git's path order (task 1.1's measurement).</p>
 *
 * <p>The offline tests (`DutSubtypeChangePushTests`, against `FakeIde`) pin the engine; only a live IDE can say
 * the vendor object takes the new shape in place, which is why this file exists on both vendors.</p>
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, setDefaultTimeout } from "bun:test"
import { BASE } from "../lib/pipe"
import { bridge } from "../lib/bridge"
import { id, fid, cleanup, requireHealthy, createItem, fetchItem, pushOps, plcFolder } from "../lib/workspace"
import { structDut, enumDut, unionDut } from "../fixtures"
import { ensureCompiles, withMainProgramRestored } from "../lib/compile"

describe(`items / DUT subtype change (${BASE})`, () => {
	setDefaultTimeout(60_000)
	beforeAll(async () => { await requireHealthy() })
	beforeEach(cleanup)
	afterAll(cleanup)

	/** Create `name` as a struct in a sub-folder (so "folder kept" cannot pass by landing at a default). */
	async function seedStruct(key: string): Promise<{ bare: string; folder: string; version: string }> {
		const bare = id(key)
		const folder = await plcFolder("POUs/SubtypeChange")
		await createItem(fid(key, "struct"), structDut(bare), folder)
		const refs = await bridge.refs()
		const version = refs.items[fid(key, "struct")]
		expect(version, `the created struct is not in refs: ${JSON.stringify(Object.keys(refs.items).filter((n) => n.startsWith(bare)))}`).toBeDefined()
		return { bare, folder, version }
	}

	async function expectOnlyUnder(key: string, ext: string, others: string[]): Promise<void> {
		const names = Object.keys((await bridge.refs()).items)
		expect(names).toContain(fid(key, ext))
		for (const o of others) expect(names).not.toContain(fid(key, o))
	}

	it("git sees a rename: set X.struct → toName X.enum is one update, folder kept", async () => {
		const { bare, folder, version } = await seedStruct("sub_rn")
		const r = await pushOps([
			{ op: "set", name: fid("sub_rn", "struct"), toName: fid("sub_rn", "enum"), sourceText: enumDut(bare), ifVersion: version },
		])
		expect(r.accepted, `refused: ${JSON.stringify(r.conflicts)}`).toBe(true)

		const it = await fetchItem(fid("sub_rn", "enum"))
		expect(it.folder).toBe(folder)
		expect(it.sourceText).toMatch(/Green/)
		await expectOnlyUnder("sub_rn", "enum", ["struct"])
	})

	// Both orders, because the order is git's path sort and 1.1 measured opposite outcomes for the two.
	for (const order of ["delete-first", "set-first"] as const) {
		it(`git sees delete + add (${order}): one update, folder kept`, async () => {
			const key = `sub_da_${order === "delete-first" ? "d" : "s"}`
			const { bare, folder, version } = await seedStruct(key)
			const del = { op: "deleteItem", name: fid(key, "struct"), ifVersion: version }
			const add = { op: "set", name: fid(key, "union"), sourceText: unionDut(bare), ifVersion: null }
			const r = await pushOps(order === "delete-first" ? [del, add] : [add, del])
			expect(r.accepted, `refused: ${JSON.stringify(r.conflicts)}`).toBe(true)

			const it = await fetchItem(fid(key, "union"))
			expect(it.folder).toBe(folder)
			expect(it.sourceText).toMatch(/UNION/)
			await expectOnlyUnder(key, "union", ["struct"])
			// The vendor object took the new shape IN PLACE only if the compiler accepts it as that shape.
			await withMainProgramRestored(() => ensureCompiles(bare))
		})
	}

	it("a stale delete guard is a version conflict, and the IDE is unchanged", async () => {
		const { bare, version } = await seedStruct("sub_stale")
		const r = await pushOps([
			{ op: "deleteItem", name: fid("sub_stale", "struct"), ifVersion: "0".repeat(version.length) },
			{ op: "set", name: fid("sub_stale", "enum"), sourceText: enumDut(bare), ifVersion: null },
		])
		expect(r.accepted).toBe(false)
		// A version conflict like any update's — not any refusal: the spec names the code.
		expect(r.conflicts ?? [], JSON.stringify(r.conflicts)).toContainEqual(
			expect.objectContaining({ name: fid("sub_stale", "struct"), code: "STALE_ITEM_VERSION" }),
		)
		await expectOnlyUnder("sub_stale", "struct", ["enum"])
		expect((await bridge.refs()).items[fid("sub_stale", "struct")]).toBe(version)
	})

	it("two sets on one DUT under two subtypes are refused BAD_REQUEST naming both, IDE unchanged", async () => {
		const { bare, version } = await seedStruct("sub_two")
		const r = await pushOps([
			{ op: "set", name: fid("sub_two", "struct"), sourceText: structDut(bare), ifVersion: version },
			{ op: "set", name: fid("sub_two", "enum"), sourceText: enumDut(bare), ifVersion: null },
		])
		expect(r.accepted).toBe(false)
		const c = (r.conflicts ?? []).find((x: any) => x.code === "BAD_REQUEST")
		expect(c, JSON.stringify(r.conflicts)).toBeDefined()
		const text = `${c.name} ${c.reason}`
		expect(text).toContain(fid("sub_two", "struct"))
		expect(text).toContain(fid("sub_two", "enum"))
		await expectOnlyUnder("sub_two", "struct", ["enum"])
		expect((await bridge.refs()).items[fid("sub_two", "struct")]).toBe(version)
	})

	it("a body of another subtype under the old name is refused BAD_REQUEST naming both names", async () => {
		const { bare, version } = await seedStruct("sub_body")
		const r = await pushOps([{ op: "set", name: fid("sub_body", "struct"), sourceText: enumDut(bare), ifVersion: version }])
		expect(r.accepted).toBe(false)
		const c = (r.conflicts ?? []).find((x: any) => x.code === "BAD_REQUEST")
		expect(c, JSON.stringify(r.conflicts)).toBeDefined()
		const text = `${c.name} ${c.reason}`
		expect(text).toContain(fid("sub_body", "struct"))
		expect(text).toContain(fid("sub_body", "enum"))
		await expectOnlyUnder("sub_body", "struct", ["enum"])
		expect((await bridge.refs()).items[fid("sub_body", "struct")]).toBe(version)
	})

	it("deleting a stale subtype name does not delete the DUT", async () => {
		const { bare, version } = await seedStruct("sub_gone")
		const moved = await pushOps([
			{ op: "set", name: fid("sub_gone", "struct"), toName: fid("sub_gone", "enum"), sourceText: enumDut(bare), ifVersion: version },
		])
		expect(moved.accepted, JSON.stringify(moved.conflicts)).toBe(true)

		await pushOps([{ op: "deleteItem", name: fid("sub_gone", "struct"), ifVersion: version }])
		await expectOnlyUnder("sub_gone", "enum", ["struct"])
	})
})
