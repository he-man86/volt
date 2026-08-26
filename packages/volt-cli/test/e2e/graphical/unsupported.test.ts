/**
 * CFC and SFC are UNSUPPORTED — and the only thing that matters is that a push never destroys one.
 *
 * <p>Everything protecting these bodies was offline until now. That is a real gap and not a formality: the guard
 * works by LOCATING the language element in the export, the two vendors were only ever assumed to agree on where
 * it sits, and if the element is not found the empty sibling `<ST>` that a nested body carries wins instead — the
 * body reads as textual and uncommitted, and the next push flattens a diagram that cannot be rebuilt from text.
 * The offline suite proves the logic against fixtures Volt itself wrote; only a live IDE proves the shape.</p>
 *
 * <p>These POUs cannot be created by a test. Volt never creates a diagram — there is no text form to push — so
 * `VltFixtureCfc` and `VltFixtureSfc` are committed INTO both fixture projects, authored by each IDE itself
 * (CODESYS via `create_pou(language=cfc|sfc)`, TwinCAT via `CreateChild(name, 602, "", "CFC"|"SFC")`, both of
 * which accept a diagram language — measured, DIALECT D19). Hand-writing the files would have been inventing a
 * shape rather than capturing one.</p>
 *
 * <p>Their KIND differs by vendor and deliberately is not unified: CODESYS's `create_pou` defaults to a function
 * block (`.fb`), TwinCAT's `CreateChild(…, 602, …)` makes a program (`.prg`). Nothing here depends on which —
 * the body language is the subject — so the names are RESOLVED from `refs` rather than spelled with an
 * extension. A hardcoded `.prg` would have made this suite silently vendor-specific for a reason that has
 * nothing to do with what it tests.</p>
 *
 * <p>They are the only fixture POUs a test must not delete, so this suite never pushes a `deleteItem` for them
 * and never renames them; the shared `cleanup()` ignores them because it only removes names under the test
 * PREFIX.</p>
 *
 * <p>Adding them to the CODESYS fixture took a real bug with it, which is the sort of thing a first live test
 * finds. `CodesysTestProject.project` predates SP21, and saving it under SP21 — the only way to add an object —
 * re-resolves its referenced libraries; that pulled in `AppendErrorString`, a hidden CODESYS OPERATOR with two
 * VAR_IN_OUT and no return type. `LibSignatureRenderer` threw on it, and because every signature renders in one
 * pass during `fetch`, one unrenderable operator took the whole fetch down: 593 items to zero. Return-less
 * library functions are now skipped and counted (DIALECT D20).</p>
 */
import { describe, it, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { bridge, fetchItem, requireHealthy, BASE } from "../harness"

setDefaultTimeout(30000)

const CASES = [["CFC", "VltFixtureCfc"], ["SFC", "VltFixtureSfc"]] as const

describe(`graphical / unsupported bodies are never overwritten (${BASE})`, () => {
	// bare fixture name -> full wire name, resolved once (`.fb` on CODESYS, `.prg` on TwinCAT).
	const wire = new Map<string, string>()
	const nameOf = (bare: string) => wire.get(bare) ?? `${bare}.?`

	beforeAll(async () => {
		await requireHealthy()
		const refs = await bridge.refs()
		for (const [, bare] of CASES) {
			const full = Object.keys(refs.items).find((n) => n.startsWith(`${bare}.`))
			if (!full) throw new Error(
				`fixture POU '${bare}' is missing from this project — it is committed, and the suite cannot ` +
				`create one (Volt never creates a diagram). Re-add it in the IDE, not by hand.`)
			wire.set(bare, full)
		}
	})

	for (const [lang, bare] of CASES) {
		it(`a ${lang} body materializes as the MARKER, not as source`, async () => {
			const it0 = await fetchItem(nameOf(bare))
			// The marker is a FILE FORMAT — it lands in the user's git history — so it is matched literally.
			expect(it0.sourceText).toContain(`(* @volt-graphical: ${lang} *)`)
			// And it carries none of the diagram. An engineer must not be handed an editable-looking file: that
			// is the exact failure IL caused, materializing as its raw source and being rewritten as ST.
			expect(it0.sourceText).not.toContain("NETWORK")
			expect(it0.sourceText).not.toContain("XmlArchive")
		})

		it(`pushing the ${lang} marker BACK is a no-op, not a refusal`, async () => {
			// This is what keeps the POU pullable at all: `volt pull` writes the marker to disk, and the next
			// `volt push` of an unrelated item restates every file it has. If restating the marker were refused,
			// a project containing one diagram could never be pushed again.
			const name = nameOf(bare)
			const before = await fetchItem(name)
			const refs = await bridge.refs()
			const r = await bridge.push({
				expectedProjectVersion: refs.projectVersion,
				ops: [{ op: "set", name, sourceText: before.sourceText, ifVersion: refs.items[name] }],
			})
			expect(r.accepted).toBe(true)

			const after = await fetchItem(name)
			expect(after.sourceText).toBe(before.sourceText)
			expect(after.version).toBe(before.version)     // untouched, so the content hash cannot have moved
		})

		it(`pushing real ST over a ${lang} body is REFUSED and changes nothing`, async () => {
			const name = nameOf(bare)
			const before = await fetchItem(name)
			const refs = await bridge.refs()
			const r = await bridge.push({
				expectedProjectVersion: refs.projectVersion,
				ops: [{
					op: "set",
					name,
					// A WELL-FORMED program. The refusal has to come from the body being a diagram, not from a parse
					// error: without END_PROGRAM the push is rejected for "Missing END_PROGRAM" and the test goes green
					// while proving nothing about diagram protection.
					sourceText: `PROGRAM ${name.split(".")[0]}\nVAR\n\tnHacked : INT;\nEND_VAR\n\nnHacked := 1;\nEND_PROGRAM\n`,
					ifVersion: refs.items[name],
				}],
			})
			expect(r.accepted).toBe(false)

			// The refusal must NAME the language and say Volt does not support it. "Refused" alone leaves an
			// engineer unable to tell a Volt limitation from a mistake in what they pushed.
			const reason = JSON.stringify(r.conflicts ?? r)
			expect(reason).toContain(lang)
			expect(reason.toLowerCase()).toContain("support")

			// And the IDE is untouched — the whole point. A refusal that had already half-written the body
			// would be worse than an accept.
			const after = await fetchItem(name)
			expect(after.sourceText).toBe(before.sourceText)
			expect(after.version).toBe(before.version)
			expect(after.sourceText).not.toContain("nHacked")
		})
	}

	it("a project containing diagrams still fetches and re-pushes everything else normally", async () => {
		// The regression this guards is "one CFC in the project makes the project unusable" — the reason the
		// marker round-trips as a no-op rather than an error. A full fetch must include the diagram POUs and
		// must not fail on them.
		const all = await bridge.fetch({ knownItems: {} })
		const names = all.changed.map((i: any) => i.name)
		expect(names).toContain(nameOf("VltFixtureCfc"))
		expect(names).toContain(nameOf("VltFixtureSfc"))
	})
})
