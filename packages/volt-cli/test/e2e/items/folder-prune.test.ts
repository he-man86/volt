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
	 *
	 * <p>Paths come from `plcFolder(sub)`, which JOINS — `${root}/${sub}` does not survive an EMPTY root, and
	 * one of the two fixture projects has its main program AT the PLC root. There that produced a leading
	 * slash and TwinCAT answered `CreateChild failed: Value cannot be null. Parameter name: path`. Which
	 * project a run binds is not something the run chooses, so both layouts have to work.</p>
	 */
	async function emptyBy(how: "delete" | "move", key: string, sub: string): Promise<string> {
		const folder = await plcFolder(sub)
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
				: [{ op: "set", name, toFolder: await plcFolder(), ifVersion: refs.items[name] }]

		const r = await pushOps(away)
		expect(r.accepted, `${how} refused: ${JSON.stringify(r.conflicts)}`).toBe(true)
		return folder
	}

	it("a DELETE that empties a folder is accepted, and the item is gone", async () => {
		expect(await inhabited(await emptyBy("delete", "pr_del", "VltPrune/Del"))).toBe(false)
	})

	it("a MOVE OUT of a folder is accepted, and the item lands in its new folder", async () => {
		expect(await inhabited(await emptyBy("move", "pr_mov", "VltPrune/Mov"))).toBe(false)
	})

	/** A three-deep chain, which is the recursive case the offline suite asserts the removal of. */
	it("a push that empties a three-deep chain is accepted", async () => {
		const deep = await plcFolder("VltPruneChain/Mid/Leaf")
		const name = fid("pr_chain")

		expect((await pushOps([{ op: "set", name, toFolder: deep, sourceText: fb(id("pr_chain")), ifVersion: null }])).accepted).toBe(true)

		const refs = await bridge.refs()
		expect((await pushOps([{ op: "deleteItem", name, ifVersion: refs.items[name] }])).accepted).toBe(true)
		expect(await inhabited(await plcFolder("VltPruneChain"))).toBe(false)
	})

	/**
	 * A SIBLING IN AN UNTOUCHED FOLDER IS NOT DISTURBED — the live half of "only what this push emptied".
	 * The wire cannot show that the parent FOLDER survived, but it can show the sibling did.
	 */
	it("a sibling in an untouched folder is not disturbed", async () => {
		const parent = await plcFolder("VltPruneKeep")
		const goes = await plcFolder("VltPruneKeep/Goes")
		const stays = fid("pr_stay")
		const leaves = fid("pr_leave")

		expect((await pushOps([
			{ op: "set", name: stays, toFolder: parent, sourceText: fb(id("pr_stay")), ifVersion: null },
			{ op: "set", name: leaves, toFolder: goes, sourceText: fb(id("pr_leave")), ifVersion: null },
		])).accepted).toBe(true)

		const refs = await bridge.refs()
		expect((await pushOps([{ op: "deleteItem", name: leaves, ifVersion: refs.items[leaves] }])).accepted).toBe(true)

		expect(await inhabited(goes), "the emptied child folder still holds an item").toBe(false)
		expect(await inhabited(parent), "the sibling was removed along with its neighbour").toBe(true)
	})
})
