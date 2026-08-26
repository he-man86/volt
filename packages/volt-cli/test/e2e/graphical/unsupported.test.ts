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
 * <p>They are the only fixture POUs a test must not delete, so this suite never pushes a `deleteItem` for them
 * and never renames them; the shared `cleanup()` ignores them because it only removes names under the test
 * PREFIX.</p>
 *
 * <p><b>TWINCAT ONLY, and this is a blocked item rather than a vendor limit.</b> The CODESYS fixture POUs were
 * created the same way and worked — but `CodesysTestProject.project` predates SP21, and SAVING it under SP21 (the
 * only way to add an object) re-resolves its referenced libraries. That pulls in a HIDDEN library function,
 * `AppendErrorString` (`IsHidden="true"` in the System/Analyzation browsercache), which has no readable return
 * type; `LibSignatureRenderer` then throws and the whole `fetch` fails — 593 items to zero, on a project that is
 * otherwise fine. Volt already skips hidden objects in the PROJECT tree (`CodesysTypeMap` → `IHiddenObject`) but
 * the library-signature path does not carry hidden-ness at all, so it cannot make the same call. Until that is
 * threaded through, adding these POUs to the CODESYS fixture trades live CFC coverage for a broken suite.</p>
 */
import { describe, it, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { bridge, fetchItem, requireHealthy, BASE, VENDOR } from "../harness"

setDefaultTimeout(30000)

// Programs on TwinCAT (`CreateChild(name, 602, …)`) — the extension follows the KIND, not the language.
const CASES = [
	["CFC", "VltFixtureCfc.prg"],
	["SFC", "VltFixtureSfc.prg"],
] as const

if (VENDOR !== "twincat")
	console.log("graphical/unsupported: SKIPPED on CODESYS — its fixture project has no CFC/SFC POU (see the header).")

describe.skipIf(VENDOR !== "twincat")(`graphical / unsupported bodies are never overwritten (${BASE})`, () => {
	beforeAll(async () => { await requireHealthy() })

	for (const [lang, name] of CASES) {
		it(`a ${lang} body materializes as the MARKER, not as source`, async () => {
			const it0 = await fetchItem(name)
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
		expect(names).toContain("VltFixtureCfc.prg")
		expect(names).toContain("VltFixtureSfc.prg")
	})
})
