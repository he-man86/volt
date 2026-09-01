/**
 * FOLDER PRESERVATION: an in-place edit must not move the item.
 *
 * This exists ahead of `pou-writes-via-plcopen`, which replaces the per-item `WriteText` with
 * delete-then-reimport of a spliced PLCopen document. Two facts make placement the first thing that breaks:
 *
 *   1. PLCopen carries NO folder membership at all. Nothing in the document says where the item lives.
 *   2. An import lands at the PROJECT ROOT unless the target parent is passed — observed live while probing
 *      CODESYS, where a POU deleted from `EdgePcClient` came back at the root with its content intact.
 *
 * Under today's `WriteText` these pass trivially: nothing is deleted, so nothing can be relocated. That is the
 * point — they pin the behaviour BEFORE the mechanism changes, so a regression shows up as a red test rather
 * than as an engineer's POU quietly reappearing at the top of their project tree.
 *
 * Depth matters: a single-level folder can be preserved by accident (the import's default parent may happen to
 * be right), so the nested cases are the real assertion.
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { id, fid, cleanup, requireHealthy, createItem, updateItem, fetchItem, plcFolder, BASE } from "../harness"
import { fb, METHOD, ACTION, PROPERTY } from "../fixtures"

describe(`lifecycle / folder preservation (${BASE})`, () => {
	setDefaultTimeout(120_000)
	beforeAll(async () => {
		await requireHealthy()
		await cleanup()
	})
	afterAll(async () => {
		try {
			await cleanup()
		} catch {}
	})

	/** Create in `sub`, edit IN PLACE, then assert the item is still in `sub`. */
	async function editKeepsFolder(key: string, sub: string, children = ""): Promise<void> {
		const name = id(key)
		const wire = fid(key)
		const folder = await plcFolder(sub)

		await createItem(wire, fb(name, { body: "x := 1;", children }), folder)
		const created = await fetchItem(wire)
		expect(created.folder ?? "").toBe(folder) // the create landed where we asked

		// The edit names NO folder — it is a content change only.
		await updateItem(wire, fb(name, { body: "x := 2;", children }))

		const edited = await fetchItem(wire)
		expect(edited.folder ?? "").toBe(folder) // ...and must not have moved it
		expect(edited.sourceText).toContain("x := 2") // the edit really applied
	}

	it("a POU one folder deep stays put across an in-place edit", async () => {
		await editKeepsFolder("fp_one", "POUs")
	})

	it("a POU TWO folders deep stays put — the case a default parent cannot get right by luck", async () => {
		await editKeepsFolder("fp_two", "POUs/Sub")
	})

	it("a POU THREE folders deep stays put", async () => {
		await editKeepsFolder("fp_three", "POUs/Sub/Deep")
	})

	it("a nested POU keeps its folder AND its children across an in-place edit", async () => {
		const kids = METHOD("Accelerate") + ACTION("Start") + PROPERTY("Speed")
		await editKeepsFolder("fp_kids", "POUs/Sub", kids)

		// The children must have survived the edit too — a delete-then-reimport that loses placement is just as
		// likely to lose members, and both are silent.
		const fetched = await fetchItem(fid("fp_kids"))
		expect(fetched.sourceText).toContain("Accelerate")
		expect(fetched.sourceText).toContain("Start")
		expect(fetched.sourceText).toContain("Speed")
	})
})
