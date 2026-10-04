/**
 * EVERY WIRE CODE, PROVEN LIVE ON BOTH VENDORS — the negative matrix (openspec `bridge-refusal-review` 8.1, 8.4).
 *
 * <p>Data-driven from `table.ts`: one minimal trigger per code a client can receive. Each live row is run against every
 * fixture IDE of ours that is up (CODESYS and TwinCAT, resolved exactly as `vendor-parity` resolves them — only an
 * `ide.ps1` instance's own copy), and asserts (a) the exact code, (b) that the message names the item (or what the
 * frame is about), (c) the project after the call — nothing written for a pre-write refusal, exactly the receipt for
 * an apply-time stop — and, when both IDEs are up, (d) that the two answers are byte-identical after masking versions
 * and the project's own name (`normalize`). A row where the two vendors answer differently is a defect below the seam
 * (8.4), fixed there. The one exception is a row's `divergence`: an irreducible vendor fact, measured against at least
 * two other vendor paths and listed for the OWNER — pinned here (the other vendor's answer is asserted), so it fails the
 * day the vendors converge, and never silently absorbed.</p>
 *
 * <p>Run with both launchers up, then either vendor's command (the file drives both pipes itself):</p>
 * <pre>
 *   pwsh scripts/ide.ps1 up -Vendor codesys -Instance x -Wait
 *   pwsh scripts/ide.ps1 up -Vendor twincat -Instance x -Fixture 13 -Wait
 *   VOLT_E2E_INSTANCE=x bun test test/e2e/refusals
 * </pre>
 * <p>A vendor with no fixture IDE of ours is a skip that prints what it refused; the parity half needs both.</p>
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { livePipesFor } from "../lib/pipe"
import {
	IN_SESSION,
	ROWS,
	REF_PREFIX,
	bindBridge,
	conflictOf,
	normalize,
	refsOf,
	sweep,
	type Bridge,
	type LiveRow,
	type Outcome,
} from "./table"

setDefaultTimeout(180_000)

function pipeFor(vendor: "codesys" | "twincat"): string | undefined {
	try {
		return livePipesFor(vendor)[0]
	} catch (e) {
		if (process.env[`VOLT_PIPE_${vendor.toUpperCase()}`]) throw e
		console.log(`refusals: ${vendor}: ${(e as Error).message}`)
		return undefined
	}
}

const VENDORS = (["codesys", "twincat"] as const).filter((v) => pipeFor(v) !== undefined)
if (VENDORS.length === 0) console.log("refusals: SKIPPED — no fixture IDE of ours is up on either vendor")
if (VENDORS.length === 1) console.log(`refusals: only ${VENDORS[0]} is up — the vendor-parity half (d) is SKIPPED`)

const live = ROWS.filter((r): r is LiveRow => r.live)
/** The normalized answer of each row per vendor, filled by the per-vendor runs, compared by the parity half. */
const answers = new Map<string, Partial<Record<"codesys" | "twincat", unknown>>>()

/** The part of `refs` a refusal must leave alone. */
const state = (r: any) => ({
	projectVersion: r.projectVersion,
	items: r.items,
	folders: r.folders,
	unreadable: r.unreadable,
})

