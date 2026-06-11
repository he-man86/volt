import { afterEach, describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { readWorkspace } from "../../harness/assert-workspace.js"
import { makeTestEnv, type TestEnv } from "../../harness/make-test-env.js"
import { runPull } from "../../harness/run-verb.js"
import { simple } from "../../fixtures/projects/simple.js"

let env: TestEnv | undefined
afterEach(() => {
	env?.cleanup()
	env = undefined
})

describe("scenario: pull --force", () => {
	test("overwrites workspace edits the engineer didn't ask to keep", async () => {
		env = makeTestEnv(simple)
		await runPull(env)

		const fbPath = join(env.workspace, "src/POUs/FB_Motor.st")
		writeFileSync(fbPath, "// local junk\n", "utf-8")

		const refuse = await runPull(env)
		expect(refuse.exitCode).toBe(2)
		expect(refuse.stderr).toMatch(/pull refused|workspace edit/i)

		const forced = await runPull(env, { force: true })
		expect(forced.exitCode).toBe(0)
		const restored = readWorkspace(env.workspace, "src/POUs/FB_Motor.st")
		expect(restored).toContain("FUNCTION_BLOCK FB_Motor")
		expect(restored).not.toContain("local junk")
	})
})
