/**
 * CROSS-VENDOR PARITY — the same source pushed to CODESYS and to TwinCAT must come back the same.
 *
 * This is the invariant `ARCHITECTURE.md` opens with: "the parity boundary is the pipe wire (not the driver), so
 * both vendors serve byte-identical responses for the same project". Nothing checked it. `child-roundtrip-parity`
 * is named for it but runs the same assertions against ONE bridge at a time, so it catches "TwinCAT drops FBs
 * with methods" only because that failure is absolute; anything the two vendors do DIFFERENTLY BUT BOTH
 * PLAUSIBLY — a stray blank line, a reordered VAR block, a normalised keyword case — passes twice and is invisible.
 * Divergence like that costs a user a phantom `volt status` diff on every pull after switching vendors, which is
 * the thing the wire-level boundary exists to prevent.
 *
 * So this suite drives BOTH bridges at once, pushes identical source to each, and DIFFS what comes back. It is
 * the only file here that needs two IDEs open simultaneously, which is why it uses `clientFor` rather than the
 * suite's single resolved pipe.
 *
 * What is compared, and what deliberately is not:
 *   - `sourceText` — compared EXACTLY. This is the payload a workspace file is written from and git diffs, so a
 *     one-character difference is a real user-visible difference.
 *   - `kind` — compared exactly. The wire kind is vendor-neutral by definition.
 *   - item VERSIONS and `projectVersion` — NOT compared. These are content hashes over each IDE's own export;
 *     the two projects are different projects, so equality would be meaningless. What IS asserted is that the
 *     hash is a function of content: the same source pushed twice to the same vendor hashes the same.
 */
