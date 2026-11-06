/**
 * THE STORED BOX STATES ON A LIVE CODESYS (openspec nwl-box-storage-map): every state the recording
 * `test/fixtures/nwl-schema/box-states.3.5.21.40.json` marks `live` stands as a PROGRAM in its own fixture, authored by the
 * IDE itself (`scripts/author-box-states-fixture.py`):
 *
 *   powershell -File scripts/ide.ps1 up -Vendor codesys -Instance <yours> -Fixture test/fixtures/nwl-schema/CodesysBoxStates.3.5.21.40.project -Wait
 *
 * A pull that changes for one of them fails, naming it, and the run shows the stored form does what the recording says. The
 * offline twin over every row is `CodesysBoxStatesTests`. The third test needs no such fixture: what a push stores for a
 * PROGRAM box builds and runs as the editor's box does.
 *
 * CODESYS only (openspec: no TwinCAT live for now).
 */
import { describe, expect, setDefaultTimeout } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { id, fid, requireHealthy, VENDOR, BASE } from "../harness"
import { itGapped, PLATFORM_GAPS } from "../lib/platform"
import { bridge } from "../lib/bridge"
import { createItem, removeItem, pathIn, pathOf, pushOps, landed, at, fetchSource } from "../lib/workspace"
import { drivenBuild } from "../lib/compile"
import { runCalled } from "../lib/codesys-run"

const it = itGapped(PLATFORM_GAPS.graphicalWrite)

setDefaultTimeout(1_800_000)

interface Row {
	id: string
	kind: string
	language: string
	position: string
	outputs: (string | null)[]
	live: boolean
	pull: string
	measured: { build: string[]; run: string | null; observed?: string }
	/** the variables a state's own holder declares beside the shared ones (a conversion at the output store) */
	vars?: string[]
	/** what the box's callee shows of its call after the run, where nothing the holder declares does (a root box): `%s.t2.q1`
	 *  in the state's own program, or a callee's own variable (`bmP2.q1`), which the state's program then runs alone to read */
	observe?: string[]
}

const FIXTURES = join(import.meta.dir, "..", "..", "fixtures", "nwl-schema")
const recording = JSON.parse(readFileSync(join(FIXTURES, "box-states.3.5.21.40.json"), "utf8"))
const live: Row[] = recording.states.filter((s: Row) => s.live)
const nameOf = (r: Row) => `BoxState_${r.id}`

const items = VENDOR === "codesys" ? ((await bridge.refs()).items ?? {}) : {}
const served = VENDOR === "codesys" && pathIn(items, `${nameOf(live[0]!)}.pou`) !== undefined
if (VENDOR === "codesys" && !served)
	console.warn(`[nwl-box-states] ${BASE} serves no BoxState_* objects: serve test/fixtures/nwl-schema/CodesysBoxStates.3.5.21.40.project (ide.ps1 up -Fixture ...; author-box-states-fixture.py)`)

/** The body lines of a pulled item, as the recording holds them. */
function bodyLines(source: string): string {
	const text = source.replace(/\r\n/g, "\n")
	const body = text.slice(text.indexOf("%LANGUAGE")).replace(/\nEND_PROGRAM[\s\S]*$/, "")
	return body.split("\n").slice(1).filter((l) => l.trim().length > 0 && l !== "%NETWORK").join(" / ")
}

