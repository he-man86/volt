/**
 * A REFUSED OP'S CONFLICT STATES IN FIELDS WHAT OF IT THE IDE KEPT — live (openspec `push-partially-applied-flag`,
 * task 3.1).
 *
 * <p>`push-keeps-what-landed` made the reason SAY what of a refused op stays; this change puts the same fact in fields
 * (`partiallyApplied`, `renamedTo`, `remains`) so a client branches on them and never parses the prose. The offline twin
 * is `Volt.Engine.Tests/sync/PartiallyAppliedFieldsTests.cs`; this file proves the live IDE's refusal reaches them. Each
 * field claim is checked against the IDE itself: `partiallyApplied` is asserted together with a refs re-read showing the
 * item DID change (or moved), so a field that lies cannot pass.</p>
 *
 * <p>The refused member is `Vlt__Log` — a `__` inside a word that no pre-flight list holds, so the push sends it and the
 * live IDE refuses it at apply (the same word `push-keeps-what-landed.test.ts` uses for its apply-time refusal). The
 * "nothing stays" side (a rolled-back create, a pre-flight refusal) is pinned there, on the same pushes.</p>
 *
 * <p>Runs on BOTH vendors, unmodified: measured green live on CODESYS SP21 Patch 4 and on TwinCAT (Project13 copy),
 * 2026-10-04 (gate 3). Both refuse `Vlt__Log` at apply (TwinCAT: `CreateChild` "Name mismatch") after the declaration
 * was written, and the shared engine words the kept part identically. What a rename does to the item's own text was the
 * one vendor difference (DIALECT C2o); the push now puts back everything but the header, so the last test asserts one
 * answer on both (openspec bridge-refusal-review 8.4).</p>
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { id, fid, bridge, requireHealthy, pushOps, cleanup, plcFolder, fetchItem, FOLDER, BASE } from "../harness"
import { fb, MARK } from "../fixtures"

describe(`endpoints / push partially applied (${BASE})`, () => {
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

	const REFUSED_AT_APPLY = "Vlt__Log"
	const refusedMethod = `\nMETHOD ${REFUSED_AT_APPLY} : BOOL\nVAR_INPUT\n\tmsg : STRING;\nEND_VAR\n${MARK}\n${REFUSED_AT_APPLY} := TRUE;\nEND_METHOD\n`
	const newDecl = "VAR\n\tx : INT;\n\tpaAdded : BOOL;\nEND_VAR"

	it("an update refused on a new member after its declaration was written: partiallyApplied, and the IDE holds the new declaration", async () => {
		const bare = id("pa_upd"), name = fid("pa_upd")
		const folder = await plcFolder(FOLDER)
		const created = await pushOps([{ op: "set", name, toFolder: folder, sourceText: fb(bare), ifVersion: null }])
		expect(created.accepted, `the FB to update was not created: ${JSON.stringify(created.conflicts)}`).toBe(true)
		const before = (await bridge.refs()).items ?? {}
		expect(before[name]).toBeDefined()

		const r = await pushOps([
			{ op: "set", name, sourceText: fb(bare, { vars: newDecl, children: refusedMethod }), ifVersion: before[name] },
		])
		console.log("[push-partially-applied 3.1] update response:", JSON.stringify({ accepted: r.accepted, conflicts: r.conflicts }))

		const conflicts = r.conflicts ?? []
		expect(conflicts.map((c: any) => c.name), `the IDE took METHOD ${REFUSED_AT_APPLY}, or refused something else: ${JSON.stringify(conflicts)}`).toEqual([name])
		const c = conflicts[0]
		expect(c.code).toBe("UNSUPPORTED")
		expect(c.reason, "the reason no longer says the declaration stays").toContain(`the declaration of '${bare}' was written before it and stays`)
		expect(c.partiallyApplied, "the declaration stays, but the conflict does not say partiallyApplied").toBe(true)
		expect(c.renamedTo, "nothing was renamed").toBeUndefined()
		expect(c.remains, "nothing was created").toBeUndefined()

		// The field is the IDE's truth: the item is still there under its name, and it changed.
		const after = (await bridge.refs()).items ?? {}
		expect(after[name], "the refused update removed the item").toBeDefined()
		expect(after[name], "partiallyApplied, but the IDE's item is unchanged").not.toBe(before[name])
		const fetched = await bridge.fetch({ onlyItems: [name] })
		const text = JSON.stringify(fetched)
		expect(text, "the declaration the conflict says stays is not in the IDE").toContain("paAdded")
		expect(text, `METHOD ${REFUSED_AT_APPLY} is in the IDE although it was refused`).not.toContain(REFUSED_AT_APPLY)
	})

	it("a rename that ran before the refusal: partiallyApplied and renamedTo the FULL new name, which is where the IDE holds the item", async () => {
		const from = fid("pa_rnA"), toBare = id("pa_rnB"), to = fid("pa_rnB")
		const folder = await plcFolder(FOLDER)
		const created = await pushOps([{ op: "set", name: from, toFolder: folder, sourceText: fb(id("pa_rnA")), ifVersion: null }])
		expect(created.accepted, `the FB to rename was not created: ${JSON.stringify(created.conflicts)}`).toBe(true)
		const before = (await bridge.refs()).items ?? {}
		expect(before[to], `the project already holds ${to}`).toBeUndefined()

		const r = await pushOps([
			{ op: "set", name: from, toName: to, sourceText: fb(toBare, { children: refusedMethod }), ifVersion: before[from] },
		])
		console.log("[push-partially-applied 1.2 live] rename response:", JSON.stringify({ accepted: r.accepted, conflicts: r.conflicts }))

		const conflicts = r.conflicts ?? []
		expect(conflicts.map((c: any) => c.name), `the IDE took METHOD ${REFUSED_AT_APPLY}, or refused something else: ${JSON.stringify(conflicts)}`).toEqual([from])
		const c = conflicts[0]
		expect(c.code).toBe("UNSUPPORTED")
		expect(c.reason, "the reason no longer says the rename stays").toContain("stays renamed")
		expect(c.partiallyApplied, "the rename stays, but the conflict does not say partiallyApplied").toBe(true)
		expect(c.renamedTo, "renamedTo is not the FULL name the item now has").toBe(to)
		expect(c.remains).toBeUndefined()

		const after = (await bridge.refs()).items ?? {}
		expect(after[from], "renamedTo is set, but the item is still under its old name").toBeUndefined()
		expect(after[to], "renamedTo names an item the IDE does not hold").toBeDefined()
	})

	// FOUND BY THE TEST ABOVE (2026-10-04): its first live run answered STALE_ITEM_VERSION, not the member refusal —
	// "'VltE2E_pa_rnB' changed in the IDE while this push was being applied" — and a rename+edit with NO refused member
	// answered the same. The last-moment check compared the client's pre-rename version with the item after the native
	// rename, which rewrites the item's own header; so every rename+edit of a POU (what `volt push` sends for a renamed and
	// edited file) was refused after the rename had run. The check now runs before the rename (offline twin:
	// `RenameBeforeWriteTests.A_rename_and_edit_lands_although_the_rename_rewrote_the_items_own_header`).
	it("a rename+edit with its version lands: the rename's rewrite of the item's own header is not a concurrent edit", async () => {
		const from = fid("pa_reA"), to = fid("pa_reB")
		const folder = await plcFolder(FOLDER)
		const created = await pushOps([{ op: "set", name: from, toFolder: folder, sourceText: fb(id("pa_reA")), ifVersion: null }])
		expect(created.accepted, `the FB to rename was not created: ${JSON.stringify(created.conflicts)}`).toBe(true)
		const before = (await bridge.refs()).items ?? {}

		const r = await pushOps([
			{ op: "set", name: from, toName: to, sourceText: fb(id("pa_reB"), { body: "x := x + 2;" }), ifVersion: before[from] },
		])
		expect(r.conflicts, `a rename+edit was refused: ${JSON.stringify(r.conflicts)}`).toBeUndefined()
		expect(r.accepted).toBe(true)
		const after = (await bridge.refs()).items ?? {}
		expect(after[from]).toBeUndefined()
		expect(after[to]).toBeDefined()
		expect(r.newItems?.[to]).toBe(after[to])
		expect(JSON.stringify(await bridge.fetch({ onlyItems: [to] })), "the edit did not land").toContain("x := x + 2;")
	})

	// THE LAST-MOMENT CHECK OF A MOVE (gate review of step 3) now runs before the rename and the move, against the item's
	// CURRENT folder — a rename+move+edit with its version must still land (a move+edit alone: push.test.ts).
	it("a rename+move+edit with its version lands: checked once, before anything of the op", async () => {
		const from = fid("pa_rmA"), to = fid("pa_rmB")
		const created = await pushOps([{ op: "set", name: from, toFolder: "", sourceText: fb(id("pa_rmA")), ifVersion: null }])
		expect(created.accepted, `the FB to rename was not created: ${JSON.stringify(created.conflicts)}`).toBe(true)
		const before = await bridge.refs()
		const folder = await plcFolder(FOLDER)
		expect(before.folders?.[from], "premise: the item starts outside the destination").not.toBe(folder)

		const r = await pushOps([
			{ op: "set", name: from, toName: to, toFolder: folder, sourceText: fb(id("pa_rmB"), { body: "x := x + 3;" }), ifVersion: before.items[from] },
		])
		expect(r.conflicts, `a rename+move+edit was refused: ${JSON.stringify(r.conflicts)}`).toBeUndefined()
		const after = await bridge.refs()
		expect(after.items[from]).toBeUndefined()
		expect(after.folders[to]).toBe(folder)
		expect((await fetchItem(to)).sourceText, "the edit did not land").toContain("x := x + 3;")
	})

	// WHAT A RENAME DOES TO THE ITEM'S OWN TEXT: its header, and nothing else — on both vendors. TwinCAT's native rename
	// also rewrites the item's own code references (DIALECT C2o) and the push puts them back (openspec bridge-refusal-review
	// 8.4: a push changes exactly what it names). A rename-only op (no sourceText): the text is the pre-push fetch with the
	// header renamed, byte for byte.
	it("a rename changes only the item's header, on both vendors", async () => {
		const fnA = id("pa_selfFnA"), fnB = id("pa_selfFnB")
		const fbA = id("pa_selfFbA"), fbB = id("pa_selfFbB")
		const folder = await plcFolder(FOLDER)
		const fnSrc = `// ${fnA} helper\nFUNCTION ${fnA} : BOOL\nVAR_INPUT\n\ta : INT;\nEND_VAR\n${MARK}\n// sets ${fnA}\n${fnA} := a > 0;\nEND_FUNCTION\n`
		const fbSrc = `// ${fbA} helper\nFUNCTION_BLOCK ${fbA}\nVAR\n\tpSelf : POINTER TO ${fbA};\n\tx : INT;\nEND_VAR\n${MARK}\nx := x + 1;\nEND_FUNCTION_BLOCK\n`
		const created = await pushOps([
			{ op: "set", name: fid("pa_selfFnA"), toFolder: folder, sourceText: fnSrc, ifVersion: null },
			{ op: "set", name: fid("pa_selfFbA"), toFolder: folder, sourceText: fbSrc, ifVersion: null },
		])
		expect(created.accepted, `the items to rename were not created: ${JSON.stringify(created.conflicts)}`).toBe(true)
		const before = (await bridge.refs()).items ?? {}

		const fnBefore = (await fetchItem(fid("pa_selfFnA"))).sourceText as string
		const fbBefore = (await fetchItem(fid("pa_selfFbA"))).sourceText as string
		const r = await pushOps([
			{ op: "set", name: fid("pa_selfFnA"), toName: fid("pa_selfFnB"), ifVersion: before[fid("pa_selfFnA")] },
			{ op: "set", name: fid("pa_selfFbA"), toName: fid("pa_selfFbB"), ifVersion: before[fid("pa_selfFbA")] },
		])
		expect(r.conflicts, `a rename was refused: ${JSON.stringify(r.conflicts)}`).toBeUndefined()
		const fn = (await fetchItem(fid("pa_selfFnB"))).sourceText as string
		const fbText = (await fetchItem(fid("pa_selfFbB"))).sourceText as string
		console.log("[push-partially-applied gate 3] renamed FUNCTION:\n" + fn + "\n[renamed FUNCTION_BLOCK]:\n" + fbText)

		expect(fn).toBe(fnBefore.replace(`FUNCTION ${fnA} : BOOL`, `FUNCTION ${fnB} : BOOL`))
		expect(fbText).toBe(fbBefore.replace(`FUNCTION_BLOCK ${fbA}\n`, `FUNCTION_BLOCK ${fbB}\n`))
		expect(fn, "premise: the return assignment names the old name").toContain(`${fnA} := a > 0;`)
	})
})

