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
import { id, fid, bridge, pushOps, requireHealthy, VENDOR, BASE, currentPipe } from "../harness"
import { withMainProgramRestored, instantiate } from "../lib/compile"
import { reopenTwinCatSolution } from "../lib/tc-reopen"
import { openInTwinCatEditor } from "../lib/tc-editor"
import { itGapped, PLATFORM_GAPS } from "../lib/platform"

const it = itGapped(PLATFORM_GAPS.graphicalWrite)

const FN = id("nw_F")
const VARS =
	"a : BOOL; b : BOOL; c : BOOL; d : BOOL; e : BOOL; go : BOOL; out : BOOL; out1 : BOOL; out2 : BOOL; out3 : BOOL; " +
	"i1 : INT; i2 : INT; n : INT; t1 : TON; pt : TIME; el : TIME;"

/** The shapes: name → the body under `IMPLEMENTATION <LANG>`. */
const SHAPES: Record<string, string> = {
	single_consumer_branch: "NETWORK\n  split1 := a AND b;\n  out := split1;\nEND_NETWORK\n",
	fanout_two_coils: "NETWORK\n  split1 := a AND b;\n  out1 := split1;\n  out2 := split1;\nEND_NETWORK\n",
	leaf_fed_split: "NETWORK\n  split1 := a;\n  out1 := split1;\n  out2 := split1;\nEND_NETWORK\n",
	unconnected_pin: "NETWORK\n  t1(IN := , PT := pt);\nEND_NETWORK\n",
	pin_to_variable: "NETWORK\n  t1(IN := a, PT := pt, ET => el);\nEND_NETWORK\n",
	negated_input: "NETWORK\n  out := NOT a AND b;\nEND_NETWORK\n",
	set_coil: "NETWORK\n  out S= a;\nEND_NETWORK\n",
	reset_coil: "NETWORK\n  out R= a AND b;\nEND_NETWORK\n",
	rising_edge: "NETWORK\n  out := R_EDGE(a) AND b;\nEND_NETWORK\n",
	execute: "NETWORK\n  EXECUTE EN go\nn := n + 1;\n  END_EXECUTE;\nEND_NETWORK\n",
	multi_rung: "NETWORK\n  out1 := a AND b;\n  out2 := c OR d;\n  t1(IN := e, PT := pt);\nEND_NETWORK\n",
	assign_below_top: "NETWORK\n  t1(IN := (out := go), PT := pt);\nEND_NETWORK\n",
	jump_and_label: "NETWORK\n  JMP L1 := a;\nEND_NETWORK\nNETWORK LABEL: L1\n  out := a OR b;\nEND_NETWORK\n",
	return_uncond: "NETWORK\n  out := a AND b;\nEND_NETWORK\nNETWORK\n  RETURN;\nEND_NETWORK\n",
	unconnected_coil: "NETWORK\n  out := ;\nEND_NETWORK\n",
	empty_network: "NETWORK\n  out := a AND b;\nEND_NETWORK\nNETWORK\nEND_NETWORK\n",
	header: "NETWORK LABEL: Here DISABLED TITLE: \"a rung\"\n  // a comment\n  out := a AND b;\nEND_NETWORK\n",
	enable_move: "NETWORK\n  MOVE b EN go\n  out := ENO;\nEND_NETWORK\n",
	function_named: `NETWORK\n  n := ${FN}(A := i1, B := i2);\nEND_NETWORK\n`,
}

const LANGS = ["LD", "FBD"] as const
type Row = { stores?: boolean; reload?: boolean; editor?: boolean; edit?: boolean; reloadEdited?: boolean; note?: string }

