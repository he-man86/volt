/** Top-level kinds the lifecycle doesn't fully cover: function/alias type fidelity, interface, folders.
 *  (The CRUD lifecycle already asserts kind for fb/prog/gvl/struct/enum/union/alias.) */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "bun:test"
import { bridge, id, cleanup, requireHealthy, createItem, fetchItem, fetchSource, ensureCompiles, savePlcPrg, restorePlcPrg, fixPlcPrg, isTwinCAT, FOLDER, BASE } from "../harness"
import { func, aliasDut, iface, fb } from "../fixtures"

describe(`kinds / top-level (${BASE})`, () => {
	beforeAll(async () => { await requireHealthy() })
	beforeEach(async () => { await fixPlcPrg(); await cleanup(); await savePlcPrg() })
	afterEach(async () => { await restorePlcPrg() })
	afterAll(cleanup)

	// function create: works on CODESYS; on TwinCAT it needs the omitted-vInfo create (see vendor-notes).
	it("creates a function with a non-INT return type that survives (WriteText corrects the create seed)", async () => {
		const name = id("k_func")
		await createItem(name, func(name))
		const item = await fetchItem(name)
		expect(item.sourceText).toMatch(/FUNCTION \w+ : BOOL/)
	})

	it("creates an alias with a non-INT base type that survives", async () => {
		const name = id("k_alias")
		await createItem(name, aliasDut(name))
		const item = await fetchItem(name)
		expect(item.sourceText).toContain("DWORD")
	})

	it("creates an empty interface", async () => {
		const name = id("k_iface")
		await createItem(name, iface(name))
		expect(await fetchSource(name)).toContain("INTERFACE")
	})

	// Interface members crash TwinCAT (interface members are declaration-only; the materializer's
	// implementation read kills the COM channel — see memory). Works on CODESYS.
	it("interface with a method + property (members inside the block)", async () => {
		if (await isTwinCAT()) { console.warn("TC: interface-member create crashes the COM channel — skipping (see memory)"); return }
		const name = id("k_iface_m")
		await createItem(name, iface(name, `METHOD DoIt : INT\nEND_METHOD\nPROPERTY Ready : BOOL\nGET\nEND_GET\nEND_PROPERTY\n`))
		const s = await fetchSource(name)
		expect(s).toContain("METHOD DoIt"); expect(s).toContain("PROPERTY Ready")
	})

	it("creates at the project root and in a nested folder", async () => {
		const root = id("k_root"), nested = id("k_nested")
		await createItem(root, fb(root), "")
		await ensureCompiles(root)
		await createItem(nested, fb(nested), "POUs/Sub/Deep")
		await ensureCompiles(nested)
		expect((await fetchItem(root)).folder ?? "").toBe("")
		expect((await fetchItem(nested)).folder).toBe("POUs/Sub/Deep")
	})
})
