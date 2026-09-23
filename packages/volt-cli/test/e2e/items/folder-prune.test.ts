/**
 * A PUSH THAT EMPTIES A FOLDER STILL WORKS — the live half of the folder prune.
 *
 * <p>`PushService` removes a folder this push emptied, the way git removes a directory once its last file
 * goes. That behaviour is asserted OFFLINE (`Volt.Engine.Tests/sync/FolderPruneTests`), and it has to be,
 * because an empty folder is UNREPRESENTABLE on this wire: `refs`/`fetch` publish `folders` keyed BY ITEM,
 * and `ProjectSnapshot.IsTracked` excludes container managers from the version hashes. A folder holding
 * nothing changes nothing a client can observe.</p>
 *
 * <p><b>The first version of this file tried to assert it anyway</b>, by checking that no item sits in the
 * folder afterwards — which is true whether the prune ran or not. It passed with the prune commented out.
 * That is the trap this header exists to stop the next person walking into.</p>
 *
 * <p>So what a LIVE test can add is the half the fake cannot: that the prune runs against two real IDEs
 * without refusing the push, losing the item, or disturbing anything it should not touch. The vendor half —
 * that neither IDE prunes on its own and both accept the delete — is measured by
 * `scripts/probe-empty-folder-lifecycle.py` and a COM tree walk.</p>
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { id, fid, bridge, requireHealthy, pushOps, cleanup, plcFolder, BASE } from "../harness"
import { fb } from "../fixtures"

describe(`lifecycle / emptied folders are pruned (${BASE})`, () => {
	setDefaultTimeout(180_000)
	beforeAll(async () => {
		await requireHealthy()
		await cleanup()
	})
	afterAll(async () => {
		try {
			await cleanup()
		} catch {}
	})

	/** Does any item sit in `folder`, or under it? That is the only question the wire can answer about a folder. */
	const inhabited = async (folder: string): Promise<boolean> => {
		const folders = (await bridge.refs()).folders ?? {}
		return Object.values(folders).some(
			(f) => typeof f === "string" && (f === folder || f.startsWith(folder + "/")),
		)
	}

	/**
	 * Create an item, then take it away — by DELETING it or by MOVING it out. Both empty the folder, and both
	 * have to prune: a move's origin is emptied exactly as a delete's folder is.
	 */
	async function emptyBy(how: "delete" | "move", key: string, depth: string): Promise<string> {
		const root = await plcFolder()
		const folder = `${root}/${depth}`
		const name = fid(key)

		const created = await pushOps([
			{ op: "set", name, toFolder: folder, sourceText: fb(id(key)), ifVersion: null },
		])
		expect(created.accepted, `create refused: ${JSON.stringify(created.conflicts)}`).toBe(true)
		expect(await inhabited(folder), "the item did not land in the folder under test").toBe(true)

		const refs = await bridge.refs()
		const away =
			how === "delete"
				? [{ op: "deleteItem", name, ifVersion: refs.items[name] }]
				: [{ op: "set", name, toFolder: root, ifVersion: refs.items[name] }]

		const r = await pushOps(away)
		expect(r.accepted, `${how} refused: ${JSON.stringify(r.conflicts)}`).toBe(true)
		return folder
	}

	it("a DELETE that empties a folder is accepted, and the item is gone", async () => {
		const folder = await emptyBy("delete", "pr_del", "VltPrune/Del")
		expect(await inhabited(folder)).toBe(false)
	})

	it("a MOVE OUT of a folder is accepted, and the item lands in its new folder", async () => {
		// The origin is emptied exactly as a delete's folder is — the item is simply somewhere else now.
		const folder = await emptyBy("move", "pr_mov", "VltPrune/Mov")
		expect(await inhabited(folder)).toBe(false)
	})

	/**
	 * RULE 2 — RECURSIVE, BECAUSE GIT IS. Emptying `a/b/` removes `a/` too when `b` was all it held. Without the
	 * ancestor walk the shallow half of the chain survives, which is the litter this exists to stop.
	 */
	it("a push that empties a three-deep chain is accepted", async () => {
		const root = await plcFolder()
		const deep = `${root}/VltPruneChain/Mid/Leaf`
		const name = fid("pr_chain")

		expect((await pushOps([{ op: "set", name, toFolder: deep, sourceText: fb(id("pr_chain")), ifVersion: null }])).accepted).toBe(true)

		const refs = await bridge.refs()
		expect((await pushOps([{ op: "deleteItem", name, ifVersion: refs.items[name] }])).accepted).toBe(true)

		// Every level of the chain, not just the one the item was in.
		expect(await inhabited(`${root}/VltPruneChain`)).toBe(false)
	})

	/**
	 * RULE 1 — ONLY WHAT THIS PUSH EMPTIED. A folder that still holds something is left alone, which is the
	 * difference between pruning and deleting the engineer's tree. A sibling in the SAME parent proves both
	 * halves at once: the emptied child goes, the parent stays because the sibling is still in it.
	 */
	it("a sibling in an untouched folder is not disturbed", async () => {
		const root = await plcFolder()
		const parent = `${root}/VltPruneKeep`
		const goes = `${parent}/Goes`
		const stays = fid("pr_stay")
		const leaves = fid("pr_leave")

		expect((await pushOps([
			{ op: "set", name: stays, toFolder: parent, sourceText: fb(id("pr_stay")), ifVersion: null },
			{ op: "set", name: leaves, toFolder: goes, sourceText: fb(id("pr_leave")), ifVersion: null },
		])).accepted).toBe(true)

		const refs = await bridge.refs()
		expect((await pushOps([{ op: "deleteItem", name: leaves, ifVersion: refs.items[leaves] }])).accepted).toBe(true)

		expect(await inhabited(goes), "the emptied child folder survived").toBe(false)
		expect(await inhabited(parent), "the parent was pruned while it still held an item").toBe(true)
	})
})
