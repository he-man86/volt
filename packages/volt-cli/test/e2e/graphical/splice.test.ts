import { landed } from "../harness"
/**
 * The SPLICE against a live IDE — the change's central assumption, measured.
 *
 * A push used to regenerate a graphical body whole. It now carries every network whose text did not change
 * straight from the stored export, so the document handed to the importer is PART VENDOR BYTES, PART VOLT BYTES.
 * Nothing in the offline suite can say whether an IDE accepts that: every live verification to date exercised a
 * fully regenerated body.
 *
 * That is openspec `splice-graphical-body` U6, and this is the half of it the wire can answer — does a spliced
 * body import cleanly, compile, and stay stable? The other half (whether the importer NORMALIZES what was
 * carried) is invisible from here: the wire serves network text, not XML, so a normalization that preserved the
 * text while rewriting the attributes would look identical. Closing that needs the exported document, from a
 * bridge-side dump or an IDE-side export.
 */
import { describe, expect, beforeAll, beforeEach, afterEach, setDefaultTimeout } from "bun:test"
import { bridge, id, fid, cleanup, requireHealthy, createItem, fetchItem, ensureCompiles, savePlcPrg, restorePlcPrg, fixPlcPrg, BASE, inFolder, projectRoot } from "../harness"

import { itGapped, PLATFORM_GAPS } from "../lib/platform"

/** On a CODESYS version that cannot take an LD/FBD write, every test here must end in that refusal (lib/platform.ts). */
const it = itGapped(PLATFORM_GAPS.graphicalWrite)

setDefaultTimeout(60000)

/** Two independent networks — the smallest body where "carry the other one" means anything. */
function twoNetworks(name: string) {
	return `PROGRAM ${name}
VAR
\ta : BOOL;
\tb : BOOL;
\tout1 : BOOL;
\tout2 : BOOL;
END_VAR
%LANGUAGE FBD
%NETWORK
out1 := AND(a, b);
%NETWORK
out2 := OR(a, b);
END_PROGRAM
`
}

/** Each `%NETWORK …` block, up to the next one or the body's END_ line. */
const networks = (src: string): string[] => {
	const heads = [...src.matchAll(/^%NETWORK\b/gm)]
	return heads.map((h, i) =>
		src.slice(h.index!, i + 1 < heads.length ? heads[i + 1].index! : h.index! + src.slice(h.index!).search(/^END_\w+\s*$/m)))

}

describe(`graphical / splice (${BASE})`, () => {
	beforeAll(async () => { await requireHealthy() })
	beforeEach(async () => { await fixPlcPrg(); await cleanup(); await savePlcPrg() })
	afterEach(async () => { await restorePlcPrg() })

	it("a body where only ONE network changed imports cleanly and keeps the other verbatim", async () => {
		const name = id("splice_two")
		const full = inFolder(await projectRoot(), fid("splice_two", "pou"))
		await createItem(full, twoNetworks(name), await projectRoot())

		const v1 = (await fetchItem(full)).sourceText
		const nets1 = networks(v1)
		expect(nets1.length).toBe(2)

		// Edit network 1 ONLY. Network 0's text is byte-identical, so the splice must carry it.
		const edited = nets1[1].replace("out2 :=", "out2b :=").replace("OR(a, b);", "AND(a, NOT b);")
		expect(edited).not.toBe(nets1[1])
		const pushed = v1.replace(nets1[1], edited).replace("\tout2 : BOOL;", "\tout2b : BOOL;")

		const refs = await bridge.refs()
		const r = await bridge.push({
			expectedProjectVersion: refs.projectVersion,
			ops: [{ op: "set", name: full, sourceText: pushed, ifVersion: refs.items[full] }],
		})
		// THE measurement: a part-vendor, part-Volt document is accepted by a real importer.
		expect(landed(r), `spliced push refused: ${JSON.stringify(r.conflicts)}`).toBe(true)

		const v2 = (await fetchItem(full)).sourceText
		const nets2 = networks(v2)
		expect(nets2.length).toBe(2)
		expect(nets2[0]).toBe(nets1[0])                 // untouched network: carried, unchanged
		expect(v2).toContain("out2b")                   // and the edit really landed
		expect(v2).not.toContain("OR(a, b);")
	})

	it("a spliced body still COMPILES — the importer accepted it as a program, not just as XML", async () => {
		// A malformed body can import and still be nonsense; the compiler is the independent oracle. An FB is
		// used because TwinCAT skips unreferenced POUs, and `ensureCompiles` declares an instance in the main
		// program so the body is actually reached on both vendors.
		const name = id("splice_build")
		const full = inFolder(await projectRoot(), fid("splice_build", "pou"))
		const src = `FUNCTION_BLOCK ${name}
VAR
\ta : BOOL;
\tb : BOOL;
\tout1 : BOOL;
\tout2 : BOOL;
END_VAR
%LANGUAGE FBD
%NETWORK
out1 := AND(a, b);
%NETWORK
out2 := OR(a, b);
END_FUNCTION_BLOCK
`
		await createItem(full, src, await projectRoot())
		const v1 = (await fetchItem(full)).sourceText
		const nets1 = networks(v1)

		const pushed = v1.replace(nets1[1], nets1[1].replace("OR(a, b);", "AND(a, NOT b);"))
		const refs = await bridge.refs()
		expect(landed((await bridge.push({
			expectedProjectVersion: refs.projectVersion,
			ops: [{ op: "set", name: full, sourceText: pushed, ifVersion: refs.items[full] }],
		})))).toBe(true)

		await ensureCompiles(name)
	})

	it("re-pushing a spliced body is a fixed point — the splice does not drift on repeat", async () => {
		const name = id("splice_stable")
		const full = inFolder(await projectRoot(), fid("splice_stable", "pou"))
		await createItem(full, twoNetworks(name), await projectRoot())

		const v1 = (await fetchItem(full)).sourceText
		const nets = networks(v1)
		const pushed = v1.replace(nets[1], nets[1].replace("OR(a, b);", "AND(a, NOT b);"))

		const r1 = await bridge.refs()
		expect(landed((await bridge.push({ expectedProjectVersion: r1.projectVersion,
			ops: [{ op: "set", name: full, sourceText: pushed, ifVersion: r1.items[full] }] })))).toBe(true)
		const v2 = (await fetchItem(full)).sourceText

		// Push what came back. Nothing changed, so the whole-body no-op should fire and the document is untouched.
		const r2 = await bridge.refs()
		expect(landed((await bridge.push({ expectedProjectVersion: r2.projectVersion,
			ops: [{ op: "set", name: full, sourceText: v2, ifVersion: r2.items[full] }] })))).toBe(true)
		expect((await fetchItem(full)).sourceText).toBe(v2)
	})
})
