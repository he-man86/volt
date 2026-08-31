/**
 * ROUND-TRIP PROOF for the CODESYS/TwinCAT graphical parity fixes.
 *
 * Every case here was a divergence found by diffing the two LD/FBD implementations, and every one of them had
 * offline coverage that passed on doubles or fixtures. That is not the same claim: the offline tests prove the
 * code does what it says against a stand-in, and these prove the SHAPE survives a real IDE — pushed in, pulled
 * back, byte for byte, on whichever vendor is serving this pipe.
 *
 * The suite is deliberately vendor-blind. Each test asserts the SAME text comes back on both vendors, because
 * that is the parity boundary the architecture states: "both vendors serve byte-identical responses for the
 * same project". A test that passed on one bridge and not the other would be the finding.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, setDefaultTimeout } from "bun:test"
import { bridge, id, fid, cleanup, fetchItem, requireHealthy, savePlcPrg, restorePlcPrg, fixPlcPrg, BASE } from "../harness"

setDefaultTimeout(30000)

/** Push a body, pull it back, and return what the IDE actually holds. */
async function roundTrip(fullName: string, src: string): Promise<string> {
	const refs = await bridge.refs()
	const r = await bridge.push({
		expectedProjectVersion: refs.projectVersion,
		ops: [{ op: "set", name: fullName, toFolder: "", sourceText: src, ifVersion: refs.items[fullName] ?? null }],
	})
	expect(r.accepted, `push refused: ${JSON.stringify(r.conflicts)}`).toBe(true)
	return (await fetchItem(fullName)).sourceText
}

