/**
 * PUSH DOES NOT PARSE A TOP-LEVEL ITEM'S HEADER — openspec `push-without-header-check`, against a live IDE.
 *
 * <p>A top-level item's kind is its wire name's extension; its text is written as sent and the IDE's BUILD says
 * what is wrong with it. The offline half (`PushWithoutHeaderCheckTests`, against `FakeIde`) pins the engine: no
 * header parse, no header/extension check, no refusal. Only a live IDE can say the other half of the spec's
 * scenario — "a later build reports the error" — and what the IDE makes of a text that contradicts its extension.</p>
 *
 * <p><b>The build only reaches what something references.</b> Measured 2026-09-30 on CODESYS SP21: an unreferenced
 * item is not compiled at all ("The application is up to date", 0 errors, even for `n := ;`); TwinCAT skips
 * unreferenced POUs too (`ensureCompiles`). So every shape here is
 * referenced from the main program before the build, and the error the build reports is where the reference fails
 * (`Unknown type: '<name>'`, `Identifier '<name>_g' not defined`): the item's text read as one comment declares
 * nothing.</p>
 *
 * <p><b>Cleanup is forced.</b> An item the reader refuses (a POU whose header the IDE cannot read) is written, but cannot be
 * read back: `refs` lists it under `unreadable`, not `items`, so `cleanup()` does not see it and a plain delete is
 * refused UNREADABLE ("push with --force to delete it"); this file sweeps its own names with `force`. A DUT is
 * never unreadable for its text: every DUT is `X.dut` by its class (openspec push-without-header-check 5.P), so even
 * an empty or prose DUT is fetched back as sent (re-recorded live on both vendors 2026-10-03, 5.F.1).</p>
 */
import { describe, it, expect, beforeAll, afterEach, afterAll, setDefaultTimeout } from "bun:test"
import { BASE, VENDOR } from "../lib/pipe"
import { bridge } from "../lib/bridge"
import { id, requireHealthy, pushOps, plcFolder, mainProgram, fetchItem, PREFIX } from "../lib/workspace"
import { withMainProgramRestored } from "../lib/compile"

const KEY = "nohdr_"

/** The extension each name that can come back unreadable was pushed under: `unreadable` lists BARE names, and a
 *  forced delete reaches the object only under its own kind. Only this row records `unreadable` (the GVL holding a
 *  retired comment did until openspec bridge-refusal-review 1.4); any other name listed there is a new fact, and the
 *  sweep says so rather than guess its kind. */
const pushedAs = new Map<string, string>([["uc_fb", "pou"]].map(([k, e]) => [id(KEY + k), e]))

/** Delete every item this file made, readable or not. */
async function sweep(): Promise<void> {
	const refs = await bridge.refs()
	const mine = (n: string) => n.startsWith(`${PREFIX}_${KEY}`)
	const ops = [
		...Object.keys(refs.items ?? {}).filter(mine).map((n) => ({ op: "deleteItem", name: n, ifVersion: null })),
		...(refs.unreadable ?? []).filter(mine).map((n: string) => {
			const ext = pushedAs.get(n)
			if (!ext) throw new Error(`'${n}' is unreadable and is no shape of this file — no kind to delete it under`)
			return { op: "deleteItem", name: `${n}.${ext}`, ifVersion: null }
		}),
	]
	if (ops.length === 0) return
	const r = await bridge.push({ expectedProjectVersion: refs.projectVersion, force: true, ops })
	if (!r.accepted) throw new Error(`sweep could not delete ${ops.length} item(s): ${JSON.stringify(r.conflicts).slice(0, 300)}`)
	const left = await bridge.refs()
	const stuck = [...Object.keys(left.items ?? {}), ...(left.unreadable ?? [])].filter(mine)
	if (stuck.length) throw new Error(`sweep left ${JSON.stringify(stuck)} in the project`)
}

/** What the IDE holds after `text` was pushed as `bare.ext` — the half of "pushed as written" an `accepted` cannot
 *  say. `fetched`: `refs` names it `bare.ext` and its text is the text sent (a POU comes back with the blank line
 *  the writer puts above its END line, so blank lines are not compared). `unreadable`: it is in the project — listed
 *  under `unreadable` (a GVL whose text the reader refuses, a POU TwinCAT does not parse) — and has no readable name. */
