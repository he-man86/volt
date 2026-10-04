/**
 * WHAT THIS CHANGE MADE THE BRIDGE DO DIFFERENTLY — proven live on both vendors (openspec `bridge-refusal-review` 8.2).
 *
 * <p>Two directions. The REMOVED code checks now ACCEPT, and the IDE's own build says what is wrong (1.1, 1.2, 2.1, 1.4):
 * a push no longer judges the code. The SILENT DROPS are gone: 4.26 a body at an item with no body slot is not dropped
 * (no wire text reaches such an item as a body — it is written whole, and the build reports it), 4.31 a move into a node
 * that is no folder is refused before anything is written, and D27 a body in a language Volt does not show reads with
 * its declaration and a marker naming the language instead of dropping the POU. Every row runs against every fixture
 * IDE of ours that is up, and — when both are — the two answers must be byte-identical after `normalize` (8.4). The
 * BUILD's messages are not compared: they are each IDE's compiler output (CODESYS quotes the source span with its line
 * breaks, TwinCAT adds a follow-on error — measured on 4.26), the same as a recorded conformance build. The
 * network-text rows (1.3, 1.5, 4.3) wait for the LD/FBD design (owner, 2026-10-03) and are not here.</p>
 *
 * <p>Not live, and why: D27's UNKNOWN view mode / language (a vendor-named marker, `IMPLEMENTATION UML UNSUPPORTED`)
 * needs an object no fixture holds and SP21 cannot author without an add-on; `CodesysUnknownBodyLanguageTests` and
 * `TcBodyLanguageTests` pin it offline. The CFC row below is the same code path (`NetworkText.ViewLanguage` /
 * `ImplementationMarker.VendorLanguage`) with a language the IDE names.</p>
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { livePipesFor } from "../lib/pipe"
import { fb, MARK } from "../fixtures"
import { REF_PREFIX, bindBridge, normalize, pushFresh, refsOf, sweep, type Answer, type Bridge } from "./table"

setDefaultTimeout(240_000)

function pipeFor(vendor: "codesys" | "twincat"): string | undefined {
	try {
		return livePipesFor(vendor)[0]
	} catch (e) {
		if (process.env[`VOLT_PIPE_${vendor.toUpperCase()}`]) throw e
		console.log(`refusals/behaviour: ${vendor}: ${(e as Error).message}`)
		return undefined
	}
}
const VENDORS = (["codesys", "twincat"] as const).filter((v) => pipeFor(v) !== undefined)

const n = (s: string) => `${REF_PREFIX}${s}`
const noBlanks = (t: string) => t.replace(/\n[ \t]*(?=\n)/g, "").trimEnd()

async function fetchOne(b: Bridge, name: string): Promise<any> {
	const f = await b.call("fetch", { knownItems: {}, onlyItems: [name] })
	return f.changed.find((i: any) => i.name === name)
}

/** The build's errors attributed to one item (its diagnostic's `name` holds the bare name): an error anywhere else in
 *  the fixture — a leftover of another row, a main program not put back — must not stand in for the row's own. */
function errorsOf(errs: string[], bare: string): string[] {
	return errs.filter((e) => e.slice(0, e.indexOf(": ")).includes(bare))
}

async function errors(b: Bridge): Promise<string[]> {
	const r = await b.call("build", {})
	return (r.diagnostics ?? []).filter((d: any) => d.severity === "error").map((d: any) => `${d.name}: ${d.message}`).sort()
}

/** Reference `decl`/`body` from the main program, build, and put the main program back — whatever happens. */
async function buildReferencing(b: Bridge, ref: { decl?: string; body?: string }): Promise<string[]> {
	const main = "PLC_PRG.pou"
	const m = await fetchOne(b, main)
	if (!m) throw new Error(`${b.vendor}: the fixture has no ${main}`)
	let src: string = m.sourceText
	if (ref.decl) src = src.replace(/\nEND_VAR/, `\n\t${ref.decl}\nEND_VAR`)
	if (ref.body) src = src.replace(/IMPLEMENTATION ST\n/, `IMPLEMENTATION ST\n${ref.body}\n`)
	const r = await b.call("push", { ops: [{ op: "set", name: main, sourceText: src, ifVersion: m.version }] })
	try {
		expect(r.accepted && !(r.conflicts ?? []).length, `${b.vendor}: could not reference from ${main}: ${JSON.stringify(r.conflicts)}`).toBe(true)
		return await errors(b)
	} finally {
		const now = await fetchOne(b, main)
		const back = await b.call("push", { ops: [{ op: "set", name: main, sourceText: m.sourceText, ifVersion: now.version }] })
		if (!back.accepted) throw new Error(`${b.vendor}: could not restore ${main}: ${JSON.stringify(back.conflicts)}`)
	}
}

/** What a row hands to the parity half: whatever both vendors must agree on, already vendor-neutral. */
type Seen = Partial<Record<"codesys" | "twincat", unknown>>
const seen = new Map<string, Seen>()
function record(row: string, b: Bridge, value: unknown) {
	const s = seen.get(row) ?? {}
	s[b.vendor] = value
	seen.set(row, s)
}

