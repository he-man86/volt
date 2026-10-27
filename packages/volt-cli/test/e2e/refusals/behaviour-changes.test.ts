import { landed } from "../harness"
/**
 * WHAT THIS CHANGE MADE THE BRIDGE DO DIFFERENTLY — proven live on both vendors (openspec `bridge-refusal-review` 8.2).
 *
 * <p>Two directions. The REMOVED code checks now ACCEPT, and the IDE's own build says what is wrong (1.1, 1.2, 2.1, 1.4):
 * a push no longer judges the code. The SILENT DROPS are gone: 4.26 a body at an item with no body slot is not dropped
 * (no wire text reaches such an item as a body — it is written whole, and the build reports it; 4.26b: a `%LANGUAGE`
 * line there, which would be written as code, is refused by name), 4.31 a move into a node
 * that is no folder is refused before anything is written, and D27 a body in a language Volt does not show reads with
 * its declaration and a marker naming the language instead of dropping the POU. Every row runs against every fixture
 * IDE of ours that is up, and — when both are — the two answers must be byte-identical after `normalize` (8.4). The
 * BUILD's messages are not compared: they are each IDE's compiler output (CODESYS quotes the source span with its line
 * breaks, TwinCAT adds a follow-on error — measured on 4.26), the same as a recorded conformance build. The
 * network-text rows (1.3, 1.5, 4.3) wait for the LD/FBD design (owner, 2026-10-03) and are not here. Row 8.4: a rename changes exactly
 * the items the push names, alone and with its caller in the same push (each vendor's own rename differs, DIALECT
 * C2o/C2p; the push puts back what it did not name), and the two vendors leave byte-identical refs and texts.</p>
 *
 * <p>Not live, and why: D27's UNKNOWN view mode / language (a vendor-named marker, `%LANGUAGE UML UNSUPPORTED`)
 * needs an object no fixture holds and SP21 cannot author without an add-on; `CodesysUnknownBodyLanguageTests` and
 * `TcBodyLanguageTests` pin it offline. The CFC row below is the same code path (`NetworkText.ViewLanguage` /
 * `ImplementationMarker.VendorLanguage`) with a language the IDE names.</p>
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { fixturePipeOrSkip } from "../lib/pipe"
import { fb, MARK } from "../fixtures"
import { REF_PREFIX, bindBridge, normalize, pushFresh, refsOf, sweep, type Answer, type Bridge } from "./table"
import { drivenApplication, drivenDiagnostics, fileOf, folderOf, inFolder, mainProgram, pathIn } from "../lib/main-program"

setDefaultTimeout(240_000)

const pipeFor = (vendor: "codesys" | "twincat") => fixturePipeOrSkip(vendor, "refusals/behaviour")
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

/** The driven application's build errors, that application built alone (`applications`, as `drivenBuild`): TwinCAT
 *  MultiProject's Untitled1 carries its own fault, which is no row's, and a failed whole build closes with a line naming
 *  no item that no filter can place. */
async function errors(b: Bridge): Promise<string[]> {
	const apps: string[] = (await refsOf(b)).applications ?? []
	const driven = drivenApplication(apps)
	const r = await b.call("build", apps.length > 1 && driven !== null ? { applications: [driven] } : {})
	const own = drivenDiagnostics(r.diagnostics ?? [], apps)
	return own.filter((d: any) => d.severity === "error").map((d: any) => `${d.name}: ${d.message}`).sort()
}