import { describe, it, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { clientFor, livePipesFor, PREFIX, type PipeClient } from "./harness"
import { fb, prog, func, METHOD, ACTION, PROPERTY, structDut, enumDut, gvl } from "./fixtures"

setDefaultTimeout(60000)

const cs = livePipesFor("codesys")[0]
const tc = livePipesFor("twincat")[0]
const BOTH = cs !== undefined && tc !== undefined

// Not a capability claim, and not permanent: this is the one suite that needs BOTH IDEs, and a normal run has
// one. It prints why rather than vanishing — a silent skip is how the TwinCAT move test stayed off for an entire
// implementation. Run it with `scripts/codesys-pipe.ps1 up` AND `scripts/twincat-instances.ps1 up` together.
if (!BOTH)
	console.log(
		`vendor-parity: SKIPPED — needs both bridges up (codesys: ${cs ?? "down"}, twincat: ${tc ?? "down"}). ` +
			`Start both, then re-run.`,
	)

/** Push one item, read it back. Returns the fetched wire row. */
async function roundTrip(c: PipeClient, name: string, src: string): Promise<any> {
	const refs = await c.refs()
	const r = await c.push({
		expectedProjectVersion: refs.projectVersion,
		ops: [{ op: "set", name, toFolder: "", sourceText: src, ifVersion: refs.items[name] ?? null }],
	})
	expect(r.accepted).toBe(true)
	const f = await c.fetch({ knownItems: {}, onlyItems: [name] })
	const it = f.changed.find((i: any) => i.name === name)
	if (!it) throw new Error(`${c.pipe}: '${name}' accepted but absent from fetch`)
	return it
}

async function removeIfPresent(c: PipeClient, name: string) {
	const refs = await c.refs()
	if (refs.items[name] === undefined) return
	await c.push({ expectedProjectVersion: refs.projectVersion, ops: [{ op: "deleteItem", name, ifVersion: refs.items[name] }] })
}

/** A folder path relative to that vendor's own project root — "" for the root itself.
 *  <p>The absolute paths are NOT comparable and must not be made to look it: CODESYS hangs POUs under
 *  "Device/Plc Logic/Application" and TwinCAT under the PLC project, which is the tree asymmetry
 *  `ARCHITECTURE.md` explicitly refuses to unify. Relative placement is the part that must match, because that
 *  is what a workspace lays out on disk and what a user sees move.</p> */
function rel(folder: string, root: string): string {
	if (root === "") return folder
	if (folder === root) return ""
	return folder.startsWith(root + "/") ? folder.slice(root.length + 1) : folder
}

describe.skipIf(!BOTH)("vendor parity — CODESYS vs TwinCAT, same source, same answer", () => {
	let a: PipeClient
	let b: PipeClient
	let rootA = ""
	let rootB = ""

	beforeAll(async () => {
		a = clientFor(cs!)
		b = clientFor(tc!)
		// TwinCAT XAE starts every project idle and must be told which to serve; on CODESYS this is a harmless
		// re-confirm. Same call, both vendors — the connect op is vendor-neutral too.
		for (const c of [a, b]) {
			const h = await c.health()
			const first = (h.projects ?? [])[0]
			if (first) await c.connect({ project: first.project ?? first.name }).catch(() => {})
		}
		// Learn each vendor's root by MEASURING it — push one item at `toFolder: ""` and see where it lands —
		// rather than hardcoding two path strings that would rot the first time a fixture project is rearranged.
		const probe = `${PREFIX}_par_root.fb`
		;[rootA, rootB] = await Promise.all([a, b].map(async (c) => {
			const row = await roundTrip(c, probe, fb(`${PREFIX}_par_root`))
			await removeIfPresent(c, probe)
			return row.folder as string
		}))
	})

	// One case per SHAPE, because divergence is shape-specific: it showed up historically in members (TwinCAT
	// dropped FBs with methods) and in declaration-only kinds (the DUT export that answered E_FAIL).
	const cases: [string, string, (n: string) => string][] = [
		["a plain function_block", "fb", (n) => fb(n)],
		["a program", "prg", (n) => prog(n)],
		["a function with a non-INT return", "fun", (n) => func(n)],
		["an FB with a METHOD", "fb", (n) => fb(n, { children: METHOD("Compute") })],
		["an FB with an ACTION", "fb", (n) => fb(n, { children: ACTION("Step") })],
		["an FB with a PROPERTY (both accessors)", "fb", (n) => fb(n, { children: PROPERTY("Ready") })],
		["a struct DUT", "dut", (n) => structDut(n)],
		["an enum DUT", "dut", (n) => enumDut(n)],
		["a GVL", "gvl", (n) => gvl(n)],
	]

	for (const [label, ext, build] of cases) {
		it(`${label} round-trips IDENTICALLY on both vendors`, async () => {
			const bare = `${PREFIX}_par_${ext}_${label.replace(/[^a-z]/gi, "").slice(0, 10)}`
			const name = `${bare}.${ext}`
			const src = build(bare)
			try {
				const [ra, rb] = await Promise.all([roundTrip(a, name, src), roundTrip(b, name, src)])

				// A fetch row is exactly { name, folder, sourceText, version } — checked against the live wire,
				// not assumed. An earlier draft of this suite compared `row.kind`, which no vendor sends: both
				// sides read `undefined`, the assertion passed on every case, and it proved nothing. Asserting
				// the key set first is what stops that from coming back silently.
				expect(Object.keys(rb).sort()).toEqual(["folder", "name", "sourceText", "version"])
				expect(Object.keys(ra).sort()).toEqual(["folder", "name", "sourceText", "version"])

				// The payload. Compared exactly, because this is what lands in a file and what git diffs: any
				// difference is a phantom `volt status` diff for a user who switches vendors.
				expect(rb.sourceText).toBe(ra.sourceText)
				expect(rb.name).toBe(ra.name)

				// Placement is compared RELATIVE to each vendor's own root, never absolutely. Measured: a push to
				// `toFolder: ""` lands at "Device/Plc Logic/Application" on CODESYS and at "" on TwinCAT. That is
				// the load-bearing asymmetry the architecture allows — the API layer is byte-identical, the TREE
				// is not — so an equality here would be asserting the vendors are the same product.
				expect(rel(rb.folder, rootB)).toBe(rel(ra.folder, rootA))
				expect(rel(ra.folder, rootA)).toBe("")            // both put a root push at their own root
			} finally {
				await Promise.all([removeIfPresent(a, name), removeIfPresent(b, name)])
			}
		})
	}

	// Versions are NOT compared across vendors — different projects, so a shared hash would be meaningless. What
	// must hold is that the hash is a function of CONTENT on each side, which is what makes `volt status` quiet
	// after a no-op push. Asserted per vendor, on the same source, in the same test.
	it("an item's version is a function of its content, on both vendors", async () => {
		const bare = `${PREFIX}_par_hash`
		const name = `${bare}.fb`
		const src = fb(bare)
		try {
			for (const c of [a, b]) {
				const first = await roundTrip(c, name, src)
				const again = await roundTrip(c, name, src)      // same bytes, pushed twice
				expect(again.version).toBe(first.version)
				expect(again.sourceText).toBe(first.sourceText)
			}
		} finally {
			await Promise.all([removeIfPresent(a, name), removeIfPresent(b, name)])
		}
	})

	// The refs contract is the other half of the wire, and it is where a vendor difference would be structural
	// rather than textual: same push, same set of names, same kinds.
	it("refs reports the same name and kind for the same push on both vendors", async () => {
		const bare = `${PREFIX}_par_refs`
		const name = `${bare}.fb`
		try {
			await Promise.all([
				roundTrip(a, name, fb(bare, { children: METHOD("M") })),
				roundTrip(b, name, fb(bare, { children: METHOD("M") })),
			])
			const [ra, rb] = await Promise.all([a.refs(), b.refs()])
			// `refs` is { projectVersion, structureVersion, items, folders } — again asserted, not assumed.
			expect(Object.keys(rb).sort()).toEqual(["folders", "items", "projectVersion", "structureVersion"])

			// The ITEM is ONE row keyed by its full wire name on both sides, and a METHOD child does not get a
			// row of its own — the member rides inside its parent's document. That is the structural half of
			// parity: a vendor that surfaced members as separate refs would still round-trip identical TEXT.
			expect(Object.keys(ra.items)).toContain(name)
			expect(Object.keys(rb.items)).toContain(name)
			const memberRefs = (r: any) => Object.keys(r.items).filter((k: string) => k.startsWith(`${bare}.`) && k !== name)
			expect(memberRefs(rb)).toEqual(memberRefs(ra))
			expect(memberRefs(ra)).toEqual([])
			expect(rel(rb.folders[name], rootB)).toBe(rel(ra.folders[name], rootA))
		} finally {
			await Promise.all([removeIfPresent(a, name), removeIfPresent(b, name)])
		}
	})
})
