/**
 * Live-bridge wire-contract invariants.
 *
 * Runs only when `VOLT_TEST_BRIDGE_PORT` points at a connected IDE
 * (8555 = TwinCAT, 8556 = CODESYS). Read-only — no pushes, no
 * mutations to the user's project. Purely asserts that the wire shape
 * the bridge produces conforms to the contract the agent expects.
 *
 * Why this complements `full-cycle.test.ts`:
 *  - full-cycle exercises push/pull round-trip — risky against
 *    production projects, requires a sandbox POU (PLC_PRG).
 *  - This file is the cheap, ALWAYS-SAFE diagnostic: spin against any
 *    open project, get pass/fail on every wire invariant. If either
 *    bridge regresses on shape (silent ST fallback, missing
 *    graphicalChildren, language on non-POU items, etc.), this trips.
 *
 * Invariants asserted:
 *   1. Per-item version is content-addressed (stable across
 *      back-to-back /refs). projectVersion may churn for non-content
 *      reasons (TC SaveAll bumps it; see `project_drift_means_item_change`).
 *   2. `graphicalChildren` entries are schema-valid: kind ∈
 *      {action, method, transition}, language ∈ {FBD, LD, SFC, CFC},
 *      declaration + implementationXml non-empty.
 *   3. Top-level graphical POUs (language ∈ {FBD, LD, SFC, CFC}) carry
 *      `implementationXml` so the agent can transpile or surface them.
 *   4. Declaration-only kinds (gvl/structure/enumeration/union/alias/
 *      interface) NEVER carry a `language` field — they have no body.
 *   5. No item should carry `language: "UNKNOWN"`. UNKNOWN is a real
 *      signal worth investigating (the bridge couldn't classify a body)
 *      — log + fail so the engineer notices.
 *   6. The full /fetch payload validates against `FetchResponseSchema`.
 *      Catches accidental wire-shape drift early.
 *
 * Cross-bridge: same test code, same assertions. Run twice (once per
 * port) to validate parity between Beckhoff and CODESYS.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { BridgeClient } from "../../bridge/client.js";
import { FetchResponseSchema } from "../../bridge/types.js";

const PORT_RAW = process.env.VOLT_TEST_BRIDGE_PORT;
const PORT = PORT_RAW !== undefined ? Number.parseInt(PORT_RAW, 10) : Number.NaN;
const LIVE = Number.isFinite(PORT);

// Live /refs on a large CODESYS project (200+ items, deep device tree)
// can take several seconds — each library reference, every device tree
// node, every visualization gets polled by the bridge. Default 5s is
// tight on real projects. Cap each test at 60s.
const LIVE_TEST_TIMEOUT_MS = 60_000;

describe.skipIf(!LIVE)("live wire-contract invariants", () => {
	let bridge: BridgeClient;

	beforeAll(async () => {
		bridge = new BridgeClient({ port: PORT });
		const h = await bridge.getHealth();
		if (h.connected !== true) {
			throw new Error(
				`bridge at :${PORT} reports connected=false (ide=${h.ideName}) — open an IDE project before running this test`,
			);
		}
	});

	afterAll(() => {
		// Nothing to clean — we don't touch the bridge state.
	});

	test("per-item version is content-addressed (stable across back-to-back /refs)", { timeout: LIVE_TEST_TIMEOUT_MS }, async () => {
		const a = await bridge.getRefs();
		// projectVersion churns on TC/CODESYS for non-content reasons —
		// we don't test it here. Item versions MUST be stable.
		const b = await bridge.getRefs();
		const diffs: string[] = [];
		for (const [name, ver] of Object.entries(a.items)) {
			if (b.items[name] !== ver) {
				diffs.push(`${name}: ${ver} → ${b.items[name]}`);
			}
		}
		for (const name of Object.keys(b.items)) {
			if (!(name in a.items)) diffs.push(`${name}: appeared between calls`);
		}
		if (diffs.length > 0) {
			console.error(
				"per-item versions churned across back-to-back /refs:\n  " +
					diffs.join("\n  "),
			);
		}
		expect(diffs).toEqual([]);
	});

	test("fetch payload validates against the wire schema", { timeout: LIVE_TEST_TIMEOUT_MS }, async () => {
		// Empty knownItems = full snapshot. Any item the bridge sends
		// that violates `FetchedItemSchema` (extra field on strict()
		// dict, wrong type on language enum, missing required, etc.)
		// surfaces as a parse error here.
		const raw = await bridge.fetchChanges({ knownItems: {} });
		const parsed = FetchResponseSchema.safeParse(raw);
		if (!parsed.success) {
			console.error("wire schema violation:", parsed.error.format());
		}
		expect(parsed.success).toBe(true);
	});

	test("graphicalChildren entries are schema-valid", { timeout: LIVE_TEST_TIMEOUT_MS }, async () => {
		const r = await bridge.fetchChanges({ knownItems: {} });
		const violations: string[] = [];
		for (const it of r.changed) {
			const gc = it.graphicalChildren;
			if (gc === undefined) continue;
			for (const g of gc) {
				if (!["action", "method", "transition"].includes(g.kind)) {
					violations.push(`${it.name}/${g.name}: invalid kind '${g.kind}'`);
				}
				if (!["FBD", "LD", "SFC", "CFC"].includes(g.language)) {
					violations.push(
						`${it.name}/${g.name}: invalid graphical language '${g.language}'`,
					);
				}
				if (!g.declaration || g.declaration.length === 0) {
					violations.push(`${it.name}/${g.name}: empty declaration`);
				}
				if (!g.implementationXml || g.implementationXml.length === 0) {
					violations.push(`${it.name}/${g.name}: empty implementationXml`);
				}
			}
		}
		expect(violations).toEqual([]);
	});

	test("top-level graphical POUs carry implementationXml", { timeout: LIVE_TEST_TIMEOUT_MS }, async () => {
		const r = await bridge.fetchChanges({ knownItems: {} });
		const missing: string[] = [];
		for (const it of r.changed) {
			if (
				it.language === "FBD" ||
				it.language === "LD" ||
				it.language === "SFC" ||
				it.language === "CFC"
			) {
				if (!it.implementationXml) {
					missing.push(`${it.name} (${it.kind}, ${it.language})`);
				}
			}
		}
		if (missing.length > 0) {
			console.error(
				"top-level graphical POUs missing implementationXml:\n  " +
					missing.join("\n  "),
			);
		}
		expect(missing).toEqual([]);
	});

	test("declaration-only kinds carry no language field", { timeout: LIVE_TEST_TIMEOUT_MS }, async () => {
		// PLC kinds with NO body: GVL, INTERFACE, STRUCTURE, UNION,
		// ENUMERATION, ALIAS. The wire schema makes `language` optional
		// specifically so these items can OMIT it (instead of pretending
		// to have a body language).
		const declOnlyKinds = new Set([
			"gvl",
			"interface",
			"structure",
			"union",
			"enumeration",
			"alias",
		]);
		const r = await bridge.fetchChanges({ knownItems: {} });
		const violations: string[] = [];
		for (const it of r.changed) {
			if (declOnlyKinds.has(it.kind) && it.language !== undefined) {
				violations.push(
					`${it.name} (${it.kind}): unexpected language='${it.language}'`,
				);
			}
		}
		if (violations.length > 0) {
			console.error(
				"declaration-only items pretending to have a body language:\n  " +
					violations.join("\n  "),
			);
		}
		expect(violations).toEqual([]);
	});

	test("no item carries language=UNKNOWN (would mean bridge couldn't classify)", { timeout: LIVE_TEST_TIMEOUT_MS }, async () => {
		// UNKNOWN is a real "I couldn't tell" signal. Either the IDE has
		// a POU in a state that's broken (re-export it) or the bridge
		// classifier has a gap. Either way, fail loud rather than silently
		// drop the POU.
		const r = await bridge.fetchChanges({ knownItems: {} });
		const unknown: string[] = [];
		for (const it of r.changed) {
			if (it.language === "UNKNOWN") {
				unknown.push(`${it.name} (${it.kind})`);
			}
		}
		if (unknown.length > 0) {
			console.error(
				"items the bridge couldn't classify (language=UNKNOWN):\n  " +
					unknown.join("\n  "),
			);
		}
		expect(unknown).toEqual([]);
	});

	test("graphical-child language matches the workspace extension that would be picked", { timeout: LIVE_TEST_TIMEOUT_MS }, async () => {
		// Sanity: every graphical child's language must map to a known
		// workspace file extension via the agent's extension registry.
		// This catches the case where the bridge emits e.g. "CFC" but
		// the registry didn't yet add `.cfc` as a graphical-child ext.
		const { pickExtension } = await import("../../engine/extension-registry.js");
		const r = await bridge.fetchChanges({ knownItems: {} });
		const violations: string[] = [];
		for (const it of r.changed) {
			const gc = it.graphicalChildren;
			if (gc === undefined) continue;
			for (const g of gc) {
				try {
					// We use the parent's POU kind to drive the extension —
					// graphical children currently use the parent's source
					// family. The kind→ext mapping for graphical children
					// should round-trip without throwing.
					const ext = pickExtension("function_block", g.language);
					if (typeof ext !== "string" || ext.length === 0) {
						violations.push(
							`${it.name}/${g.name}: pickExtension returned empty for language '${g.language}'`,
						);
					}
				} catch (err) {
					violations.push(
						`${it.name}/${g.name}: pickExtension threw for language '${g.language}': ${err instanceof Error ? err.message : String(err)}`,
					);
				}
			}
		}
		expect(violations).toEqual([]);
	});
});