/** Reference `decl`/`body` from the main program, build, and put the main program back — whatever happens. */
async function buildReferencing(b: Bridge, ref: { decl?: string; body?: string }): Promise<string[]> {
	const main = mainProgram(await refsOf(b)).path
	const m = await fetchOne(b, main)
	if (!m) throw new Error(`${b.vendor}: the fixture has no ${main}`)
	let src: string = m.sourceText
	if (ref.decl) src = src.replace(/\nEND_VAR/, `\n\t${ref.decl}\nEND_VAR`)
	if (ref.body) src = src.replace(/%LANGUAGE ST\n/, `%LANGUAGE ST\n${ref.body}\n`)
	const r = await b.call("push", { ops: [{ op: "set", name: main, sourceText: src, ifVersion: m.version }] })
	try {
		expect(landed(r) && !(r.conflicts ?? []).length, `${b.vendor}: could not reference from ${main}: ${JSON.stringify(r.conflicts)}`).toBe(true)
		return await errors(b)
	} finally {
		const now = await fetchOne(b, main)
		const back = await b.call("push", { ops: [{ op: "set", name: main, sourceText: m.sourceText, ifVersion: now.version }] })
		if (!landed(back)) throw new Error(`${b.vendor}: could not restore ${main}: ${JSON.stringify(back.conflicts)}`)
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
			const r = await pushFresh(b, [{ op: "set", name: b.path(`${bare}.pou`), sourceText: text, ifVersion: null }])
			expect(accepted(r), `${b.vendor}: refused: ${JSON.stringify(r)}`).toBe(true)
			expect(noBlanks((await fetchOne(b, b.path(`${bare}.pou`))).sourceText)).toBe(noBlanks(text))
			const errs = await buildReferencing(b, { decl: `v : ${bare};`, body: "v();" })
			console.log(`[behaviour ${b.vendor}] 1.1 build:`, JSON.stringify(errs))
			expect(errorsOf(errs, bare).length, `${b.vendor}: the build reported nothing at ${bare} for NETWORK under %LANGUAGE ST`).toBeGreaterThan(0)
			return { text: noBlanks((await fetchOne(b, b.path(`${bare}.pou`))).sourceText) }
		},
	},
	{
		key: "1.2",
		title: "1.2 a variable named `implementation` is written, and builds clean",
		run: async (b) => {
			const bare = n("implv")
			const text = fb(bare, { vars: "VAR\n\tx : INT;\n\timplementation : INT;\nEND_VAR", body: "x := implementation;" })
			const r = await pushFresh(b, [{ op: "set", name: b.path(`${bare}.pou`), sourceText: text, ifVersion: null }])
			expect(accepted(r), `${b.vendor}: refused: ${JSON.stringify(r)}`).toBe(true)
			expect(noBlanks((await fetchOne(b, b.path(`${bare}.pou`))).sourceText)).toBe(noBlanks(text))
			const errs = await buildReferencing(b, { decl: `v : ${bare};`, body: "v();" })
			expect(errs, `${b.vendor}: a variable named implementation does not build`).toEqual([])
			return { text: noBlanks((await fetchOne(b, b.path(`${bare}.pou`))).sourceText) }
		},
	},
	{
		key: "2.1",
		title: "2.1 a `(* @volt-x *)` comment in a current ST body is written and read back",
		run: async (b) => {
			const bare = n("retired_st")
			const text = fb(bare, { body: "(* @volt-x *)\nx := x + 1;" })
			const r = await pushFresh(b, [{ op: "set", name: b.path(`${bare}.pou`), sourceText: text, ifVersion: null }])
			expect(accepted(r), `${b.vendor}: refused: ${JSON.stringify(r)}`).toBe(true)
			const back = noBlanks((await fetchOne(b, b.path(`${bare}.pou`))).sourceText)
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
			const r = await pushFresh(b, [{ op: "set", name: b.path(`${bare}.gvl`), sourceText: text, ifVersion: null }])
			expect(accepted(r), `${b.vendor}: refused: ${JSON.stringify(r)}`).toBe(true)
			const refs = await refsOf(b)
			expect((refs.unreadable ?? []).map((u: { name: string }) => fileOf(u.name))).not.toContain(`${bare}.gvl`)
			const back = noBlanks((await fetchOne(b, b.path(`${bare}.gvl`))).sourceText)
			expect(back).toBe(noBlanks(text))
			return { text: back }
		},
	},
	{
		key: "4.26",
		// MEASURED 2026-10-04 on both vendors: no wire text reaches a slotless item AS a body. The reader sends a GVL's
		// whole text as its declaration and a null body (`NoBodySlotIsNullTests`), so a statement after its VAR block is not
		// dropped — it is written as sent, and the build reports it. The drivers' own `RequireSlot` refusal
		// (CodesysNoSlotTextTests, TcNoSlotTextTests) guards every other caller and is unreachable from the wire; the
		// silent drop this row was written for (TwinCAT's kind table dropped the body) cannot happen from a push.
		title: "4.26 a GVL text with a statement after its VAR block is written whole (nothing dropped); the build reports it",
		run: async (b) => {
			const bare = n("gvl_body")
			const name = b.path(`${bare}.gvl`)
			const text = `VAR_GLOBAL
	${bare}_g : INT;
END_VAR
${bare}_g := 1;
`
			const r = await pushFresh(b, [{ op: "set", name, sourceText: text, ifVersion: null }])
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
		key: "4.26b",
		// A `%LANGUAGE` line opens a body, and a GVL has none: the reader refuses it by name (`StReader.RefusePropertyLinesIn`)
		// instead of writing it into the IDE as code — the push's side of the LSP's misplaced-property-line report.
		title: "4.26b a GVL text with a %LANGUAGE ST line is refused INVALID_ST, naming the item and the line; nothing changes",
		run: async (b) => {
			const bare = n("gvl_line")
			const name = b.path(`${bare}.gvl`)
			const before = await refsOf(b)
			const text = `VAR_GLOBAL
	${bare}_g : INT;
END_VAR
${MARK}
${bare}_g := 1;
`
			const r = await pushFresh(b, [{ op: "set", name, sourceText: text, ifVersion: null }])
			const c = r.kind === "push" ? (r.response.conflicts ?? []).find((x: any) => x.name === name) : undefined
			expect(c, `${b.vendor}: a %LANGUAGE line in a GVL was not refused: ${JSON.stringify(r)}`).toBeDefined()
			expect(c.code).toBe("INVALID_ST")
			expect(c.reason).toContain(bare)
			expect(c.reason).toContain(MARK)
			expect(stateOf(await refsOf(b))).toEqual(stateOf(before))
			return normalize(r, b)
		},
	},
	{
		key: "4.31",
		title: "4.31 a move into the library manager (a node that is no folder) is refused in the pre-flight; nothing moves",
		run: async (b) => {
			const bare = n("mv_lib")
			const name = b.path(`${bare}.pou`)
			const create = await pushFresh(b, [{ op: "set", name, sourceText: fb(bare), ifVersion: null }])
			expect(accepted(create), `${b.vendor}: setup create refused: ${JSON.stringify(create)}`).toBe(true)
			const before = await refsOf(b)
			// The library manager node, from where the bridge itself puts a library: the parent of any `.library` folder.
			const lib = Object.keys(before.items).find((k) => k.endsWith(".library"))
			if (!lib) throw new Error(`${b.vendor}: the fixture references no library`)
			const target = folderOf(folderOf(lib))
			const r = await pushFresh(b, [{ op: "set", name, to: inFolder(target, fileOf(name)), sourceText: fb(bare), ifVersion: before.items[name] }])
			console.log(`[behaviour ${b.vendor}] 4.31:`, JSON.stringify(r).slice(0, 600))
			const c = r.kind === "push" ? (r.response.conflicts ?? []).find((x: any) => x.name === name) : undefined
			expect(c, `${b.vendor}: a move into '${target}' was not refused: ${JSON.stringify(r)}`).toBeDefined()
			expect(c.code).toBe("UNSUPPORTED")
			expect(c.reason).toContain(bare)
			expect(stateOf(await refsOf(b))).toEqual(stateOf(before))
			// The target path is each vendor's own tree (CODESYS `…/Application/Library Manager`, TwinCAT `References`) —
			// the representation asymmetry ARCHITECTURE.md keeps; the answer around it must match.
			const node = target.slice(target.lastIndexOf("/") + 1)
			// Masked BEFORE normalize, which drops the root prefix the full target path is spelled with.
			return normalize(JSON.parse(JSON.stringify(r).split(target).join("<library manager>").split(`'${node}'`).join("'<library manager>'")), b)
		},
	},
	{
		key: "D27",
		title: "D27 a CFC body pulls whole — declaration and the language-naming marker, never a dropped POU",
		run: async (b) => {
			const refs = await refsOf(b)
			const cfc = pathIn(refs.items, "VltFixtureCfc.pou", refs.applications)
			expect(cfc, `${b.vendor}: the committed CFC fixture POU is missing from refs`).toBeDefined()
			expect((refs.unreadable ?? []).map((u: { name: string }) => fileOf(u.name))).not.toContain("VltFixtureCfc.pou")
			const text = (await fetchOne(b, cfc!)).sourceText as string
			expect(text).toContain("\n%LANGUAGE CFC UNSUPPORTED\n")
			// Whole: the declaration (its header and its VAR block) stands above the marker — a marker alone is the drop
			// D27 rules out. The KIND is each fixture's own (CODESYS authored a FUNCTION_BLOCK, TwinCAT a PROGRAM).
			const decl = text.slice(0, text.indexOf("\n%LANGUAGE CFC UNSUPPORTED\n"))
			expect(decl, `${b.vendor}: the CFC POU pulled without its declaration header`).toMatch(/^\s*(PROGRAM|FUNCTION_BLOCK) VltFixtureCfc\b/m)
			expect(decl, `${b.vendor}: the CFC POU pulled without its VAR block`).toMatch(/\nEND_VAR\s*$/)
			return { marker: text.split("\n").find((l) => l.startsWith("%LANGUAGE")) }
		},
	},
	{
		key: "8.4",
		title: "8.4 a rename changes exactly the items the push names: alone, and with its caller in the same push",
		run: async (b) => {
			const [fbA, fbB, fnA, fnB, p] = ["ren_fbA", "ren_fbB", "ren_fnA", "ren_fnG", "ren_call"].map(n)
			const callerText = `PROGRAM ${p}\nVAR\n\tinst : ${fbA}; (* an ${fbA} *)\n\tok : BOOL;\nEND_VAR\n${MARK}\ninst();\nok := ${fnA}(a := 1); // calls ${fnA}\nEND_PROGRAM\n`
			const made = await pushFresh(b, [
				{ op: "set", name: b.path(`${fbA}.pou`), ifVersion: null,
				  sourceText: `// ${fbA} helper\nFUNCTION_BLOCK ${fbA}\nVAR\n\tpSelf : POINTER TO ${fbA};\nEND_VAR\n${MARK}\npSelf := 0; // sets ${fbA}\nEND_FUNCTION_BLOCK\n` },
				{ op: "set", name: b.path(`${fnA}.pou`), ifVersion: null,
				  sourceText: `FUNCTION ${fnA} : BOOL\nVAR_INPUT\n\ta : INT;\nEND_VAR\n${MARK}\n${fnA} := a > 0; // sets ${fnA}\nEND_FUNCTION\n` },
				{ op: "set", name: b.path(`${p}.pou`), ifVersion: null, sourceText: callerText },
			])
			expect(accepted(made), `${b.vendor}: setup refused: ${JSON.stringify(made)}`).toBe(true)
			const v0 = (await refsOf(b)).items
			const [fbText, fnText, callText] = await Promise.all([`${fbA}.pou`, `${fnA}.pou`, `${p}.pou`].map(async (x) => (await fetchOne(b, b.path(x))).sourceText as string))

			// Alone: only the headers change; the caller and the items' own references keep the old names.
			const alone = await pushFresh(b, [
				{ op: "set", name: b.path(`${fbA}.pou`), to: b.path(`${fbB}.pou`), ifVersion: v0[b.path(`${fbA}.pou`)] },
				{ op: "set", name: b.path(`${fnA}.pou`), to: b.path(`${fnB}.pou`), ifVersion: v0[b.path(`${fnA}.pou`)] },
			], { returnSources: true })
			expect(accepted(alone), `${b.vendor}: rename refused: ${JSON.stringify(alone)}`).toBe(true)
			const v1 = (await refsOf(b)).items
			expect((await fetchOne(b, b.path(`${fbB}.pou`))).sourceText).toBe(fbText.replace(`FUNCTION_BLOCK ${fbA}\n`, `FUNCTION_BLOCK ${fbB}\n`))
			expect((await fetchOne(b, b.path(`${fnB}.pou`))).sourceText).toBe(fnText.replace(`FUNCTION ${fnA} :`, `FUNCTION ${fnB} :`))
			expect((await fetchOne(b, b.path(`${p}.pou`))).sourceText, `${b.vendor}: the caller changed`).toBe(callText)
			expect(v1[b.path(`${p}.pou`)], `${b.vendor}: the caller's version moved`).toBe(v0[b.path(`${p}.pou`)])
			expect(Object.keys((alone as any).response.newSources ?? {}).sort()).toEqual([b.path(`${fbB}.pou`), b.path(`${fnB}.pou`)].sort())

			// With its caller, the caller FIRST (written before the renames): the caller holds the text sent.
			const sent = callText.replace(`inst : ${fbA};`, `inst : ${fbB};`).replace(`ok := ${fnA}(`, `ok := ${fnB}(`)
			const together = await pushFresh(b, [
				{ op: "set", name: b.path(`${p}.pou`), sourceText: sent, ifVersion: v1[b.path(`${p}.pou`)] },
				{ op: "set", name: b.path(`${fbB}.pou`), to: b.path(`${fbA}.pou`), ifVersion: v1[b.path(`${fbB}.pou`)] },
			])
			expect(accepted(together), `${b.vendor}: rename + caller refused: ${JSON.stringify(together)}`).toBe(true)
			expect((await fetchOne(b, b.path(`${p}.pou`))).sourceText, `${b.vendor}: the caller does not hold the text sent`).toBe(sent)
			expect((await fetchOne(b, b.path(`${fbA}.pou`))).sourceText).toBe(fbText)

			const refs = await refsOf(b)
			const mine = Object.keys(refs.items).filter((k) => fileOf(k).startsWith(n("ren_"))).sort()
			// By file name and text: the path carries each vendor's spine, and a version is hashed over it.
			return Object.fromEntries(await Promise.all(mine.map(async (k) => [fileOf(k), { text: (await fetchOne(b, k)).sourceText }])))
		},
	},
]

function accepted(a: Answer): boolean {
	return a.kind === "push" && landed(a.response) === true && (a.response.conflicts ?? []).length === 0
}

const stateOf = (r: any) => ({ projectVersion: r.projectVersion, items: r.items, unreadable: r.unreadable })

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
