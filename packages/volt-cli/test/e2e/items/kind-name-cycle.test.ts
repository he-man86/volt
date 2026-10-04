/**
 * EVERY ITEM KEEPS ITS NAME THROUGH A BROKEN → FIXED → CHANGED CYCLE — openspec `push-without-header-check` 5.G.1,
 * through the real `volt` CLI against a live IDE.
 *
 * <p>A wire name carries only what the IDE stores per object (5.P/5.Q): every DUT is `X.dut`, every PROGRAM /
 * FUNCTION_BLOCK / FUNCTION is `X.pou`, an interface `X.itf`, a GVL `X.gvl` — never a name read from the text. So a
 * text that is broken, fixed, or rewritten into another shape of the same object never renames the file. This file
 * drives every 5.A.1 shape (each DUT shape incl. an enum with a base type and an attribute, the six alias shapes, a
 * union, a struct and a struct EXTENDS; PRG / FB / FUN; an interface; a GVL), each first with BROKEN text (an opening
 * comment that never closes, `TYPE X : END_TYPE`, a missing END_TYPE, an empty text, a body that does not parse),
 * through `volt push` → `volt pull` → `volt push` of the fixed text → `volt pull` → an in-place rewrite (struct →
 * enum, PROGRAM → FUNCTION_BLOCK) → `volt push` → `volt pull`, asserting the file names after every pull and the
 * text the IDE holds after every push. The fixed texts then BUILD when referenced from the main program.</p>
 *
 * <p><b>A POU whose text TwinCAT does not parse</b> (DIALECT C2i): written in this load, it is read like any POU on
 * both vendors (bridge-refusal-review 8.4: TwinCAT's system manager still resolves it by path), so the cycle runs the
 * same on both. Only after XAE loads the project again is it `unreadable` on TwinCAT (the refusal matrix's UNREADABLE
 * row pins that state). The CODESYS text-list enum is not here: a push creates a plain DUT, and a
 * text-list enum is a class only the IDE can create (`CodesysTextListEnumTests`, 5.P.1).</p>
 *
 * Local-only (a live bridge and a built volt.exe), like the rest of test/e2e.
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { init, pull, push, setBundledCli } from "@volt/control"
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve, dirname, basename } from "node:path"
import { bridge } from "../lib/bridge"
import { VENDOR, BASE, currentPipe } from "../lib/pipe"
import { id, requireHealthy, mainProgram, fetchItem, PREFIX, landedInFull } from "../lib/workspace"
import { withMainProgramRestored } from "../lib/compile"

const CLI_ROOT = resolve(import.meta.dir, "..", "..", "..")
function exesUnder(dir: string): string[] {
	if (!existsSync(dir)) return []
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? exesUnder(join(dir, e.name)) : e.name === "volt.exe" ? [join(dir, e.name)] : [],
	)
}
const CLI = [...exesUnder(join(CLI_ROOT, "src", "Volt.Cli", "bin")), ...exesUnder(join(CLI_ROOT, "dist", "Cli"))].sort(
	(a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs,
)[0]
if (CLI) setBundledCli(CLI)

const KEY = "cyc_"
const M = "IMPLEMENTATION ST"

interface Shape {
	key: string
	ext: "dut" | "pou" | "itf" | "gvl"
	broken: (b: string) => string
	fixed: (b: string) => string
}

const unclosed = (t: string) => `(* note that never closes\n *\n${t}`
const struct = (b: string) => `TYPE ${b} :\nSTRUCT\n\ta : INT;\n\tb : BOOL;\nEND_STRUCT\nEND_TYPE\n`
const enumOf = (b: string) => `TYPE ${b} :\n(\n\tIdle := 0,\n\tRun\n);\nEND_TYPE\n`
const prg = (b: string) => `PROGRAM ${b}\nVAR\n\tn : INT;\nEND_VAR\n${M}\nn := n + 1;\nEND_PROGRAM\n`
const fbOf = (b: string) => `FUNCTION_BLOCK ${b}\nVAR\n\tn : INT;\nEND_VAR\n${M}\nn := n + 2;\nEND_FUNCTION_BLOCK\n`
const alias = (t: string) => (b: string) => `TYPE ${b} : ${t};\nEND_TYPE\n`

const S = (k: string) => id(KEY + k)
const shapes: Shape[] = [
	{ key: "struct", ext: "dut", broken: (b) => unclosed(struct(b)), fixed: struct },
	{ key: "struct_ext", ext: "dut", broken: (b) => `TYPE ${b} EXTENDS ${S("struct")} :\nSTRUCT\n\tc : REAL;\nEND_STRUCT\n`,
	  fixed: (b) => `TYPE ${b} EXTENDS ${S("struct")} :\nSTRUCT\n\tc : REAL;\nEND_STRUCT\nEND_TYPE\n` },
	{ key: "enum_base", ext: "dut", broken: (b) => `TYPE ${b} : END_TYPE\n`,
	  fixed: (b) => `{attribute 'qualified_only'}\n{attribute 'strict'}\nTYPE ${b} :\n(\n\tIdle := 0,\n\tRun := 5\n) DINT;\nEND_TYPE\n` },
	{ key: "union", ext: "dut", broken: (b) => `TYPE ${b} :\nUNION\n\ti : INT;\n\trv : REAL;\nEND_UNION\n`,
	  fixed: (b) => `TYPE ${b} :\nUNION\n\ti : INT;\n\trv : REAL;\nEND_UNION\nEND_TYPE\n` },
	{ key: "al_elem", ext: "dut", broken: () => "", fixed: alias("DWORD") },
	{ key: "al_str", ext: "dut", broken: (b) => unclosed(alias("STRING(40)")(b)), fixed: alias("STRING(40)") },
	{ key: "al_arr", ext: "dut", broken: (b) => `TYPE ${b} : ARRAY[1..4] OF INT;\n`, fixed: alias("ARRAY[1..4] OF INT") },
	{ key: "al_ptr", ext: "dut", broken: (b) => `TYPE ${b} : END_TYPE\n`, fixed: alias("POINTER TO INT") },
	{ key: "al_ref", ext: "dut", broken: () => "this is not structured text at all", fixed: alias("REFERENCE TO INT") },
	{ key: "al_sub", ext: "dut", broken: (b) => unclosed(alias("INT(0..100)")(b)), fixed: alias("INT(0..100)") },
	// The struct shape is rewritten as an enum in place in the third push (`change` below).
	{ key: "prg", ext: "pou", broken: (b) => unclosed(prg(b)), fixed: prg },
	{ key: "fb", ext: "pou", broken: (b) => unclosed(fbOf(b)), fixed: fbOf },
	{ key: "fun", ext: "pou", broken: (b) => `FUNCTION ${b} : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\n${M}\n${b} := a +;\nEND_FUNCTION\n`,
	  fixed: (b) => `FUNCTION ${b} : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\n${M}\n${b} := a + 1;\nEND_FUNCTION\n` },
	{ key: "itf", ext: "itf", broken: (b) => unclosed(`INTERFACE ${b}\nEND_INTERFACE\n`),
	  fixed: (b) => `INTERFACE ${b}\nMETHOD M : INT\nEND_METHOD\nEND_INTERFACE\n` },
	{ key: "gvl", ext: "gvl", broken: (b) => unclosed(`VAR_GLOBAL\n\t${b}_g : INT;\nEND_VAR\n`), fixed: (b) => `VAR_GLOBAL\n\t${b}_g : INT := 3;\nEND_VAR\n` },
]

/** The in-place rewrites of the third push: another shape of the same object, so a content change of the same name. */
const change: Record<string, (b: string) => string> = {
	struct: enumOf, // struct → enum: an ordinary content change of `X.dut`
	prg: fbOf, // PROGRAM → FUNCTION_BLOCK: a content change of `X.pou`; its END line follows the header
}

