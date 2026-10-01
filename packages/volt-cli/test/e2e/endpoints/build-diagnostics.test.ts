/**
 * `build` — a compile error becomes a diagnostic, with a usable location.
 *
 * <p><b>Cleanup is PER TEST, and that is not a style choice.</b> This file used to set up once in `beforeAll`,
 * so every test's deliberately-broken FB stayed instantiated in the main program for the rest of the file. The
 * first test asserts the project builds CLEAN — and it passed only because it happened to run first. Run it
 * alone after the others, or reorder the file, and it fails. A test whose result depends on its position is not
 * evidence of anything.</p>
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, setDefaultTimeout } from "bun:test"
import { bridge, id, fid, cleanup, requireHealthy, createItem, savePlcPrg, restorePlcPrg, instantiateInPlcPrg, fixPlcPrg, BASE } from "../harness"
import { fb, METHOD, ACTION, MARK } from "../fixtures"

describe(`endpoints / build diagnostics (${BASE})`, () => {
	setDefaultTimeout(60_000)
	beforeAll(async () => { await requireHealthy() })
	beforeEach(async () => { await fixPlcPrg(); await cleanup(); await savePlcPrg() })
	afterEach(async () => { await restorePlcPrg() })
	afterAll(cleanup)

	it("healthy project builds successfully", async () => {
		const name = id("b_ok")
		await createItem(fid("b_ok"), `FUNCTION_BLOCK ${name}\nVAR\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\nx := x + 1;\nEND_FUNCTION_BLOCK\n`)
		await instantiateInPlcPrg(name)

		const r = await bridge.build()
		expect(r.success, "a project holding only a valid FB must build clean").toBe(true)
		expect(r.diagnostics.filter((d: any) => d.severity === "error")).toEqual([])
	})

	it("detects undeclared variable", async () => {
		const name = id("b_undef")
		const src = `FUNCTION_BLOCK ${name}\nVAR\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\ny := 1;\nEND_FUNCTION_BLOCK\n`
		await createItem(fid("b_undef"), src)
		await instantiateInPlcPrg(name)

		const r = await bridge.build()
		expect(r.success).toBe(false)
		const errors = r.diagnostics.filter((d: any) => d.severity === "error")
		expect(errors.length).toBeGreaterThan(0)

		const hit = errors.find((d: any) =>
			d.message.toLowerCase().includes("y") &&
			(d.message.toLowerCase().includes("not defined") || d.message.toLowerCase().includes("undefined") || d.message.toLowerCase().includes("unknown")))
		expect(hit).toBeDefined()
		expect(hit.line).toBeGreaterThanOrEqual(0)
		expect(hit.column).toBeGreaterThanOrEqual(0)
	})

	it("detects duplicate variable declaration", async () => {
		const name = id("b_dup")
		const src = `FUNCTION_BLOCK ${name}\nVAR\n\tx : INT;\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\nx := 1;\nEND_FUNCTION_BLOCK\n`
		await createItem(fid("b_dup"), src)
		await instantiateInPlcPrg(name)

		const r = await bridge.build()
		expect(r.success).toBe(false)
		const errors = r.diagnostics.filter((d: any) => d.severity === "error")
		expect(errors.length).toBeGreaterThan(0)

		const hit = errors.find((d: any) =>
			d.message.toLowerCase().includes("x") &&
			(d.message.toLowerCase().includes("duplicate") || d.message.toLowerCase().includes("already") || d.message.toLowerCase().includes("redeclared") || d.message.toLowerCase().includes("ambiguous")))
		expect(hit).toBeDefined()
		expect(hit.line).toBeGreaterThanOrEqual(0)
		expect(hit.column).toBeGreaterThanOrEqual(0)
	})

	it("detects type mismatch", async () => {
		const name = id("b_type")
		// x is declared INT but assigned a BOOL literal — valid syntax, semantic error
		const src = `FUNCTION_BLOCK ${name}\nVAR\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\nx := TRUE;\nEND_FUNCTION_BLOCK\n`
		await createItem(fid("b_type"), src)
		await instantiateInPlcPrg(name)

		const r = await bridge.build()
		expect(r.success).toBe(false)
		const errors = r.diagnostics.filter((d: any) => d.severity === "error")
		expect(errors.length).toBeGreaterThan(0)

		const hit = errors.find((d: any) =>
			d.message.toLowerCase().includes("cannot") ||
			d.message.toLowerCase().includes("convert") ||
			d.message.toLowerCase().includes("type") ||
			d.message.toLowerCase().includes("bool") ||
			d.message.toLowerCase().includes("implicit"))
		expect(hit).toBeDefined()
		expect(hit.line).toBeGreaterThanOrEqual(0)
		expect(hit.column).toBeGreaterThanOrEqual(0)
	})

	// A DIAGNOSTIC INSIDE A CHILD OBJECT NAMES THE ITEM AND THE CHILD (openspec codesys-diagnostic-child-names). A method,
	// action or property accessor is its own object in the IDE but travels inside its parent's file, so `name` is the
	// parent - the file a client opens - and `member` the child. CODESYS reports such an error against the CHILD's
	// guid (measured, scripts/diagnostic-child-guid.log), which the bridge used to resolve against top-level items
	// only: the field case (c802b74d) was five `C0578`s in METHOD bodies published with no name at all. Both vendors
	// must answer the same pair - the parity boundary is the wire.
	//
	// EXACTLY ONE `Identifier '…' not defined` per planted fault, not "one is found": TwinCAT writes every error to two
	// Output panes and the bridge dedupes them, so a pane that spelled the object path differently would come back
	// TWICE, and a dedupe key that was too coarse would drop a real one. `find` could see neither. Matched on that ONE
	// message, not on the token: the compiler legitimately says more than one thing about a planted fault (measured,
	// CODESYS SP21: `zzChild := 1;` also gives C0018 "'zzChild' is no valid assignment target", `Prop := zzChild;`
	// also C0032 "Cannot convert type ..."), and every one of those is returned as the IDE gave it.
	const undefinedIn = (r: any, token: string) =>
		r.diagnostics.filter((d: any) => d.severity === "error" && d.message === `Identifier '${token}' not defined`)
	const zz = (r: any) => undefinedIn(r, "zzChild")
	for (const [label, children, member] of [
		["a METHOD", METHOD("Compute", "Compute := d;\nzzChild := 1;"), "Compute"],
		["an ACTION", ACTION("Act", "x := 1;\nzzChild := 1;"), "Act"],
		["a PROPERTY GET", `\nPROPERTY Prop : INT\nGET\n${MARK}\n\tProp := zzChild;\nEND_GET\nEND_PROPERTY\n`, "Prop"],
	] as [string, string, string][]) {
		it(`an error inside ${label} names the FB and ${member}, once`, async () => {
			const name = id(`b_child_${member}`), wire = fid(`b_child_${member}`)
			await createItem(wire, fb(name, { children }))
			await instantiateInPlcPrg(name)

			const r = await bridge.build()
			expect(r.success).toBe(false)
			const hits = zz(r)
			expect(hits.map((d: any) => ({ name: d.name, member: d.member })), JSON.stringify(r.diagnostics))
				.toEqual([{ name: wire, member }])
		})
	}

	// THE GET AND THE SET OF ONE PROPERTY, the same error on the same line of each, are TWO diagnostics on both vendors.
	// Both publish `member: Prop` (an accessor is read with its property), and TwinCAT writes no column - so a dedupe
	// keyed on what the wire carries merged them, and TwinCAT returned one where CODESYS returned two.
	it("the same error in a property's GET and SET is two diagnostics", async () => {
		const name = id("b_child_getset"), wire = fid("b_child_getset")
		const children = `\nPROPERTY Prop : INT\nGET\n${MARK}\n\tProp := zzChild;\nEND_GET\nSET\n${MARK}\n\tx := zzChild;\nEND_SET\nEND_PROPERTY\n`
		await createItem(wire, fb(name, { children }))
		await instantiateInPlcPrg(name)

		const r = await bridge.build()
		expect(r.success).toBe(false)
		expect(zz(r).map((d: any) => ({ name: d.name, member: d.member })), JSON.stringify(r.diagnostics))
			.toEqual([{ name: wire, member: "Prop" }, { name: wire, member: "Prop" }])
	})

	it("an error in the FB's own body names the FB and no member, once", async () => {
		const name = id("b_child_self"), wire = fid("b_child_self")
		await createItem(wire, fb(name, { body: "x := 1;\nzzSelf := 1;", children: METHOD("Compute") }))
		await instantiateInPlcPrg(name)

		const r = await bridge.build()
		const hits = undefinedIn(r, "zzSelf")
		expect(hits.map((d: any) => ({ name: d.name, member: d.member })), JSON.stringify(r.diagnostics))
			.toEqual([{ name: wire, member: undefined }])
	})

	it("every diagnostic has a column field (may be 0 if IDE omits it)", async () => {
		const name = id("b_col")
		const src = `FUNCTION_BLOCK ${name}\nVAR\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\ny := 1;\nEND_FUNCTION_BLOCK\n`
		await createItem(fid("b_col"), src)
		await instantiateInPlcPrg(name)

		const r = await bridge.build()
		expect(r.success).toBe(false)
		for (const d of r.diagnostics)
			expect(typeof d.column).toBe("number")
	})
})
