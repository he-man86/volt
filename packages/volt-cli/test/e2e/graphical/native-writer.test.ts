import { landed } from "../harness"
/**
 * THE NATIVE WRITER, LIVE (openspec twincat-inproc-host 2.3) — every shape TwinCAT's PLCopen import refused or reshaped,
 * in LD and FBD, now written as TwinCAT's own archive, and held to everything a body the engineer drew holds:
 *
 *   stores   pushed, it pulls back as the text that was pushed
 *   reload   saved, the solution closed and reopened, it pulls back the same (TwinCAT loads the archive from disk)
 *   build    the project builds with 0 errors with an instance of every one
 *   editor   TwinCAT's own editor opens it
 *   edit     a network added and a value renamed, it pulls back as pushed — and again after a second reload
 *
 * The reload, the editor and the per-shape table are TwinCAT's (CODESYS stores the live object, there is no archive to
 * load); the rest holds on both vendors, so the same text is judged the same way on each. The shapes are the offline
 * suite's (`TcArchiveBuilderTests.BeyondTheImport`), as network text.
 */
import { describe, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { id, fid, bridge, pushOps, requireHealthy, VENDOR, BASE, currentPipe, inFolder, projectRoot } from "../harness"
import { withMainProgramRestored, instantiate, drivenBuild } from "../lib/compile"
import { reopenTwinCatSolution } from "../lib/tc-reopen"
import { openInTwinCatEditor } from "../lib/tc-editor"
import { itGapped, PLATFORM_GAPS } from "../lib/platform"

/** The project's own root (`projectRoot()`), read once the bridge serves — every item here is made there. */
let root = ""
/** The path of the test item `s` at {@link root}. */
const rid = (s: string, ext = "pou") => inFolder(root, fid(s, ext))

const it = itGapped(PLATFORM_GAPS.graphicalWrite)

const FN = id("nw_F")
const VARS =
	"a : BOOL; b : BOOL; c : BOOL; d : BOOL; e : BOOL; go : BOOL; out : BOOL; out1 : BOOL; out2 : BOOL; out3 : BOOL; " +
	"i1 : INT; i2 : INT; n : INT; t1 : TON; pt : TIME; el : TIME;"

/** A contact pair in each language: LD's contacts are infix, FBD's gates are boxes. */
const and = (lang: string, x: string, y: string) => (lang === "LD" ? `${x} AND ${y}` : `AND(${x}, ${y})`)
const or = (lang: string, x: string, y: string) => (lang === "LD" ? `${x} OR ${y}` : `OR(${x}, ${y})`)

/** The shapes: name → the body under `%LANGUAGE <LANG>`. */
const SHAPES: Record<string, (lang: string) => string> = {
	single_consumer_branch: (l) => `%NETWORK\nVAR_TEMP w1 : ANY; END_VAR\nw1 := ${and(l, "a", "b")};\nout := w1;\n`,
	fanout_two_coils: (l) => `%NETWORK\nVAR_TEMP w1 : ANY; END_VAR\nw1 := ${and(l, "a", "b")};\nout1 := w1;\nout2 := w1;\n`,
	leaf_fed_split: () => "%NETWORK\nVAR_TEMP w1 : ANY; END_VAR\nw1 := a;\nout1 := w1;\nout2 := w1;\n",
	rail_pin: () => "%NETWORK\nt1(IN := TRUE, PT := pt);\n",
	pin_to_variable: () => "%NETWORK\nt1(IN := a, PT := pt, ET => el);\n",
	negated_input: (l) => `%NETWORK\nout := ${and(l, "NOT a", "b")};\n`,
	set_coil: () => "%NETWORK\nout S= a;\n",
	reset_coil: (l) => `%NETWORK\nout R= ${and(l, "a", "b")};\n`,
	rising_edge: (l) => `%NETWORK\nout := ${and(l, "RISING(a)", "b")};\n`,
	execute: () => "%NETWORK\nEXECUTE(EN := go, 'n := n + 1;');\n",
	multi_rung: (l) => `%NETWORK\nout1 := ${and(l, "a", "b")};\nout2 := ${or(l, "c", "d")};\nt1(IN := e, PT := pt);\n`,
	assign_below_top: () => "%NETWORK\nt1(IN := (out := go), PT := pt);\n",
	jump_and_label: (l) => `%NETWORK\nJMP(L1, a);\n%NETWORK\nL1:\nout := ${or(l, "a", "b")};\n`,
	return_uncond: (l) => `%NETWORK\nout := ${and(l, "a", "b")};\n%NETWORK\nRETURN;\n`,
	rail_coil: () => "%NETWORK\nout := TRUE;\n",
	empty_network: (l) => `%NETWORK\nout := ${and(l, "a", "b")};\n%NETWORK\n`,
	header: (l) => `%NETWORK "a rung"\n%DISABLED\n// a comment\nHere:\nout := ${and(l, "a", "b")};\n`,
	enable_move: () => "%NETWORK\nout := MOVE(EN := go, b, OUT => out1).ENO;\n",
	function_named: () => `%NETWORK\nn := ${FN}(A := i1, B := i2);\n`,
	named_eno: () => "%NETWORK\nMOVE(EN := go, 7, ENO => out, OUT => n).ENO;\n",
}

const LANGS = ["LD", "FBD"] as const
type Row = { stores?: boolean; reload?: boolean; editor?: boolean; edit?: boolean; reloadEdited?: boolean; note?: string }

describe(`graphical / native writer (${BASE})`, () => {
	setDefaultTimeout(900_000)
	const rows = new Map<string, Row>()
	const cases: { key: string; bare: string; lang: string; item: string; src: string }[] = []
	const twincat = VENDOR === "twincat"
	const instance = process.env.VOLT_E2E_INSTANCE ?? ""

	const fb = (bare: string, lang: string, body: string) =>
		`FUNCTION_BLOCK ${bare}\nVAR\n${VARS.split(";").filter((v) => v.trim()).map((v) => `\t${v.trim()};`).join("\n")}\nEND_VAR\n` +
		`%LANGUAGE ${lang}\n${body}\nEND_FUNCTION_BLOCK\n`

	const pull = async (item: string): Promise<string | undefined> =>
		(await bridge.fetch({ knownItems: {}, onlyItems: [item] })).changed.find((i: any) => i.name === item)?.sourceText

	const clean = async (items: string[]) => {
		const refs = (await bridge.refs()).items ?? {}
		const ops = items.filter((n) => refs[n]).map((name) => ({ op: "deleteItem", name, ifVersion: refs[name] }))
		if (ops.length) await pushOps(ops)
	}

	const reload = async () => {
		const t0 = Date.now()
		reopenTwinCatSolution(currentPipe(), instance)
		const project = (await bridge.projects()).find((p: any) => p.status !== "idle")?.project ?? (await bridge.projects())[0]?.project
		await bridge.connect({ project })
		await requireHealthy()
		return Date.now() - t0
	}

	beforeAll(async () => {
		await requireHealthy()
		root = await projectRoot()
		// VOLT_NW_ONLY=<shape,...> narrows the run while a shape is being measured; unset, every shape runs.
		const only = (process.env.VOLT_NW_ONLY ?? "").split(",").filter((x) => x)
		for (const [shape, body] of Object.entries(SHAPES).filter(([k]) => only.length === 0 || only.includes(k)))
			for (const lang of LANGS) {
				const bare = id(`nw_${shape}_${lang}`)
				cases.push({ key: `${shape} ${lang}`, bare, lang, item: rid(`nw_${shape}_${lang}`, "pou"), src: fb(bare, lang, body(lang)) })
			}
		await clean([...cases.map((c) => c.item), rid("nw_F", "pou")])
		const fn = `FUNCTION ${FN} : INT\nVAR_INPUT\n\tA : INT;\n\tB : INT;\nEND_VAR\n%LANGUAGE ST\n${FN} := A + B;\n\nEND_FUNCTION\n`
		const made = await pushOps([{ op: "set", name: rid("nw_F", "pou"), sourceText: fn, ifVersion: null }])
		expect(landed(made), JSON.stringify(made.conflicts)).toBe(true)
	})

	afterAll(async () => {
		if (rows.size) {
			console.log("\nshape                         stores reload editor edit reload(edit)")
			for (const [k, r] of rows)
				console.log(`${k.padEnd(30)}${[r.stores, r.reload, r.editor, r.edit, r.reloadEdited].map((x) => (x === undefined ? "  -   " : x ? "  ok  " : " FAIL ")).join("")}${r.note ? "  " + r.note : ""}`)
		}
		await clean([...cases.map((c) => c.item), rid("nw_F", "pou")])
	})

	it("every shape is created natively and pulls back as pushed", async () => {
		const failures: string[] = []
		for (const c of cases) {
			const r = await pushOps([{ op: "set", name: c.item, sourceText: c.src, ifVersion: null }])
			const back = landed(r) ? await pull(c.item) : undefined
			const ok = landed(r) && back === c.src
			rows.set(c.key, { stores: ok, note: landed(r) ? undefined : JSON.stringify(r.conflicts).slice(0, 160) })
			if (!ok) failures.push(`${c.key}: ${landed(r) ? `pulled\n${back}` : JSON.stringify(r.conflicts).slice(0, 300)}`)
		}
		expect(failures, failures.join("\n\n")).toEqual([])
	})

	it("every shape survives a save and reload of the solution (TwinCAT loads the archive from disk)", async () => {
		if (!twincat) return // CODESYS holds the live object; there is no stored archive to load
		const ms = await reload()
		console.log(`reload (save, close, reopen, connect): ${ms} ms`)
		const failures: string[] = []
		for (const c of cases) {
			const back = await pull(c.item)
			const ok = back === c.src
			rows.get(c.key)!.reload = ok
			if (!ok) failures.push(`${c.key}: pulled\n${back}`)
		}
		expect(failures, failures.join("\n\n")).toEqual([])
	})

	it("the project builds with 0 errors with every shape instantiated", async () => {
		await withMainProgramRestored(async () => {
			// Only what was STORED: a version that writes no shape (DIALECT V2) has no type to instantiate.
			for (const c of cases) if (rows.get(c.key)?.stores) await instantiate(c.bare)
			const r = await drivenBuild()
			const errors = (r.diagnostics ?? []).filter((d: any) => d.severity === "error")
				.map((d: any) => `${d.name}: ${d.message}`).sort()
			// (An operator read through its ENO with its result wired nowhere did not build — "The assignment target is not
			// specified" — and is refused by name since 2R.6b, X3; the shape here wires its result.)
			expect(errors, JSON.stringify(errors).slice(0, 2000)).toEqual([])
		})
	})

	it("TwinCAT's editor opens every shape", async () => {
		if (!twincat) return // the archive is TwinCAT's; CODESYS's editor reads its own live object
		const opened = openInTwinCatEditor(currentPipe(), instance, cases.map((c) => c.bare))
		const failures: string[] = []
		for (const c of cases) {
			const o = opened[c.bare]
			rows.get(c.key)!.editor = o?.opened ?? false
			if (!o?.opened) failures.push(`${c.key}: ${JSON.stringify(o)}`)
		}
		expect(failures, failures.join("\n")).toEqual([])
	})

	it("a shape TwinCAT never wrote, or does not compile when built, is refused by name and writes nothing", async () => {
		if (!twincat) return // CODESYS builds both from its live object model
		const refused: Record<string, string> = {
			parallel: "%NETWORK\nout := BRANCH(FEED := go, a, b);\n",
			enable_and: "%NETWORK\nout := AND(EN := go, a, b).ENO;\n",
		}
		for (const [shape, body] of Object.entries(refused)) {
			const bare = id(`nw_r_${shape}`)
			const item = rid(`nw_r_${shape}`, "pou")
			await clean([item])
			const r = await pushOps([{ op: "set", name: item, sourceText: fb(bare, "LD", body), ifVersion: null }])
			expect(landed(r), `${shape} was accepted`).toBe(false)
			expect(r.conflicts?.[0]?.code, JSON.stringify(r.conflicts)).toBe("NETWORK_UNSUPPORTED")
			expect((await bridge.refs()).items?.[item], `${shape}: the refused create left the item`).toBeUndefined()
		}
	})

	it("an edit — a network added, a value renamed — writes natively and pulls back as pushed, after a reload too", async () => {
		const failures: string[] = []
		const edited = new Map<string, string>()
		for (const c of cases) {
			const refs = (await bridge.refs()).items ?? {}
			const at = c.src.indexOf("\n%LANGUAGE ")
			const src = c.src.slice(0, at) + c.src.slice(at)
				.replace(/\bb\b/g, "c")
				.replace(/\nEND_FUNCTION_BLOCK\n$/, `%NETWORK\nout3 := ${or(c.lang, "d", "e")};\n\nEND_FUNCTION_BLOCK\n`)
			const r = await pushOps([{ op: "set", name: c.item, sourceText: src, ifVersion: refs[c.item] }])
			const back = landed(r) ? await pull(c.item) : undefined
			// The canonical text the pull writes: the pushed text with a blank line before END_FUNCTION_BLOCK, as created.
			const ok = landed(r) && back === src
			rows.get(c.key)!.edit = ok
			edited.set(c.item, src)
			if (!ok) failures.push(`${c.key}: ${landed(r) ? `pulled\n${back}\npushed\n${src}` : JSON.stringify(r.conflicts).slice(0, 300)}`)
		}
		if (twincat) {
			const ms = await reload()
			console.log(`reload after the edits: ${ms} ms`)
			for (const c of cases) {
				const ok = (await pull(c.item)) === edited.get(c.item)
				rows.get(c.key)!.reloadEdited = ok
				if (!ok) failures.push(`${c.key}: after the reload`)
			}
		}
		expect(failures, failures.join("\n\n")).toEqual([])
	})
})