async function expectHeld(bare: string, ext: string, text: string, held: "fetched" | "unreadable"): Promise<void> {
	const refs = await bridge.refs()
	const names = Object.keys(refs.items).filter((n) => n.slice(0, n.lastIndexOf(".")) === bare)
	const unreadable = (refs.unreadable ?? []).filter((n: string) => n === bare)
	if (held === "unreadable") {
		expect({ names, unreadable }).toEqual({ names: [], unreadable: [bare] })
		return
	}
	expect({ names, unreadable }).toEqual({ names: [`${bare}.${ext}`], unreadable: [] })
	const noBlanks = (t: string) => t.replace(/\n[ \t]*(?=\n)/g, "").trimEnd()
	expect(noBlanks((await fetchItem(`${bare}.${ext}`)).sourceText)).toBe(noBlanks(text))
}

async function errors(): Promise<any[]> {
	return ((await bridge.build()).diagnostics ?? []).filter((d: any) => d.severity === "error")
}

/** Push `text` under `wire`, reference it from the main program (a declaration and/or a body line), build, and hand
 *  back the push receipt and the build's errors. The main program is restored whatever happens. */
async function pushReferenceBuild(
	wire: string,
	text: string,
	ref: { decl?: string; body?: string },
): Promise<{ push: any; errors: any[] }> {
	const folder = await plcFolder("POUs")
	const main = await mainProgram()
	if (!main) throw new Error("the fixture has no main program to reference the item from")
	return withMainProgramRestored(async () => {
		const push = await pushOps([{ op: "set", name: wire, toFolder: folder, sourceText: text, ifVersion: null }])
		const m = await fetchItem(main)
		let src: string = m.sourceText
		if (ref.decl) src = src.replace(/\nEND_VAR/, `\n\t${ref.decl}\nEND_VAR`)
		if (ref.body) src = src.replace(/IMPLEMENTATION ST\n/, `IMPLEMENTATION ST\n${ref.body}\n`)
		const r = await pushOps([{ op: "set", name: main, sourceText: src, ifVersion: m.version }])
		expect(r.accepted, `could not reference '${wire}' from '${main}': ${JSON.stringify(r.conflicts)}`).toBe(true)
		return { push, errors: await errors() }
	})
}