async function check(b: Bridge, row: LiveRow, before: any, out: Outcome): Promise<void> {
	const a = out.answer
	// On a vendor the row lists as an owner-listed divergence (8.4), the trigger answers that code instead: pinned.
	const code = row.divergence?.vendor === b.vendor ? row.divergence.answers : row.code
	const shown = JSON.stringify(a).slice(0, 600)
	// (a) the exact code, (b) the message names the item
	if (out.item === undefined) {
		expect(a.kind, `${row.code}: expected an error frame, got ${shown}`).toBe("frame")
		if (a.kind !== "frame") return
		expect(a.code, shown).toBe(code)
		for (const n of out.names) expect(a.message, `${row.code}: the message does not name '${n}'`).toContain(n)
	} else {
		expect(a.kind, `${row.code}: expected a push answer, got ${shown}`).toBe("push")
		const c = conflictOf(a, out.item)
		expect(c, `${row.code}: no conflict names '${out.item}': ${shown}`).toBeDefined()
		expect(c.code, `${row.code}: '${out.item}' answered ${c.code}: ${c.reason}`).toBe(code)
		if (code === row.code) for (const n of out.names) expect(c.reason, `${row.code}: the reason does not name '${n}'`).toContain(n)
	}
	// (c) the project after the call
	const after = await refsOf(b)
	if (row.after === "unchanged") {
		expect(state(after), `${row.code}: a refusal before any write changed the project`).toEqual(state(before))
	} else {
		expect(a.kind).toBe("push")
		if (a.kind !== "push") return
		expect(a.response.accepted, `${row.code}: an apply-time stop must answer accepted:true with the receipt`).toBe(true)
		expect(a.response.newProjectVersion, `${row.code}: the receipt is not the next refs`).toBe(after.projectVersion)
		expect(a.response.newItems, `${row.code}: the receipt's items are not the next refs'`).toEqual(after.items)
		// The receipt equals refs whatever the bridge did; what the project HOLDS is the proof of where the push stopped.
		if (!out.landed?.length || !out.absent?.length)
			throw new Error(`${row.code}: an apply-time row must name what landed and what was never tried`)
		const held = Object.keys(after.items ?? {})
		for (const n of out.landed) expect(held, `${row.code}: '${n}' (before the stop) did not land`).toContain(n)
		for (const n of out.absent) expect(held, `${row.code}: '${n}' (after the stop) was written`).not.toContain(n)
	}
}

for (const vendor of VENDORS) {
	describe(`refusals — live negative matrix (${vendor})`, () => {
		let b: Bridge
		beforeAll(async () => {
			b = await bindBridge(pipeFor(vendor)!, vendor)
			await sweep(b)
		})
		afterAll(async () => {
			await sweep(b)
		})

		for (const row of live) {
			it(`${row.code} — ${row.trigger}`, async () => {
				const n = (s: string) => `${REF_PREFIX}${s}`
				try {
					if (row.setup) await row.setup(b, n)
					const before = await refsOf(b)
					let out: Outcome
					try {
						out = await row.run(b, n)
					} finally {
						if (row.restore) await row.restore(b)
					}
					console.log(`[refusals ${vendor}] ${row.code}: ${JSON.stringify(out.answer).slice(0, 700)}`)
					const seen = answers.get(row.code) ?? {}
					seen[vendor] = normalize(out.answer, b)
					answers.set(row.code, seen)
					await check(b, row, before, out)
				} finally {
					await sweep(b)
				}
			})
		}
	})
}

describe.skipIf(VENDORS.length < 2)("refusals — CODESYS and TwinCAT answer byte-identically (8.1 d, 8.4)", () => {
	it("UNREADABLE's POU, in the load that wrote it: the same version and the same ITEM_EXISTS on both vendors", () => {
		expect(IN_SESSION.get("twincat"), "the TwinCAT UNREADABLE setup did not run").toBeDefined()
		expect(IN_SESSION.get("twincat")).toEqual(IN_SESSION.get("codesys"))
	})

	for (const row of live) {
		it(`${row.code}: the same answer on both vendors`, () => {
			const seen = answers.get(row.code) ?? {}
			expect(seen.codesys, `${row.code}: CODESYS row did not run`).toBeDefined()
			expect(seen.twincat, `${row.code}: TwinCAT row did not run`).toBeDefined()
			if (row.divergence) {
				// Listed for the owner, pinned: the two must still differ as recorded. Converged → take the divergence off.
				const codes = (s: any) => JSON.stringify(s).match(/"code":"([A-Z_]+)"/)?.[1]
				expect(codes(seen[row.divergence.vendor]), `${row.code}: ${row.divergence.why}`).toBe(row.divergence.answers)
				expect(seen.twincat, `${row.code}: the vendors now answer alike — take the divergence off the row`).not.toEqual(seen.codesys)
				return
			}
			expect(seen.twincat).toEqual(seen.codesys)
		})
	}
})
