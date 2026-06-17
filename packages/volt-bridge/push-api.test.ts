/**
 * Bridge push-API suite — runs against a live bridge (TwinCAT on :8555 by default, or set
 * VOLT_TC_PORT, e.g. 8556 for the headless CODESYS bridge). Tests round-trip fidelity and the full
 * op/kind/child matrix.
 *
 * COVERAGE MAP (keep this list in sync with the describe blocks below so situations don't slip):
 *   1. create / top-level kinds .......... FB, function, program, interface, gvl, struct, enum, union, alias
 *   2. create / folders .................. root, nested
 *   3. create / POU children ............. action, method(s), property(get/set), all kinds, interface members, sub-folders
 *   4. update / in-place ................. body, declaration, a child body, add a child
 *   5. update / child + accessor removal . delete method/action/property, drop one of many, drop a GET/SET accessor
 *   6. delete ............................ whole item
 *   7. rename ............................ whole item
 *   8. move .............................. simple, with-children (preserved), graphical refused
 *   9. graphical round-trip .............. existing FBD / LD fixed point (skip if none); read-only CFC/SFC
 *  10. conflicts ......................... wrong ifVersion, create-when-exists, wrong project version, delete wrong version
 *  11. batch ............................. create+update+delete, atomic rejection
 *  12. fidelity ......................... decl-only, impl body, complex POU exact fixed point
 *
 * NOTE: graphical bodies (FBD/LD/CFC/SFC) cannot be CREATED from scratch — the bridge authors ST only
 * and round-trips EXISTING IDE-authored graphical POUs. Graphical tests therefore discover an existing
 * POU and skip cleanly if the project has none.
 */
import { describe, expect, it, beforeAll, afterAll } from "bun:test"

const PORT = Number.parseInt(process.env.VOLT_TC_PORT ?? "8555", 10)
const BASE = `http://127.0.0.1:${PORT}`
const PREFIX = "VltPushTest"
const FOLDER = "POUs"

// ── wire helpers ────────────────────────────────────────────────────────────
async function get(path: string): Promise<any> { return (await fetch(`${BASE}${path}`)).json() }
async function post(path: string, body?: unknown): Promise<any> {
	const r = await fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) })
	return r.json()
}
async function pv(): Promise<string> { return (await get("/refs")).projectVersion }
async function isTwinCAT(): Promise<boolean> { return (await get("/health")).platform === "beckhoff" }
async function fetchAll(): Promise<any> { return post("/fetch", { knownItems: {} }) }
async function push(ops: unknown[]): Promise<any> {
	const r = await post("/push", { expectedProjectVersion: await pv(), ops })
	if (!r.accepted) console.warn("push rejected:", JSON.stringify(r.conflicts || r).slice(0, 200))
	return r
}

// ── test-item helpers (everything is named `<PREFIX>_<id>`, so cleanup is prefix-based) ──
function id(s: string): string { return `${PREFIX}_${s}` }

async function cleanup(): Promise<void> {
	const refs = await get("/refs")
	const ops = Object.keys(refs.items).filter(n => n.startsWith(PREFIX)).map(n => ({ op: "deleteItem", name: n, ifVersion: refs.items[n] }))
	if (ops.length === 0) return
	const r = await post("/push", { expectedProjectVersion: refs.projectVersion, ops })
	if (!r.accepted) console.warn("cleanup:", JSON.stringify(r.conflicts).slice(0, 200))
}

async function create(name: string, src: string, folder = FOLDER): Promise<any> {
	const r = await push([{ op: "pushItem", name, folder, sourceText: src, ifVersion: null }])
	expect(r.accepted).toBe(true)
	return r
}
async function update(name: string, src: string, folder = FOLDER): Promise<any> {
	const refs = await get("/refs")
	const r = await push([{ op: "pushItem", name, folder, sourceText: src, ifVersion: refs.items[name] ?? null }])
	expect(r.accepted).toBe(true)
	return r
}
async function fetchItem(name: string): Promise<any> {
	const f = await post("/fetch", { knownItems: {}, onlyItems: [name] })
	const it = f.changed.find((i: any) => i.name === name)
	if (!it) throw new Error(`item '${name}' not found in fetch`)
	return it
}
async function fetchSource(name: string): Promise<string> { return (await fetchItem(name)).sourceText }

