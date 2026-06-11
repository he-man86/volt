import { afterEach, describe, expect, test } from "bun:test"

import { simple } from "../fixtures/projects/simple.js"
import { makeTestEnv, type TestEnv } from "../harness/make-test-env.js"
import { runPull, runShow } from "../harness/run-verb.js"

let env: TestEnv | undefined
afterEach(() => {
	env?.cleanup()
	env = undefined
})

describe("show: src/ prefix handling", () => {
	test("HEAD ref resolves a workspace-relative (src/-prefixed) path", async () => {
		env = makeTestEnv(simple)
		expect((await runPull(env)).exitCode).toBe(0)

		const result = await runShow(env, {
			_positional: "HEAD",
			_positional2: "src/POUs/FB_Motor.st",
		})

		expect(result.exitCode).toBe(0)
		expect(result.stdout.length).toBeGreaterThan(0)
		expect(result.stdout).toContain("FUNCTION_BLOCK FB_Motor")
	})

	test("HEAD ref still resolves a vendor-relative path (no src/)", async () => {
		env = makeTestEnv(simple)
		expect((await runPull(env)).exitCode).toBe(0)

		const result = await runShow(env, {
			_positional: "HEAD",
			_positional2: "POUs/FB_Motor.st",
		})

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain("FUNCTION_BLOCK FB_Motor")
	})

	test("missing item reports the original (user-supplied) path in the error", async () => {
		env = makeTestEnv(simple)
		expect((await runPull(env)).exitCode).toBe(0)

		const result = await runShow(env, {
			_positional: "HEAD",
			_positional2: "src/POUs/Nope.st",
		})

		expect(result.exitCode).toBe(2)
		expect(result.stderr).toContain("src/POUs/Nope.st")
	})
})