describe(`graphical / parity fixes (${BASE})`, () => {
	beforeAll(async () => { await requireHealthy() })
	beforeEach(async () => { await fixPlcPrg(); await cleanup(); await savePlcPrg() })
	afterEach(async () => { await restorePlcPrg() })

	/**
	 * A WIRED EN PIN SURVIVES.
	 *
	 * TwinCAT read AND wrote this member as `"En"` while every archive spells it `EN` — 33 occurrences across
	 * every fixture and both real projects, zero of the other. `TcArchive.Obj` compares ordinally, so the lookup
	 * matched nothing and a wired enable was silently dropped on pull. The two halves were misspelled in
	 * agreement, which is the only reason it never surfaced as an error: the write no-opped for exactly the
	 * bodies the read could not see.
	 */
	it("a wired EN pin either round-trips exactly or is refused — never silently reshaped", async () => {
		const name = id("pf_en")
		const full = fid("pf_en", "prg")
		const src =
			`PROGRAM ${name}\nVAR\n\tgo : BOOL;\n\ta : BOOL;\n\tb : BOOL;\n\tout : BOOL;\nEND_VAR\n\n` +
			// The EN/ENO form is ONE LINE — `IF en THEN <result>; END_IF` (network-text.md §6).
			`NETWORK 0 FBD\n  LET en1 := go;\n  IF en1 THEN out := (a AND b); END_IF\nEND_NETWORK\n\n` +
			`END_PROGRAM\n`

		// VENDOR-BLIND ON PURPOSE, because this is the one capability that genuinely differs and the difference
		// is FORCED. CODESYS builds an enable natively. TwinCAT cannot: PLCopen can STATE the pin — the vendor's
		// own export writes `<variable formalParameter="EN">` — but its importer does not HONOUR it. Measured
		// live: `IF en1 THEN out := (a AND b); END_IF` came back as `out := (go AND a AND b);`, the enable folded
		// in as a third ordinary input. On an AND that is coincidentally equivalent; on any other box it changes
		// what the program does.
		//
		// So the invariant worth pinning is not "it works", it is that NEITHER vendor silently reshapes it:
		// either the body round-trips exactly, or the push is refused and says why.
		const refs = await bridge.refs()
		const r = await bridge.push({
			expectedProjectVersion: refs.projectVersion,
			ops: [{ op: "set", name: full, toFolder: "", sourceText: src, ifVersion: refs.items[full] ?? null }],
		})

		if (!r.accepted) {
			expect(JSON.stringify(r.conflicts)).toMatch(/EN\b/)
			return
		}
		expect((await fetchItem(full)).sourceText).toBe(src)
	})

	/**
	 * A STATELESS FUNCTION CALL KEEPS ITS CALLEE.
	 *
	 * CODESYS tested only that the `Instance` MEMBER was present, and the serializer writes a present-but-empty
	 * `Operand` on every box — so a default-constructed `Operand("")` read back as a function-block instance. For
	 * an operator that is harmless (it renders from the box type), but a stateless FUNCTION misses the operator
	 * table and rendered as `( := a, := b)`: no callee at all, which does not parse, so the POU could be pulled
	 * and never pushed again.
	 */
	it("a stateless function call keeps its callee", async () => {
		const name = id("pf_fn")
		const full = fid("pf_fn", "prg")
		const src =
			`PROGRAM ${name}\nVAR\n\ta : INT;\n\tb : INT;\n\tout : INT;\nEND_VAR\n\n` +
			`NETWORK 0 FBD\n  out := MAX(a, b);\nEND_NETWORK\n\n` +
			`END_PROGRAM\n`

		const back = await roundTrip(full, src)

		expect(back).toContain("MAX(")                   // the callee is named…
		expect(back).not.toMatch(/\(\s*:=/)              // …and not the headless `( := a, := b)` shape
		expect(back).toBe(src)
	})

	/**
	 * REORDERING A CALL'S NAMED PINS DOES NOT SWAP THEIR VALUES.
	 *
	 * Network text names the pins, so writing them in the other order says the same thing. TwinCAT placed input
	 * VALUES positionally and never wrote `InputParam/Names` at all, so the swapped values landed in slots still
	 * named `[IN, PT]` — `PT`'s value on `IN`. Nothing refused it, the text round-tripped clean, and the running
	 * program changed. This is the one divergence in the set that is invisible in git and wrong in the PLC.
	 */
	it("reordering a call's named pins keeps each value on its own pin", async () => {
		const name = id("pf_pins")
		const full = fid("pf_pins", "prg")
		const src =
			`PROGRAM ${name}\nVAR\n\tt1 : TON;\n\tgo : BOOL;\n\tpt : TIME;\nEND_VAR\n\n` +
			`NETWORK 0 FBD\n  t1(IN := go, PT := pt);\nEND_NETWORK\n\n` +
			`END_PROGRAM\n`

		// Create, then edit the PULLED text rather than re-stating the body. The IDE decides its own network
		// boundaries — one network per connected component (D25), which is one of the two FORCED divergences —
		// so a re-stated body can differ in network COUNT from what the IDE built and be refused for that
		// instead. Mutating what came back keeps the shape identical and isolates the one thing under test:
		// which value sits on which named pin.
		const created = await roundTrip(full, src)
		expect(created).toContain("IN := go")

		const swapped = created.replace("t1(IN := go, PT := pt)", "t1(PT := pt, IN := go)")
		expect(swapped).not.toBe(created)          // the edit really applied

		const back = await roundTrip(full, swapped)

		// Whatever ORDER comes back, each pin must still carry its own value. The bug produced `IN := pt`.
		expect(back).toContain("IN := go")
		expect(back).toContain("PT := pt")
		expect(back).not.toContain("IN := pt")
		expect(back).not.toContain("PT := go")
	})

	/**
	 * A NEGATED CONTACT IS STILL NEGATED AFTER A ROUND TRIP.
	 *
	 * A contact's modifiers live on the OPERAND, not on the item holding it (`BoxTreeOperand` carries no Flags
	 * member). CODESYS read them off the ITEM, which therefore always yielded none, so a negated contact reached
	 * the workspace as a PLAIN one — the wrong logic, committed to git, with nothing downstream to show it.
	 */
	it("a negated contact stays negated", async () => {
		const name = id("pf_neg")
		const full = fid("pf_neg", "prg")
		const src =
			`PROGRAM ${name}\nVAR\n\ta : BOOL;\n\tb : BOOL;\n\tout : BOOL;\nEND_VAR\n\n` +
			`NETWORK 0 LD\n  out := (NOT a AND b);\nEND_NETWORK\n\n` +
			`END_PROGRAM\n`

		const back = await roundTrip(full, src)

		expect(back).toContain("NOT a")
		expect(back).toBe(src)
	})

	/**
	 * A SET COIL IS STILL A SET COIL.
	 *
	 * Both IDEs keep coil storage on the operand being assigned TO, while the text format spells it after the
	 * VALUE. TwinCAT translated between the two; CODESYS dropped the target's flags entirely, so a SET coil
	 * pulled as a plain one and was downgraded on the next push — a change to what the program does.
	 */
	it("a SET coil stays a SET coil", async () => {
		const name = id("pf_set")
		const full = fid("pf_set", "prg")
		const src =
			`PROGRAM ${name}\nVAR\n\ta : BOOL;\n\tout : BOOL;\nEND_VAR\n\n` +
			`NETWORK 0 LD\n  out := a SET;\nEND_NETWORK\n\n` +
			`END_PROGRAM\n`

		const back = await roundTrip(full, src)

		expect(back).toContain("SET")
		expect(back).toBe(src)
	})

	/**
	 * AND THE WHOLE SET IS STABLE: pushing back exactly what came out changes nothing. This is the property the
	 * change gates on both writers exist for — a push that changes nothing must write nothing, so an unrelated
	 * edit elsewhere in the POU cannot re-mint a rung the engineer never touched.
	 */
	it("re-pushing what came back is a fixed point", async () => {
		const name = id("pf_fix")
		const full = fid("pf_fix", "prg")
		const src =
			`PROGRAM ${name}\nVAR\n\ta : BOOL;\n\tb : BOOL;\n\tout : BOOL;\nEND_VAR\n\n` +
			`NETWORK 0 LD\n  out := (NOT a AND b) SET;\nEND_NETWORK\n\n` +
			`END_PROGRAM\n`

		const once = await roundTrip(full, src)
		const twice = await roundTrip(full, once)

		expect(twice).toBe(once)
	})
})
