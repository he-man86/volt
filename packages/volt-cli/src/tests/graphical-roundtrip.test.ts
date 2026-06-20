/**
 * Live graphical round-trip — runs against a real bridge with FBD/LD POUs.
 * Verifies a graphical root body materializes as an editable .fbd file (leading with the NETWORK
 * marker, no legacy @volt-graphical marker) and round-trips: pull → edit VG → push → pull → restore.
 *
 * Defaults to :8556 (CODESYS headless, the proven WriteGraphicalBody path); override VOLT_TC_PORT.
 * The edit-round-trip mutates one POU in the live project and restores it in a finally.
 */
import { describe, expect, it, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BridgeClient } from "../bridge/client.js"
import { init } from "../commands/init.js"
import { pull } from "../commands/pull.js"
import { push } from "../commands/push.js"

const PORT = Number.parseInt(process.env.VOLT_TC_PORT ?? "8556", 10)

// Self-provisioned FBD fixture (the suite must never depend on an ambient graphical POU — it creates its own
// and deletes it). A boolean leaf (FALSE/TRUE) so the edit-round-trip test has an operand to flip.
const FIXTURE = "VltRtGfx"
const FIXTURE_FBD =
	`PROGRAM ${FIXTURE}\nVAR\n\tout : BOOL;\nEND_VAR\n\n` +
	`NETWORK 0 FBD\n  VAR_TEMP\n    i1 : BOOL;\n    i2 : BOOL;\n    g1 : BOOL;\n  END_VAR\n` +
	`  i1 := FALSE;\n  i2 := TRUE;\n  g1 := (i1 AND i2);\n  out := g1;\nEND_NETWORK\nEND_PROGRAM\n`

let bridge: BridgeClient
let workspace: string
let cleanup: () => void

async function provisionFixture() {
	const refs = await bridge.getRefs()
	await bridge.pushBatch({
		expectedProjectVersion: refs.projectVersion,
		ops: [{ op: "pushItem", name: `${FIXTURE}.fbd`, folder: "", sourceText: FIXTURE_FBD, ifVersion: refs.items[`${FIXTURE}.fbd`] ?? null }],
	})
}
async function deleteFixture() {
	const refs = await bridge.getRefs()
	const full = [`${FIXTURE}.fbd`, `${FIXTURE}.st`].find((k) => refs.items[k])
	if (full) await bridge.pushBatch({ expectedProjectVersion: refs.projectVersion, ops: [{ op: "deleteItem", name: full, ifVersion: refs.items[full]! }] })
}

function walk(dir: string): string[] {
	const out: string[] = []
	for (const e of readdirSync(dir)) {
		if (e === ".volt" || e === ".git") continue
		const p = join(dir, e)
		if (statSync(p).isDirectory()) out.push(...walk(p))
		else out.push(p)
	}
	return out
}

/** First editable graphical (.fbd/.ld) file in the workspace, or null. */
function findGraphical(): string | null {
	for (const f of walk(workspace)) if (f.endsWith(".fbd") || f.endsWith(".ld")) return f
	return null
}

describe("graphical round-trip (FBD/LD ↔ .fbd/.ld)", () => {
	setDefaultTimeout(30_000)

	beforeAll(async () => {
		const h = (await (await fetch(`http://127.0.0.1:${PORT}/health`)).json()) as { status?: string }
		if (h.status !== "healthy") throw new Error(`bridge not healthy on :${PORT}: ${h.status}`)
		bridge = new BridgeClient({ port: PORT })
		const root = mkdtempSync(join(tmpdir(), "volt-gfx-"))
		workspace = join(root, "ws")
		mkdirSync(workspace, { recursive: true })
		cleanup = () => rmSync(root, { recursive: true, force: true })
		const r = await init(workspace, bridge, {})
		expect(r.kind).toBe("ok")
		await provisionFixture()   // self-provision the graphical POU — never rely on ambient project state
	})

	afterAll(async () => {
		await deleteFixture()
		cleanup?.()
	})

	it("pull materializes an FBD root body as a marker-free .fbd file", async () => {
		const r = await pull(workspace, bridge, { force: true })
		expect(r.kind).toBe("ok")
		const f = findGraphical()
		expect(f).not.toBeNull()
		const vg = readFileSync(f!, "utf-8")
		expect(vg).toContain("NETWORK ")          // editable FBD/LD body leads with the network marker
		expect(vg).not.toContain("@volt-graphical") // root file carries NO legacy marker
	})

	it("no-op push of a graphical body produces no drift", async () => {
		await pull(workspace, bridge, { force: true })
		const r = await push(workspace, bridge, {})
		expect(r.kind).toBe("ok")
	})

	it("edit VG → push → pull round-trips the change", async () => {
		await pull(workspace, bridge, { force: true })
		const f0 = findGraphical()!
		const original = readFileSync(f0, "utf-8")
		// A reversible operand flip inside the VG body.
		const flip = original.includes("FALSE") ? ["FALSE", "TRUE"] : ["TRUE", "FALSE"]
		const edited = original.replace(flip[0]!, flip[1]!)
		expect(edited).not.toBe(original)   // the fixture POU must contain a boolean operand

		const relBefore = f0.slice(workspace.length)
		try {
			writeFileSync(f0, edited, "utf-8")
			const pr = await push(workspace, bridge, {})
			if (pr.kind !== "ok") console.warn("push:", pr.kind, "reason" in pr ? pr.reason : "")
			expect(pr.kind).toBe("ok")

			await pull(workspace, bridge, { force: true })
			const f1 = findGraphical()!
			const after = readFileSync(f1, "utf-8")
			expect(after).toContain(flip[1]!)              // the edit landed in the IDE and came back
			expect(f1.slice(workspace.length)).toBe(relBefore)  // and the POU kept its folder (no relocate-on-import)
		} finally {
			const cur = findGraphical()
			if (cur) {
				writeFileSync(cur, original, "utf-8")
				await push(workspace, bridge, {})
			}
		}
	})
})

