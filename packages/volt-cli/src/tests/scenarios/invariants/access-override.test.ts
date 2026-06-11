import { afterEach, describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { listWorkspace, workspaceHasFile } from "../../harness/assert-workspace.js"
import { makeTestEnv, type TestEnv } from "../../harness/make-test-env.js"
import { runPull, runPush } from "../../harness/run-verb.js"
import { withConfig } from "../../fixtures/projects/with-config.js"

let env: TestEnv | undefined
afterEach(() => {
	env?.cleanup()
	env = undefined
})

describe("scenario: extensionAccess overrides", () => {
	test('"off" makes a library extension invisible to the workspace', async () => {
		env = makeTestEnv({
			...withConfig,
			extensionAccess: { ".library": "off" },
		})
		await runPull(env)
		const files = listWorkspace(env.workspace)
		const libraryFiles = files.filter((f) => f.endsWith(".library"))
		expect(libraryFiles).toEqual([])
		expect(workspaceHasFile(env.workspace, "src/POUs/FB_Pump.st")).toBe(true)
	})

	test('"rw" override lets push send a normally-read-only extension', async () => {
		env = makeTestEnv({
			...withConfig,
			extensionAccess: { ".library": "rw" },
		})
		await runPull(env)

		writeFileSync(
			join(
				env.workspace,
				"src/Device/Plc Logic/Application/Library Manager/IoStandard.library",
			),
			"name = #IoStandard\nresolution = 3.5.18.0 (upgraded)\n",
			"utf-8",
		)
		const result = await runPush(env)
		expect(result.exitCode).not.toBe(2)
	})
})
