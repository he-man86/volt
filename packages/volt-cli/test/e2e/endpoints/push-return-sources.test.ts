/**
 * THE PUSH ANSWER HOLDS WHAT A FETCH GIVES — live (openspec `st-roundtrip-fixed-point`, task 4.1).
 *
 * <p>With `returnSources: true` an accepted push answers `newSources`: full wire name → the item's stored text as a
 * fetch returns it, for every item the push changed. The offline twin is
 * `Volt.Engine.Tests/sync/PushReturnsSourcesTests.cs`, which compares against a fetch on the FakeIde; this file
 * compares against a LIVE fetch of the same IDE, never against a canned canonical text — the fake's canonical form
 * is StWriter + fake, and only the IDE says what the IDE stores.</p>
 *
 * <p>Every test goes through one rule check, `holdsWhatAFetchGives`, for EVERY entry of the answer: its text equals a
 * live fetch's `sourceText` byte for byte, its key is in `newItems`, and its `newItems` version equals the live refs
 * version. The cases then go rule by rule through the `NewSources` contract (PushModels.cs): created FB with members
 * (the census's W1 shape), GVL + struct + enum DUT, update, rename+edit (new name), rename-only (the IDE rewrites the
 * header and nothing else, on both vendors — DIALECT C2o), move-only (the move landed), a rename answers exactly the
 * renamed items and leaves a caller as it was, and a caller sent with the rename holds the text sent (DIALECT C2p; the
 * push puts back what TwinCAT's rename touched beyond what it names — openspec bridge-refusal-review 8.4), only changed
 * items answered, no flag → absent, delete → no entry, a refused op →
 * no entry, an op named in another case → the IDE's spelling.</p>
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { id, fid, bridge, requireHealthy, cleanup, plcFolder, fetchSource, FOLDER, BASE } from "../harness"
import { fb, func, gvl, structDut, enumDut, MARK } from "../fixtures"

/** The census's W1: the body runs straight into END_FUNCTION_BLOCK, and the PROPERTY is written before the ACTION. */
const w1 = (n: string) =>
	`FUNCTION_BLOCK ${n}\nVAR_INPUT\n\txEnable : BOOL;\nEND_VAR\nVAR\n\txRunning : BOOL;\nEND_VAR\n${MARK}\nxRunning := xEnable;\nEND_FUNCTION_BLOCK\n` +
	`\nPROPERTY Running : BOOL\nGET\n${MARK}\nRunning := xRunning;\nEND_GET\nEND_PROPERTY\n` +
	`\nACTION Stop\n${MARK}\nxRunning := FALSE;\nEND_ACTION\n`

/** `returnSources` "omit" sends no flag at all (an explicit `undefined` would take a default, so it is spelt out). */
async function push(ops: unknown[], returnSources: boolean | "omit" = true): Promise<any> {
	const req: any = { expectedProjectVersion: (await bridge.refs()).projectVersion, ops }
	if (returnSources !== "omit") req.returnSources = returnSources
	return bridge.push(req)
}

/** The rule every answer obeys: each entry is what a live fetch gives, under a `newItems` key whose version is the
 *  IDE's current one. Returns the entries for the case's own assertions. */
async function holdsWhatAFetchGives(r: any): Promise<Record<string, string>> {
	expect(r.accepted, `push rejected: ${JSON.stringify(r.conflicts ?? r)}`).toBe(true)
	const sources: Record<string, string> = r.newSources ?? {}
	const refs = (await bridge.refs()).items ?? {}
	for (const [name, text] of Object.entries(sources)) {
		expect(r.newItems?.[name], `newSources has '${name}', newItems does not`).toBeDefined()
		expect(r.newItems[name], `newItems version of '${name}' is not the IDE's`).toBe(refs[name])
		expect(text, `newSources['${name}'] is not what a fetch gives`).toBe(await fetchSource(name))
	}
	return sources
}

