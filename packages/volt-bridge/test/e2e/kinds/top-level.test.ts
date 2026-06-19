/** Top-level kinds the lifecycle doesn't fully cover: function/alias type fidelity, interface, folders.
 *  (The CRUD lifecycle already asserts kind for fb/prog/gvl/struct/enum/union/alias.) */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, setDefaultTimeout } from "bun:test"
import { bridge, id, fid, cleanup, requireHealthy, createItem, fetchItem, fetchSource, ensureCompiles, savePlcPrg, restorePlcPrg, fixPlcPrg, FOLDER, BASE } from "../harness"
import { func, aliasDut, iface, fb } from "../fixtures"

describe(`kinds / top-level (${BASE})`, () => {
	setDefaultTimeout(60_000)
	beforeAll(async () => { await requireHealthy() })
	beforeEach(async () => { await fixPlcPrg(); await cleanup(); await savePlcPrg() })
	afterEach(async () => { await restorePlcPrg() })
	afterAll(cleanup)

	// function create: works on CODESYS; on TwinCAT it needs the omitted-vInfo create (see vendor-notes).
	it("creates a function with a non-INT return type that survives (WriteText corrects the create seed)", async () => {
		const name = id("k_func"), wire = fid("k_func")
		await createItem(wire, func(name))
		const item = await fetchItem(wire)
		expect(item.sourceText).toMatch(/FUNCTION \w+ : BOOL/)
	})

	it("creates an alias with a non-INT base type that survives", async () => {
		const name = id("k_alias"), wire = fid("k_alias", "alias")
		await createItem(wire, aliasDut(name))
		const item = await fetchItem(wire)
		expect(item.sourceText).toContain("DWORD")
	})

	it("creates an empty interface", async () => {
		const name = id("k_iface"), wire = fid("k_iface", "itf")
		await createItem(wire, iface(name))
		expect(await fetchSource(wire)).toContain("INTERFACE")
	})

	// Interface members test declaration-only method + property create + round-trip.
	it("interface with a method + property (members inside the block)", async () => {
		const name = id("k_iface_m"), wire = fid("k_iface_m", "itf")
		await createItem(wire, iface(name, `METHOD DoIt : INT\nEND_METHOD\nPROPERTY Ready : BOOL\nGET\nEND_GET\nEND_PROPERTY\n`))
		const s = await fetchSource(wire)
		expect(s).toContain("METHOD DoIt"); expect(s).toContain("PROPERTY Ready")
	})

	it("creates at the project root and in a nested folder", async () => {
		const root = id("k_root"), nested = id("k_nested")
		const rootWire = fid("k_root"), nestedWire = fid("k_nested")
		await createItem(rootWire, fb(root), "")
		await ensureCompiles(root)
		await createItem(nestedWire, fb(nested), "POUs/Sub/Deep")
		await ensureCompiles(nested)
		expect((await fetchItem(rootWire)).folder ?? "").toBe("")
		expect((await fetchItem(nestedWire)).folder).toBe("POUs/Sub/Deep")
	})
})
