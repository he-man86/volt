/**
 * A PUSH SAYS EXACTLY WHAT LANDED — live (openspec `push-keeps-what-landed`, tasks 1.1 / 1.2 / 4.1).
 *
 * <p>The PLCAssist repro (CODESYS 3.5.21.40, 2026-10-01): one push of `[enum DUT, struct DUT, FB whose METHOD is named
 * Log]`. `Log` is the IEC standard function LOG and only the LIVE IDE refuses it as a member name, so the refusal comes
 * from the apply loop after the two DUTs were written. The answer was `accepted:false` with what landed only as a count
 * in prose ("NOTE: 2 of 3 item(s) were already written … Run `volt pull` …") and no receipt, so the client re-sent the
 * whole batch and its DUT creates then failed ITEM_EXISTS.</p>
 *
 * <p>BOTH VENDORS refuse the name (measured 2026-10-03, gate step 1): CODESYS SP21 "The name 'Log' is not valid for this
 * object.", TcXaeShell "Creating the child named 'Log' is not possible on node (Name mismatch)" — each rolled back, each
 * reaching the client as INTERNAL_ERROR because neither driver's ChildRefusal knew the wording. So the test runs
 * ungated on both, and pins the code (UNSUPPORTED) and the rollback in the reason, not only the conflict's name.</p>
 *
 * <p>Task 3.1 moved every word an IDE was measured to refuse (`Log` among them) into the pre-flight: `METHOD Log` is now
 * refused before the first write, and the apply-time test uses a word no probe asked that the IDE still refuses.</p>
 *
 * <p>What is built: an apply-time stop is `accepted:true` + the receipt + a conflict per op that did not land; a
 * refused create leaves nothing; a pre-flight refusal still writes nothing but names EVERY refused op. The offline twin
 * is `Volt.Engine.Tests/sync/PushKeepsWhatLandedTests.cs`.</p>
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { id, fid, bridge, requireHealthy, pushOps, cleanup, plcFolder, FOLDER, BASE } from "../harness"
import { fb, enumDut, structDut, prog, MARK } from "../fixtures"

describe(`endpoints / push keeps what landed (${BASE})`, () => {
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

	const CLIENT_ADVICE = ["volt pull", "Pull first", "pull first", "push again", "--force", "NOTE:"]
	// A name the IDE refuses that NO probe asked (task 3.1). `Log` is refused by the pre-flight now (the test below), so
	// the apply-time path needs a word outside the drivers' measured lists: `a__b` was refused on both vendors, and
	// `Vlt__Log` (a `__` inside a word) was never asked — the push sends it, and the IDE refuses it.
	const REFUSED_AT_APPLY = "Vlt__Log"

	it("an IDE refusal of a METHOD name at apply after two DUT creates: accepted, the DUTs in the receipt, the FB the only conflict, no shell", async () => {
		const enumName = fid("pk_E", "dut"), structName = fid("pk_ST", "dut"), fbName = fid("pk_FB")
		const folder = await plcFolder(FOLDER)
		const before = (await bridge.refs()).items ?? {}
		for (const n of [enumName, structName, fbName]) expect(before[n], `the project already holds ${n}`).toBeUndefined()

		const logMethod = `\nMETHOD ${REFUSED_AT_APPLY} : BOOL\nVAR_INPUT\n\tmsg : STRING;\nEND_VAR\n${MARK}\n${REFUSED_AT_APPLY} := TRUE;\nEND_METHOD\n`
		const r = await pushOps([
			{ op: "set", name: enumName, toFolder: folder, sourceText: enumDut(id("pk_E")), ifVersion: null },
			{ op: "set", name: structName, toFolder: folder, sourceText: structDut(id("pk_ST")), ifVersion: null },
			{ op: "set", name: fbName, toFolder: folder, sourceText: fb(id("pk_FB"), { children: logMethod }), ifVersion: null },
		])
		// THE MEASUREMENT, printed whole so a run records today's answer (task 1.1 re-measures it live).
		console.log("[push-keeps-what-landed 1.1] response:", JSON.stringify({ ...r, newItems: r.newItems && Object.keys(r.newItems).filter((n) => n.includes("pk_")), newFolders: undefined }))

		const after = (await bridge.refs()).items ?? {}
		console.log("[push-keeps-what-landed 1.1] refs after:", JSON.stringify(Object.keys(after).filter((n) => n.includes("pk_"))))

		// What the IDE holds.
		expect(after[enumName], "the enum DUT before the refused op did not land").toBeDefined()
		expect(after[structName], "the struct DUT before the refused op did not land").toBeDefined()
		expect(after[fbName], "the refused FB create left its shell in the project").toBeUndefined()

		// What the response says about it.
		const conflicts = r.conflicts ?? []
		expect(conflicts.map((c: any) => c.name), `the IDE took METHOD ${REFUSED_AT_APPLY}, or refused something else: ${JSON.stringify(conflicts)}`).toEqual([fbName])
		expect(r.accepted, "two items landed, but the push answered accepted:false").toBe(true)
		// THE CODE AND WHAT OF THE OP THE IDE KEPT (gate step 1 review). Measured 2026-10-03: INTERNAL_ERROR ("a fault
		// nobody classified") and no word of the rollback — CodesysDriver.ChildRefusal knew only "is not accepted by
		// parent object", so "The name 'Log' is not valid for this object." skipped MemberRefusal. A vendor refusing a
		// member by its name is UNSUPPORTED, as its refusal by kind (DIALECT C2k) is; the CLI picks its advice by code.
		expect(conflicts[0].code, `the IDE's refusal of METHOD ${REFUSED_AT_APPLY} reached the client unclassified: ${conflicts[0].reason}`).toBe("UNSUPPORTED")
		expect(conflicts[0].reason, "the reason does not say the refused create was rolled back").toContain(
			`'${fbName.replace(/\.pou$/, "")}' is not created (the create is rolled back)`,
		)
		for (const advice of CLIENT_ADVICE) expect(conflicts[0].reason, `the reason carries the client instruction '${advice}'`).not.toContain(advice)
		// Rolled back: nothing of the op stays, so no field says otherwise (openspec `push-partially-applied-flag` 3.1).
		expect(conflicts[0].partiallyApplied, "a rolled-back create claims partiallyApplied").toBeUndefined()
		expect(conflicts[0].remains, "a rolled-back create claims it remains").toBeUndefined()
		expect(conflicts[0].renamedTo).toBeUndefined()

		// The receipt IS the next refs, as on every accepted push.
		expect(r.newProjectVersion).toBe((await bridge.refs()).projectVersion)
		expect(r.newItems?.[enumName]).toBe(after[enumName])
		expect(r.newItems?.[structName]).toBe(after[structName])
		expect(r.newItems?.[fbName]).toBeUndefined()
	})

	it("METHOD Log, a name the IDE was measured to refuse, is refused by the pre-flight and nothing is written (task 3.1)", async () => {
		const enumName = fid("pk_E2", "dut"), fbName = fid("pk_FB2")
		const folder = await plcFolder(FOLDER)
		const before = (await bridge.refs()).items ?? {}

		const logMethod = `\nMETHOD Log : BOOL\nVAR_INPUT\n\tmsg : STRING;\nEND_VAR\n${MARK}\nLog := TRUE;\nEND_METHOD\n`
		const r = await pushOps([
			{ op: "set", name: enumName, toFolder: folder, sourceText: enumDut(id("pk_E2")), ifVersion: null },
			{ op: "set", name: fbName, toFolder: folder, sourceText: fb(id("pk_FB2"), { children: logMethod }), ifVersion: null },
		])
		console.log("[push-keeps-what-landed 3.1] response:", JSON.stringify({ accepted: r.accepted, conflicts: r.conflicts }))

		const after = (await bridge.refs()).items ?? {}
		const added = Object.keys(after).filter((n) => before[n] === undefined)
		expect(added, `a push refused before the first write wrote ${added.join(", ")} into the project`).toEqual([])
		expect(r.accepted).toBe(false)
		const conflicts = r.conflicts ?? []
		expect(conflicts.map((c: any) => c.name)).toEqual([fbName])
		expect(conflicts[0].code).toBe("UNSUPPORTED")
		expect(conflicts[0].reason).toContain("method 'Log'")
		// Refused before the first write: nothing stays (openspec `push-partially-applied-flag` 3.1).
		expect(conflicts[0].partiallyApplied, "a pre-flight refusal claims partiallyApplied").toBeUndefined()
	})

	it("a pre-flight batch with two INVALID_ST items names both and writes nothing", async () => {
		const good1 = fid("pk_good1"), bad1 = fid("pk_bad1"), bad2 = fid("pk_bad2"), good2 = fid("pk_good2")
		const folder = await plcFolder(FOLDER)
		const before = (await bridge.refs()).items ?? {}

		const r = await pushOps([
			{ op: "set", name: good1, toFolder: folder, sourceText: prog(id("pk_good1")), ifVersion: null },
			{ op: "set", name: bad1, toFolder: folder, sourceText: "not a POU at all", ifVersion: null },
			{ op: "set", name: bad2, toFolder: folder, sourceText: "not a POU either", ifVersion: null },
			{ op: "set", name: good2, toFolder: folder, sourceText: prog(id("pk_good2")), ifVersion: null },
		])
		console.log("[push-keeps-what-landed 1.2] response:", JSON.stringify({ accepted: r.accepted, conflicts: r.conflicts }))

		const after = (await bridge.refs()).items ?? {}
		const added = Object.keys(after).filter((n) => before[n] === undefined)
		expect(added, `a REFUSED push wrote ${added.join(", ")} into the project`).toEqual([])
		expect(r.accepted).toBe(false)
		const named = (r.conflicts ?? []).map((c: any) => c.name).sort()
		expect(named, "the pre-flight did not name every malformed item").toEqual([bad1, bad2].sort())
		for (const c of r.conflicts ?? []) expect(c.code).toBe("INVALID_ST")
	})
})
