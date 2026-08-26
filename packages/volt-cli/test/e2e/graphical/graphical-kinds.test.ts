/**
 * FBD and LD on every element that can hold a body — the coverage neither language had.
 *
 * `graphical/roundtrip.test.ts` proves both languages thoroughly, but only ever on a PROGRAM: its featureset
 * matrix, its fixed-point checks and its Execute-box test are all `.prg`, plus one FUNCTION_BLOCK created to
 * build-verify. That everything else works rested on the offline suite and on FBD/LD sharing a code path — an
 * inference, not a measurement, and the two are not the same thing here.
 *
 * The kinds are every element with an executable body: top-level FUNCTION_BLOCK, PROGRAM and FUNCTION, and the
 * MEMBERS of an FB — METHOD, ACTION, and both PROPERTY accessors. Members are the half that had nothing at all.
 * Content travels as ONE PLCopen document, so a member's body is not its own push: it rides inside the parent's
 * source text, and the splice has to land it in the MEMBER's body rather than the parent's.
 *
 * Both languages run the same matrix because there is no reason for them to differ — same codec, same graph,
 * same splice — which is exactly why an asymmetry here would be a bug rather than a vendor fact. The one real
 * difference is the source they are written from, so that is the only thing parameterised.
 *
 * Each case asserts three things, and the third is the one that catches real bugs:
 *   1. the body comes back in the language it was pushed as, not flattened to ST;
 *   2. re-pushing what was fetched is byte-identical (a fixed point, so `volt status` stays quiet);
 *   3. it COMPILES. A body can round-trip perfectly and still be invalid — that is exactly how a push-created
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

/** The one network used throughout, in whichever language: `coil := (l AND r)`. Deliberately IDENTICAL across
 *  every kind and both languages, so a failure isolates to the kind or the language and never to the network.
 *  It is also the canonical form both readers emit, which is what makes the re-push a fixed point. */
const NET = (lang: string) => (coil: string, l = "a", r = "b") =>
	`NETWORK 0 ${lang}\n  ${coil} := (${l} AND ${r});\nEND_NETWORK`

/** Every source shape for one language. Built from the same `net` so the two languages differ in exactly one
 *  token — if FBD passes where LD fails, the difference is real and not a fixture artefact. */
function sources(lang: string) {
	const net = NET(lang)
	const withMember = (n: string, member: string) =>
		// The parent's OWN body is ST on purpose. A member's language is independent of its parent's, and an
		// all-graphical document would still pass while the splice wrote the member's body into the parent's.
		`FUNCTION_BLOCK ${n}\n${VARS}\n\nout := a;\nEND_FUNCTION_BLOCK\n${member}`
	return {
		fb: (n: string) => `FUNCTION_BLOCK ${n}\n${VARS}\n\n${net("out")}\nEND_FUNCTION_BLOCK\n`,
		prg: (n: string) => `PROGRAM ${n}\n${VARS}\n\n${net("out")}\nEND_PROGRAM\n`,
		// A FUNCTION's coil is its RETURN variable — the function's own name. BOOL return so a coil can drive it.
		fun: (n: string) => `FUNCTION ${n} : BOOL\nVAR_INPUT\n\ta : BOOL;\n\tb : BOOL;\nEND_VAR\n\n${net(n)}\nEND_FUNCTION\n`,
		method: (n: string) => withMember(n, `\nMETHOD M_G : BOOL\nVAR_INPUT\n\tp : BOOL;\nEND_VAR\n${net("M_G", "a", "p")}\nEND_METHOD\n`),
		action: (n: string) => withMember(n, `\nACTION A_G\n${net("out")}\nEND_ACTION\n`),
		// Both accessors graphical, and they are NOT symmetric: a GET's coil is the property itself, a SET's is
		// driven BY it. Writing one and asserting the other is how an accessor bug hides.
		property: (n: string) =>
			withMember(n, `\nPROPERTY P_G : BOOL\nGET\n${net("P_G")}\nEND_GET\nSET\n${net("out", "P_G", "a")}\nEND_SET\nEND_PROPERTY\n`),
	}
}

/** The languages of every `NETWORK n LANG` marker in a body, in order. */
const networkLangs = (src: string) => [...String(src).matchAll(/NETWORK\s+\d+\s+(\w+)/g)].map((m) => m[1])

/** Re-push exactly what was fetched and assert nothing moved. The property that keeps `volt status` quiet. */
async function isFixedPoint(fullName: string, fetched: any) {
	// An UPDATE omits toFolder — a `""` here would read as "move to root" against the
	// Device/Plc Logic/Application structure and be refused as a move.
	const refs = await bridge.refs()
	const r = await bridge.push({
		expectedProjectVersion: refs.projectVersion,
		ops: [{ op: "set", name: fullName, sourceText: fetched.sourceText, ifVersion: refs.items[fullName] }],
	})
	expect(r.accepted).toBe(true)
	expect((await fetchItem(fullName)).sourceText).toBe(fetched.sourceText)
}