/**
 * LD featureset at the CLI materialization layer (mirrors C# LadderRoundTripTests + the bridge e2e):
 * push each variation via the bridge (its own fixture), pull via the CLI, and assert the .ld file
 * materializes with the right VG logic. Self-contained — creates and deletes its own POUs, so it does
 * not depend on a pre-existing graphical fixture and survives on either vendor.
 */
function ldProg(name: string, vars: string, temps: string, body: string): string {
	return `PROGRAM ${name}\nVAR\n${vars}END_VAR\n\nNETWORK 0 LD\n  VAR_TEMP\n${temps}  END_VAR\n${body}END_NETWORK\nEND_PROGRAM\n`
}
const LD_VARIATIONS: [string, (n: string) => string, (vg: string) => void][] = [
	["negated", (n) => ldProg(n, "\ta : BOOL;\n\tb : BOOL;\n\tout : BOOL;\n", "    i1 : BOOL;\n    i2 : BOOL;\n    g1 : BOOL;\n", "  i1 := NOT a;\n  i2 := b;\n  g1 := (i1 AND i2);\n  out := g1;\n"),
		(vg) => expect(vg).toContain("NOT")],
	["series3", (n) => ldProg(n, "\ta : BOOL;\n\tb : BOOL;\n\tc : BOOL;\n\tout : BOOL;\n", "    i1 : BOOL;\n    i2 : BOOL;\n    i3 : BOOL;\n    g1 : BOOL;\n", "  i1 := a;\n  i2 := b;\n  i3 := c;\n  g1 := (i1 AND i2 AND i3);\n  out := g1;\n"),
		(vg) => expect(vg).toContain("AND")],
]

describe("LD featureset — CLI materializes each variation as a .ld file", () => {
	setDefaultTimeout(30_000)
	let b: BridgeClient
	let ws: string
	let cleanWs: () => void
	const created: string[] = []

	async function del(name: string) {
		const refs = await b.getRefs()
		const full = [`${name}.ld`, `${name}.fbd`, `${name}.st`].find((k) => refs.items[k])
		if (full) await b.pushBatch({ expectedProjectVersion: refs.projectVersion, ops: [{ op: "deleteItem", name: full, ifVersion: refs.items[full]! }] })
	}

	beforeAll(async () => {
		const h = (await (await fetch(`http://127.0.0.1:${PORT}/health`)).json()) as { status?: string }
		if (h.status !== "healthy") throw new Error(`bridge not healthy on :${PORT}: ${h.status}`)
		b = new BridgeClient({ port: PORT })
		const root = mkdtempSync(join(tmpdir(), "volt-gfx-ld-"))
		ws = join(root, "ws")
		mkdirSync(ws, { recursive: true })
		cleanWs = () => rmSync(root, { recursive: true, force: true })
		expect((await init(ws, b, {})).kind).toBe("ok")
	})

	afterAll(async () => {
		for (const n of created) await del(n)
		cleanWs?.()
	})

	for (const [label, build, assertVg] of LD_VARIATIONS) {
		it(`pull materializes the ${label} ladder as a .ld file with the right logic`, async () => {
			const name = `VltCliLd_${label}`
			await del(name) // self-heal from an interrupted prior run
			created.push(name)
			const refs = await b.getRefs()
			const r = await b.pushBatch({ expectedProjectVersion: refs.projectVersion, ops: [{ op: "pushItem", name: `${name}.ld`, folder: "", sourceText: build(name), ifVersion: null }] })
			expect(r.accepted).toBe(true)

			expect((await pull(ws, b, { force: true })).kind).toBe("ok")
			const f = walk(ws).find((p) => p.endsWith(`${name}.ld`))
			expect(f).toBeDefined()
			const vg = readFileSync(f!, "utf-8")
			expect(vg).toContain("NETWORK")
			expect(vg).toContain(" LD")   // stayed ladder
			assertVg(vg)
		})
	}
})
