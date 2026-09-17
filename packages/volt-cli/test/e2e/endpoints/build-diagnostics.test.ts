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

describe(`endpoints / build diagnostics (${BASE})`, () => {
	setDefaultTimeout(60_000)
	beforeAll(async () => { await requireHealthy() })
	beforeEach(async () => { await fixPlcPrg(); await cleanup(); await savePlcPrg() })
	afterEach(async () => { await restorePlcPrg() })
	afterAll(cleanup)

	it("healthy project builds successfully", async () => {
		const name = id("b_ok")
		await createItem(fid("b_ok"), `FUNCTION_BLOCK ${name}\nVAR\n\tx : INT;\nEND_VAR\n(* @volt-implementation *)\nx := x + 1;\nEND_FUNCTION_BLOCK\n`)
		await instantiateInPlcPrg(name)

		const r = await bridge.build()
		expect(r.success, "a project holding only a valid FB must build clean").toBe(true)
		expect(r.diagnostics.filter((d: any) => d.severity === "error")).toEqual([])
	})

	it("detects undeclared variable", async () => {
		const name = id("b_undef")
		const src = `FUNCTION_BLOCK ${name}\nVAR\n\tx : INT;\nEND_VAR\n(* @volt-implementation *)\ny := 1;\nEND_FUNCTION_BLOCK\n`
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
		const src = `FUNCTION_BLOCK ${name}\nVAR\n\tx : INT;\n\tx : INT;\nEND_VAR\n(* @volt-implementation *)\nx := 1;\nEND_FUNCTION_BLOCK\n`
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
		const src = `FUNCTION_BLOCK ${name}\nVAR\n\tx : INT;\nEND_VAR\n(* @volt-implementation *)\nx := TRUE;\nEND_FUNCTION_BLOCK\n`
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

	it("every diagnostic has a column field (may be 0 if IDE omits it)", async () => {
		const name = id("b_col")
		const src = `FUNCTION_BLOCK ${name}\nVAR\n\tx : INT;\nEND_VAR\n(* @volt-implementation *)\ny := 1;\nEND_FUNCTION_BLOCK\n`
		await createItem(fid("b_col"), src)
		await instantiateInPlcPrg(name)

		const r = await bridge.build()
		expect(r.success).toBe(false)
		for (const d of r.diagnostics)
			expect(typeof d.column).toBe("number")
	})
})