describe(`items / push without header check (${BASE})`, () => {
	setDefaultTimeout(120_000)
	beforeAll(async () => {
		await requireHealthy()
		await sweep()
		// Zero-errors baseline, so every error below is the shape under test (see `ensureCompiles`).
		expect(await errors(), "the fixture must build clean before this file runs").toEqual([])
	})
	afterEach(sweep)
	afterAll(sweep)

	// ── the c802b74d shape: an opening comment that never closes ─────────────────────────────────────
	// Each is pushed as written (the spec's first scenario), and a build that reaches it reports it.

	// `errors` is the build's EXACT answer (message and the item it is reported on), recorded live 2026-09-30 — the
	// oracle LSP parity (tasks 4.1/4.2) is held to. Every one lands on the main program's reference: the item's own
	// text is one comment and declares nothing. `held` is how the item comes back: a DUT or a GVL is fetched back and
	// must be the text sent (the DUT rows were `unreadable` until 5.P; re-recorded live 2026-10-03 on both vendors).
	const unclosed: {
		key: string; ext: string; text: (b: string) => string; ref: (b: string) => { decl?: string; body?: string }
		errors: (b: string, main: string) => string[]; held: "unreadable" | "fetched"
	}[] = [
		{ key: "uc_struct", ext: "dut", text: (b) => `(* Carrier state\n *\nTYPE ${b} :\nSTRUCT\n\tnPos : INT; (* mm *)\nEND_STRUCT\nEND_TYPE`, ref: (b) => ({ decl: `v : ${b};` }),
		  errors: (b, m) => [`${m}: Unknown type: '${b}'`], held: "fetched" },
		{ key: "uc_enum", ext: "dut", text: (b) => `(* Modes\n *\nTYPE ${b} :\n(\n\tIdle := 0,\n\tRun\n);\nEND_TYPE`, ref: (b) => ({ decl: `v : ${b};` }),
		  errors: (b, m) => [`${m}: Unknown type: '${b}'`], held: "fetched" },
		{ key: "uc_gvl", ext: "gvl", text: (b) => `(* Globals\n *\nVAR_GLOBAL\n\t${b}_g : INT;\nEND_VAR`, ref: (b) => ({ decl: "v : INT;", body: `v := ${b}_g;` }),
		  errors: (b, m) => [`${m}: Cannot convert type 'Unknown type: '${b}_g'' to type 'INT'`, `${m}: Identifier '${b}_g' not defined`], held: "fetched" },
		{ key: "uc_fb", ext: "pou", text: (b) => `(* Motor\n *\nFUNCTION_BLOCK ${b}\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\nn := n + 1;\nEND_FUNCTION_BLOCK\n`, ref: (b) => ({ decl: `v : ${b};`, body: "v();" }),
		  // TwinCAT does not parse this text as a POU, so its Solution Explorer caption carries no (FB) and the C2i guard
		  // (5.H) never opens it: listed unreadable as `X.pou`, IN the session that wrote it too (measured 2026-10-02,
		  // 5Qa review). CODESYS reads its class and fetches the text back.
		  errors: (b, m) => [`${m}: Unknown type: '${b}'`, `${m}: Program name, function or function block instance expected instead of 'v'`], held: VENDOR === "twincat" ? "unreadable" : "fetched" },
	]
	for (const s of unclosed) {
		it(`${s.ext} whose opening comment never closes: pushed as written, and the build reports it`, async () => {
			const bare = id(KEY + s.key)
			const main = await mainProgram()
			const r = await pushReferenceBuild(`${bare}.${s.ext}`, s.text(bare), s.ref(bare))
			expect(r.push.accepted, `refused: ${JSON.stringify(r.push.conflicts)}`).toBe(true)
			expect(r.errors.map((e: any) => `${e.name}: ${e.message}`).sort()).toEqual(s.errors(bare, main!).sort())
			await expectHeld(bare, s.ext, s.text(bare), s.held)
		})
	}

	// ── the header is not checked against the extension ─────────────────────────────────────────────

	// Every DUT is `X.dut` (openspec push-without-header-check 5.P): this pushed `X.struct` and expected `X.enum`.
	it("X.dut whose text is an enum pushes as written and keeps its name", async () => {
		const bare = id(KEY + "st_enum")
		const text = `TYPE ${bare} :\n(\n\tIdle := 0,\n\tRun\n);\nEND_TYPE`
		const r = await pushReferenceBuild(`${bare}.dut`, text, { decl: `v : ${bare};` })
		expect(r.push.accepted, `refused: ${JSON.stringify(r.push.conflicts)}`).toBe(true)
		expect(r.errors).toEqual([])
		const names = Object.keys((await bridge.refs()).items).filter((n) => n.startsWith(bare))
		expect(names).toEqual([`${bare}.dut`])
		expect((await fetchItem(`${bare}.dut`)).sourceText.trimEnd()).toBe(text)
	})

	/** A POU text whose kind differs from the object's (push-without-header-check 1.2/3.2, measured 2026-09-30) is held
	 *  as ONE object on both vendors, and since 5.Q it is `X.pou` on both: the wire names a POU by its class, never by
	 *  what its text declares (CODESYS takes the text's kind, TwinCAT's tree code lags it until a reload — DIALECT C2f —
	 *  and neither is read). The pulled file's END line mirrors the header it holds: `PROGRAM X … END_PROGRAM`. */
	/** The spec's second scenario: not refused, one object, and it builds when the main program calls it. */
	it("X.pou whose text says PROGRAM is not refused for its header: one item, and it builds", async () => {
		const bare = id(KEY + "fb_prg")
		const r = await pushReferenceBuild(
			`${bare}.pou`,
			`PROGRAM ${bare}\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\nn := 1;\nEND_PROGRAM\n`,
			{ body: `${bare}();` },
		)
		expect(r.push.accepted, `refused: ${JSON.stringify(r.push.conflicts)}`).toBe(true)
		expect(r.errors).toEqual([])
		expect(Object.keys((await bridge.refs()).items).filter((n) => n.startsWith(bare))).toEqual([`${bare}.pou`])
		expect((await fetchItem(`${bare}.pou`)).sourceText.trimEnd()).toMatch(/\nEND_PROGRAM$/)
	})

	/** The same on an UPDATE of a live function block — the case the removed re-type guard's comment said made
	 *  CODESYS clear the body. Measured on both vendors: the body is KEPT, the folder too, the object is never lost or
	 *  duplicated, and pushing the fixed text gives back the function block.
	 *
	 *  <p>Since 5.Q the name never changes: it is `X.pou` throughout, an ordinary content update each time. A push of
	 *  the fixed text at the version the client held BEFORE the PROGRAM text is refused by the version gate on both
	 *  vendors — the item changed — so it is a "pull first", and nothing is written.</p> */
	it("an FB updated with PROGRAM text keeps its body and one identity; the fixed text restores it", async () => {
		const bare = id(KEY + "upd")
		const fbText = (n: number) => `FUNCTION_BLOCK ${bare}\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\nn := ${n};\nEND_FUNCTION_BLOCK\n`
		const folder = await plcFolder("POUs")
		expect((await pushOps([{ op: "set", name: `${bare}.pou`, toFolder: folder, sourceText: fbText(5), ifVersion: null }])).accepted).toBe(true)

		let refs = await bridge.refs()
		const heldBefore = refs.items[`${bare}.pou`]
		const prgText = `PROGRAM ${bare}\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\nn := 6;\nEND_PROGRAM\n`
		const r = await pushOps([{ op: "set", name: `${bare}.pou`, sourceText: prgText, ifVersion: heldBefore }])
		expect(r.accepted, `refused: ${JSON.stringify(r.conflicts)}`).toBe(true)
		refs = await bridge.refs()
		const heldName = `${bare}.pou`
		expect(Object.keys(refs.items).filter((n) => n.startsWith(bare))).toEqual([heldName])
		const held = await fetchItem(heldName)
		expect(held.sourceText).toMatch(/^PROGRAM /)
		expect(held.sourceText.trimEnd()).toMatch(/\nEND_PROGRAM$/)
		expect(held.sourceText).toMatch(/n := 6;/)
		expect(held.folder).toBe(folder)

		// Under the original name, at the version held before: refused by the gate, and nothing is written.
		const stale = await bridge.push({ ops: [{ op: "set", name: `${bare}.pou`, sourceText: fbText(7), ifVersion: heldBefore }] })
		expect(stale.accepted).toBe(false)
		expect(stale.conflicts.map((c: any) => [c.name, c.code])).toEqual([[`${bare}.pou`, "STALE_ITEM_VERSION"]])
		expect((await bridge.refs()).items[heldName]).toBe(refs.items[heldName])

		const fixed = await pushOps([{ op: "set", name: heldName, sourceText: fbText(7), ifVersion: refs.items[heldName] }])
		expect(fixed.accepted, `refused: ${JSON.stringify(fixed.conflicts)}`).toBe(true)
		expect(Object.keys((await bridge.refs()).items).filter((n) => n.startsWith(bare))).toEqual([`${bare}.pou`])
		const back = await fetchItem(`${bare}.pou`)
		expect(back.sourceText).toMatch(/^FUNCTION_BLOCK /)
		expect(back.sourceText).toMatch(/n := 7;/)
		expect(back.folder).toBe(folder)
	})

	// ── a DUT or a GVL is not read at all: nothing about its text is a reason to refuse ─────────────

	// `held` recorded live 2026-09-30, the DUT rows re-recorded 2026-10-03 on both vendors (5.F.1): a DUT is fetched
	// back as sent whatever its text — empty, prose, a struct member named IMPLEMENTATION. A GVL holding a retired
	// comment was recorded `unreadable` (the pull refused the comment); that refusal is a check on the code and is gone
	// (openspec bridge-refusal-review 1.4), so the row expects `fetched` — not yet re-recorded live.
	const unread: { key: string; ext: string; text: (b: string) => string; held: "fetched" | "unreadable" }[] = [
		{ key: "empty", ext: "dut", text: () => "", held: "fetched" },
		{ key: "prose", ext: "dut", text: () => "this is not structured text at all", held: "fetched" },
		{ key: "implm", ext: "dut", text: (b) => `TYPE ${b} :\nSTRUCT\n\tIMPLEMENTATION : INT;\nEND_STRUCT\nEND_TYPE`, held: "fetched" },
		{ key: "retired", ext: "gvl", text: (b) => `(* @volt-impl *)\nVAR_GLOBAL\n\t${b}_g : INT;\nEND_VAR`, held: "fetched" },
	]
	for (const s of unread) {
		it(`${s.key} under .${s.ext} is pushed as written`, async () => {
			const bare = id(KEY + s.key)
			const r = await pushOps([{ op: "set", name: `${bare}.${s.ext}`, toFolder: await plcFolder("POUs"), sourceText: s.text(bare), ifVersion: null }])
			expect(r.accepted, `refused: ${JSON.stringify(r.conflicts)}`).toBe(true)
			await expectHeld(bare, s.ext, s.text(bare), s.held)
		})
	}
})
