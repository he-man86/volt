import { afterEach, describe, expect, test } from "bun:test"

import { simple } from "../fixtures/projects/simple.js"
import { makeTestEnv, type TestEnv } from "../harness/make-test-env.js"
import { runPull } from "../harness/run-verb.js"

let env: TestEnv | undefined
afterEach(() => {
	env?.cleanup()
	env = undefined
})

describe("/fetch with onlyItems allowlist", () => {
	test("returns ONLY the requested item even when others exist on the bridge", async () => {
		env = makeTestEnv(simple)
		expect((await runPull(env)).exitCode).toBe(0)

		const resp = await env.bridge.fetchChanges({
			knownItems: Object.fromEntries(env.bridge.items.entries().map(([n, it]) => [n, ""])),
			onlyItems: ["FB_Motor"],
		})
		const changedNames = resp.changed.map((c) => c.name)
		expect(changedNames).toContain("FB_Motor")
	})

	test("direct bridge call with onlyItems filters `changed` correctly", async () => {
		env = makeTestEnv(simple)

		const resp = await env.bridge.fetchChanges({
			knownItems: {},
			onlyItems: ["FB_Motor"],
		})

		const changedNames = resp.changed.map((c) => c.name)
		expect(changedNames).toContain("FB_Motor")
		expect(changedNames).not.toContain("GVL_Config")
		expect(changedNames).not.toContain("DUT_MotorState")
	})

	test("absent onlyItems = wholesale fetch (back-compat)", async () => {
		env = makeTestEnv(simple)

		const resp = await env.bridge.fetchChanges({ knownItems: {} })

		const changedNames = resp.changed.map((c) => c.name)
		expect(changedNames).toContain("FB_Motor")
		expect(changedNames).toContain("GVL_Config")
		expect(changedNames).toContain("DUT_MotorState")
	})
})