type Row = { key: string; title: string; run: (b: Bridge) => Promise<unknown> }

const ROWS: Row[] = [
	{
		key: "1.1",
		title: "1.1 an ST body holding NETWORK … END_NETWORK is written as sent; the build reports it",
		run: async (b) => {
			const bare = n("st_net")
			const text = fb(bare, { body: "NETWORK\nx := 1;\nEND_NETWORK" })
			const r = await pushFresh(b, [{ op: "set", name: `${bare}.pou`, toFolder: "", sourceText: text, ifVersion: null }])
			expect(accepted(r), `${b.vendor}: refused: ${JSON.stringify(r)}`).toBe(true)
			expect(noBlanks((await fetchOne(b, `${bare}.pou`)).sourceText)).toBe(noBlanks(text))
			const errs = await buildReferencing(b, { decl: `v : ${bare};`, body: "v();" })
			console.log(`[behaviour ${b.vendor}] 1.1 build:`, JSON.stringify(errs))
			expect(errorsOf(errs, bare).length, `${b.vendor}: the build reported nothing at ${bare} for NETWORK under IMPLEMENTATION ST`).toBeGreaterThan(0)
			return { text: noBlanks((await fetchOne(b, `${bare}.pou`)).sourceText) }
		},
	},
	{
		key: "1.2",
		title: "1.2 a variable named `implementation` is written, and builds clean",
		run: async (b) => {
			const bare = n("implv")
			const text = fb(bare, { vars: "VAR\n\tx : INT;\n\timplementation : INT;\nEND_VAR", body: "x := implementation;" })
			const r = await pushFresh(b, [{ op: "set", name: `${bare}.pou`, toFolder: "", sourceText: text, ifVersion: null }])
			expect(accepted(r), `${b.vendor}: refused: ${JSON.stringify(r)}`).toBe(true)
			expect(noBlanks((await fetchOne(b, `${bare}.pou`)).sourceText)).toBe(noBlanks(text))
			const errs = await buildReferencing(b, { decl: `v : ${bare};`, body: "v();" })
			expect(errs, `${b.vendor}: a variable named implementation does not build`).toEqual([])
			return { text: noBlanks((await fetchOne(b, `${bare}.pou`)).sourceText) }
		},
	},
	{
		key: "2.1",
		title: "2.1 a `(* @volt-x *)` comment in a current ST body is written and read back",
		run: async (b) => {
			const bare = n("retired_st")
			const text = fb(bare, { body: "(* @volt-x *)\nx := x + 1;" })
			const r = await pushFresh(b, [{ op: "set", name: `${bare}.pou`, toFolder: "", sourceText: text, ifVersion: null }])
			expect(accepted(r), `${b.vendor}: refused: ${JSON.stringify(r)}`).toBe(true)
			const back = noBlanks((await fetchOne(b, `${bare}.pou`)).sourceText)
			expect(back).toBe(noBlanks(text))
			return { text: back }
		},
	},
	{
		key: "1.4",
		title: "1.4 a GVL holding a retired `(* @volt-impl *)` comment pulls readable",
		run: async (b) => {
			const bare = n("retired_gvl")
			const text = `(* @volt-impl *)\nVAR_GLOBAL\n\t${bare}_g : INT;\nEND_VAR`
			const r = await pushFresh(b, [{ op: "set", name: `${bare}.gvl`, toFolder: "", sourceText: text, ifVersion: null }])
			expect(accepted(r), `${b.vendor}: refused: ${JSON.stringify(r)}`).toBe(true)
			const refs = await refsOf(b)
			expect(refs.unreadable ?? []).not.toContain(bare)
			const back = noBlanks((await fetchOne(b, `${bare}.gvl`)).sourceText)
			expect(back).toBe(noBlanks(text))
			return { text: back }
		},
	},
	{
		key: "4.26",
		// MEASURED 2026-10-04 on both vendors: no wire text reaches a slotless item AS a body. The reader sends a GVL's
		// whole text as its declaration and a null body (`NoBodySlotIsNullTests`), so a body after an `IMPLEMENTATION ST`
		// line is not dropped — it is written as sent, and the build reports it. The drivers' own `RequireSlot` refusal
		// (CodesysNoSlotTextTests, TcNoSlotTextTests) guards every other caller and is unreachable from the wire; the
		// silent drop this row was written for (TwinCAT's kind table dropped the body) cannot happen from a push.
		title: "4.26 a GVL text with a body after IMPLEMENTATION ST is written whole (nothing dropped); the build reports it",
		run: async (b) => {
			const bare = n("gvl_body")
			const name = `${bare}.gvl`
			const text = `VAR_GLOBAL\n\t${bare}_g : INT;\nEND_VAR\n${MARK}\n${bare}_g := 1;\n`
			const r = await pushFresh(b, [{ op: "set", name, toFolder: "", sourceText: text, ifVersion: null }])
			expect(accepted(r), `${b.vendor}: refused: ${JSON.stringify(r)}`).toBe(true)
			const back = (await fetchOne(b, name)).sourceText
			expect(back, `${b.vendor}: the GVL is not held as sent`).toBe(text)
			const errs = await buildReferencing(b, { decl: "v : INT;", body: `v := ${bare}_g;` })
			console.log(`[behaviour ${b.vendor}] 4.26 build:`, JSON.stringify(errs))
			expect(errorsOf(errs, bare).length, `${b.vendor}: the build reported nothing at ${bare} for a body in a GVL`).toBeGreaterThan(0)
			return { text: back }
		},
	},
	{
		key: "4.31",
		title: "4.31 a move into the library manager (a node that is no folder) is refused in the pre-flight; nothing moves",
		run: async (b) => {
			const bare = n("mv_lib")
			const name = `${bare}.pou`
			const create = await pushFresh(b, [{ op: "set", name, toFolder: "", sourceText: fb(bare), ifVersion: null }])
			expect(accepted(create), `${b.vendor}: setup create refused: ${JSON.stringify(create)}`).toBe(true)
			const before = await refsOf(b)
			// The library manager node, from where the bridge itself puts a library: the parent of any `.library` folder.
			const lib = Object.keys(before.folders).find((k) => k.endsWith(".library"))
			if (!lib) throw new Error(`${b.vendor}: the fixture references no library`)
			const target = before.folders[lib].slice(0, before.folders[lib].lastIndexOf("/"))
			const r = await pushFresh(b, [{ op: "set", name, toFolder: target, sourceText: fb(bare), ifVersion: before.items[name] }])
			console.log(`[behaviour ${b.vendor}] 4.31:`, JSON.stringify(r).slice(0, 600))
			const c = r.kind === "push" ? (r.response.conflicts ?? []).find((x: any) => x.name === name) : undefined
			expect(c, `${b.vendor}: a move into '${target}' was not refused: ${JSON.stringify(r)}`).toBeDefined()
			expect(c.code).toBe("UNSUPPORTED")
			expect(c.reason).toContain(bare)
			expect(stateOf(await refsOf(b))).toEqual(stateOf(before))
			// The target path is each vendor's own tree (CODESYS `…/Application/Library Manager`, TwinCAT `References`) —
			// the representation asymmetry ARCHITECTURE.md keeps; the answer around it must match.
			const node = target.slice(target.lastIndexOf("/") + 1)
			return JSON.parse(
				JSON.stringify(normalize(r, b)).split(target).join("<library manager>").split(`'${node}'`).join("'<library manager>'"),
			)
		},
	},
	{
		key: "D27",
		title: "D27 a CFC body pulls whole — declaration and the language-naming marker, never a dropped POU",
		run: async (b) => {
			const refs = await refsOf(b)
			expect(refs.items["VltFixtureCfc.pou"], `${b.vendor}: the committed CFC fixture POU is missing from refs`).toBeDefined()
			expect(refs.unreadable ?? []).not.toContain("VltFixtureCfc")
			const text = (await fetchOne(b, "VltFixtureCfc.pou")).sourceText as string
			expect(text).toContain("\nIMPLEMENTATION CFC UNSUPPORTED\n")
			// Whole: the declaration (its header and its VAR block) stands above the marker — a marker alone is the drop
			// D27 rules out. The KIND is each fixture's own (CODESYS authored a FUNCTION_BLOCK, TwinCAT a PROGRAM).
			const decl = text.slice(0, text.indexOf("\nIMPLEMENTATION CFC UNSUPPORTED\n"))
			expect(decl, `${b.vendor}: the CFC POU pulled without its declaration header`).toMatch(/^\s*(PROGRAM|FUNCTION_BLOCK) VltFixtureCfc\b/m)
			expect(decl, `${b.vendor}: the CFC POU pulled without its VAR block`).toMatch(/\nEND_VAR\s*$/)
			return { marker: text.split("\n").find((l) => l.startsWith("IMPLEMENTATION")) }
		},
	},
]

function accepted(a: Answer): boolean {
	return a.kind === "push" && a.response.accepted === true && (a.response.conflicts ?? []).length === 0
}

const stateOf = (r: any) => ({ projectVersion: r.projectVersion, items: r.items, folders: r.folders, unreadable: r.unreadable })

for (const vendor of VENDORS) {
	describe(`refusals — behaviour changes, live (${vendor})`, () => {
		let b: Bridge
		beforeAll(async () => {
			b = await bindBridge(pipeFor(vendor)!, vendor)
			await sweep(b)
		})
		afterAll(async () => {
			await sweep(b)
		})
		for (const row of ROWS) {
			it(row.title, async () => {
				try {
					record(row.key, b, await row.run(b))
				} finally {
					await sweep(b)
				}
			})
		}
	})
}

describe.skipIf(VENDORS.length < 2)("refusals — behaviour changes answer identically on both vendors (8.4)", () => {
	for (const row of ROWS) {
		it(`${row.key}: the same answer on both vendors`, () => {
			const s = seen.get(row.key) ?? {}
			expect(s.codesys, "CODESYS row did not run").toBeDefined()
			expect(s.twincat, "TwinCAT row did not run").toBeDefined()
			expect(s.twincat).toEqual(s.codesys)
		})
	}
})
