import { afterEach, describe, expect, test } from "bun:test"

import { runStatus } from "../../harness/run-verb.js"
import { makeTestEnv, type TestEnv } from "../../harness/make-test-env.js"
import { simple } from "../../fixtures/projects/simple.js"

let env: TestEnv | undefined
afterEach(() => {
	env?.cleanup()
	env = undefined
})

describe("scenario: status after init, before any pull", () => {
	test("shows every bridge item as incoming added", async () => {
		env = makeTestEnv(simple)

		const result = await runStatus(env, { json: true })
		expect(result.exitCode).toBe(0)
		const out = JSON.parse(result.stdout) as {
			initialized: boolean
			incoming: { added: string[]; modified: string[]; removed: string[] }
			outgoing: { added: string[]; modified: string[]; removed: string[] }
			nextAction: string | null
			pathByName: Record<string, string>
			summary: string
		}

		expect(out.initialized).toBe(true)
		expect(out.outgoing.added).toEqual([])
		expect(out.outgoing.modified).toEqual([])
		expect(out.outgoing.removed).toEqual([])
		expect(out.incoming.added.sort()).toEqual([
			"DUT_MotorState",
			"FB_Motor",
			"GVL_Config",
		])
		expect(out.incoming.modified).toEqual([])
		expect(out.incoming.removed).toEqual([])
		expect(out.nextAction).toBe("pull")
		expect(out.summary).toMatch(/run volt pull/i)
	})

	test("pathByName entries are workspace-relative under src/", async () => {
		env = makeTestEnv(simple)

		const result = await runStatus(env, { json: true })
		const out = JSON.parse(result.stdout) as { pathByName: Record<string, string> }

		for (const [name, rel] of Object.entries(out.pathByName)) {
			expect(rel.startsWith("src/"), `pathByName[${name}] = ${rel} should start with "src/"`).toBe(true)
		}
		expect(out.pathByName["FB_Motor"]).toBe("src/POUs/FB_Motor.st")
		expect(out.pathByName["GVL_Config"]).toBe("src/POUs/GVL_Config.gvl")
		expect(out.pathByName["DUT_MotorState"]).toBe("src/POUs/Types/DUT_MotorState.struct")
	})

	test("porcelain output emits one iA line per bridge item", async () => {
		env = makeTestEnv(simple)

		const result = await runStatus(env, { porcelain: true })
		expect(result.exitCode).toBe(0)
		const lines = result.stdout.trim().split("\n").sort()
		expect(lines).toEqual([
			"iA DUT_MotorState",
			"iA FB_Motor",
			"iA GVL_Config",
		])
	})
})
