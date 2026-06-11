import { afterEach, describe, expect, test } from "bun:test"

import { runPull } from "../../harness/run-verb.js"
import { runPush } from "../../harness/run-verb.js"
import { runBuild } from "../../harness/run-verb.js"
import { simple } from "../../fixtures/projects/simple.js"
import { makeTestEnv, type TestEnv } from "../../harness/make-test-env.js"

let env: TestEnv | undefined
afterEach(() => {
	env?.cleanup()
	env = undefined
})

describe("scenario: project-binding mismatch refuses mutating verbs", () => {
	test("pull refuses with exit 2 when bridge reports a different projectName", async () => {
		env = makeTestEnv({
			...simple,
			health: { projectName: "ScenarioProject_v2" },
		})

		const result = await runPull(env)
		expect(result.exitCode).toBe(2)
		expect(result.stderr).toContain("project-binding mismatch")
		expect(result.stderr).toContain("ScenarioProject")
		expect(result.stderr).toContain("ScenarioProject_v2")
		expect(result.stderr).toContain("volt init --force")
	})

	test("push refuses with exit 2 when bridge reports a different plcProjectName", async () => {
		env = makeTestEnv({
			...simple,
			health: { plcProjectName: "ScenarioPlc_renamed" },
		})

		const result = await runPush(env)
		expect(result.exitCode).toBe(2)
		expect(result.stderr).toContain("project-binding mismatch")
		expect(result.stderr).toContain("volt init --force")
	})

	test("build refuses with exit 2 when bridge reports a different platform", async () => {
		env = makeTestEnv(simple)
		env.bridge.mutateHealth({ platform: "codesys" })

		const result = await runBuild(env)
		expect(result.exitCode).toBe(2)
		expect(result.stderr).toContain("project-binding mismatch")
		expect(result.stderr).toContain("beckhoff")
		expect(result.stderr).toContain("codesys")
	})

	test("pull succeeds when the bridge identity matches the saved binding", async () => {
		env = makeTestEnv(simple)
		const result = await runPull(env)
		expect(result.exitCode).toBe(0)
	})
})
