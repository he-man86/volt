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
 * <p><b>Cleanup is forced.</b> A DUT whose text states no subtype is written, but cannot be read back: `refs` lists
 * it under `unreadable`, not `items`, so `cleanup()` does not see it and a plain delete is refused UNREADABLE ("push
 * with --force to delete it"). Pulling such a DUT back under its extension is task 5.1; until then this file sweeps
 * its own names with `force`.</p>
 */
import { describe, it, expect, beforeAll, afterEach, afterAll, setDefaultTimeout } from "bun:test"
import { BASE } from "../lib/pipe"
import { bridge, expectVendorDifference } from "../lib/bridge"
import { id, requireHealthy, pushOps, plcFolder, mainProgram, fetchItem, PREFIX } from "../lib/workspace"
import { withMainProgramRestored } from "../lib/compile"

const KEY = "nohdr_"

/** The extension each unreadable name was pushed under: `unreadable` lists BARE names, and a forced delete reaches
 *  the object only under its own kind (a GVL is not reached as `.struct`; a DUT is, under any DUT subtype). */
const pushedAs = new Map<string, string>(
	[["uc_struct", "struct"], ["uc_enum", "enum"], ["uc_gvl", "gvl"], ["uc_fb", "fb"], ["st_enum", "struct"], ["fb_prg", "fb"],
	 ["upd", "fb"], ["empty", "struct"], ["prose", "struct"], ["implm", "struct"], ["retired", "gvl"]].map(([k, e]) => [id(KEY + k), e]),
)

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
 *  under `unreadable`, as a DUT whose text states no subtype is until task 5.1 — and has no readable name. */
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
	// text is one comment and declares nothing. `held` is how the item comes back: a DUT whose text states no subtype
	// is listed `unreadable` (task 5.1); a GVL or a POU is fetched back and must be the text sent.
	const unclosed: {
		key: string; ext: string; text: (b: string) => string; ref: (b: string) => { decl?: string; body?: string }
		errors: (b: string, main: string) => string[]; held: "unreadable" | "fetched"
	}[] = [
		{ key: "uc_struct", ext: "struct", text: (b) => `(* Carrier state\n *\nTYPE ${b} :\nSTRUCT\n\tnPos : INT; (* mm *)\nEND_STRUCT\nEND_TYPE`, ref: (b) => ({ decl: `v : ${b};` }),
		  errors: (b, m) => [`${m}: Unknown type: '${b}'`], held: "unreadable" },
		{ key: "uc_enum", ext: "enum", text: (b) => `(* Modes\n *\nTYPE ${b} :\n(\n\tIdle := 0,\n\tRun\n);\nEND_TYPE`, ref: (b) => ({ decl: `v : ${b};` }),
		  errors: (b, m) => [`${m}: Unknown type: '${b}'`], held: "unreadable" },
		{ key: "uc_gvl", ext: "gvl", text: (b) => `(* Globals\n *\nVAR_GLOBAL\n\t${b}_g : INT;\nEND_VAR`, ref: (b) => ({ decl: "v : INT;", body: `v := ${b}_g;` }),
		  errors: (b, m) => [`${m}: Cannot convert type 'Unknown type: '${b}_g'' to type 'INT'`, `${m}: Identifier '${b}_g' not defined`], held: "fetched" },
		{ key: "uc_fb", ext: "fb", text: (b) => `(* Motor\n *\nFUNCTION_BLOCK ${b}\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\nn := n + 1;\nEND_FUNCTION_BLOCK\n`, ref: (b) => ({ decl: `v : ${b};`, body: "v();" }),
		  errors: (b, m) => [`${m}: Unknown type: '${b}'`, `${m}: Program name, function or function block instance expected instead of 'v'`], held: "fetched" },
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

	it("X.struct whose text is an enum pushes as written; refs names it by what it holds", async () => {
		const bare = id(KEY + "st_enum")
		const text = `TYPE ${bare} :\n(\n\tIdle := 0,\n\tRun\n);\nEND_TYPE`
		const r = await pushReferenceBuild(`${bare}.struct`, text, { decl: `v : ${bare};` })
		expect(r.push.accepted, `refused: ${JSON.stringify(r.push.conflicts)}`).toBe(true)
		expect(r.errors).toEqual([])
		const names = Object.keys((await bridge.refs()).items).filter((n) => n.startsWith(bare))
		expect(names).toEqual([`${bare}.enum`])
		expect((await fetchItem(`${bare}.enum`)).sourceText.trimEnd()).toBe(text)
	})

	/** Measured 2026-09-30 (push-without-header-check 1.2/3.2): a POU text that contradicts its object's kind is held
	 *  as ONE object on both vendors, but which kind it then IS differs. CODESYS takes the text's kind (the object
	 *  becomes a PROGRAM, `refs` names it `.prg`); TwinCAT keeps the tree item it created or had (`refs` still names it
	 *  `.fb`, and a pull renders the declaration it holds under the object's END line: `PROGRAM X … END_FUNCTION_BLOCK`)
	 *  — the POU counterpart of DIALECT C2e's DUT tree code. */
	const TEXT_KIND_WHY = "push-without-header-check 1.2/3.2 (measured 2026-09-30); cf. DIALECT C2e (TwinCAT keeps the tree kind)"
	const heldAs = (bare: string, codesysExt: string, twincatExt: string) =>
		expectVendorDifference(TEXT_KIND_WHY, { codesys: () => `${bare}.${codesysExt}`, twincat: () => `${bare}.${twincatExt}` })

	/** The spec's second scenario: not refused, one object, and it builds when the main program calls it. */
	it("X.fb whose text says PROGRAM is not refused for its header: one item, and it builds", async () => {
		const bare = id(KEY + "fb_prg")
		const r = await pushReferenceBuild(
			`${bare}.fb`,
			`PROGRAM ${bare}\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\nn := 1;\nEND_PROGRAM\n`,
			{ body: `${bare}();` },
		)
		expect(r.push.accepted, `refused: ${JSON.stringify(r.push.conflicts)}`).toBe(true)
		expect(r.errors).toEqual([])
		expect(Object.keys((await bridge.refs()).items).filter((n) => n.startsWith(bare))).toEqual([heldAs(bare, "prg", "fb")])
	})

	/** The same on an UPDATE of a live function block — the case the removed re-type guard's comment said made
	 *  CODESYS clear the body. Measured on both vendors: the body is KEPT, the folder too, the object is never lost or
	 *  duplicated, and pushing the fixed text under the name `refs` now publishes gives back the function block.
	 *
	 *  <p>That is the name a user's workspace pushes it under: the CLI names the pushed item the IDE now publishes
	 *  under another name, and the next pull moves the file there (CODESYS; `Commands.HeldUnderAnotherName`), or
	 *  brings the IDE's text in as the change it is (TwinCAT; `PushedText.SameExceptLayout` reads the END line).
	 *  A push of the fixed text under the ORIGINAL name at the version the client held before is refused by the
	 *  version gate — the item is not there under that name (CODESYS) or changed (TwinCAT) — so it is a "pull first",
	 *  never the re-type guard's "delete and create it", and nothing is written.</p> */
	it("an FB updated with PROGRAM text keeps its body and one identity; the fixed text restores it", async () => {
		const bare = id(KEY + "upd")
		const fbText = (n: number) => `FUNCTION_BLOCK ${bare}\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\nn := ${n};\nEND_FUNCTION_BLOCK\n`
		const folder = await plcFolder("POUs")
		expect((await pushOps([{ op: "set", name: `${bare}.fb`, toFolder: folder, sourceText: fbText(5), ifVersion: null }])).accepted).toBe(true)

		let refs = await bridge.refs()
		const heldBefore = refs.items[`${bare}.fb`]
		const prgText = `PROGRAM ${bare}\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\nn := 6;\nEND_PROGRAM\n`
		const r = await pushOps([{ op: "set", name: `${bare}.fb`, sourceText: prgText, ifVersion: heldBefore }])
		expect(r.accepted, `refused: ${JSON.stringify(r.conflicts)}`).toBe(true)
		refs = await bridge.refs()
		const heldName = heldAs(bare, "prg", "fb")
		expect(Object.keys(refs.items).filter((n) => n.startsWith(bare))).toEqual([heldName])
		const held = await fetchItem(heldName)
		expect(held.sourceText).toMatch(/^PROGRAM /)
		expect(held.sourceText).toMatch(/n := 6;/)
		expect(held.folder).toBe(folder)

		// Under the original name, at the version held before: refused by the gate, and nothing is written.
		const stale = await bridge.push({ ops: [{ op: "set", name: `${bare}.fb`, sourceText: fbText(7), ifVersion: heldBefore }] })
		expect(stale.accepted).toBe(false)
		expect(stale.conflicts.map((c: any) => [c.name, c.code])).toEqual([[`${bare}.fb`,
			expectVendorDifference(TEXT_KIND_WHY, { codesys: () => "ITEM_MISSING", twincat: () => "STALE_ITEM_VERSION" })]])
		expect((await bridge.refs()).items[heldName]).toBe(refs.items[heldName])

		const fixed = await pushOps([{ op: "set", name: heldName, sourceText: fbText(7), ifVersion: refs.items[heldName] }])
		expect(fixed.accepted, `refused: ${JSON.stringify(fixed.conflicts)}`).toBe(true)
		expect(Object.keys((await bridge.refs()).items).filter((n) => n.startsWith(bare))).toEqual([`${bare}.fb`])
		const back = await fetchItem(`${bare}.fb`)
		expect(back.sourceText).toMatch(/^FUNCTION_BLOCK /)
		expect(back.sourceText).toMatch(/n := 7;/)
		expect(back.folder).toBe(folder)
	})

	// ── a DUT or a GVL is not read at all: nothing about its text is a reason to refuse ─────────────

	// `held` recorded live 2026-09-30: a struct member named IMPLEMENTATION is read back byte for byte; an empty text,
	// prose and a GVL holding a retired comment are in the project but listed `unreadable` (task 5.1).
	const unread: { key: string; ext: string; text: (b: string) => string; held: "fetched" | "unreadable" }[] = [
		{ key: "empty", ext: "struct", text: () => "", held: "unreadable" },
		{ key: "prose", ext: "struct", text: () => "this is not structured text at all", held: "unreadable" },
		{ key: "implm", ext: "struct", text: (b) => `TYPE ${b} :\nSTRUCT\n\tIMPLEMENTATION : INT;\nEND_STRUCT\nEND_TYPE`, held: "fetched" },
		{ key: "retired", ext: "gvl", text: (b) => `(* @volt-impl *)\nVAR_GLOBAL\n\t${b}_g : INT;\nEND_VAR`, held: "unreadable" },
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
