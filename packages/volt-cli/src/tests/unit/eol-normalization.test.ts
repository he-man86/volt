import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { workspacePaths } from "../../config/workspace.js"
import { loadState } from "../../snapshot/repo.js"
import { computeOutgoing } from "../../snapshot/state.js"
import { detectWorkspaceDirty } from "../../snapshot/workspace.js"
import { simple } from "../fixtures/projects/simple.js"
import { makeTestEnv, type TestEnv } from "../harness/make-test-env.js"
import { listWorkspace } from "../harness/assert-workspace.js"
import { runPull } from "../harness/run-verb.js"

let env: TestEnv | undefined
afterEach(() => {
	env?.cleanup()
	env = undefined
})

describe("EOL normalization parity (detectWorkspaceDirty ↔ computeOutgoing)", () => {
	test("a workspace file rewritten with CRLF endings is NOT reported as outgoing", async () => {
		env = makeTestEnv(simple)
		expect((await runPull(env)).exitCode).toBe(0)

		const sourcePaths = listWorkspace(env.workspace).filter((p) =>
			/\.(st|gvl|struct|enum|union|alias|itf|fbd|ld|sfc|cfc)$/.test(p),
		)
		expect(sourcePaths.length).toBeGreaterThan(0)
		for (const rel of sourcePaths) {
			const abs = join(env.workspace, rel)
			const lf = readFileSync(abs, "utf-8")
			const crlf = lf.replace(/(?<!\r)\n/g, "\r\n")
			writeFileSync(abs, crlf, "utf-8")
		}

		const paths = workspacePaths(env.workspace)
		const state = loadState(paths.snapshotPath)
		expect(state).toBeDefined()

		const dirty = detectWorkspaceDirty(paths.snapshotPath, env.workspace, state!.commitSha)
		expect(dirty).toEqual([])

		const outgoing = computeOutgoing(paths.snapshotPath, env.workspace, state!.commitSha)
		expect(outgoing.added).toEqual([])
		expect(outgoing.modified).toEqual([])
		expect(outgoing.removed).toEqual([])
		expect(outgoing.moved).toEqual([])
	})

	test("a REAL content change is still surfaced (not silently swallowed by normalization)", async () => {
		env = makeTestEnv(simple)
		expect((await runPull(env)).exitCode).toBe(0)

		const fbPath = join(env.workspace, "src/POUs/FB_Motor.st")
		writeFileSync(
			fbPath,
			readFileSync(fbPath, "utf-8") + "\n// edited by test\n",
			"utf-8",
		)

		const paths = workspacePaths(env.workspace)
		const state = loadState(paths.snapshotPath)!

		const dirty = detectWorkspaceDirty(paths.snapshotPath, env.workspace, state.commitSha)
		expect(dirty).toContain("POUs/FB_Motor.st")

		const outgoing = computeOutgoing(paths.snapshotPath, env.workspace, state.commitSha)
		expect(outgoing.modified).toContain("FB_Motor")
	})
})
