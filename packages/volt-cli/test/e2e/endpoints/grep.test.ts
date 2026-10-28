/**
 * grep — search the text `fetch` ships, answer the matching LINES (openspec `grep-item-sources`, task 4.1).
 *
 * <p>The first test is the change's STOP GATE (task 1.2): the text `refs` hashes into an item's version IS the
 * `sourceText` `fetch` ships for it, byte for byte, for every item of the served project. `grep`'s line numbers are
 * computed on that text, so if the two differed, a matched line would not be the fetched line. Every later expectation
 * about a line is read off the live `fetch` of the item, never typed out here.</p>
 *
 * <pre>
 *   powershell -File scripts/ide.ps1 up -Vendor codesys -Instance gr-cs -Wait
 *   VOLT_E2E_INSTANCE=gr-cs VOLT_VENDOR=codesys VOLT_GRAPHICAL=1 bun test test/e2e/endpoints/grep.test.ts
 *   powershell -File scripts/ide.ps1 up -Vendor twincat -Instance gr-tc -Fixture "test/fixtures/TwinCAT MultiProject/TwinCAT MultiProject.sln" -Wait
 *   VOLT_E2E_INSTANCE=gr-tc VOLT_VENDOR=twincat VOLT_GRAPHICAL=1 bun test test/e2e/endpoints/grep.test.ts
 * </pre>
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { bridge, cleanup, requireHealthy, createItem, fetchSource, BASE, pathOf, fid, id, opErrorCode } from "../harness"
import { MARK } from "../fixtures"
import { call } from "../lib/pipe"
import { expectGap, PLATFORM_GAPS } from "../lib/platform"
import { itemVersion } from "../lib/versions"
/** The fetched text's line `n` (1-based), without its line ending. */
const lineOf = (text: string, n: number) => text.split("\n")[n - 1].replace(/\r$/, "")

const HIDDEN = /^%LANGUAGE (\w+) UNSUPPORTED$/m

