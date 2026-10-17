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
import { clientFor, PREFIX, type PipeClient, pathIn, inFolder, fileOf, folderOf } from "./harness"
import { fixturePipeOrSkip } from "./lib/pipe"
import { fb, prog, func, METHOD, ACTION, PROPERTY, structDut, enumDut, gvl, abstractFb, ABSTRACT_METHOD, ABSTRACT_PROPERTY } from "./fixtures"

setDefaultTimeout(60000)

const pipeFor = (vendor: "codesys" | "twincat") => fixturePipeOrSkip(vendor, "vendor-parity")

const cs = pipeFor("codesys")
const tc = pipeFor("twincat")
const BOTH = cs !== undefined && tc !== undefined

/** Whether either fixture serves an item of a stub kind (a visualization, a text list) — the stub-manifest parity case's
 *  witness (openspec bridge-one-to-one 2.3). Neither committed fixture holds one today (2026-10-13), so that case skips
 *  naming why; the offline twin (`WireParityCases`, both drivers' doubles) is its gate until a fixture holds one. */
const STUB_WITNESS = BOTH
	? (await Promise.all([cs!, tc!].map(async (p) => Object.keys((await clientFor(p).refs()).items ?? {}))))
			.flat()
			.some((n) => /\.(visualization|text_list)$/.test(n))
	: false
if (BOTH && !STUB_WITNESS)
	console.log("vendor-parity: the stub-manifest case SKIPPED — neither fixture serves a visualization or a text list")

// Not a capability claim, and not permanent: this is the one suite that needs BOTH IDEs, and a normal run has
// one. It prints why rather than vanishing — a silent skip is how the TwinCAT move test stayed off for an entire
// implementation. Run it with `scripts/ide.ps1 up -Vendor codesys` AND `scripts/ide.ps1 up -Vendor twincat` together
// (the same `-Instance` for both, named by `VOLT_E2E_INSTANCE`).
if (!BOTH)
	console.log(
		`vendor-parity: SKIPPED — needs both bridges up (codesys: ${cs ?? "down"}, twincat: ${tc ?? "down"}). ` +
			`Start both with scripts/ide.ps1 (instance ${process.env.VOLT_E2E_INSTANCE || "(default)"}), then re-run.`,
	)

/** Where each client creates at its project's own root: CODESYS's tree root (the POU pool), TwinCAT's one PLC project
 *  (its tree root holds system projects). Filled in `beforeAll`. */
const roots = new Map<PipeClient, string>()

/** Push one item (by file name: the path refs holds it under, or at its client's root), read it back. Returns the
 *  fetched wire row. */
async function roundTrip(c: PipeClient, name: string, src: string): Promise<any> {
	const refs = await c.refs()
	const path = pathIn(refs.items, name) ?? inFolder(roots.get(c)!, name)
	const r = await c.push({
		expectedProjectVersion: refs.projectVersion,
		ops: [{ op: "set", name: path, sourceText: src, ifVersion: refs.items[path] ?? null }],
	})
	expect(r.accepted).toBe(true)
	const f = await c.fetch({ knownItems: {}, onlyItems: [path] })
	const it = f.changed.find((i: any) => i.name === path)
	if (!it) throw new Error(`${c.pipe}: '${path}' accepted but absent from fetch`)
	return it
}

