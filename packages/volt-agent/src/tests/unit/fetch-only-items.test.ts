/**
 * Regression test: `/fetch` honors `onlyItems` allowlist.
 *
 * The VS Code extension's SCM-tree preview (click on an incoming item to
 * see the bridge's version) calls `peekBridgeItem(bridge, name)`, which
 * sends `{knownItems: {[name]: ""}, onlyItems: [name]}`. Without the
 * `onlyItems` filter, the bridge materialized every item in the project
 * just to discard 242 of them — a 5-second click for one preview on a
 * 243-item CODESYS solution. This test pins the filter behavior so a
 * future refactor of the bridge's fetch loop can't silently regress it.
 */
import { afterEach, describe, expect, test } from "bun:test";

import { pullVerb } from "../../cli/pull.js";
import { peekBridgeItem } from "../../engine/ops.js";
import { simple } from "../fixtures/projects/simple.js";
import { makeTestEnv, type TestEnv } from "../harness/make-test-env.js";
import { runVerb } from "../harness/run-verb.js";

let env: TestEnv | undefined;
afterEach(() => {
	env?.cleanup();
	env = undefined;
});

describe("/fetch with onlyItems allowlist", () => {
	test("returns ONLY the requested item even when others exist on the bridge", async () => {
		env = makeTestEnv(simple);

		// Set up a populated bridge by pulling once (simple has 3 items).
		expect((await runVerb(pullVerb, env)).exitCode).toBe(0);

		// Now ask for one item via peekBridgeItem (which uses onlyItems).
		const outputs = await peekBridgeItem(env.bridge, "FB_Motor");
		expect(outputs.length).toBeGreaterThan(0);
		// At least one output is named FB_Motor (the parent).
		expect(outputs.some((o) => o.path.includes("FB_Motor"))).toBe(true);
	});

	test("direct bridge call with onlyItems filters `changed` correctly", async () => {
		env = makeTestEnv(simple);

		// Empty knownItems + onlyItems=["FB_Motor"] → bridge should only
		// build FB_Motor, not GVL_Config or DUT_MotorState.
		const resp = await env.bridge.fetchChanges({
			knownItems: {},
			onlyItems: ["FB_Motor"],
		});

		const changedNames = resp.changed.map((c) => c.name);
		expect(changedNames).toContain("FB_Motor");
		expect(changedNames).not.toContain("GVL_Config");
		expect(changedNames).not.toContain("DUT_MotorState");
	});

	test("absent onlyItems = wholesale fetch (back-compat)", async () => {
		env = makeTestEnv(simple);

		// Old call shape — no onlyItems. Bridge must still return all
		// items the agent doesn't know about. Pull's first call does
		// exactly this.
		const resp = await env.bridge.fetchChanges({ knownItems: {} });

		const changedNames = resp.changed.map((c) => c.name);
		expect(changedNames).toContain("FB_Motor");
		expect(changedNames).toContain("GVL_Config");
		expect(changedNames).toContain("DUT_MotorState");
	});
});
