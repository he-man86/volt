/**
 * EVERY ROW OF `wire.html#layout`, LIVE (wire-final-shape 4.3b against 4.3d). `StLayoutRulesTests` holds each row on
 * the writer and the reader offline; this file holds it on each vendor's IDE, row by row, from the same data the page
 * renders (`docs/assets/data.js`, generated from `StLayoutRules`): the row's example is pushed as a create and fetched
 * back byte for byte (it is the writer's own output, so the canonical text is a fixed point through the IDE), then the
 * row's breaking variant is pushed over it and the fetch does what the row's "a push that breaks it" column says —
 * `canonical`: the example again; `kept`: the variant as pushed; `refused`: an INVALID_ST conflict, and the example
 * still stands — and a `canonical` or `kept` fetch, pushed again, is a fixed point. Then the `lf` row's CR inside a
 * comment or a string, and the one vendor-dependent answer (a non-empty interface-accessor declaration, design.md
 * 4.3d). The examples' made-up names (`a`, `b`, `E`, `I`) become this run's own item names.
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { bridge, id, fid, at, cleanup, requireHealthy, pushOps, landed, BASE, VENDOR } from "../harness"

type Row = { id: string; example: string; variant: string; ext: string; push: "canonical" | "kept" | "refused" }
/** data.js is `window.VOLT = <JSON>`, under two comment lines. */
const DATA = readFileSync(join(import.meta.dir, "../../../docs/assets/data.js"), "utf8")
const ROWS: Row[] = JSON.parse(DATA.slice(DATA.indexOf("window.VOLT = ") + "window.VOLT = ".length)).layout

/** The example's own name, the first header's, becomes `name` (a GVL's text names nothing: its path is its name). */
const HEADER = /^(PROGRAM|FUNCTION_BLOCK|FUNCTION|INTERFACE|TYPE) (\w+)/m
const named = (text: string, name: string) => text.replace(HEADER, `$1 ${name}`)

describe(`endpoints / every layout row holds through the IDE (${BASE})`, () => {
	setDefaultTimeout(120_000)
	beforeAll(async () => { await requireHealthy(); await cleanup() })
	afterAll(cleanup)

	it("the page has the rows this file walks", () => {
		expect(ROWS.length).toBeGreaterThan(0)
		for (const r of ROWS) expect(["canonical", "kept", "refused"]).toContain(r.push)
	})

	for (const row of ROWS)
		it(`${row.id}: the example round-trips exactly; a push that breaks it is ${row.push}`, async () => {
			const key = `lay_${row.id.replaceAll("-", "_")}`, name = id(key)
			const wire = await at(fid(key, row.ext))
			const example = named(row.example, name), variant = named(row.variant, name)
			const fetch = async () => (await bridge.fetch({ knownItems: {}, onlyItems: [wire] })).changed.find((i: any) => i.name === wire)

			const created = await pushOps([{ op: "set", name: wire, sourceText: example, ifVersion: null }])
			expect(landed(created), JSON.stringify(created.conflicts)).toBe(true)
			const back = await fetch()
			expect(back?.sourceText, `${wire}: the example did not come back as written`).toBe(example)

			const r = await pushOps([{ op: "set", name: wire, sourceText: variant, ifVersion: back.version }])
			if (row.push === "refused") {
				expect(r.conflicts.map((c: any) => [c.name, c.code])).toEqual([[wire, "INVALID_ST"]])
				expect(landed(r)).toBe(false)
				expect((await fetch()).sourceText).toBe(example)
			} else {
				expect(landed(r), JSON.stringify(r.conflicts)).toBe(true)
				const after = await fetch()
				expect(after.sourceText).toBe(row.push === "canonical" ? example : variant)
				// …and what came back is a fixed point: pushed again, it comes back unchanged.
				const again = await pushOps([{ op: "set", name: wire, sourceText: after.sourceText, ifVersion: after.version }])
				expect(landed(again), JSON.stringify(again.conflicts)).toBe(true)
				expect((await fetch()).sourceText).toBe(after.sourceText)
			}
			await pushOps([{ op: "deleteItem", name: wire }])
		})

	/** The `lf` row's "wherever it stands": a lone CR, and a CR inside a comment or a string literal, is a line end
	 *  like any other and comes back as LF — the comment or the literal then spans two lines. */
	const CR = "\r", LF = "\n"
	const CRS: [string, string][] = [
		["a lone CR between two lines", `VAR_GLOBAL${CR}\ta : INT;${CR}END_VAR${CR}`],
		["a CR inside a comment", `VAR_GLOBAL${LF}\ta : INT; (* x${CR}y *)${LF}END_VAR${LF}`],
		["a CR inside a string literal", `VAR_GLOBAL${LF}\ts : STRING := 'x${CR}y';${LF}END_VAR${LF}`],
	]
	for (const [k, [label, pushed]] of CRS.entries())
		it(`lf: ${label} comes back as LF, and that is a fixed point`, async () => {
			const key = `lay_cr_${k}`, wire = await at(fid(key, "gvl"))
			const fetch = async () => (await bridge.fetch({ knownItems: {}, onlyItems: [wire] })).changed.find((i: any) => i.name === wire)
			const created = await pushOps([{ op: "set", name: wire, sourceText: pushed, ifVersion: null }])
			expect(landed(created), JSON.stringify(created.conflicts)).toBe(true)
			const back = await fetch()
			expect(back?.sourceText).toBe(pushed.replaceAll(CR, LF))
			const again = await pushOps([{ op: "set", name: wire, sourceText: back.sourceText, ifVersion: back.version }])
			expect(landed(again), JSON.stringify(again.conflicts)).toBe(true)
			expect((await fetch()).sourceText).toBe(back.sourceText)
			await pushOps([{ op: "deleteItem", name: wire }])
		})

	/** The `interface-member` row's accessor DECLARATION slot is the one place the vendors answer differently (listed
	 *  for the owner, design.md 4.3d): CODESYS writes a non-empty interface-accessor declaration and the build judges
	 *  it (DIALECT D41); TwinCAT refuses it UNSUPPORTED and lands nothing (D21). Both answers, pinned live. */
	const codesys = VENDOR === "codesys"
	it(`interface-member: a non-empty interface-accessor declaration is ${codesys ? "written and fetched back as pushed" : "refused UNSUPPORTED, nothing lands"}`, async () => {
		const key = "lay_itf_decl", name = id(key), wire = await at(fid(key, "itf"))
		const pushed = `INTERFACE ${name}\n\nMETHOD m : BOOL\n%EXCLUDE_FROM_BUILD\nEND_METHOD\n\nPROPERTY p : INT\nGET\nVAR\nEND_VAR\nEND_GET\nEND_PROPERTY\n\nEND_INTERFACE\n`
		const r = await pushOps([{ op: "set", name: wire, sourceText: pushed, ifVersion: null }])
		const back = (await bridge.fetch({ knownItems: {}, onlyItems: [wire] })).changed.find((i: any) => i.name === wire)
		if (codesys) {
			expect(landed(r), JSON.stringify(r.conflicts)).toBe(true)
			expect(back?.sourceText).toBe(pushed)
			await pushOps([{ op: "deleteItem", name: wire }])
		} else {
			expect(r.conflicts.map((c: any) => [c.name, c.code])).toEqual([[wire, "UNSUPPORTED"]])
			expect(landed(r)).toBe(false)
			expect(back).toBeUndefined()
		}
	})
})