describe(`endpoints / push returns sources (${BASE})`, () => {
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

	it("W1 created: the answer is the fetched text (blank line before END, ACTION before PROPERTY), not the pushed one", async () => {
		const bare = id("rs_w1"), name = fid("rs_w1")
		const pushed = w1(bare)
		const r = await push([{ op: "set", name, toFolder: await plcFolder(FOLDER), sourceText: pushed, ifVersion: null }])
		const s = await holdsWhatAFetchGives(r)
		const text = s[name]
		expect(text, "no newSources entry for the created FB").toBeDefined()
		console.log("[push-return-sources 4.1] W1 answered:\n" + text)
		expect(text).not.toBe(pushed)
		// The census's patch: a search spanning the end of the body, taken from what the client now holds, matches the IDE.
		expect(text).toContain("xRunning := xEnable;\n\nEND_FUNCTION_BLOCK")
		expect(text.indexOf("ACTION Stop")).toBeLessThan(text.indexOf("PROPERTY Running"))
		expect(Object.keys(s), "an item the push did not change was answered").toEqual([name])
	})

	it("a GVL, a struct and an enum DUT in one push: each answered as a fetch gives it", async () => {
		const g = fid("rs_g", "gvl"), st = fid("rs_st", "dut"), en = fid("rs_en", "dut")
		const folder = await plcFolder(FOLDER)
		const r = await push([
			{ op: "set", name: g, toFolder: folder, sourceText: gvl(id("rs_g")), ifVersion: null },
			{ op: "set", name: st, toFolder: folder, sourceText: structDut(id("rs_st")), ifVersion: null },
			{ op: "set", name: en, toFolder: folder, sourceText: enumDut(id("rs_en")), ifVersion: null },
		])
		const s = await holdsWhatAFetchGives(r)
		expect(Object.keys(s).sort()).toEqual([en, g, st].sort())
	})

	it("an update: answered; no flag → no newSources; false → no newSources", async () => {
		const bare = id("rs_up"), name = fid("rs_up")
		const created = await push([{ op: "set", name, toFolder: await plcFolder(FOLDER), sourceText: fb(bare), ifVersion: null }], "omit")
		expect(created.accepted).toBe(true)
		expect(created.newSources, "newSources without the flag").toBeUndefined()

		const v1 = (await bridge.refs()).items[name]
		const off = await push([{ op: "set", name, sourceText: fb(bare, { body: "x := x + 5;" }), ifVersion: v1 }], false)
		expect(off.accepted).toBe(true)
		expect(off.newSources, "newSources with returnSources: false").toBeUndefined()

		const v2 = (await bridge.refs()).items[name]
		const r = await push([{ op: "set", name, sourceText: fb(bare, { body: "x := x + 6;" }), ifVersion: v2 }])
		const s = await holdsWhatAFetchGives(r)
		expect(s[name]).toContain("x := x + 6;")
	})

	it("rename+edit: answered under the NEW name, the old one absent", async () => {
		const from = fid("rs_reA"), to = fid("rs_reB")
		const created = await push([{ op: "set", name: from, toFolder: await plcFolder(FOLDER), sourceText: fb(id("rs_reA")), ifVersion: null }])
		expect(created.accepted).toBe(true)
		const v = (await bridge.refs()).items[from]
		const r = await push([{ op: "set", name: from, toName: to, sourceText: fb(id("rs_reB"), { body: "x := x + 7;" }), ifVersion: v }])
		const s = await holdsWhatAFetchGives(r)
		expect(s[to]).toContain("x := x + 7;")
		expect(s[from]).toBeUndefined()
	})

	it("rename-only (no text): answered under the new name with the header the IDE rewrote", async () => {
		const from = fid("rs_roA"), to = fid("rs_roB")
		const created = await push([{ op: "set", name: from, toFolder: await plcFolder(FOLDER), sourceText: fb(id("rs_roA")), ifVersion: null }])
		expect(created.accepted).toBe(true)
		const v = (await bridge.refs()).items[from]
		const r = await push([{ op: "set", name: from, toName: to, ifVersion: v }])
		const s = await holdsWhatAFetchGives(r)
		expect(s[to], "a rename-only op has no entry").toBeDefined()
		expect(s[to]).toContain(`FUNCTION_BLOCK ${id("rs_roB")}`)
	})

	// A rename-only push of a FUNCTION whose body assigns its own name: the header is renamed and the return assignment
	// keeps the old name, on both vendors (DIALECT C2o: TwinCAT's rename rewrites it, and the push puts it back).
	it("rename-only of a FUNCTION: only the header is renamed (DIALECT C2o, both vendors)", async () => {
		const from = fid("rs_rfA"), to = fid("rs_rfB"), a = id("rs_rfA"), b = id("rs_rfB")
		const created = await push([{ op: "set", name: from, toFolder: await plcFolder(FOLDER), sourceText: func(a), ifVersion: null }])
		expect(created.accepted, JSON.stringify(created.conflicts)).toBe(true)
		const v = (await bridge.refs()).items[from]
		const r = await push([{ op: "set", name: from, toName: to, ifVersion: v }])
		const s = await holdsWhatAFetchGives(r)
		const text = s[to]
		expect(text, "a rename-only op has no entry").toBeDefined()
		console.log("[push-return-sources gate 4] renamed FUNCTION answered:\n" + text)
		expect(text).toContain(`FUNCTION ${b} : BOOL`)
		expect(text, "the return assignment does not keep the old name").toContain(`${a} := a > 0;`)
	})

	// A PUSH CHANGES EXACTLY THE ITEMS IT NAMES (openspec bridge-refusal-review 8.4): a rename answers the renamed items
	// and nothing else, and a caller that names them keeps its text and its version — on both vendors (DIALECT C2p:
	// TwinCAT's native rename rewrites the caller, and the push puts it back).
	async function renameFixture(tag: string) {
		const names = { fbA: id(`rs_${tag}A`), fbB: id(`rs_${tag}B`), fnA: id(`rs_${tag}F`), fnB: id(`rs_${tag}G`), p: id(`rs_${tag}P`) }
		const folder = await plcFolder(FOLDER)
		const created = await push([
			{ op: "set", name: fid(`rs_${tag}A`), toFolder: folder, sourceText: fb(names.fbA), ifVersion: null },
			{ op: "set", name: fid(`rs_${tag}F`), toFolder: folder, sourceText: func(names.fnA), ifVersion: null },
			{ op: "set", name: fid(`rs_${tag}P`), toFolder: folder, sourceText: `PROGRAM ${names.p}\nVAR\n\tinst : ${names.fbA}; (* an ${names.fbA} *)\n\tok : BOOL;\nEND_VAR\n${MARK}\ninst();\nok := ${names.fnA}(a := 1); // calls ${names.fnA}\nEND_PROGRAM\n`, ifVersion: null },
		])
		expect(created.accepted, JSON.stringify(created.conflicts)).toBe(true)
		return names
	}

	it("a rename alone answers exactly the renamed items; the caller keeps its text and version", async () => {
		const n = await renameFixture("rc")
		const caller = fid("rs_rcP")
		const before = (await bridge.refs()).items
		const callerBefore = await fetchSource(caller)
		const r = await push([
			{ op: "set", name: fid("rs_rcA"), toName: fid("rs_rcB"), ifVersion: before[fid("rs_rcA")] },
			{ op: "set", name: fid("rs_rcF"), toName: fid("rs_rcG"), ifVersion: before[fid("rs_rcF")] },
		])
		const s = await holdsWhatAFetchGives(r)
		const after = (await bridge.refs()).items
		const changed = Object.keys(after).filter((k) => after[k] !== before[k]).sort()
		console.log("[push-return-sources 8.4] rename changed:", JSON.stringify(changed))
		expect(changed).toEqual([fid("rs_rcB"), fid("rs_rcG")].sort())
		expect(Object.keys(s).sort(), "newSources is not exactly the renamed items").toEqual(changed)
		expect(await fetchSource(caller), "the caller changed").toBe(callerBefore)
		expect(callerBefore).toContain(`inst : ${n.fbA};`)
	})

	it("a rename and its caller in one push: the caller holds the text sent, the callee only its header", async () => {
		const n = await renameFixture("rp")
		const caller = fid("rs_rpP")
		const before = (await bridge.refs()).items
		const calleeBefore = await fetchSource(fid("rs_rpF"))
		const sent = (await fetchSource(caller)).replace(`inst : ${n.fbA};`, `inst : ${n.fbB};`).replace(`ok := ${n.fnA}(`, `ok := ${n.fnB}(`)
		// The caller FIRST: it is written before the renames, which would rewrite its comments on TwinCAT if nothing put
		// the sent text back.
		const r = await push([
			{ op: "set", name: caller, sourceText: sent, ifVersion: before[caller] },
			{ op: "set", name: fid("rs_rpA"), toName: fid("rs_rpB"), ifVersion: before[fid("rs_rpA")] },
			{ op: "set", name: fid("rs_rpF"), toName: fid("rs_rpG"), ifVersion: before[fid("rs_rpF")] },
		])
		const s = await holdsWhatAFetchGives(r)
		expect(Object.keys(s).sort()).toEqual([caller, fid("rs_rpB"), fid("rs_rpG")].sort())
		expect(await fetchSource(caller), "the caller does not hold the text sent").toBe(sent)
		expect(await fetchSource(fid("rs_rpG"))).toBe(calleeBefore.replace(`FUNCTION ${n.fnA} : BOOL`, `FUNCTION ${n.fnB} : BOOL`))
	})

	it("move-only: answered", async () => {
		const name = fid("rs_mv")
		const created = await push([{ op: "set", name, toFolder: "", sourceText: fb(id("rs_mv")), ifVersion: null }])
		expect(created.accepted).toBe(true)
		const before = await bridge.refs()
		const folder = await plcFolder(FOLDER)
		expect(before.folders?.[name], "premise: the item starts outside the destination").not.toBe(folder)
		const r = await push([{ op: "set", name, toFolder: folder, ifVersion: before.items[name] }])
		const s = await holdsWhatAFetchGives(r)
		// The move LANDED — otherwise an entry for the unmoved item would pass the rule check just the same.
		expect(r.newFolders?.[name], "the receipt does not place the item in the destination").toBe(folder)
		expect((await bridge.refs()).folders?.[name], "the IDE did not move the item").toBe(folder)
		expect(s[name], "a move-only op has no entry").toBeDefined()
	})

	it("a delete has no entry; an op named in another case is answered under the IDE's spelling", async () => {
		const del = fid("rs_del"), keep = fid("rs_Case")
		const folder = await plcFolder(FOLDER)
		const created = await push([
			{ op: "set", name: del, toFolder: folder, sourceText: fb(id("rs_del")), ifVersion: null },
			{ op: "set", name: keep, toFolder: folder, sourceText: fb(id("rs_Case")), ifVersion: null },
		])
		expect(created.accepted).toBe(true)
		const refs = (await bridge.refs()).items
		const r = await push([
			{ op: "deleteItem", name: del, ifVersion: refs[del] },
			{ op: "set", name: keep.toLowerCase(), sourceText: fb(id("rs_Case"), { body: "x := x + 8;" }), ifVersion: refs[keep] },
		])
		const s = await holdsWhatAFetchGives(r)
		expect(s[del]).toBeUndefined()
		expect(Object.keys(s)).toEqual([keep])
		expect(s[keep]).toContain("x := x + 8;")
	})

	it("an op refused at apply has no entry; the ops that landed before it are answered", async () => {
		const ok = fid("rs_ok"), bad = fid("rs_bad"), bareBad = id("rs_bad")
		const refused = `\nMETHOD Vlt__Log : BOOL\n${MARK}\nVlt__Log := TRUE;\nEND_METHOD\n`
		const folder = await plcFolder(FOLDER)
		const created = await push([{ op: "set", name: bad, toFolder: folder, sourceText: fb(bareBad), ifVersion: null }])
		expect(created.accepted).toBe(true)
		const v = (await bridge.refs()).items[bad]
		const r = await push([
			{ op: "set", name: ok, toFolder: folder, sourceText: fb(id("rs_ok")), ifVersion: null },
			{ op: "set", name: bad, sourceText: fb(bareBad, { children: refused }), ifVersion: v },
		])
		console.log("[push-return-sources 4.1] partial:", JSON.stringify({ accepted: r.accepted, conflicts: r.conflicts, keys: Object.keys(r.newSources ?? {}) }))
		expect((r.conflicts ?? []).map((c: any) => c.name), "premise: the IDE refuses METHOD Vlt__Log at apply").toEqual([bad])
		const s = await holdsWhatAFetchGives(r)
		expect(s[ok], "the landed op has no entry").toBeDefined()
		expect(s[bad], "a refused op was answered").toBeUndefined()
	})
})
