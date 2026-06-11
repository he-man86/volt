import { afterEach, describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { makeTestEnv, type TestEnv } from "../../harness/make-test-env.js"
import { runPull, runPush } from "../../harness/run-verb.js"
import { simple } from "../../fixtures/projects/simple.js"

let env: TestEnv | undefined
afterEach(() => {
	env?.cleanup()
	env = undefined
})

describe("scenario: push source-file edits", () => {
	test("an edited .st file lands on the bridge", async () => {
		env = makeTestEnv(simple)
		await runPull(env)

		const fbPath = join(env.workspace, "src/POUs/FB_Motor.st")
		const updatedBody =
			"FUNCTION_BLOCK FB_Motor\n" +
			"VAR_INPUT\n" +
			"\trun: BOOL;\n" +
			"\tspeed: REAL;\n" +
			"END_VAR\n" +
			"VAR_OUTPUT\n" +
			"\trunning: BOOL;\n" +
			"END_VAR\n" +
			"\nrunning := run;\n\n" +
			"END_FUNCTION_BLOCK\n"
		writeFileSync(fbPath, updatedBody, "utf-8")

		const result = await runPush(env)
		expect(result.exitCode).toBe(0)

		const item = env.bridge.items.get("FB_Motor")
		expect(item?.sourceText.replace(/\r\n/g, "\n")).toBe(updatedBody)
	})

	test("a push that touches nothing exits cleanly without sending an op", async () => {
		env = makeTestEnv(simple)
		await runPull(env)
		env.bridge.pushCalls = []

		const result = await runPush(env)
		expect(result.exitCode).toBe(0)
		expect(env.bridge.pushCalls).toEqual([])
		expect(result.stdout).toContain("nothing to push")
	})
})
