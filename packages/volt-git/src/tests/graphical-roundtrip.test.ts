/**
 * Live graphical round-trip — drives the volt-git CLI against a real bridge with FBD/LD POUs.
 * Verifies a graphical root body materializes as an editable, marker-free .fbd/.ld file (leading with
 * the NETWORK marker) and round-trips: provision (IDE) → pull → edit VG → push → pull → the edit survives.
 *
 * Defaults to :8556 (CODESYS headless — the proven WriteGraphicalBody path); override VOLT_TC_PORT.
 * Self-provisions every fixture (a `Vlt*`-named POU) and purges them on entry/exit — never touches a
 * real project POU, never depends on an ambient graphical body.
 */
import { expect, it, beforeAll, afterAll, beforeEach, setDefaultTimeout } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import type { BridgeClient } from "../bridge/client.js"
import { pull } from "../sync/pull.js"
import { push } from "../sync/push.js"
import { checkpoint as checkpointWs, commit as commitWs, freshWorkspace, ideSet, purge, suite, walk } from "./live-harness.js"

const PREFIX = "Vlt" // covers this suite's VltRtGfx + VltGfxLd_* fixtures

let bridge: BridgeClient
let ws: string
let cleanup: () => void

const commit = (msg: string): void => commitWs(ws, msg)
const checkpoint = (): void => checkpointWs(ws)

/** Provision a graphical POU straight in the IDE (a `set` op = the engineer drew it). */
const provision = (name: string, sourceText: string): Promise<void> => ideSet(name, { folder: "", sourceText })

/** This suite's OWN graphical fixture file, or null — keyed by name so an ambient POU can't be picked up. */
function findGraphical(name: string): string | null {
	for (const f of walk(ws)) if (f.endsWith(`${name}.fbd`) || f.endsWith(`${name}.ld`)) return f
	return null
}

async function setup(): Promise<void> {
	const h = await freshWorkspace(PREFIX)
	bridge = h.bridge
	ws = h.ws
	cleanup = h.cleanup
}

// ── FBD round-trip ──────────────────────────────────────────────────────────
const FIXTURE = "VltRtGfx"
// A boolean leaf (FALSE/TRUE) so the edit-round-trip has an operand to flip.
const FIXTURE_FBD = `PROGRAM ${FIXTURE}\nVAR\n\tout : BOOL;\nEND_VAR\n\nNETWORK 0 FBD\n  out := (FALSE AND TRUE);\nEND_NETWORK\nEND_PROGRAM\n`

suite("graphical round-trip (FBD ↔ .fbd)", () => {
	setDefaultTimeout(30_000)

	beforeAll(async () => {
		await setup()
		await provision(`${FIXTURE}.fbd`, FIXTURE_FBD)
	})
	afterAll(async () => {
		await purge(PREFIX)
		cleanup?.()
	})
	beforeEach(checkpoint)

	it("pull materializes an FBD root body as a marker-free .fbd file", async () => {
		expect((await pull(ws, bridge)).kind).toBe("ok")
		const f = findGraphical(FIXTURE)
		expect(f).not.toBeNull()
		const vg = readFileSync(f!, "utf-8")
		expect(vg).toContain("NETWORK ") // editable graphical body leads with the network marker
		expect(vg).not.toContain("@volt-graphical") // root file carries NO legacy marker
	})

	it("no-op push of a graphical body produces no drift", async () => {
		expect((await push(ws, bridge)).kind).toBe("ok")
	})

	it("edit VG → push → pull round-trips the change", async () => {
		const f0 = findGraphical(FIXTURE)!
		const original = readFileSync(f0, "utf-8")
		const flip = original.includes("FALSE") ? (["FALSE", "TRUE"] as const) : (["TRUE", "FALSE"] as const)
		const edited = original.replace(flip[0], flip[1])
		expect(edited).not.toBe(original) // the fixture must contain a boolean operand
		writeFileSync(f0, edited, "utf-8")
		commit("edit vg")
		expect((await push(ws, bridge)).kind).toBe("ok")
		expect((await pull(ws, bridge)).kind).toBe("ok")
		expect(readFileSync(findGraphical(FIXTURE)!, "utf-8")).toContain(flip[1]) // the edit landed in the IDE and came back
	})
})

// ── LD featureset ───────────────────────────────────────────────────────────
const ldProg = (name: string, vars: string, body: string): string =>
	`PROGRAM ${name}\nVAR\n${vars}END_VAR\n\nNETWORK 0 LD\n${body}END_NETWORK\nEND_PROGRAM\n`
const LD_VARIATIONS: [string, (n: string) => string, string][] = [
	["negated", (n) => ldProg(n, "\ta : BOOL;\n\tb : BOOL;\n\tout : BOOL;\n", "  out := (NOT a AND b);\n"), "NOT"],
	["series3", (n) => ldProg(n, "\ta : BOOL;\n\tb : BOOL;\n\tc : BOOL;\n\tout : BOOL;\n", "  out := ((a AND b) AND c);\n"), "AND"],
]

suite("LD featureset — each variation materializes as a .ld file with the right logic", () => {
	setDefaultTimeout(30_000)

	beforeAll(setup)
	afterAll(async () => {
		await purge(PREFIX)
		cleanup?.()
	})
	beforeEach(checkpoint)

	for (const [label, build, mustContain] of LD_VARIATIONS) {
		it(`pull materializes the ${label} ladder as a .ld file`, async () => {
			const name = `VltGfxLd_${label}`
			await provision(`${name}.ld`, build(name))
			expect((await pull(ws, bridge)).kind).toBe("ok")
			const f = findGraphical(name)
			expect(f).not.toBeNull()
			const vg = readFileSync(f!, "utf-8")
			expect(vg).toContain("NETWORK")
			expect(vg).toContain(" LD") // stayed ladder
			expect(vg).toContain(mustContain) // the variation's logic survived
		})
	}
})
