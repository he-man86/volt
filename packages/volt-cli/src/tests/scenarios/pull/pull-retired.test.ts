import { afterEach, describe, expect, test } from "bun:test"

import {
	listWorkspace,
	workspaceHasFile,
} from "../../harness/assert-workspace.js"
import { makeTestEnv, type TestEnv } from "../../harness/make-test-env.js"
import { runPull } from "../../harness/run-verb.js"
import { simple } from "../../fixtures/projects/simple.js"

let env: TestEnv | undefined
afterEach(() => {
	env?.cleanup()
	env = undefined
})

describe("scenario: pull removes retired items", () => {
	test("an item the bridge deletes disappears from workspace on next pull", async () => {
		env = makeTestEnv(simple)
		await runPull(env)
		expect(workspaceHasFile(env.workspace, "src/POUs/Types/DUT_MotorState.struct")).toBe(true)

		env.bridge.items.delete("DUT_MotorState")

		const result = await runPull(env)
		expect(result.exitCode).toBe(0)
		expect(workspaceHasFile(env.workspace, "src/POUs/Types/DUT_MotorState.struct")).toBe(false)
		expect(workspaceHasFile(env.workspace, "src/POUs/FB_Motor.st")).toBe(true)
		expect(workspaceHasFile(env.workspace, "src/POUs/GVL_Config.gvl")).toBe(true)
	})

	test("emptied parent dirs get swept", async () => {
		env = makeTestEnv(simple)
		await runPull(env)
		env.bridge.items.delete("DUT_MotorState")
		await runPull(env)
		const files = listWorkspace(env.workspace)
		expect(files.some((f) => f.startsWith("src/POUs/Types/"))).toBe(false)
	})
})
