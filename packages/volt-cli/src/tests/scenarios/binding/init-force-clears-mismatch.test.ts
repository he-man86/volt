import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { runInit } from "../../harness/run-verb.js"
import { runPull } from "../../harness/run-verb.js"
import { runStatus } from "../../harness/run-verb.js"
import { simple } from "../../fixtures/projects/simple.js"
import { makeTestEnv, type TestEnv } from "../../harness/make-test-env.js"

let env: TestEnv | undefined
afterEach(() => {
	env?.cleanup()
	env = undefined
})

interface StatusJson {
	projectMismatch: null | { diffFields: string[] }
}

describe("scenario: init --force accepts the new binding and preserves snapshot history", () => {
	test("force-init updates config to the bridge's current identity", async () => {
		env = makeTestEnv({
			...simple,
			health: { projectName: "ScenarioProject_v2" },
		})

		const pre = JSON.parse(
			(await runStatus(env, { json: true })).stdout,
		) as StatusJson
		expect(pre.projectMismatch).not.toBeNull()

		const initResult = await runInit(env, { force: true })
		expect(initResult.exitCode).toBe(0)

		const cfg = JSON.parse(
			readFileSync(join(env.workspace, ".volt", "config.json"), "utf-8"),
		) as { project: { projectName: string } }
		expect(cfg.project.projectName).toBe("ScenarioProject_v2")

		const post = JSON.parse(
			(await runStatus(env, { json: true })).stdout,
		) as StatusJson
		expect(post.projectMismatch).toBeNull()
	})

	test("snapshot history survives the rebind — prior pull's state is preserved", async () => {
		env = makeTestEnv(simple)

		await runPull(env)
		const statePath = join(env.workspace, ".volt", "snapshot", "state.json")
		const stateBefore = readFileSync(statePath, "utf-8")

		env.bridge.mutateHealth({ projectName: "ScenarioProject_v2" })

		const initResult = await runInit(env, { force: true })
		expect(initResult.exitCode).toBe(0)

		const stateAfter = readFileSync(statePath, "utf-8")
		expect(stateAfter).toBe(stateBefore)
	})
})
