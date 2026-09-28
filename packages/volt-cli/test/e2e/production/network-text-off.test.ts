/**
 * A PRODUCTION BRIDGE — `VOLT_GRAPHICAL` unset, as every shipped build is — pulled and pushed live (openspec
 * `implementation-keyword` 3c, task 4.1).
 *
 * <p>Network text is a development feature: a bridge without the variable shows every ST body and hides every LD and
 * FBD body behind its line `IMPLEMENTATION LD|FBD UNSUPPORTED`, naming the reason in the fetch. Hidden is not blocked:
 * the item's declaration stays editable and pushes as usual, and the IDE's body is never written. The offline suites
 * prove each rule against doubles (`NetworkTextSwitchTests`, `TcNetworkTextSwitchTests`,
 * `CodesysNetworkTextSwitchTests`); this proves the switch is actually off in a bridge started the way a customer's is,
 * against a real project that holds ladders.</p>
 *
 * <p><b>It runs only against a production bridge</b>, and every other suite needs the opposite, so it is its own run —
 * the bridge's switch is its process environment and cannot flip under a running suite:</p>
 * <pre>
 *   pwsh scripts/ide.ps1 up -Vendor twincat -Fixture 14 -Production -Wait
 *   VOLT_VENDOR=twincat bun test test/e2e/production
 * </pre>
 * <p>The project must hold at least one LD or FBD body — TwinCAT Project14 does; the CODESYS test fixture does not, so
 * serve a copy of a customer fixture there (`-Fixture test/fixtures/Pro2193-94-95-96_COdesys.project`). With network
 * text ON the suite skips, loudly: a development bridge is what every other e2e file runs against.</p>
 */