describe.skipIf(VENDOR !== "codesys")(`graphical / stored box states, nwl-box-storage-map (${BASE})`, () => {
	it.skipIf(!served)("every stored state pulls as the recording says", async () => {
		await requireHealthy()
		const paths = await Promise.all(live.map((r) => pathOf(`${nameOf(r)}.pou`)))
		const answer = await bridge.fetch({ knownItems: {}, onlyItems: paths })
		const text = new Map<string, string>(answer.changed.map((i: any) => [i.name, i.sourceText]))
		const different = live.flatMap((r, i) => {
			const source = text.get(paths[i]!)
			if (source === undefined) return [`${r.id}: not in the fetch`]
			const pulled = bodyLines(source)
			return pulled === r.pull ? [] : [`${r.id} ${r.kind} ${r.language} ${r.position} ${JSON.stringify(r.outputs)}: pulled '${pulled}', recorded '${r.pull}'`]
		})
		expect(different.slice(0, 30)).toEqual([])
	})

	it.skipIf(!served)("a stored state runs as the recording says", async () => {
		await requireHealthy()
		const clean = live.filter((r) => r.measured.run !== null && !r.measured.build.some((m) => m.includes("Error ")))
		const vars = (r: Row) => ["x", "y", "z", "k", "m", ...(r.vars ?? [])]
		// In groups: one run reads every variable online, one request at a time, and the probe answers within its hang guard
		// for a group, not for the whole fixture (236 programs, 1180 reads: over 120 s, measured).
		const values: Record<string, string> = {}
		for (let i = 0; i < clean.length; i += 30) {
			const group = clean.slice(i, i + 30)
			Object.assign(values, await runCalled(group.map(nameOf), group.flatMap((r) => vars(r).map((v) => `${nameOf(r)}.${v}`))))
		}
		const different = clean.flatMap((r) => {
			const ran = vars(r)
				.map((v) => [v, values[`${nameOf(r)}.${v}`]!] as const)
				.filter(([, value]) => !["FALSE", "0", "INT#0", "UINT#0", "SINT#0"].includes(value))
				.map(([v, value]) => `${v}=${value}`)
				.sort()
				.join(" ")
			return ran === r.measured.run ? [] : [`${r.id} ${r.kind} ${r.position} ${JSON.stringify(r.outputs)}: ran '${ran}', recorded '${r.measured.run}'`]
		})
		expect(different.slice(0, 30)).toEqual([])
	})

	it.skipIf(!served)("a root box's callee shows its call as the recording says", async () => {
		await requireHealthy()
		const observing = live.filter((r) => r.observe)
		const shown = (r: Row, values: Record<string, string>) =>
			r.observe!
				.map((p) => [p.replace("%s.", ""), values[p.replace("%s", nameOf(r))]!] as const)
				.filter(([, value]) => !["FALSE", "0", "INT#0"].includes(value))
				.map(([p, value]) => `${p}=${value}`)
				.sort()
				.join(" ")
		// a callee's own variable is every caller's: the state's program runs alone
		const alone = observing.filter((r) => r.observe!.some((p) => !p.startsWith("%s.")))
		const together = observing.filter((r) => !alone.includes(r))
		const values: Record<string, string> = {}
		if (together.length > 0)
			Object.assign(values, await runCalled(together.map(nameOf), together.flatMap((r) => r.observe!.map((p) => p.replace("%s", nameOf(r))))))
		const different: string[] = []
		for (const r of observing) {
			const got = alone.includes(r) ? shown(r, await runCalled([nameOf(r)], r.observe!)) : shown(r, values)
			if (got !== r.measured.observed) different.push(`${r.id} ${r.kind} ${r.position}: observed '${got}', recorded '${r.measured.observed}'`)
		}
		expect(different).toEqual([])
	})

	it("a PROGRAM box only something reads is called: no root box beside it calls it for them", async () => {
		await requireHealthy()
		const P = id("bsQ")
		const pFile = fid("bsQ")
		const H = id("bsI")
		const hFile = fid("bsI")
		const declared = `PROGRAM ${P}\nVAR_INPUT\n\ta : BOOL;\n\tn : INT;\nEND_VAR\nVAR_OUTPUT\n\tq1 : BOOL;\n\tq2 : INT;\nEND_VAR\n%LANGUAGE ST\nq1 := a;\nq2 := n + 1;\n\nEND_PROGRAM\n`
		const holder = `PROGRAM ${H}\nVAR\n\ta : BOOL := TRUE;\n\tx : BOOL;\n\ti : INT := 5;\nEND_VAR\n%LANGUAGE FBD\n%NETWORK\nASSIGN(${P}(a := a, n := i), Q => x);\n\nEND_PROGRAM\n`
		await removeItem(hFile)
		await removeItem(pFile)
		await createItem(pFile, declared)
		try {
			await createItem(hFile, holder)
			const values = await runCalled([H], [`${H}.x`])
			expect(values[`${H}.x`]).toBe("TRUE")
		} finally {
			await removeItem(hFile)
			await removeItem(pFile)
		}
	})

	it("a PROGRAM box a push stores builds and runs as the editor's box does", async () => {
		await requireHealthy()
		const P = id("bsP")
		const pFile = fid("bsP")
		const H = id("bsH")
		const hFile = fid("bsH")
		const declared = `PROGRAM ${P}\nVAR_INPUT\n\ta : BOOL;\n\tn : INT;\nEND_VAR\nVAR_OUTPUT\n\tq1 : BOOL;\n\tq2 : INT;\nEND_VAR\n%LANGUAGE ST\nq1 := a;\nq2 := n + 1;\n\nEND_PROGRAM\n`
		const holder = (body: string) =>
			`PROGRAM ${H}\nVAR\n\ta : BOOL := TRUE;\n\tgo : BOOL := TRUE;\n\tx, y : BOOL;\n\ti : INT := 5;\n\tk, v : INT;\nEND_VAR\n%LANGUAGE FBD\n${body}\n\nEND_PROGRAM\n`
		await removeItem(hFile)
		await removeItem(pFile)
		await createItem(pFile, declared)
		try {
			const body = [
				`%NETWORK\nASSIGN(${P}(a := a, n := i), Q => x);`,
				`%NETWORK\nASSIGN(${P}(a := a, n := i).q2, Q => k);`,
				`%NETWORK\n${P}(a := a, n := i, q2 => v);`,
				`%NETWORK\nASSIGN(${P}(EN := go, a := a, n := i), Q => y);`,
			].join("\n")
			const pushed = await pushOps([{ op: "set", name: await at(hFile), sourceText: holder(body), ifVersion: null }])
			expect(landed(pushed), JSON.stringify(pushed.conflicts)).toBe(true)
			const values = await runCalled([H], ["x", "k", "v", "y"].map((v) => `${H}.${v}`))
			expect(values[`${H}.x`]).toBe("TRUE")
			expect(values[`${H}.k`]).toBe("INT#6")
			expect(values[`${H}.v`]).toBe("INT#6")
			expect(values[`${H}.y`]).toBe("TRUE")
		} finally {
			await removeItem(hFile)
			await removeItem(pFile)
		}
	})

	/** The networks of a pulled item: its body after the language line, as pushed. */
	const networks = (source: string) =>
		source
			.replace(/\r\n/g, "\n")
			.split("\n%LANGUAGE ")[1]!
			.split("\n")
			.slice(1)
			.join("\n")
			.replace(/\n+END_PROGRAM[\s\S]*$/, "")

	it("an LD function box with its formal pins pulls back, builds and runs as the FBD box (LIMIT, SEL)", async () => {
		await requireHealthy()
		const body = "%NETWORK\nASSIGN(LIMIT(MN := 0, IN := v, MX := 100), Q => y);\n%NETWORK\nASSIGN(SEL(G := g, IN0 := a, IN1 := b), Q => k);"
		const ran: Record<string, unknown> = {}
		for (const language of ["LD", "FBD"]) {
			const H = id(`bsL${language}`)
			const hFile = fid(`bsL${language}`)
			const source = `PROGRAM ${H}\nVAR\n\tv : INT := 150;\n\tg : BOOL := TRUE;\n\ta : INT := 1;\n\tb : INT := 2;\n\ty, k : INT;\nEND_VAR\n%LANGUAGE ${language}\n${body}\n\nEND_PROGRAM\n`
			await removeItem(hFile)
			try {
				await createItem(hFile, source)
				expect(networks(await fetchSource(hFile))).toBe(body)
				const values = await runCalled([H], [`${H}.y`, `${H}.k`])
				ran[language] = { y: values[`${H}.y`], k: values[`${H}.k`] }
			} finally {
				await removeItem(hFile)
			}
		}
		expect(ran.FBD).toEqual({ y: "INT#100", k: "INT#2" })
		expect(ran.LD).toEqual(ran.FBD)
	})

	it("an FBD wire carrying an array builds and runs: the wire takes the array's type", async () => {
		await requireHealthy()
		const H = id("bsW")
		const hFile = fid("bsW")
		const body = "%NETWORK\nVAR w1 : ANY; END_VAR\nw1 := MOVE(arr);\nASSIGN(w1, Q => out);"
		const source = `PROGRAM ${H}\nVAR\n\tarr : ARRAY[0..1] OF INT := [3, 4];\n\tout : ARRAY[0..1] OF INT;\nEND_VAR\n%LANGUAGE FBD\n${body}\n\nEND_PROGRAM\n`
		await removeItem(hFile)
		try {
			await createItem(hFile, source)
			expect(networks(await fetchSource(hFile))).toBe(body)
			const built = await drivenBuild()
			expect(built.diagnostics.filter((d: any) => JSON.stringify(d).includes(H))).toEqual([])
			expect(await runCalled([H], [`${H}.out[0]`, `${H}.out[1]`])).toEqual({ [`${H}.out[0]`]: "INT#3", [`${H}.out[1]`]: "INT#4" })
		} finally {
			await removeItem(hFile)
		}
	})
})