async function removeIfPresent(c: PipeClient, name: string) {
	const refs = await c.refs()
	const path = pathIn(refs.items, name)
	if (path === undefined) return
	await c.push({ expectedProjectVersion: refs.projectVersion, ops: [{ op: "deleteItem", name: path, ifVersion: refs.items[path] }] })
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
		// Each vendor's own root, read from what its walk states rather than hardcoded: CODESYS's tree root, TwinCAT's one
		// PLC project (`applications`), which would rot the first time a fixture project is rearranged.
		const apps: string[] = (await b.refs()).applications ?? []
		if (apps.length !== 1) throw new Error(`vendor-parity serves one TwinCAT PLC project; ${b.pipe} states ${apps.length}`)
		;[rootA, rootB] = ["", apps[0]!]
		roots.set(a, rootA)
		roots.set(b, rootB)
	})

	// One case per SHAPE, because divergence is shape-specific: it showed up historically in members (TwinCAT
	// dropped FBs with methods) and in declaration-only kinds (the DUT export that answered E_FAIL).
	const cases: [string, string, (n: string) => string][] = [
		["a plain function_block", "pou", (n) => fb(n)],
		["a program", "pou", (n) => prog(n)],
		["a function with a non-INT return", "pou", (n) => func(n)],
		["an FB with a METHOD", "pou", (n) => fb(n, { children: METHOD("Compute") })],
		["an FB with an ACTION", "pou", (n) => fb(n, { children: ACTION("Step") })],
		["an FB with a PROPERTY (both accessors)", "pou", (n) => fb(n, { children: PROPERTY("Ready") })],
		["a struct DUT", "dut", (n) => structDut(n)],
		["an enum DUT", "dut", (n) => enumDut(n)],
		["a GVL", "gvl", (n) => gvl(n)],
		// openspec abstract-member-parity: an abstract member with no code reads `IMPLEMENTATION NONE` on BOTH vendors
		// (TwinCAT pulled `IMPLEMENTATION ST` for its slotted members until then).
		["an abstract FB with an abstract METHOD", "pou", (n) => abstractFb(n, ABSTRACT_METHOD("Pick"))],
		["an abstract FB with an abstract PROPERTY", "pou", (n) => abstractFb(n, ABSTRACT_PROPERTY("Busy"))],
	]

	for (const [label, ext, build] of cases) {
		it(`${label} round-trips IDENTICALLY on both vendors`, async () => {
			const bare = `${PREFIX}_par_${ext}_${label.replace(/[^a-z]/gi, "").slice(0, 10)}`
			const name = `${bare}.${ext}`
			const src = build(bare)
			try {
				const [ra, rb] = await Promise.all([roundTrip(a, name, src), roundTrip(b, name, src)])

				// A fetch row is exactly { name, sourceText, version } — checked against the live wire,
				// not assumed. An earlier draft of this suite compared `row.kind`, which no vendor sends: both
				// sides read `undefined`, the assertion passed on every case, and it proved nothing. Asserting
				// the key set first is what stops that from coming back silently.
				expect(Object.keys(rb).sort()).toEqual(["name", "sourceText", "version"])
				expect(Object.keys(ra).sort()).toEqual(["name", "sourceText", "version"])

				// The payload. Compared exactly, because this is what lands in a file and what git diffs: any
				// difference is a phantom `volt status` diff for a user who switches vendors.
				expect(rb.sourceText).toBe(ra.sourceText)
				expect(fileOf(rb.name)).toBe(fileOf(ra.name))

				// Placement is compared RELATIVE to each vendor's own root, never absolutely — the API layer is
				// byte-identical, the TREE is not, so an absolute equality here would be asserting the vendors are
				// the same product.
				expect(rel(folderOf(rb.name), rootB)).toBe(rel(folderOf(ra.name), rootA))
				expect(rel(folderOf(ra.name), rootA)).toBe("")            // both put a root push at their own root
			} finally {
				await Promise.all([removeIfPresent(a, name), removeIfPresent(b, name)])
			}
		})
	}

	// THE SAME ABSTRACT DECLARATION, ONE TEXT (openspec abstract-member-parity): pushed as `IMPLEMENTATION NONE` and as a
	// pre-fold file (`IMPLEMENTATION ST`, nothing under it), it comes back `IMPLEMENTATION NONE` under the method, the GET
	// and the SET on both bridges — byte-identical four ways.
	it("an abstract method and an abstract property pull IMPLEMENTATION NONE, byte-identical on both vendors", async () => {
		const bare = `${PREFIX}_par_abstract`
		const name = `${bare}.pou`
		const build = (line: string) => abstractFb(bare, ABSTRACT_METHOD("Pick", line) + ABSTRACT_PROPERTY("Busy", line))
		try {
			const rows: any[] = []
			for (const line of ["IMPLEMENTATION NONE", "IMPLEMENTATION ST"])
				rows.push(...(await Promise.all([roundTrip(a, name, build(line)), roundTrip(b, name, build(line))])))
			const lf = (s: string) => s.replace(/\r\n/g, "\n")
			for (const r of rows) expect(lf(r.sourceText)).toBe(lf(rows[0].sourceText))
			const text = lf(rows[0].sourceText)
			expect(text).toContain("METHOD ABSTRACT Pick : INT\nIMPLEMENTATION NONE\nEND_METHOD")
			expect(text.split("\n").filter((l) => l === "IMPLEMENTATION NONE")).toHaveLength(3)
			expect(text).toContain(`FUNCTION_BLOCK ABSTRACT ${bare}`)
			expect(text).toContain("IMPLEMENTATION ST\nx := x + 1;")   // the abstract FB's own body is no member site
		} finally {
			await Promise.all([removeIfPresent(a, name), removeIfPresent(b, name)])
		}
	})

	// ── openspec bridge-one-to-one 2.3: the wire-parity gate's live half (the offline twin is WireParityCases, asserted
	// by both drivers' doubles). Closed by step 3 (design §3).

	/** Every item of `ext` the bridge serves, with its text. */
	async function served(c: PipeClient, ext: string): Promise<{ name: string; text: string }[]> {
		const names = Object.keys((await c.refs()).items ?? {}).filter((n) => n.endsWith(`.${ext}`))
		if (names.length === 0) return []
		const f = await c.fetch({ knownItems: {}, onlyItems: names })
		return (f.changed as any[]).filter((i) => i.name.endsWith(`.${ext}`)).map((i) => ({ name: i.name, text: i.sourceText }))
	}

	// A stub manifest is ONE form on both vendors: the kind alone (`ItemKind.EmptyManifest`). TwinCAT wrote `Name=<name>`.
	;(STUB_WITNESS ? it : it.skip)("every stub manifest (visualization, text list) is the kind alone, on both vendors", async () => {
		for (const c of [a, b])
			for (const [ext, kind] of [["visualization", "visualization"], ["text_list", "text_list"]] as const)
				for (const row of await served(c, ext))
					expect(`${row.name}: ${row.text.replace(/\r\n/g, "\n")}`).toBe(`${row.name}: ${kind}\n`)
	})

	// `SYSTEM` is CODESYS's member alone (TwinCAT has none, tc-library-system, C37): spelled only where it is true, so a
	// non-system reference pulls the same on both vendors. TwinCAT hard-coded `SYSTEM false`; CODESYS spells `false` too.
	it("no library manifest spells SYSTEM false, and TwinCAT's spells no SYSTEM line at all", async () => {
		for (const row of await served(a, "library")) expect(`${row.name}: ${/^SYSTEM false$/m.test(row.text)}`).toBe(`${row.name}: false`)
		for (const row of await served(b, "library")) expect(`${row.name}: ${/^SYSTEM /m.test(row.text)}`).toBe(`${row.name}: false`)
	})

	// An interface property's GET: CODESYS holds an empty declaration, TwinCAT its measured constant PUBLIC/VAR/END_VAR,
	// spelled as that same empty declaration (tc-itf-accessor-decl, D21/D41) — one text on both vendors.
	it("an interface with a property GET pulls byte-identically on both vendors", async () => {
		const bare = `${PREFIX}_par_itf`
		const name = `${bare}.itf`
		const src = `INTERFACE ${bare}\n\nPROPERTY Speed : INT\nGET\nEND_GET\nEND_PROPERTY\n\nEND_INTERFACE\n`
		try {
			const [ra, rb] = await Promise.all([roundTrip(a, name, src), roundTrip(b, name, src)])
			expect(rb.sourceText).toBe(ra.sourceText)
			expect(ra.sourceText.replace(/\r\n/g, "\n")).toBe(src)
		} finally {
			await Promise.all([removeIfPresent(a, name), removeIfPresent(b, name)])
		}
	})

	// Versions are NOT compared across vendors — different projects, so a shared hash would be meaningless. What
	// must hold is that the hash is a function of CONTENT on each side, which is what makes `volt status` quiet
	// after a no-op push. Asserted per vendor, on the same source, in the same test.
	it("an item's version is a function of its content, on both vendors", async () => {
		const bare = `${PREFIX}_par_hash`
		const name = `${bare}.pou`
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
		const name = `${bare}.pou`
		try {
			await Promise.all([
				roundTrip(a, name, fb(bare, { children: METHOD("M") })),
				roundTrip(b, name, fb(bare, { children: METHOD("M") })),
			])
			const [ra, rb] = await Promise.all([a.refs(), b.refs()])
			// The exact SHAPE of `refs`, asserted rather than assumed — this is the assertion that notices a
			// field appearing or vanishing on one vendor and not the other.
			//
			// `unreadable` names the items the walk found and could not materialize: they are tracked in the
			// project hash but deliberately absent from `items`, so without it a POU that failed to read was
			// simply missing, with no error anywhere (DIALECT C7). `unwalkedFolders` is the same idea one level
			// up — a folder the driver could not enumerate, which makes absence meaningless beneath it. `removed` is
			// the engine's removal verdict over the names a client says it knows (`ReadResponse.Removed`, shared with
			// `fetch`): refs carries it since removal is decided once, in the engine, for both read ops.
			const shape = ["applications", "items", "platform", "projectName", "projectVersion", "removed", "unreadable", "unwalkedFolders"]
			expect(Object.keys(ra).sort()).toEqual(shape)
			expect(Object.keys(rb).sort()).toEqual(shape)
			// Asked about no known names, neither vendor can report one removed.
			expect(ra.removed).toEqual([])
			expect(rb.removed).toEqual([])

			// …and BOTH vendors report nothing unreadable for the same push — a parity claim in its own right,
			// since one vendor quietly dropping an item is exactly what this suite exists to catch.
			expect(ra.unreadable).toEqual([])
			expect(rb.unreadable).toEqual([])

			// The ITEM is ONE row keyed by its path on both sides, and a METHOD child does not get a
			// row of its own — the member rides inside its parent's document. That is the structural half of
			// parity: a vendor that surfaced members as separate refs would still round-trip identical TEXT.
			const pa = pathIn(ra.items, name), pb = pathIn(rb.items, name)
			expect(pa).toBeDefined()
			expect(pb).toBeDefined()
			const memberRefs = (r: any, own: string) => Object.keys(r.items).filter((k: string) => fileOf(k).startsWith(`${bare}.`) && k !== own)
			expect(memberRefs(rb, pb!)).toEqual(memberRefs(ra, pa!))
			expect(memberRefs(ra, pa!)).toEqual([])
			expect(rel(folderOf(pb!), rootB)).toBe(rel(folderOf(pa!), rootA))
		} finally {
			await Promise.all([removeIfPresent(a, name), removeIfPresent(b, name)])
		}
	})
})