for (const lang of ["FBD", "LD"]) {
	const src = sources(lang)
	const tag = lang.toLowerCase()

	describe(`graphical / ${lang} across kinds (${BASE})`, () => {
		beforeAll(async () => { await requireHealthy() })
		beforeEach(async () => { await fixPlcPrg(); await cleanup(); await savePlcPrg() })
		afterEach(async () => { await restorePlcPrg() })

		for (const [kind, ext] of [["function_block", "fb"], ["program", "prg"], ["function", "fun"]] as const) {
			it(`a ${lang} ${kind} round-trips`, async () => {
				const name = id(`vg_${tag}_${ext}`)
				const full = fid(`vg_${tag}_${ext}`, ext)
				await createItem(full, src[ext](name), "")

				const v1 = await fetchItem(full)
				expect(networkLangs(v1.sourceText)).toEqual([lang])   // stayed graphical, not flattened to ST
				expect(v1.sourceText).toContain("(a AND b)")
				await isFixedPoint(full, v1)
			})
		}

		for (const [what, key, coil] of [["METHOD", "method", "M_G"], ["ACTION", "action", "out"]] as const) {
			it(`an FB with a textual body and a ${lang} ${what} round-trips and compiles`, async () => {
				const name = id(`vg_${tag}_${key}`)
				const full = fid(`vg_${tag}_${key}`, "fb")
				await createItem(full, src[key](name), "")

				const v1 = await fetchItem(full)
				expect(v1.sourceText).toContain("out := a;")          // the parent's own body stayed TEXTUAL…
				expect(networkLangs(v1.sourceText)).toEqual([lang])   // …and only the member is graphical
				expect(v1.sourceText).toContain(`${coil} := (`)
				await isFixedPoint(full, v1)
				await ensureCompiles(name)
			})
		}

		it(`an FB whose PROPERTY has ${lang} in BOTH accessors round-trips and compiles`, async () => {
			const name = id(`vg_${tag}_prop`)
			const full = fid(`vg_${tag}_prop`, "fb")
			await createItem(full, src.property(name), "")

			const v1 = await fetchItem(full)
			// TWO networks, one per accessor, each keeping its own coil. A splice that wrote both accessors from
			// the same body would still show two networks — the coils are what tell them apart.
			expect(networkLangs(v1.sourceText)).toEqual([lang, lang])
			expect(v1.sourceText).toContain("P_G := (a AND b)")     // the GET drives the property…
			expect(v1.sourceText).toContain("out := (P_G AND a)")   // …and the SET is driven by it
			await isFixedPoint(full, v1)
			await ensureCompiles(name)

			// THE assertion that cannot pass vacuously, and the reason this test was rewritten. Until the accessor
			// path was routed through BodyCodec, `SetAccessor` hardcoded <ST>: a graphical accessor was stored as its
			// own network TEXT and read straight back, so everything above was a fixed point over a body that had
			// already been destroyed — `networkLangs` and `isFixedPoint` both passed, on both vendors, while doing it.
			//
			// A body that is genuinely graphical must REFUSE a textual push. That refusal is the wire-visible
			// difference between a real diagram and its text sitting in an <ST>; a flattened accessor accepts it.
			const refs = await bridge.refs()
			const flat = src.property(name).replace(new RegExp(`NETWORK 0 ${lang}[^]*?END_NETWORK`, "g"), "P_G := a;")
			const r = await bridge.push({
				expectedProjectVersion: refs.projectVersion,
				ops: [{ op: "set", name: full, ifVersion: refs.items[full], sourceText: flat }],
			})
			expect(r.accepted).toBe(false)
			expect(JSON.stringify(r.conflicts ?? r)).toContain(lang)
			expect((await fetchItem(full)).sourceText).toBe(v1.sourceText)   // and the refusal changed nothing
		})

		// Build-verified separately because only an FB can be INSTANTIATED, which is how `ensureCompiles` forces
		// TwinCAT to compile a body at all (TC skips unreferenced POUs; CODESYS compiles everything). The PROGRAM
		// and FUNCTION cases are covered by their round-trip plus this.
		it(`a ${lang} function_block compiles when referenced — build-verified on BOTH vendors`, async () => {
			const name = id(`vg_${tag}_compile`)
			await createItem(fid(`vg_${tag}_compile`, "fb"), src.fb(name), "")
			await ensureCompiles(name)
		})
	})
}
