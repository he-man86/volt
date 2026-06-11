import { afterAll, beforeAll, describe, expect, test } from "bun:test"

import { BridgeClient } from "../../bridge/client.js"
import { FetchResponseSchema } from "../../bridge/types.js"

const PORT_RAW = process.env.VOLT_TEST_BRIDGE_PORT
const PORT = PORT_RAW !== undefined ? Number.parseInt(PORT_RAW, 10) : Number.NaN
const LIVE = Number.isFinite(PORT)

const LIVE_TEST_TIMEOUT_MS = 60_000

describe.skipIf(!LIVE)("live wire-contract invariants", () => {
	let bridge: BridgeClient

	beforeAll(async () => {
		bridge = new BridgeClient({ port: PORT })
		const h = await bridge.getHealth()
		if (h.connected !== true) {
			throw new Error(
				`bridge at :${PORT} reports connected=false (ide=${h.ideName}) — open an IDE project before running this test`,
			)
		}
	})

	afterAll(() => {
		// Nothing to clean — we don't touch the bridge state.
	})

	test("per-item version is content-addressed (stable across back-to-back /refs)", async () => {
		const a = await bridge.getRefs()
		const b = await bridge.getRefs()
		const diffs: string[] = []
		for (const [name, ver] of Object.entries(a.items)) {
			if (b.items[name] !== ver) {
				diffs.push(`${name}: ${ver} → ${b.items[name]}`)
			}
		}
		for (const name of Object.keys(b.items)) {
			if (!(name in a.items)) diffs.push(`${name}: appeared between calls`)
		}
		if (diffs.length > 0) {
			console.error(
				"per-item versions churned across back-to-back /refs:\n  " +
					diffs.join("\n  "),
			)
		}
		expect(diffs).toEqual([])
	})

	test("fetch payload validates against the wire schema", async () => {
		const raw = await bridge.fetchChanges({ knownItems: {} })
		const parsed = FetchResponseSchema.safeParse(raw)
		if (!parsed.success) {
			console.error("wire schema violation:", parsed.error.format())
		}
		expect(parsed.success).toBe(true)
	})

	test("declaration-only kinds carry no language field", async () => {
		const declOnlyKinds = new Set([
			"gvl",
			"interface",
			"structure",
			"union",
			"enumeration",
			"alias",
		])
		const r = await bridge.fetchChanges({ knownItems: {} })
		const violations: string[] = []
		for (const it of r.changed) {
			if (declOnlyKinds.has(it.kind) && (it as { language?: string }).language !== undefined) {
				violations.push(
					`${it.name} (${it.kind}): unexpected language='${(it as { language?: string }).language}'`,
				)
			}
		}
		if (violations.length > 0) {
			console.error(
				"declaration-only items pretending to have a body language:\n  " +
					violations.join("\n  "),
			)
		}
		expect(violations).toEqual([])
	})

	test("no item carries language=UNKNOWN (would mean bridge couldn't classify)", async () => {
		const r = await bridge.fetchChanges({ knownItems: {} })
		const unknown: string[] = []
		for (const it of r.changed) {
			if ((it as { language?: string }).language === "UNKNOWN") {
				unknown.push(`${it.name} (${it.kind})`)
			}
		}
		if (unknown.length > 0) {
			console.error(
				"items the bridge couldn't classify (language=UNKNOWN):\n  " +
					unknown.join("\n  "),
			)
		}
		expect(unknown).toEqual([])
	})
})
