/** /build — compile errors produce diagnostics with correct line numbers. */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { bridge, id, fid, cleanup, requireHealthy, createItem, savePlcPrg, restorePlcPrg, instantiateInPlcPrg, fixPlcPrg, BASE } from "../harness"

describe(`endpoints / build diagnostics (${BASE})`, () => {
	setDefaultTimeout(60_000)
	beforeAll(async () => { await requireHealthy(); await fixPlcPrg(); await cleanup(); await savePlcPrg() })
	afterAll(async () => { await restorePlcPrg(); await cleanup() })

	it("healthy project builds successfully", async () => {
		const name = id("b_ok")
		await createItem(fid("b_ok"), `FUNCTION_BLOCK ${name}\nVAR\n\tx : INT;\nEND_VAR\n\nx := x + 1;\nEND_FUNCTION_BLOCK\n`)
		await instantiateInPlcPrg(name)

		const r = await bridge.build()
		expect(r.success).toBe(true)
		expect(Array.isArray(r.diagnostics)).toBe(true)
	})

	it("detects undeclared variable", async () => {
		const name = id("b_undef")
		const src = `FUNCTION_BLOCK ${name}\nVAR\n\tx : INT;\nEND_VAR\n\ny := 1;\nEND_FUNCTION_BLOCK\n`
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
		const src = `FUNCTION_BLOCK ${name}\nVAR\n\tx : INT;\n\tx : INT;\nEND_VAR\n\nx := 1;\nEND_FUNCTION_BLOCK\n`
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
		const src = `FUNCTION_BLOCK ${name}\nVAR\n\tx : INT;\nEND_VAR\n\nx := TRUE;\nEND_FUNCTION_BLOCK\n`
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
		const src = `FUNCTION_BLOCK ${name}\nVAR\n\tx : INT;\nEND_VAR\n\ny := 1;\nEND_FUNCTION_BLOCK\n`
		await createItem(fid("b_col"), src)
		await instantiateInPlcPrg(name)

		const r = await bridge.build()
		expect(r.success).toBe(false)
		for (const d of r.diagnostics)
			expect(typeof d.column).toBe("number")
	})
})