import { describe, it, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { readFileSync } from "node:fs"
import { id, fid, bridge, fetchItem, pushOps, expectVendorDifference, BASE } from "../harness"
import { heldImplementations } from "../lib/held-body"
import { servedProject, tcPouFile } from "../lib/tc-files"

setDefaultTimeout(600_000)

/** The engine's wording (`NetworkTextSwitch.DisabledReason`), which a pull message shows the engineer. */
const DISABLED = "LD and FBD are not enabled in this build"
const ADDED = "VAR_INPUT\n\tbVoltHiddenProbe : BOOL;\nEND_VAR\n"

const health = await bridge.health()
const production = health.networkText === false
if (!production)
	console.warn(`[production] skipped: the bridge on ${BASE} has LD and FBD network text ON — serve it with ide.ps1 up -Production`)

describe.skipIf(!production)(`production / a bridge without VOLT_GRAPHICAL (${BASE})`, () => {
	let project = ""
	let all: any[] = []

	/** Every LD/FBD line in a file: [language, hidden?]. */
	const networkLines = (src: string) =>
		[...src.matchAll(/^IMPLEMENTATION (LD|FBD)( UNSUPPORTED)?\r?$/gm)].map((m) => ({ language: m[1]!, hidden: !!m[2] }))

	beforeAll(async () => {
		project = servedProject(health)
		all = (await bridge.fetch({ knownItems: {} })).changed
		expect(all.length).toBeGreaterThan(0)
	})

	it("ST is shown, and every LD and FBD body is its UNSUPPORTED line, named with the switch's reason", () => {
		const withNetwork = all.filter((i) => networkLines(i.sourceText).length > 0)
		if (withNetwork.length === 0)
			throw new Error(`'${project}' holds no LD or FBD body, so this run proves nothing — serve a project that does`)

		for (const item of withNetwork) {
			const lines = networkLines(item.sourceText)
			// Not one ladder shown: every line is hidden, and no network text follows any of them.
			expect(lines.filter((l) => !l.hidden), item.name).toEqual([])
			expect(item.sourceText, item.name).not.toMatch(/^NETWORK\b/m)
			// Each hidden body is named in the fetch, for the pull message, with the switch as the reason.
			const named: { member?: string; language: string; reason: string }[] = (item.unsupported ?? []).filter(
				(u: any) => u.language === "LD" || u.language === "FBD")
			expect(named.length, String(item.name)).toBe(lines.length)
			for (const u of named) expect(u.reason, `${item.name} ${u.member ?? ""}`).toBe(DISABLED)
		}
		console.log(`  [production] ${withNetwork.length} item(s) hide ${withNetwork.reduce((n, i) => n + networkLines(i.sourceText).length, 0)} LD/FBD bod(ies)`)

		// ST untouched by the switch: bodies stated ST, with their code under them.
		const st = all.filter((i) => /^IMPLEMENTATION ST\r?\n[ \t]*\S/m.test(i.sourceText))
		expect(st.length).toBeGreaterThan(0)
	})

	it("network text pushed is refused naming the switch, and nothing is created", async () => {
		const name = fid("prod_ld", "prg")
		const src =
			`PROGRAM ${id("prod_ld")}\nVAR\n\ta : BOOL;\n\tout : BOOL;\nEND_VAR\n` +
			`IMPLEMENTATION LD\nNETWORK\n  out := a;\nEND_NETWORK\n\nEND_PROGRAM\n`
		const r = await pushOps([{ op: "set", name, toFolder: "", sourceText: src, ifVersion: null }])
		expect(r.accepted).toBe(false)
		expect(JSON.stringify(r.conflicts ?? r)).toContain(DISABLED)
		expect((await bridge.refs()).items[name]).toBeUndefined()
	})

	it("an item with a hidden LD/FBD body takes a declaration push, and its bodies are never written", async () => {
		// A PROGRAM or FUNCTION_BLOCK holding a hidden LD/FBD body — its own or a member's. The new input goes directly
		// above the POU's OWN `IMPLEMENTATION` line (the first one in the file), i.e. after its last VAR block, which
		// holds whatever precedes the header (attributes, comments) and a header wrapped over lines (`IMPLEMENTS`).
		const target = all.find((i) => /\.(prg|fb)$/.test(i.name) && networkLines(i.sourceText).length > 0)
		if (!target) throw new Error(`no PROGRAM or FUNCTION_BLOCK with a hidden LD/FBD body in '${project}'`)
		const name: string = target.name
		const bare = name.split(".")[0]!
		const pulled: string = target.sourceText
		const own = /^IMPLEMENTATION [A-Z]+( UNSUPPORTED)?\r?$/m.exec(pulled)
		if (!own) throw new Error(`${name} has no IMPLEMENTATION line`)
		const edited = pulled.slice(0, own.index) + ADDED + pulled.slice(own.index)
		console.log(`  [production] declaration push over ${name}`)

		// The bodies as the IDE holds them, byte for byte (`lib/held-body.ts`) — a production bridge fetches only the
		// UNSUPPORTED line, so the wire can say nothing about them.
		const held = () => heldImplementations(bare, project)
		const set = async (text: string) => {
			const refs = await bridge.refs()
			return pushOps([{ op: "set", name, sourceText: text, ifVersion: refs.items[name] }])
		}

		const before = await held()
		try {
			const r = await set(edited)
			expect(r.accepted, `push refused: ${JSON.stringify(r.conflicts)}`).toBe(true)
			const after = (await fetchItem(name)).sourceText
			expect(after).toBe(edited)
			expect(await held()).toEqual(before)
			expectVendorDifference("openspec implementation-keyword 3b.1: only TwinCAT saves a push to a readable file", {
				twincat: () => expect(readFileSync(tcPouFile(bare, project), "utf8")).toContain("bVoltHiddenProbe : BOOL;"),
				codesys: () => undefined,
			})
		} finally {
			expect((await set(pulled)).accepted).toBe(true)
			expect((await fetchItem(name)).sourceText).toBe(pulled)
			expect(await held()).toEqual(before)
		}
	})
})