describe(`graphical / native writer (${BASE})`, () => {
	setDefaultTimeout(900_000)
	const rows = new Map<string, Row>()
	const cases: { key: string; bare: string; item: string; src: string }[] = []
	const twincat = VENDOR === "twincat"
	const instance = process.env.VOLT_E2E_INSTANCE ?? ""

	const fb = (bare: string, lang: string, body: string) =>
		`FUNCTION_BLOCK ${bare}\nVAR\n${VARS.split(";").filter((v) => v.trim()).map((v) => `\t${v.trim()};`).join("\n")}\nEND_VAR\n` +
		`IMPLEMENTATION ${lang}\n${body}\nEND_FUNCTION_BLOCK\n`

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
		// VOLT_NW_ONLY=<shape,...> narrows the run while a shape is being measured; unset, every shape runs.
		const only = (process.env.VOLT_NW_ONLY ?? "").split(",").filter((x) => x)
		for (const [shape, body] of Object.entries(SHAPES).filter(([k]) => only.length === 0 || only.includes(k)))
			for (const lang of LANGS) {
				const bare = id(`nw_${shape}_${lang}`)
				cases.push({ key: `${shape} ${lang}`, bare, item: fid(`nw_${shape}_${lang}`, "pou"), src: fb(bare, lang, body) })
			}
		await clean([...cases.map((c) => c.item), fid("nw_F", "pou")])
		const fn = `FUNCTION ${FN} : INT\nVAR_INPUT\n\tA : INT;\n\tB : INT;\nEND_VAR\nIMPLEMENTATION ST\n${FN} := A + B;\n\nEND_FUNCTION\n`
		const made = await pushOps([{ op: "set", name: fid("nw_F", "pou"), toFolder: "", sourceText: fn, ifVersion: null }])
		expect(made.accepted, JSON.stringify(made.conflicts)).toBe(true)
	})

	afterAll(async () => {
		if (rows.size) {
			console.log("\nshape                         stores reload editor edit reload(edit)")
			for (const [k, r] of rows)
				console.log(`${k.padEnd(30)}${[r.stores, r.reload, r.editor, r.edit, r.reloadEdited].map((x) => (x === undefined ? "  -   " : x ? "  ok  " : " FAIL ")).join("")}${r.note ? "  " + r.note : ""}`)
		}
		await clean([...cases.map((c) => c.item), fid("nw_F", "pou")])
	})

	it("every shape is created natively and pulls back as pushed", async () => {
		const failures: string[] = []
		for (const c of cases) {
			const r = await pushOps([{ op: "set", name: c.item, toFolder: "", sourceText: c.src, ifVersion: null }])
			const back = r.accepted ? await pull(c.item) : undefined
			const ok = r.accepted && back === c.src
			rows.set(c.key, { stores: ok, note: r.accepted ? undefined : JSON.stringify(r.conflicts).slice(0, 160) })
			if (!ok) failures.push(`${c.key}: ${r.accepted ? `pulled\n${back}` : JSON.stringify(r.conflicts).slice(0, 300)}`)
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
			for (const c of cases) await instantiate(c.bare)
			const r = await bridge.build()
			const errors = (r.diagnostics ?? []).filter((d: any) => d.severity === "error")
				.map((d: any) => `${d.name}: ${d.message}`).sort()
			// CODESYS DOES NOT BUILD TWO OF THESE AS ITS WRITER BUILDS THEM — measured 2026-10-17 (cs-native, SP21), the
			// first run of these shapes on CODESYS: an operator read through its ENO with its result wired nowhere keeps an
			// empty operand in the result slot ("The assignment target is not specified", the N21 finding TwinCAT's builder
			// answers with the vendor's null), and a function called by pin name ("The assignment source is incorrect").
			// A ratchet, not a skip: the day CodesysNetworkWriter builds them, this fails — take them off.
			const known = VENDOR === "codesys"
				? cases.filter((c) => c.key.startsWith("enable_move ") || c.key.startsWith("function_named "))
					.map((c) => `${c.item}: ${c.key.startsWith("enable_move ") ? "The assignment target is not specified." : "The assignment source is incorrect."}`)
					.sort()
				: []
			expect(errors, JSON.stringify(errors).slice(0, 2000)).toEqual(known)
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
			parallel: "NETWORK\n  out := go BRANCH (a, b);\nEND_NETWORK\n",
			enable_and: "NETWORK\n  a AND b EN go\n  out := ENO;\nEND_NETWORK\n",
		}
		for (const [shape, body] of Object.entries(refused)) {
			const bare = id(`nw_r_${shape}`)
			const item = fid(`nw_r_${shape}`, "pou")
			await clean([item])
			const r = await pushOps([{ op: "set", name: item, toFolder: "", sourceText: fb(bare, "LD", body), ifVersion: null }])
			expect(r.accepted, `${shape} was accepted`).toBe(false)
			expect(r.conflicts?.[0]?.code, JSON.stringify(r.conflicts)).toBe("NETWORK_UNSUPPORTED")
			expect((await bridge.refs()).items?.[item], `${shape}: the refused create left the item`).toBeUndefined()
		}
	})

	it("an edit — a network added, a value renamed — writes natively and pulls back as pushed, after a reload too", async () => {
		const failures: string[] = []
		const edited = new Map<string, string>()
		for (const c of cases) {
			const refs = (await bridge.refs()).items ?? {}
			const at = c.src.indexOf("\nIMPLEMENTATION ")
			const src = c.src.slice(0, at) + c.src.slice(at)
				.replace(/\bb\b/g, "c")
				.replace(/\nEND_FUNCTION_BLOCK\n$/, "NETWORK\n  out3 := d OR e;\nEND_NETWORK\n\nEND_FUNCTION_BLOCK\n")
			const r = await pushOps([{ op: "set", name: c.item, sourceText: src, ifVersion: refs[c.item] }])
			const back = r.accepted ? await pull(c.item) : undefined
			// The canonical text the pull writes: the pushed text with a blank line before END_FUNCTION_BLOCK, as created.
			const ok = r.accepted && back === src
			rows.get(c.key)!.edit = ok
			edited.set(c.item, src)
			if (!ok) failures.push(`${c.key}: ${r.accepted ? `pulled\n${back}\npushed\n${src}` : JSON.stringify(r.conflicts).slice(0, 300)}`)
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
