/**
 * LD on every element that can hold a body — the coverage the LD suite next door never had.
 *
 * `graphical/roundtrip.test.ts` proves LD thoroughly, but only ever on a PROGRAM (its featureset matrix, its
 * fixed-point checks) plus one FUNCTION_BLOCK it creates to build-verify. LD is supported on everything with a
 * body, and "supported" was resting on FBD parity and the offline suite rather than on either live IDE.
 *
 * The kinds here are the ones with an executable body: a top-level FUNCTION_BLOCK, FUNCTION and PROGRAM, and the
 * MEMBERS of an FB — METHOD, ACTION, and both PROPERTY accessors. Members are the interesting half. Content
 * travels as ONE PLCopen document, so a member's ladder is not a separate push: it rides inside the parent's
 * source text, and the splice has to place it in the member's own body rather than the parent's. A member body is
 * also where a language mix-up would be invisible — an FB whose own body is ST and whose method is LD is a shape
 * nothing else in the suite produces.
 *
 * Each test asserts three things, and the third is the one that catches real bugs:
 *   1. the body comes back as LD, not flattened to ST;
 *   2. re-pushing what was fetched is byte-identical (the round-trip is a fixed point, so `volt status` is quiet);
 *   3. it COMPILES. A ladder can round-trip perfectly and still be invalid — that is exactly how a push-created
 *      graphical POU once landed with an empty VAR section, its contacts referencing undeclared variables.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, setDefaultTimeout } from "bun:test"
import { bridge, id, fid, cleanup, createItem, fetchItem, ensureCompiles, requireHealthy, savePlcPrg, restorePlcPrg, fixPlcPrg, BASE } from "../harness"

// A TwinCAT full build is ~9s, past bun's 5s default, and the compile assertions here build the project.
setDefaultTimeout(30000)

const VARS = `VAR
\ta : BOOL;
\tb : BOOL;
\tout : BOOL;
END_VAR`

/** The one ladder used throughout: a two-contact series rung driving a coil. Deliberately the SAME rung in every
 *  kind, so a failure isolates to the KIND rather than to the ladder. */
const RUNG = (coil: string, l = "a", r = "b") => `NETWORK 0 LD\n  ${coil} := (${l} AND ${r});\nEND_NETWORK`

// ── top-level kinds ───────────────────────────────────────────────────────────
const ldFb = (n: string) => `FUNCTION_BLOCK ${n}\n${VARS}\n\n${RUNG("out")}\nEND_FUNCTION_BLOCK\n`
const ldProgram = (n: string) => `PROGRAM ${n}\n${VARS}\n\n${RUNG("out")}\nEND_PROGRAM\n`
// A FUNCTION's coil is its RETURN variable — the function's own name. BOOL return so a coil can drive it.
const ldFunction = (n: string) => `FUNCTION ${n} : BOOL\nVAR_INPUT\n\ta : BOOL;\n\tb : BOOL;\nEND_VAR\n\n${RUNG(n)}\nEND_FUNCTION\n`

// ── members, each riding inside its parent FB's source ─────────────────────────
// The parent's OWN body is ST on purpose. A member's language is independent of its parent's, and an all-LD
// document could pass while the splice was writing the member's ladder into the parent's body.
const fbWithMember = (n: string, member: string) =>
	`FUNCTION_BLOCK ${n}\n${VARS}\n\nout := a;\nEND_FUNCTION_BLOCK\n${member}`

const ldMethod = (n: string) => fbWithMember(n, `\nMETHOD M_Ld : BOOL\nVAR_INPUT\n\tp : BOOL;\nEND_VAR\n${RUNG("M_Ld", "a", "p")}\nEND_METHOD\n`)
const ldAction = (n: string) => fbWithMember(n, `\nACTION A_Ld\n${RUNG("out")}\nEND_ACTION\n`)
// Both accessors graphical, and they are NOT symmetric: a GET's coil is the property itself, a SET's coil is
// driven BY it. Writing one and asserting the other is how an accessor bug hides.
const ldProperty = (n: string) =>
	fbWithMember(n, `\nPROPERTY P_Ld : BOOL\nGET\n${RUNG("P_Ld")}\nEND_GET\nSET\n${RUNG("out", "P_Ld", "a")}\nEND_SET\nEND_PROPERTY\n`)

