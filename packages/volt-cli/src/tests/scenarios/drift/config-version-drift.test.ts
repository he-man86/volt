import { afterEach, describe, expect, test } from "bun:test"

import { runPull } from "../../harness/run-verb.js"
import { readWorkspace } from "../../harness/assert-workspace.js"
import { makeTestEnv, type TestEnv } from "../../harness/make-test-env.js"
import { withConfig } from "../../fixtures/projects/with-config.js"

let env: TestEnv | undefined
afterEach(() => {
	env?.cleanup()
	env = undefined
})

describe("scenario: config item version is content-aware", () => {
	test("editing a config item's content makes the next pull materialize the new content", async () => {
		env = makeTestEnv(withConfig)

		const first = await runPull(env)
		expect(first.exitCode).toBe(0)
		const taskPath = "src/Device/Plc Logic/Application/Task Configuration/MainTask.task"
		expect(readWorkspace(env.workspace, taskPath)).toContain("priority = 1")

		const task = env.bridge.items.get("MainTask")
		if (task === undefined) throw new Error("fixture invariant: MainTask must exist")
		task.sourceText = "kind = Cyclic\npriority = 9\ninterval = 50\npou = PLC_PRG\n"

		const second = await runPull(env)
		expect(second.exitCode).toBe(0)
		expect(readWorkspace(env.workspace, taskPath)).toContain("priority = 9")
	})

	test("no-op pull when nothing changed (version stable)", async () => {
		env = makeTestEnv(withConfig)
		await runPull(env)
		const before = readWorkspace(
			env.workspace,
			"src/Device/Plc Logic/Application/Library Manager/IoStandard.library",
		)

		const second = await runPull(env)
		expect(second.exitCode).toBe(0)
		const after = readWorkspace(
			env.workspace,
			"src/Device/Plc Logic/Application/Library Manager/IoStandard.library",
		)
		expect(after).toBe(before)
	})

	test("different config items produce different versions (no kind-string collisions)", async () => {
		env = makeTestEnv(withConfig)
		const refs = await env.bridge.getRefs()
		const taskVer = refs.items["MainTask"]
		const libVer = refs.items["IoStandard"]
		expect(taskVer).toBeDefined()
		expect(libVer).toBeDefined()
		expect(taskVer).not.toBe("task")
		expect(libVer).not.toBe("library")
		expect(taskVer).not.toBe(libVer)
	})
})