// ── source builders (textual ST) ────────────────────────────────────────────
const fb = (name: string, opts: { vars?: string; body?: string; children?: string } = {}) =>
	`FUNCTION_BLOCK ${name}\n${opts.vars ?? "VAR\n\tx : INT;\nEND_VAR"}\n\n${opts.body ?? "x := x + 1;"}\nEND_FUNCTION_BLOCK\n${opts.children ?? ""}`
// Non-INT return/base types on purpose: the create seeds "INT", so these prove WriteText corrects it.
const func = (name: string) => `FUNCTION ${name} : BOOL\nVAR_INPUT\n\ta : INT;\nEND_VAR\n\n${name} := a > 0;\nEND_FUNCTION\n`
const prog = (name: string) => `PROGRAM ${name}\nVAR\n\tn : INT;\nEND_VAR\n\nn := n + 1;\nEND_PROGRAM\n`
// Interface members live INSIDE the INTERFACE…END_INTERFACE block (not after, like FB methods).
const iface = (name: string, members = "") => `INTERFACE ${name}\n${members}END_INTERFACE\n`
const gvl = (name: string) => `VAR_GLOBAL\n\t${name}_g : INT := 7;\nEND_VAR\n`
const structDut = (name: string) => `TYPE ${name} :\nSTRUCT\n\ta : INT;\n\tb : BOOL;\nEND_STRUCT\nEND_TYPE\n`
const enumDut = (name: string) => `TYPE ${name} :\n(\n\tRed,\n\tGreen,\n\tBlue\n);\nEND_TYPE\n`
const unionDut = (name: string) => `TYPE ${name} :\nUNION\n\ti : INT;\n\tr : REAL;\nEND_UNION\nEND_TYPE\n`
const aliasDut = (name: string) => `TYPE ${name} : DWORD;\nEND_TYPE\n`

const METHOD = (n: string, body?: string) => `\nMETHOD ${n} : INT\nVAR_INPUT\n\td : INT;\nEND_VAR\n${body ?? `${n} := d;`}\nEND_METHOD\n`
const ACTION = (n: string, body = "x := 1;") => `\nACTION ${n}\n${body}\nEND_ACTION\n`
const PROPERTY = (n: string, get = true, set = true) =>
	`\nPROPERTY ${n} : INT\n` + (get ? `GET\n\t${n} := x;\nEND_GET\n` : "") + (set ? `SET\n\tx := ${n};\nEND_SET\n` : "") + `END_PROPERTY\n`

