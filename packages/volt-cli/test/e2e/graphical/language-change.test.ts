/**
 * AN EXISTING BODY CHANGES LANGUAGE (ST ⇄ LD/FBD) WHERE THE VENDOR WRITES IT, AND IS REFUSED BY NAME WHERE IT CANNOT
 * (openspec `bridge-refusal-review` 4.7, D7; DIALECT N24).
 *
 * One comparison in the engine (`BodyFormatGuard`) decides that a body changes language; the vendor answers whether it
 * can write it (`IVendorStore.RefusedLanguageChange`). Measured: CODESYS puts a freshly constructed body aspect of the other
 * language on the SAME object — a POU's, a method's, an action's, a property accessor's — and the body builds and runs;
 * TwinCAT has no in-place route at any site. So on CODESYS the push is accepted and the next pull states the new
 * language; on TwinCAT it is refused UNSUPPORTED, naming both languages and the route that exists, and the item is
 * untouched. (Section 8's out-of-scope note keeps the NETWORK_* matrix for the LD/FBD change; this is 4.7's own pair.)
 */
import { describe, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { bridge, id, fid, cleanup, clearTestInstances, createItem, fetchItem, pushOps, requireHealthy, ensureCompiles, BASE, VENDOR, inFolder, projectRoot } from "../harness"

import { itGapped, PLATFORM_GAPS } from "../lib/platform"

/** On a CODESYS version that cannot take an LD/FBD write, every test here must end in that refusal (lib/platform.ts). */
const it = itGapped(PLATFORM_GAPS.graphicalWrite)

setDefaultTimeout(240_000)

/** Push `sourceText` over the item at its current version. */
async function pushOver(full: string, sourceText: string): Promise<any> {
	const refs = await bridge.refs()
	return pushOps([{ op: "set", name: full, sourceText, ifVersion: refs.items[full] }])
}

/** On TwinCAT: the push is refused UNSUPPORTED by name — both languages, the vendor's reason, the route — and the item
 * is exactly what it was. */
async function expectRefusedUntouched(full: string, before: any, r: any, from: string, to: string): Promise<void> {
	expect(r.accepted, `a TwinCAT language change was accepted: ${JSON.stringify(r)}`).toBe(false)
	const conflict = (r.conflicts ?? []).find((c: any) => c.name === full)
	expect(conflict?.code, JSON.stringify(r.conflicts)).toBe("UNSUPPORTED")
	expect(conflict.reason).toContain(`is ${from} in the IDE and pushed as ${to}`)
	expect(conflict.reason).toContain("no route to change an existing body's language in place")
	expect(conflict.reason).toContain("delete it and push it again")
	const after = await fetchItem(full)
	expect(after.version).toBe(before.version)
	expect(after.sourceText).toBe(before.sourceText)
}

describe(`graphical / body language change (${BASE})`, () => {
	beforeAll(async () => { await requireHealthy(); await cleanup() })
	// the instances `ensureCompiles` declared in the main program go first: one of a deleted POU is a build error for every later file
	afterAll(async () => { await clearTestInstances(); await cleanup() })

	it("a POU's own body: ST to LD and back", async () => {
		const name = id("lang_pou")
		const full = inFolder(await projectRoot(), fid("lang_pou", "pou"))
		const st = `FUNCTION_BLOCK ${name}
VAR
	a : BOOL;
	q : BOOL;
END_VAR
IMPLEMENTATION ST
q := a;

END_FUNCTION_BLOCK
`
		await createItem(fid("lang_pou"), st, await projectRoot())
		const pulledSt = (await fetchItem(full)).sourceText
		const ld = pulledSt.replace("IMPLEMENTATION ST\nq := a;\n", "IMPLEMENTATION LD\nNETWORK\n  q := a;\nEND_NETWORK\n")
		expect(ld, "the edit did not apply").not.toBe(pulledSt)

		const before = await fetchItem(full)
		const toLd = await pushOver(full, ld)
		if (VENDOR === "twincat") return expectRefusedUntouched(full, before, toLd, "ST", "LD")

		expect(toLd.accepted, `push refused: ${JSON.stringify(toLd.conflicts)}`).toBe(true)
		expect((await fetchItem(full)).sourceText).toBe(ld)
		await ensureCompiles(name)

		const back = await pushOver(full, pulledSt)
		expect(back.accepted, `push refused: ${JSON.stringify(back.conflicts)}`).toBe(true)
		expect((await fetchItem(full)).sourceText).toBe(pulledSt)
		await ensureCompiles(name)
	})

	it("a METHOD's body: ST to FBD and back", async () => {
		const name = id("lang_meth")
		const full = inFolder(await projectRoot(), fid("lang_meth", "pou"))
		const st = `FUNCTION_BLOCK ${name}
VAR
	a : BOOL;
	q : BOOL;
END_VAR
IMPLEMENTATION ST
Step();

END_FUNCTION_BLOCK

METHOD Step : BOOL
IMPLEMENTATION ST
q := a;

END_METHOD
`
		await createItem(fid("lang_meth"), st, await projectRoot())
		const pulledSt = (await fetchItem(full)).sourceText
		// The ST body's trailing newlines are its own (held verbatim, openspec bridge-one-to-one §1.1); a network body ends
		// at its END_NETWORK, so the edit replaces them with the network.
		const fbd = pulledSt.replace(/(METHOD Step : BOOL\n(?:.*\n)*?)IMPLEMENTATION ST\nq := a;\n\n*/,
		                             "$1IMPLEMENTATION FBD\nNETWORK\n  q := a;\nEND_NETWORK\n")
		expect(fbd, "the edit did not apply").not.toBe(pulledSt)

		const before = await fetchItem(full)
		const toFbd = await pushOver(full, fbd)
		if (VENDOR === "twincat") return expectRefusedUntouched(full, before, toFbd, "ST", "FBD")

		expect(toFbd.accepted, `push refused: ${JSON.stringify(toFbd.conflicts)}`).toBe(true)
		expect((await fetchItem(full)).sourceText).toBe(fbd)
		await ensureCompiles(name)

		const back = await pushOver(full, pulledSt)
		expect(back.accepted, `push refused: ${JSON.stringify(back.conflicts)}`).toBe(true)
		expect((await fetchItem(full)).sourceText).toBe(pulledSt)
		await ensureCompiles(name)
	})

	// The ACTION and the property accessors through Volt's own write path (review of 4a: the "writes at every measured
	// site" answer for them rested on the probe alone, which also measured members only in the FBD view). Each goes
	// ST -> LD -> ST through PushService, WriteMembers / WriteAccessor and the accessor's own site mapping.
	it("an ACTION's body: ST to LD and back", async () => {
		const name = id("lang_act")
		const full = inFolder(await projectRoot(), fid("lang_act", "pou"))
		const st = `FUNCTION_BLOCK ${name}
VAR
	a : BOOL;
	q : BOOL;
END_VAR
IMPLEMENTATION ST
Act();

END_FUNCTION_BLOCK

ACTION Act
IMPLEMENTATION ST
q := a;

END_ACTION
`
		await createItem(fid("lang_act"), st, await projectRoot())
		const pulledSt = (await fetchItem(full)).sourceText
		const ld = pulledSt.replace(/(ACTION Act\n(?:.*\n)*?)IMPLEMENTATION ST\nq := a;\n\n*/,
		                            "$1IMPLEMENTATION LD\nNETWORK\n  q := a;\nEND_NETWORK\n")
		expect(ld, "the edit did not apply").not.toBe(pulledSt)

		const before = await fetchItem(full)
		const toLd = await pushOver(full, ld)
		if (VENDOR === "twincat") return expectRefusedUntouched(full, before, toLd, "ST", "LD")

		expect(toLd.accepted, `push refused: ${JSON.stringify(toLd.conflicts)}`).toBe(true)
		expect((await fetchItem(full)).sourceText).toBe(ld)
		await ensureCompiles(name)

		const back = await pushOver(full, pulledSt)
		expect(back.accepted, `push refused: ${JSON.stringify(back.conflicts)}`).toBe(true)
		expect((await fetchItem(full)).sourceText).toBe(pulledSt)
		await ensureCompiles(name)
	})

	it("a PROPERTY's GET and SET bodies: ST to LD and back", async () => {
		const name = id("lang_prop")
		const full = inFolder(await projectRoot(), fid("lang_prop", "pou"))
		const st = `FUNCTION_BLOCK ${name}
VAR
	a : BOOL;
	q : BOOL;
END_VAR
IMPLEMENTATION ST
Ready := a;

END_FUNCTION_BLOCK

PROPERTY Ready : BOOL
GET
IMPLEMENTATION ST
Ready := a;

END_GET
SET
IMPLEMENTATION ST
q := Ready;

END_SET
END_PROPERTY
`
		await createItem(fid("lang_prop"), st, await projectRoot())
		const pulledSt = (await fetchItem(full)).sourceText
		const ld = pulledSt
			.replace(/(\nGET\n(?:.*\n)*?)IMPLEMENTATION ST\nReady := a;\n\n*/, "$1IMPLEMENTATION LD\nNETWORK\n  Ready := a;\nEND_NETWORK\n")
			.replace(/(\nSET\n(?:.*\n)*?)IMPLEMENTATION ST\nq := Ready;\n\n*/, "$1IMPLEMENTATION LD\nNETWORK\n  q := Ready;\nEND_NETWORK\n")
		expect((ld.match(/IMPLEMENTATION LD/g) ?? []).length, `the edit did not apply:\n${pulledSt}`).toBe(2)

		const before = await fetchItem(full)
		const toLd = await pushOver(full, ld)
		if (VENDOR === "twincat") return expectRefusedUntouched(full, before, toLd, "ST", "LD")

		expect(toLd.accepted, `push refused: ${JSON.stringify(toLd.conflicts)}`).toBe(true)
		expect((await fetchItem(full)).sourceText).toBe(ld)
		await ensureCompiles(name)

		const back = await pushOver(full, pulledSt)
		expect(back.accepted, `push refused: ${JSON.stringify(back.conflicts)}`).toBe(true)
		expect((await fetchItem(full)).sourceText).toBe(pulledSt)
		await ensureCompiles(name)
	})
})
