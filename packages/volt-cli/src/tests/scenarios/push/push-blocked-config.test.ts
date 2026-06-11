import { afterEach, describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { makeTestEnv, type TestEnv } from "../../harness/make-test-env.js"
import { runPull, runPush } from "../../harness/run-verb.js"
import { withConfig } from "../../fixtures/projects/with-config.js"

let env: TestEnv | undefined
afterEach(() => {
	env?.cleanup()
	env = undefined
})

describe("scenario: push refuses read-only extensions", () => {
	test("editing a .library file blocks push with a clear refusal", async () => {
		env = makeTestEnv(withConfig)
		await runPull(env)

		writeFileSync(
			join(
				env.workspace,
				"src/Device/Plc Logic/Application/Library Manager/IoStandard.library",
			),
			"resolution = TampedVersion\n",
			"utf-8",
		)

		const before = env.bridge.items.get("IoStandard")?.sourceText
		const result = await runPush(env)
		expect(result.exitCode).toBe(2)
		const after = env.bridge.items.get("IoStandard")?.sourceText
		expect(after).toBe(before)
		expect(result.stderr).toContain(".library")
		expect(result.stderr).toContain("extensionAccess")
	})

	test("editing a .device file blocks push", async () => {
		env = makeTestEnv(withConfig)
		await runPull(env)
		writeFileSync(
			join(env.workspace, "src/Device.device"),
			"device-id = MUTATED\n",
			"utf-8",
		)
		const result = await runPush(env)
		expect(result.exitCode).toBe(2)
	})
})
