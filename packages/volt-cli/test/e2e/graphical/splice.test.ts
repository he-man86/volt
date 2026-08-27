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
import { describe, it, expect, beforeAll, beforeEach, afterEach, setDefaultTimeout } from "bun:test"
import { bridge, id, fid, cleanup, requireHealthy, createItem, fetchItem, ensureCompiles,
         savePlcPrg, restorePlcPrg, fixPlcPrg, BASE } from "../harness"

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

NETWORK 0 FBD
  out1 := (a AND b);
END_NETWORK
NETWORK 1 FBD
  out2 := (a OR b);
END_NETWORK
END_PROGRAM
`
}

/** Each `NETWORK n …` block, sliced so concatenation reproduces the original. */
const networks = (src: string): string[] => {
	const heads = [...src.matchAll(/^NETWORK[ \t]+\d+\b/gm)]
	return heads.map((h, i) =>
		src.slice(h.index!, i + 1 < heads.length ? heads[i + 1].index! : src.lastIndexOf("END_NETWORK") + "END_NETWORK".length + 1))
}

describe(`graphical / splice (${BASE})`, () => {
	beforeAll(async () => { await requireHealthy() })
	beforeEach(async () => { await fixPlcPrg(); await cleanup(); await savePlcPrg() })
	afterEach(async () => { await restorePlcPrg() })

	it("a body where only ONE network changed imports cleanly and keeps the other verbatim", async () => {
		const name = id("splice_two")
		const full = fid("splice_two", "prg")
		await createItem(full, twoNetworks(name), "")

		const v1 = (await fetchItem(full)).sourceText
		const nets1 = networks(v1)
		expect(nets1.length).toBe(2)

		// Edit network 1 ONLY. Network 0's text is byte-identical, so the splice must carry it.
		const edited = nets1[1].replace("out2 :=", "out2b :=").replace("(a OR b)", "(a AND NOT b)")
		expect(edited).not.toBe(nets1[1])
		const pushed = v1.replace(nets1[1], edited).replace("\tout2 : BOOL;", "\tout2b : BOOL;")

		const refs = await bridge.refs()
		const r = await bridge.push({
			expectedProjectVersion: refs.projectVersion,
			ops: [{ op: "set", name: full, sourceText: pushed, ifVersion: refs.items[full] }],
		})
		// THE measurement: a part-vendor, part-Volt document is accepted by a real importer.
		expect(r.accepted, `spliced push refused: ${JSON.stringify(r.conflicts)}`).toBe(true)

		const v2 = (await fetchItem(full)).sourceText
		const nets2 = networks(v2)
		expect(nets2.length).toBe(2)
		expect(nets2[0]).toBe(nets1[0])                 // untouched network: carried, unchanged
		expect(v2).toContain("out2b")                   // and the edit really landed
		expect(v2).not.toContain("(a OR b)")
	})

	it("a spliced body still COMPILES — the importer accepted it as a program, not just as XML", async () => {
		// A malformed body can import and still be nonsense; the compiler is the independent oracle. An FB is
		// used because TwinCAT skips unreferenced POUs, and `ensureCompiles` declares an instance in the main
		// program so the body is actually reached on both vendors.
		const name = id("splice_build")
		const full = fid("splice_build", "fb")
		const src = `FUNCTION_BLOCK ${name}
VAR
\ta : BOOL;
\tb : BOOL;
\tout1 : BOOL;
\tout2 : BOOL;
END_VAR

NETWORK 0 FBD
  out1 := (a AND b);
END_NETWORK
NETWORK 1 FBD
  out2 := (a OR b);
END_NETWORK
END_FUNCTION_BLOCK
`
		await createItem(full, src, "")
		const v1 = (await fetchItem(full)).sourceText
		const nets1 = networks(v1)

		const pushed = v1.replace(nets1[1], nets1[1].replace("(a OR b)", "(a AND NOT b)"))
		const refs = await bridge.refs()
		expect((await bridge.push({
			expectedProjectVersion: refs.projectVersion,
			ops: [{ op: "set", name: full, sourceText: pushed, ifVersion: refs.items[full] }],
		})).accepted).toBe(true)

		await ensureCompiles(name)
	})

	it("re-pushing a spliced body is a fixed point — the splice does not drift on repeat", async () => {
		const name = id("splice_stable")
		const full = fid("splice_stable", "prg")
		await createItem(full, twoNetworks(name), "")

		const v1 = (await fetchItem(full)).sourceText
		const nets = networks(v1)
		const pushed = v1.replace(nets[1], nets[1].replace("(a OR b)", "(a AND NOT b)"))

		const r1 = await bridge.refs()
		expect((await bridge.push({ expectedProjectVersion: r1.projectVersion,
			ops: [{ op: "set", name: full, sourceText: pushed, ifVersion: r1.items[full] }] })).accepted).toBe(true)
		const v2 = (await fetchItem(full)).sourceText

		// Push what came back. Nothing changed, so the whole-body no-op should fire and the document is untouched.
		const r2 = await bridge.refs()
		expect((await bridge.push({ expectedProjectVersion: r2.projectVersion,
			ops: [{ op: "set", name: full, sourceText: v2, ifVersion: r2.items[full] }] })).accepted).toBe(true)
		expect((await fetchItem(full)).sourceText).toBe(v2)
	})
})