const wire = (s: Shape) => `${S(s.key)}.${s.ext}`
const expectedFiles = shapes.map(wire).sort()
/** Blank lines are the writer's (a POU's END line gets one above it); line ends are the file system's. */
const norm = (t: string) => t.replace(/\r\n/g, "\n").replace(/\n[ \t]*(?=\n)/g, "").trim()

describe.skipIf(CLI === undefined)(`items / kind names through a broken → fixed → changed cycle (${BASE})`, () => {
	setDefaultTimeout(300_000)
	let parent = ""
	let root = ""
	let dir = "" // the workspace folder of the main program — where every shape's file is written

	/** Every forced delete of this file's names, readable or not (an unreadable one by the kind it was pushed as). */
	async function sweep(): Promise<void> {
		const refs = await bridge.refs()
		const mine = (n: string) => n.startsWith(`${PREFIX}_${KEY}`)
		const ops = [
			...Object.keys(refs.items ?? {}).filter(mine).map((n) => ({ op: "deleteItem", name: n, ifVersion: null })),
			...(refs.unreadable ?? []).filter(mine).map((n: string) => {
				const s = shapes.find((x) => S(x.key) === n)
				if (!s) throw new Error(`'${n}' is unreadable and is no shape of this file`)
				return { op: "deleteItem", name: `${n}.${s.ext}`, ifVersion: null }
			}),
		]
		if (ops.length === 0) return
		const r = await bridge.push({ expectedProjectVersion: refs.projectVersion, force: true, ops })
		// IN FULL, not `accepted`: a delete refused at apply after earlier deletes landed answers accepted WITH conflicts
		// (openspec push-keeps-what-landed), and its item would stay for the cases after this one to run into.
		if (!landedInFull(r)) throw new Error(`sweep did not land in full: ${JSON.stringify(r.conflicts).slice(0, 300)}`)
		const left = Object.keys((await bridge.refs()).items ?? {}).filter(mine)
		if (left.length > 0) throw new Error(`sweep left ${left.join(", ")} in the project`)
	}

	/** The workspace's files of this file's shapes, by file name. */
	function files(): string[] {
		return (readdirSync(join(root, "src"), { recursive: true }) as string[])
			.map((p) => basename(p))
			.filter((n) => n.startsWith(`${PREFIX}_${KEY}`))
			.sort()
	}

	function write(text: (s: Shape) => string): void {
		for (const s of shapes) writeFileSync(join(dir, wire(s)), text(s))
	}

	/** After a pull: the files are exactly the expected names, and each file holds `text` (the IDE's read of it). */
	async function expectPulled(text: (s: Shape) => string, unreadable: string[]): Promise<void> {
		const r = await pull(root)
		expect(r.kind, `pull: ${JSON.stringify(r)}`).toBe("ok")
		expect(files()).toEqual(expectedFiles)
		const refs = await bridge.refs()
		const live = Object.keys(refs.items).filter((n) => n.startsWith(`${PREFIX}_${KEY}`)).sort()
		expect(live).toEqual(expectedFiles.filter((n) => !unreadable.includes(n.slice(0, n.lastIndexOf(".")))))
		expect((refs.unreadable ?? []).filter((n: string) => n.startsWith(`${PREFIX}_${KEY}`)).sort()).toEqual([...unreadable].sort())
		for (const s of shapes) {
			const onDisk = norm(readFileSync(join(dir, wire(s)), "utf8"))
			expect(onDisk, `${wire(s)} on disk`).toBe(norm(text(s)))
			if (!unreadable.includes(S(s.key))) expect(norm((await fetchItem(wire(s))).sourceText), `${wire(s)} in the IDE`).toBe(norm(text(s)))
		}
	}

	beforeAll(async () => {
		await requireHealthy()
		await sweep()
		parent = mkdtempSync(join(tmpdir(), "volt-e2e-cycle-"))
		const r = await init(parent, VENDOR, { pipe: currentPipe() })
		expect(r.code, JSON.stringify(r)).toBe(0)
		root = r.workspace ?? parent
		const main = await mainProgram()
		if (!main) throw new Error("the fixture has no main program")
		const hit = (readdirSync(join(root, "src"), { recursive: true }) as string[]).find((p) => basename(p) === main)
		if (!hit) throw new Error(`no workspace file for '${main}'`)
		dir = dirname(join(root, "src", hit))
	})
	afterAll(async () => {
		try { await sweep() } finally { if (parent && existsSync(parent)) rmSync(parent, { recursive: true, force: true }) }
	})

	it("1. every broken text pushes as sent, and the pull names every DUT .dut and every POU .pou", async () => {
		write((s) => s.broken(S(s.key)))
		const r = await push(root)
		expect(r.kind, `push: ${JSON.stringify(r)}`).toBe("ok")
		await expectPulled((s) => s.broken(S(s.key)), [])
	})

	it("2. the fixed texts push and keep every name", async () => {
		write((s) => s.fixed(S(s.key)))
		const r = await push(root)
		expect(r.kind, `push: ${JSON.stringify(r)}`).toBe("ok")
		await expectPulled((s) => s.fixed(S(s.key)), [])
	})

	it("3. the fixed texts build when the main program references every shape", async () => {
		const main = (await mainProgram())!
		await withMainProgramRestored(async () => {
			const m = await fetchItem(main)
			const decl = [
				...shapes.filter((s) => s.ext === "dut").map((s) => `c_${s.key} : ${S(s.key)};`),
				`c_fb : ${S("fb")};`,
				`c_i : INT;`,
			]
			const body = [`${S("prg")}();`, `c_fb();`, `c_i := ${S("fun")}(c_i) + ${S("gvl")}_g;`]
			const src = m.sourceText
				.replace(/\nEND_VAR/, `\n\t${decl.join("\n\t")}\nEND_VAR`)
				.replace(/IMPLEMENTATION ST\n/, `IMPLEMENTATION ST\n${body.join("\n")}\n`)
			const r = await bridge.push({ ops: [{ op: "set", name: main, sourceText: src, ifVersion: m.version }] })
			expect(r.accepted, JSON.stringify(r.conflicts)).toBe(true)
			const errors = ((await bridge.build()).diagnostics ?? []).filter((d: any) => d.severity === "error")
			expect(errors.map((e: any) => `${e.name}: ${e.message}`)).toEqual([])
		})
		// The main program is restored through the bridge; the workspace takes it back on the next pull.
		expect((await pull(root)).kind).toBe("ok")
	})

	it("4. struct → enum and PROGRAM → FUNCTION_BLOCK in place are content changes: same names, END line follows", async () => {
		const text = (s: Shape) => (change[s.key] ?? s.fixed)(S(s.key))
		write(text)
		const r = await push(root)
		expect(r.kind, `push: ${JSON.stringify(r)}`).toBe("ok")
		await expectPulled(text, [])
		const prgFile = readFileSync(join(dir, `${S("prg")}.pou`), "utf8").replace(/\r\n/g, "\n").trimEnd()
		expect(prgFile).toMatch(/^FUNCTION_BLOCK /)
		expect(prgFile).toMatch(/\nEND_FUNCTION_BLOCK$/)
		expect(readFileSync(join(dir, `${S("struct")}.dut`), "utf8")).toMatch(/Idle := 0/)
	})
})