describe(`endpoints / grep (${BASE})`, () => {
	setDefaultTimeout(180_000)
	beforeAll(async () => { await requireHealthy(); await cleanup() })
	afterAll(cleanup)

	it("STOP GATE 1.2: every item's fetched sourceText is the text its refs version hashes", async () => {
		const r0 = performance.now()
		const refs = await bridge.refs()
		const refsMs = Math.round(performance.now() - r0)
		const g0 = performance.now()
		await bridge.grep({ pattern: "zzz_no_such_text_zzz", literal: true })
		const grepMs = Math.round(performance.now() - g0)
		const t0 = performance.now()
		const fetched = await bridge.init()
		const ms = Math.round(performance.now() - t0)
		const items = Object.keys(refs.items)
		const byName = new Map<string, any>(fetched.changed.map((c: any) => [c.name, c]))
		const differing: string[] = []
		for (const p of items) {
			const c = byName.get(p)
			if (!c) { differing.push(`${p}: refs names it, fetch shipped no text`); continue }
			if (c.version !== refs.items[p]) differing.push(`${p}: fetch version ${c.version} != refs ${refs.items[p]}`)
			if (itemVersion(p, c.sourceText) !== refs.items[p]) differing.push(`${p}: sourceText does not hash to the refs version`)
		}
		console.log(`[grep gate] ${items.length} items, ${differing.length} differing; refs ${refsMs}ms, grep ${grepMs}ms, init fetch ${ms}ms`)
		expect(differing).toEqual([])
		expect(items.length).toBeGreaterThan(0)
	})

	it("2.1: an identifier in three places is three matches at the fetched lines, with refs' versions", async () => {
		const motor = id("g_motor"), prg = id("g_prg")
		await createItem(fid("g_motor"), `FUNCTION_BLOCK ${motor}\nVAR\n\tvltGrepRunning : BOOL;\nEND_VAR\n${MARK}\n;\nEND_FUNCTION_BLOCK\n`)
		await createItem(fid("g_prg"),
			`PROGRAM ${prg}\nVAR\n\tm : ${motor};\n\tlamp : BOOL;\nEND_VAR\n${MARK}\nIF m.vltGrepRunning THEN\n\tlamp := m.vltGrepRunning;\nEND_IF\nEND_PROGRAM\n`)
		const pm = await pathOf(fid("g_motor")), pp = await pathOf(fid("g_prg"))

		const r = await bridge.grep({ pattern: "vltGrepRunning" })

		expect(r.matches.map((m: any) => m.name).sort()).toEqual([pm, pp, pp].sort())
		const text = { [pm]: await fetchSource(fid("g_motor")), [pp]: await fetchSource(fid("g_prg")) }
		for (const m of r.matches) expect(m.text).toBe(lineOf(text[m.name], m.line))
		const refs = await bridge.refs()
		expect(r.items).toEqual({ [pm]: refs.items[pm], [pp]: refs.items[pp] })
		expect(r.totalMatches).toBe(3)
		expect(r.truncated).toBe(false)
	})

	it("2.4: tabs are kept, and a method's match has its line in the fetched text after the block's end", async () => {
		const name = id("g_tabs")
		await createItem(fid("g_tabs"),
			`FUNCTION_BLOCK ${name}\nVAR\n\txErrorActive : BOOL;\nEND_VAR\n${MARK}\n\txErrorActive\t\t:= TRUE;\nEND_FUNCTION_BLOCK\n` +
			`\nMETHOD vltGrepStart : BOOL\nVAR_INPUT\nEND_VAR\n${MARK}\nvltGrepStart := xErrorActive;\nEND_METHOD\n`)
		const path = await pathOf(fid("g_tabs"))
		const text = await fetchSource(fid("g_tabs"))
		const lines = text.split("\n")

		const tab = (await bridge.grep({ pattern: "xErrorActive\t\t:= TRUE", literal: true, paths: [path] })).matches
		expect(tab).toHaveLength(1)
		expect(tab[0].text).toBe("\txErrorActive\t\t:= TRUE;")
		expect(tab[0].text).toBe(lineOf(text, tab[0].line))

		const member = (await bridge.grep({ pattern: "vltGrepStart := ", literal: true, paths: [path] })).matches
		expect(member).toHaveLength(1)
		expect(member[0].text).toBe(lineOf(text, member[0].line))
		expect(member[0].line - 1).toBeGreaterThan(lines.findIndex((l) => l.replace(/\r$/, "") === "END_FUNCTION_BLOCK"))
	})

	it("2.6: a body reading %LANGUAGE <LANG> UNSUPPORTED is named not searched, its declaration still matched", async () => {
		const fetched = await bridge.init()
		const hidden = fetched.changed.find((c: any) => c.name.endsWith(".pou") && HIDDEN.test(c.sourceText) && fetched.items[c.name])
		expect(hidden, "the fixture holds an item with a body Volt does not show (VltFixtureCfc/Sfc)").toBeDefined()
		const header = hidden.sourceText.split("\n")[0].replace(/\r$/, "")

		const r = await bridge.grep({ pattern: header, literal: true, caseSensitive: true, paths: [hidden.name] })

		expect(r.matches).toEqual([{ name: hidden.name, line: 1, text: header }])
		const entry = r.notSearched.find((n: any) => n.name === hidden.name)
		expect(entry?.reason).toContain(`%LANGUAGE ${HIDDEN.exec(hidden.sourceText)![1]} UNSUPPORTED`)
	})

	// A version that cannot take an LD/FBD body from Volt (DIALECT V2) ends this case in that named refusal.
	it("2.6: a network-text body is searched as fetch ships it", () => expectGap(PLATFORM_GAPS.graphicalWrite, "a network-text body is searched", async () => {
		const name = id("g_fbd")
		await createItem(fid("g_fbd"),
			`PROGRAM ${name}\nVAR\n\tstart : BOOL;\n\tstop : BOOL;\n\tlamp : BOOL;\nEND_VAR\n` +
			`%LANGUAGE FBD\n%NETWORK\nlamp := AND(start, stop);\n\nEND_PROGRAM\n`)
		const path = await pathOf(fid("g_fbd"))
		const text = await fetchSource(fid("g_fbd"))
		const lines = text.split("\n").map((l: string) => l.replace(/\r$/, ""))
		const at = lines.indexOf("%LANGUAGE FBD") + 1
		expect(at, `the bridge ships the FBD body as network text:\n${text}`).toBeGreaterThan(0)
		// The stop gate for a network-text body too: the text refs hashes is the text fetch ships.
		expect(itemVersion(path, text)).toBe((await bridge.refs()).items[path])

		const r = await bridge.grep({ pattern: "lamp := AND(start", literal: true, paths: [path] })

		expect(r.matches).toHaveLength(1)
		expect(r.matches[0].text).toBe(lineOf(text, r.matches[0].line))
		expect(r.matches[0].line).toBeGreaterThan(at)
		expect(r.notSearched).toEqual([])
	}))

	it("2.6: unreadable items are named, libraries are out of scope, unwalked folders pass through", async () => {
		const refs = await bridge.refs()
		const r = await bridge.grep({ pattern: "RESOLUTION" })

		expect(r.matches.filter((m: any) => m.name.endsWith(".library"))).toEqual([])
		expect(r.notSearched.filter((n: any) => n.name.endsWith(".library"))).toEqual([])
		for (const u of refs.unreadable.filter((x: any) => !x.name.endsWith(".library")))
			expect(r.notSearched).toContainEqual({ name: u.name, code: u.code, reason: u.reason })
		expect(r.unwalkedFolders).toEqual(refs.unwalkedFolders)
		expect(r.searched).toBe(Object.keys(refs.items).filter((p) => !p.endsWith(".library")).length)
	})

	it("health.ops names grep beside every op the bridge answers", async () => {
		const ops: string[] = (await bridge.health()).ops
		for (const op of ["health", "connect", "disconnect", "refs", "fetch", "grep", "push", "build"]) expect(ops).toContain(op)
	})

	it("refuses a pattern that does not compile, and a request member it does not know", async () => {
		expect(await opErrorCode(() => bridge.grep({ pattern: "fbMotor(" }))).toBe("BAD_REQUEST")
		expect(await opErrorCode(() => call("grep", { pattern: "x", regex: true }))).toBe("BAD_REQUEST")
	})
})