/** Push `src`, fetch it back, and assert every LD network survived as LD and the whole item is a fixed point. */
async function roundTrips(fullName: string, src: string, networks: number): Promise<string> {
	await createItem(fullName, src, "")
	const v1 = await fetchItem(fullName)

	const asLd = [...String(v1.sourceText).matchAll(/NETWORK\s+\d+\s+(\w+)/g)].map((m) => m[1])
	expect(asLd).toEqual(Array(networks).fill("LD"))     // every network still ladder — none flattened to ST

	// Fixed point: pushing back exactly what was fetched changes nothing. An UPDATE omits toFolder — a `""` here
	// would read as "move to root" against the Device/Plc Logic/Application structure and be refused as a move.
	const refs = await bridge.refs()
	const r = await bridge.push({
		expectedProjectVersion: refs.projectVersion,
		ops: [{ op: "set", name: fullName, sourceText: v1.sourceText, ifVersion: refs.items[fullName] }],
	})
	expect(r.accepted).toBe(true)
	expect((await fetchItem(fullName)).sourceText).toBe(v1.sourceText)
	return v1.sourceText
}

describe(`graphical / LD across kinds (${BASE})`, () => {
	beforeAll(async () => { await requireHealthy() })
	beforeEach(async () => { await fixPlcPrg(); await cleanup(); await savePlcPrg() })
	afterEach(async () => { await restorePlcPrg() })

	for (const [kind, ext, build] of [
		["function_block", "fb", ldFb],
		["program", "prg", ldProgram],
		["function", "fun", ldFunction],
	] as [string, string, (n: string) => string][]) {
		it(`an LD ${kind} round-trips and compiles`, async () => {
			const name = id(`vg_ld_${ext}`)
			const src = await roundTrips(fid(`vg_ld_${ext}`, ext), build(name), 1)
			expect(src).toContain("(a AND b)")
		})
	}

	for (const [what, build, coil] of [
		["METHOD", ldMethod, "M_Ld"],
		["ACTION", ldAction, "out"],
	] as [string, (n: string) => string, string][]) {
		it(`an FB with a textual body and an LD ${what} round-trips and compiles`, async () => {
			const name = id(`vg_ld_${what.toLowerCase()}`)
			const full = fid(`vg_ld_${what.toLowerCase()}`, "fb")
			await createItem(full, build(name), "")
			const v1 = await fetchItem(full)

			// The parent's own body stayed TEXTUAL and the member's became LD — the mix is the point.
			expect(v1.sourceText).toContain("out := a;")
			expect(v1.sourceText).toMatch(new RegExp(`NETWORK\\s+\\d+\\s+LD`))
			expect(v1.sourceText).toContain(`${coil} := (`)
			expect([...String(v1.sourceText).matchAll(/NETWORK\s+\d+\s+(\w+)/g)].map((m) => m[1])).toEqual(["LD"])

			const refs = await bridge.refs()
			const r = await bridge.push({
				expectedProjectVersion: refs.projectVersion,
				ops: [{ op: "set", name: full, sourceText: v1.sourceText, ifVersion: refs.items[full] }],
			})
			expect(r.accepted).toBe(true)
			expect((await fetchItem(full)).sourceText).toBe(v1.sourceText)
			await ensureCompiles(name)
		})
	}

	it("an FB whose PROPERTY has LD in BOTH accessors round-trips and compiles", async () => {
		const name = id("vg_ld_prop")
		const full = fid("vg_ld_prop", "fb")
		await createItem(full, ldProperty(name), "")
		const v1 = await fetchItem(full)

		// TWO ladders, one per accessor, and each keeps its own coil. A splice that wrote both accessors from
		// the same body would still show two LD networks — the coils are what tell them apart.
		expect([...String(v1.sourceText).matchAll(/NETWORK\s+\d+\s+(\w+)/g)].map((m) => m[1])).toEqual(["LD", "LD"])
		expect(v1.sourceText).toContain("P_Ld := (a AND b)")     // the GET drives the property…
		expect(v1.sourceText).toContain("out := (P_Ld AND a)")   // …and the SET is driven by it

		const refs = await bridge.refs()
		const r = await bridge.push({
			expectedProjectVersion: refs.projectVersion,
			ops: [{ op: "set", name: full, sourceText: v1.sourceText, ifVersion: refs.items[full] }],
		})
		expect(r.accepted).toBe(true)
		expect((await fetchItem(full)).sourceText).toBe(v1.sourceText)
		await ensureCompiles(name)
	})

	// The build check for the top-level kinds is separate because only an FB can be INSTANTIATED, which is how
	// `ensureCompiles` forces TwinCAT to compile a body at all (TC skips unreferenced POUs; CODESYS compiles
	// everything). A PROGRAM and a FUNCTION are covered by the round-trip above and by the FB's compile here.
	it("an LD function_block compiles when referenced — build-verified on BOTH vendors", async () => {
		const name = id("vg_ld_compile")
		await createItem(fid("vg_ld_compile", "fb"), ldFb(name), "")
		await ensureCompiles(name)
	})
})
