import { afterEach, describe, expect, test } from "bun:test"

import {
	listWorkspace,
	readWorkspace,
	workspaceHasFile,
} from "../../harness/assert-workspace.js"
import { makeTestEnv, type TestEnv } from "../../harness/make-test-env.js"
import { runPull } from "../../harness/run-verb.js"
import { simple } from "../../fixtures/projects/simple.js"
import { withConfig } from "../../fixtures/projects/with-config.js"

let env: TestEnv | undefined
afterEach(() => {
	env?.cleanup()
	env = undefined
})

describe("scenario: pull against a clean workspace", () => {
	test("materializes every source item under its folder with the right extension", async () => {
		env = makeTestEnv(simple)
		const result = await runPull(env)
		expect(result.exitCode).toBe(0)

		const files = listWorkspace(env.workspace)
		expect(files).toContain("src/POUs/FB_Motor.st")
		expect(files).toContain("src/POUs/GVL_Config.gvl")
		expect(files).toContain("src/POUs/Types/DUT_MotorState.struct")
		expect(files).toContain("src/.gitattributes")
		expect(files.filter((p) => !/(^|\/)\./.test(p))).toEqual([
			"src/POUs/FB_Motor.st",
			"src/POUs/GVL_Config.gvl",
			"src/POUs/Types/DUT_MotorState.struct",
		])
	})

	test("materializes config kinds with their own extensions + folders", async () => {
		env = makeTestEnv(withConfig)
		const result = await runPull(env)
		expect(result.exitCode).toBe(0)

		expect(workspaceHasFile(env.workspace, "src/POUs/FB_Pump.st")).toBe(true)
		expect(
			workspaceHasFile(
				env.workspace,
				"src/Device/Plc Logic/Application/Library Manager/IoStandard.library",
			),
		).toBe(true)
		expect(
			workspaceHasFile(
				env.workspace,
				"src/Device/Plc Logic/Application/Task Configuration/MainTask.task",
			),
		).toBe(true)
		expect(workspaceHasFile(env.workspace, "src/Device.device")).toBe(true)
		expect(workspaceHasFile(env.workspace, "src/Project Information.projectinfo")).toBe(true)
	})

	test("config file content matches what the bridge sent verbatim", async () => {
		env = makeTestEnv(withConfig)
		await runPull(env)
		const libText = readWorkspace(
			env.workspace,
			"src/Device/Plc Logic/Application/Library Manager/IoStandard.library",
		)
		expect(libText).toContain("namespace = IoStandard")
		expect(libText).toContain("resolution = IoStandard, 3.5.17.0 (System)")
		expect(libText).toContain("system = true")
	})

	test("logs phase progress so the user sees what's happening", async () => {
		env = makeTestEnv(simple)
		const result = await runPull(env)
		expect(result.stderr).toContain("querying bridge state")
		expect(result.stderr).toContain("fetching")
		expect(result.stderr).toContain("writing")
	})
})
