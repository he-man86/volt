/**
 * Live graphical round-trip — runs against a real bridge with FBD/LD POUs.
 * Verifies a graphical root body materializes as an editable .fbd file (marker-free, %LANG body)
 * and round-trips: pull → edit VG → push → pull → restore.
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

let bridge: BridgeClient
let workspace: string
let cleanup: () => void

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
	})

	afterAll(() => cleanup?.())

	it("pull materializes an FBD root body as a marker-free .fbd file", async () => {
		const r = await pull(workspace, bridge, { force: true })
		expect(r.kind).toBe("ok")
		const f = findGraphical()
		expect(f).not.toBeNull()
		const vg = readFileSync(f!, "utf-8")
		expect(vg).toContain("%LANG ")            // the editable VG body
		expect(vg).not.toContain("@volt-graphical") // root file carries NO marker (marker = children only)
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