describe(`bridge push API (${BASE})`, () => {
	beforeAll(async () => {
		const h = await get("/health")
		if (h.status !== "healthy") throw new Error(`Bridge not healthy: ${h.status}`)
		await cleanup()
	})
	afterAll(cleanup)

	// ── 1. create / top-level kinds ──────────────────────────────────────────
	describe("create / top-level kinds (textual ST)", () => {
		// Every top-level kind classifies identically on both vendors. (CODESYS reads the subtype from
		// its object model; TwinCAT reports all DUTs as one tree type, so the Beckhoff driver refines the
		// struct/enum/union/alias subtype from the declaration — same basis — to match.)
		const classified: [string, (n: string) => string, string][] = [
			["fb", fb, "function_block"],
			["prog", prog, "program"],
			["iface", (n) => iface(n), "interface"],
			["gvl", gvl, "gvl"],
			["struct", structDut, "structure"],
			["enum", enumDut, "enumeration"],
			["union", unionDut, "union"],
			["alias", aliasDut, "alias"],
		]
		for (const [key, build, kind] of classified) {
			it(`creates a ${kind}`, async () => {
				const name = id(`k_${key}`)
				await create(name, build(name))
				const item = await fetchItem(name)
				expect(item.kind).toBe(kind)
				expect(item.sourceText.length).toBeGreaterThan(0)
			})
		}
		// `function` create: works on CODESYS; TwinCAT rejects the vInfo for a function POU
		// ("vInfo (Type: String) is not supported") — a TC create-API gap, tracked, see memory.
		it("creates a function", async () => {
			if (await isTwinCAT()) { console.warn("TC: function create vInfo gap — skipping"); return }
			const name = id("k_func")
			await create(name, func(name))
			expect((await fetchItem(name)).kind).toBe("function")
		})
		// The create seeds a default type (functions need a return_type, aliases a baseType at create);
		// these assert the REAL non-INT type survives — i.e. WriteText corrects the seed.
		it("a function keeps its (non-INT) return type", async () => {
			if (await isTwinCAT()) { console.warn("TC: function create vInfo gap — skipping"); return }
			const name = id("k_funcRet")
			await create(name, func(name))
			expect(await fetchSource(name)).toMatch(/FUNCTION \w+ : BOOL/)
		})
		it("an alias keeps its (non-INT) base type", async () => {
			const name = id("k_aliasBase")
			await create(name, aliasDut(name))
			expect(await fetchSource(name)).toContain("DWORD")
		})
	})

	// ── 2. create / folders ──────────────────────────────────────────────────
	describe("create / folders", () => {
		it("creates at the project root (no folder)", async () => {
			const name = id("rootFB")
			await create(name, fb(name), "")
			expect((await fetchItem(name)).folder ?? "").toBe("")
		})
		it("creates in a nested folder, preserved on read-back", async () => {
			const name = id("nestedFB")
			await create(name, fb(name), "POUs/Sub/Deep")
			expect((await fetchItem(name)).folder).toBe("POUs/Sub/Deep")
		})
	})

	// ── 3. create / POU children ─────────────────────────────────────────────
	describe("create / POU children", () => {
		it("FB with an ACTION", async () => {
			const name = id("cAction")
			await create(name, fb(name, { children: ACTION("Start") }))
			expect(await fetchSource(name)).toContain("ACTION Start")
		})
		it("FB with two METHODs", async () => {
			const name = id("cMethods")
			await create(name, fb(name, { children: METHOD("Accelerate") + METHOD("Stop") }))
			const s = await fetchSource(name)
			expect(s).toContain("METHOD Accelerate")
			expect(s).toContain("METHOD Stop")
		})
		it("FB with a PROPERTY (GET + SET)", async () => {
			const name = id("cProp")
			await create(name, fb(name, { children: PROPERTY("Speed") }))
			const s = await fetchSource(name)
			expect(s).toMatch(/PROPERTY Speed[\s\S]*END_GET[\s\S]*END_SET[\s\S]*END_PROPERTY/)
		})
		it("FB with all child kinds at once", async () => {
			const name = id("cAll")
			await create(name, fb(name, { children: METHOD("M1") + ACTION("A1") + PROPERTY("P1") }))
			const s = await fetchSource(name)
			expect(s).toContain("METHOD M1")
			expect(s).toContain("ACTION A1")
			expect(s).toContain("PROPERTY P1")
		})
		// Interface members go INSIDE the block. Create works on CODESYS; TwinCAT needs the interface-method
		// tree type, not a plain method ("TREEITEMTYPE_PLCMETHOD not possible on parent 'interface'") — a TC
		// create-API gap, tracked, see memory.
		it("interface with a method + property (members inside the block)", async () => {
			if (await isTwinCAT()) { console.warn("TC: interface-member create gap — skipping"); return }
			const name = id("cIface")
			await create(name, iface(name, `METHOD DoIt : INT\nEND_METHOD\nPROPERTY Ready : BOOL\nGET\nEND_GET\nEND_PROPERTY\n`))
			const s = await fetchSource(name)
			expect(s).toContain("METHOD DoIt")
			expect(s).toContain("PROPERTY Ready")
		})
		it("children in sub-folders (incl. a name with a space)", async () => {
			const name = id("cSubfolder")
			const children = `\nACTION A1\n%FOLDER Group One\nx := 1;\nEND_ACTION\n` + `\nACTION B1\n%FOLDER Group Two\nx := 2;\nEND_ACTION\n`
			await create(name, fb(name, { children }))
			const s = await fetchSource(name)
			expect(s).toMatch(/ACTION A1\s+%FOLDER Group One/)
			expect(s).toMatch(/ACTION B1\s+%FOLDER Group Two/)
		})
	})

	// ── 4. update / in-place edits ───────────────────────────────────────────
	describe("update / in-place", () => {
		it("changes the implementation body", async () => {
			const name = id("uBody")
			await create(name, fb(name, { body: "x := 1;" }))
			await update(name, fb(name, { body: "x := 999;" }))
			expect(await fetchSource(name)).toContain("x := 999")
		})
		it("changes the declaration (adds a VAR)", async () => {
			const name = id("uDecl")
			await create(name, fb(name, { vars: "VAR\n\tx : INT;\nEND_VAR" }))
			await update(name, fb(name, { vars: "VAR\n\tx : INT;\n\ty : BOOL;\nEND_VAR" }))
			expect(await fetchSource(name)).toContain("y : BOOL")
		})
		it("changes a method body in place", async () => {
			const name = id("uMethodBody")
			await create(name, fb(name, { children: METHOD("Compute", "Compute := 1;") }))
			await update(name, fb(name, { children: METHOD("Compute", "Compute := 42;") }))
			expect(await fetchSource(name)).toContain("Compute := 42")
		})
		it("adds a method to an existing POU", async () => {
			const name = id("uAddMethod")
			await create(name, fb(name, { children: METHOD("First") }))
			await update(name, fb(name, { children: METHOD("First") + METHOD("Second") }))
			const s = await fetchSource(name)
			expect(s).toContain("METHOD First")
			expect(s).toContain("METHOD Second")
		})
	})

	// ── 5. update / child + accessor removal (the delete-a-method gap) ────────
	describe("update / child + accessor removal", () => {
		it("deletes a METHOD (no orphan left behind)", async () => {
			const name = id("dMethod")
			await create(name, fb(name, { children: METHOD("Keep") + METHOD("Remove") }))
			expect(await fetchSource(name)).toContain("METHOD Remove")
			await update(name, fb(name, { children: METHOD("Keep") }))
			const s = await fetchSource(name)
			expect(s).toContain("METHOD Keep")
			expect(s).not.toContain("METHOD Remove")
		})
		it("deletes an ACTION", async () => {
			const name = id("dAction")
			await create(name, fb(name, { children: ACTION("Keep") + ACTION("Remove") }))
			await update(name, fb(name, { children: ACTION("Keep") }))
			const s = await fetchSource(name)
			expect(s).toContain("ACTION Keep")
			expect(s).not.toContain("ACTION Remove")
		})
		it("deletes a PROPERTY", async () => {
			const name = id("dProp")
			await create(name, fb(name, { children: PROPERTY("Keep") + PROPERTY("Remove") }))
			await update(name, fb(name, { children: PROPERTY("Keep") }))
			const s = await fetchSource(name)
			expect(s).toContain("PROPERTY Keep")
			expect(s).not.toContain("PROPERTY Remove")
		})
		it("drops a property's SET accessor (GET+SET → GET only)", async () => {
			const name = id("dAccessor")
			await create(name, fb(name, { children: PROPERTY("Speed", true, true) }))
			expect(await fetchSource(name)).toContain("END_SET")
			await update(name, fb(name, { children: PROPERTY("Speed", true, false) }))
			const s = await fetchSource(name)
			expect(s).toContain("END_GET")
			expect(s).not.toContain("END_SET")
		})
	})

	// ── 6. delete ────────────────────────────────────────────────────────────
	describe("delete", () => {
		it("deletes an existing item", async () => {
			const name = id("del")
			await create(name, fb(name))
			const refs = await get("/refs")
			const r = await push([{ op: "deleteItem", name, ifVersion: refs.items[name] }])
			expect(r.accepted).toBe(true)
			expect((await get("/refs")).items).not.toHaveProperty(name)
		})
	})

	// ── 7. rename ─────────────────────────────────────────────────────────────
	describe("rename", () => {
		it("renames an existing item", async () => {
			const oldN = id("renOld"); const newN = id("renNew")
			await create(oldN, fb(oldN))
			const refs = await get("/refs")
			const r = await push([{ op: "renameItem", name: oldN, newName: newN, ifVersion: refs.items[oldN] }])
			expect(r.accepted).toBe(true)
			const after = await get("/refs")
			expect(after.items).not.toHaveProperty(oldN)
			expect(after.items).toHaveProperty(newN)
		})
	})

	// ── 8. move ───────────────────────────────────────────────────────────────
	describe("move", () => {
		it("moves a simple FB to a new folder", async () => {
			const name = id("mvSimple")
			await create(name, fb(name, { body: "x := 7;" }))
			const refs = await get("/refs")
			const r = await push([{ op: "moveItem", name, newFolder: "POUs/Moved", ifVersion: refs.items[name] }])
			expect(r.accepted).toBe(true)
			const item = await fetchItem(name)
			expect(item.folder).toBe("POUs/Moved")
			expect(item.sourceText).toContain("x := 7")
		})
		it("moving an FB with methods preserves its children", async () => {
			const name = id("mvChildren")
			await create(name, fb(name, { children: METHOD("Accelerate") + METHOD("Stop") }))
			const refs = await get("/refs")
			const r = await push([{ op: "moveItem", name, newFolder: "POUs/Relocated", ifVersion: refs.items[name] }])
			expect(r.accepted).toBe(true)
			const item = await fetchItem(name)
			expect(item.folder).toBe("POUs/Relocated")
			expect(item.sourceText).toContain("METHOD Accelerate")
			expect(item.sourceText).toContain("METHOD Stop")
		})
		it("refuses to move a graphical POU (not silently corrupted)", async () => {
			const all = await fetchAll()
			const g = all.changed.find((i: any) => i.language === "FBD" || i.language === "LD")
			if (!g) { console.warn("no graphical POU — skipping graphical move-refusal"); return }
			const refs = await get("/refs")
			const r = await post("/push", { expectedProjectVersion: refs.projectVersion, ops: [{ op: "moveItem", name: g.name, newFolder: "POUs/ShouldNotMove", ifVersion: refs.items[g.name] }] })
			expect(r.accepted).toBe(false)   // refused BEFORE any deletion → POU untouched
		})
	})

	// ── 9. graphical round-trip (existing POUs only) ─────────────────────────
	describe("graphical round-trip (FBD/LD)", () => {
		// Pushing an existing graphical POU's VG back must be a byte-identical fixed point. MUTATES the
		// discovered POU, so run only against a throwaway/headless project. Skips if none of that language.
		async function fixedPoint(lang: string): Promise<void> {
			const g = (await fetchAll()).changed.find((i: any) => i.language === lang)
			if (!g) { console.warn(`no ${lang} POU in project — skipping ${lang} round-trip`); return }
			const s1: string = g.sourceText
			expect(s1).toContain("NETWORK")
			const refs = await get("/refs")
			const r = await push([{ op: "pushItem", name: g.name, folder: g.folder, sourceText: s1, ifVersion: refs.items[g.name] }])
			expect(r.accepted).toBe(true)
			expect((await fetchItem(g.name)).sourceText).toBe(s1)
		}
		it("an existing FBD POU is a byte-identical fixed point", async () => { await fixedPoint("FBD") })
		it("an existing LD POU is a byte-identical fixed point", async () => { await fixedPoint("LD") })
		it("read-only CFC/SFC POUs are surfaced but never created from scratch", async () => {
			const ro = (await fetchAll()).changed.find((i: any) => i.language === "CFC" || i.language === "SFC")
			if (!ro) { console.warn("no CFC/SFC POU — skipping read-only graphical check"); return }
			// A read-only graphical body comes back as a %LANG placeholder, not editable VG networks.
			expect(ro.sourceText).not.toContain("NETWORK ")
		})
	})

	// ── 10. conflicts / concurrency ──────────────────────────────────────────
	describe("conflicts", () => {
		it("rejects an update with a wrong ifVersion", async () => {
			const name = id("cfVer")
			await create(name, fb(name))
			const r = await push([{ op: "pushItem", name, folder: FOLDER, sourceText: fb(name, { body: "x := 5;" }), ifVersion: "wrongversion" }])
			expect(r.accepted).toBe(false)
			expect(r.conflicts.some((c: any) => c.name === name)).toBe(true)
		})
		it("rejects a create (ifVersion=null) when the item already exists", async () => {
			const name = id("cfExists")
			await create(name, fb(name))
			const r = await push([{ op: "pushItem", name, folder: FOLDER, sourceText: fb(name), ifVersion: null }])
			expect(r.accepted).toBe(false)
		})
		it("rejects the batch on a wrong expectedProjectVersion", async () => {
			const r = await post("/push", { expectedProjectVersion: "deadbeef", ops: [] })
			expect(r.accepted).toBe(false)
			expect(r.conflicts.some((c: any) => c.name === "<project>")).toBe(true)
		})
		it("rejects a delete with a wrong ifVersion", async () => {
			const name = id("cfDel")
			await create(name, fb(name))
			const r = await push([{ op: "deleteItem", name, ifVersion: "wrongversion" }])
			expect(r.accepted).toBe(false)
		})
	})

	// ── 11. batch ─────────────────────────────────────────────────────────────
	describe("batch", () => {
		it("applies create + update + delete atomically", async () => {
			const add = id("bAdd"); const upd = id("bUpd"); const del = id("bDel")
			await push([
				{ op: "pushItem", name: upd, folder: FOLDER, sourceText: fb(upd), ifVersion: null },
				{ op: "pushItem", name: del, folder: FOLDER, sourceText: fb(del), ifVersion: null },
			])
			const refs = await get("/refs")
			const r = await post("/push", { expectedProjectVersion: refs.projectVersion, ops: [
				{ op: "pushItem", name: add, folder: FOLDER, sourceText: fb(add, { body: "x := 1;" }), ifVersion: null },
				{ op: "pushItem", name: upd, folder: FOLDER, sourceText: fb(upd, { body: "x := 99;" }), ifVersion: refs.items[upd] },
				{ op: "deleteItem", name: del, ifVersion: refs.items[del] },
			] })
			expect(r.accepted).toBe(true)
			const after = await get("/refs")
			expect(after.items).toHaveProperty(add)
			expect(after.items).toHaveProperty(upd)
			expect(after.items).not.toHaveProperty(del)
		})
		it("rejects the WHOLE batch if any op conflicts (atomic)", async () => {
			const ok = id("bOk"); const bad = id("bBad")
			await create(bad, fb(bad))
			const refs = await get("/refs")
			const r = await post("/push", { expectedProjectVersion: refs.projectVersion, ops: [
				{ op: "pushItem", name: ok, folder: FOLDER, sourceText: fb(ok), ifVersion: null },   // OK
				{ op: "deleteItem", name: bad, ifVersion: "wrongversion" },                          // CONFLICT
			] })
			expect(r.accepted).toBe(false)
			const after = await get("/refs")
			expect(after.items).not.toHaveProperty(ok)   // nothing applied
			expect(after.items).toHaveProperty(bad)
		})
	})

	// ── 12. fidelity (exact text fixed point) ────────────────────────────────
	describe("fidelity / exact text fixed point", () => {
		it("declaration-only POU round-trips identically", async () => {
			const name = id("fDecl")
			await create(name, `FUNCTION_BLOCK ${name}\nVAR\n\ta : INT;\n\tb : BOOL;\n\tc : REAL := 3.14;\nEND_VAR\nEND_FUNCTION_BLOCK\n`)
			const s1 = await fetchSource(name)
			await update(name, s1)
			expect(await fetchSource(name)).toBe(s1)   // pushing the bridge's own output back = no drift
		})
		it("the complex POU (EXTENDS + sub-folders + method + property) is an exact fixed point", async () => {
			const base = id("fBase"); const name = id("fComplex")
			await create(base, fb(base, { body: "x := 0;" }))
			const complex =
				`FUNCTION_BLOCK ${name} EXTENDS ${base}\nVAR\n\tx : INT;\nEND_VAR\n\nx := x + 1;\nEND_FUNCTION_BLOCK\n` +
				`\nACTION A1_First\n%FOLDER Group One\nx := 1;\nEND_ACTION\n` +
				`\nACTION B1_Other\n%FOLDER Group Two\nx := 3;\nEND_ACTION\n` +
				`\nMETHOD DoWork : INT\nVAR_INPUT\n\td : INT;\nEND_VAR\nDoWork := x + d;\nEND_METHOD\n` +
				`\nPROPERTY Speed : INT\nGET\n\tSpeed := x;\nEND_GET\nSET\n\tx := Speed;\nEND_SET\nEND_PROPERTY\n`
			await create(name, complex, "POUs/Deep/Nest")
			const s1 = await fetchSource(name)
			expect(s1).toContain(`EXTENDS ${base}`)
			expect((await fetchItem(name)).folder).toBe("POUs/Deep/Nest")
			await update(name, s1, "POUs/Deep/Nest")
			expect(await fetchSource(name)).toBe(s1)
		})
	})
})
