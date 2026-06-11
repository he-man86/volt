import { afterEach, describe, expect, test } from "bun:test"

import { runPull, runPush } from "../../harness/run-verb.js"
import { simple } from "../../fixtures/projects/simple.js"
import { makeTestEnv, type TestEnv } from "../../harness/make-test-env.js"

let env: TestEnv | undefined
afterEach(() => {
	env?.cleanup()
	env = undefined
})

interface CompleteEvent {
	event: "complete"
	summary: string
	status?: {
		initialized: boolean
		incoming: { added: string[]; modified: string[]; removed: string[] }
		outgoing: { added: string[]; modified: string[]; removed: string[] }
		bridgeProjectVersion: string
		snapshotProjectVersion: string
		projectMismatch: unknown | null
	}
}

function extractCompleteEvent(stdout: string): CompleteEvent {
	const completes: CompleteEvent[] = []
	for (const line of stdout.split(/\r?\n/)) {
		const trimmed = line.trim()
		if (!trimmed.startsWith("{")) continue
		try {
			const parsed = JSON.parse(trimmed) as { event?: string }
			if (parsed.event === "complete") completes.push(parsed as CompleteEvent)
		} catch {
			// non-JSON line
		}
	}
	expect(completes).toHaveLength(1)
	return completes[0]!
}

describe("scenario: pull --json output contract", () => {
	test("emits one complete event with inc=0 / out=0 status on clean success", async () => {
		env = makeTestEnv(simple)
		const result = await runPull(env, { json: true })
		expect(result.exitCode).toBe(0)

		const evt = extractCompleteEvent(result.stdout)
		expect(evt.event).toBe("complete")
		expect(typeof evt.summary).toBe("string")
		expect(evt.summary.length).toBeGreaterThan(0)

		expect(evt.status).toBeDefined()
		expect(evt.status!.initialized).toBe(true)
		expect(evt.status!.incoming.added).toEqual([])
		expect(evt.status!.incoming.modified).toEqual([])
		expect(evt.status!.incoming.removed).toEqual([])
		expect(evt.status!.outgoing.added).toEqual([])
		expect(evt.status!.outgoing.modified).toEqual([])
		expect(evt.status!.outgoing.removed).toEqual([])
		expect(evt.status!.projectMismatch).toBeNull()
		expect(evt.status!.snapshotProjectVersion).toBe(evt.status!.bridgeProjectVersion)
	})

	test("suppresses human-readable lines in --json mode (stdout is pure NDJSON)", async () => {
		env = makeTestEnv(simple)
		const result = await runPull(env, { json: true })

		const lines = result.stdout.split(/\r?\n/).filter((l) => l.length > 0)
		expect(lines.length).toBeGreaterThan(0)
		for (const line of lines) {
			expect(() => JSON.parse(line)).not.toThrow()
		}

		for (const line of lines) {
			expect(line.startsWith("pulled:")).toBe(false)
			expect(line.startsWith("already up to date")).toBe(false)
			expect(line.startsWith("  (")).toBe(false)
		}
	})

	test("default (no --json) keeps the legacy human-readable output", async () => {
		env = makeTestEnv(simple)
		const result = await runPull(env)
		expect(result.exitCode).toBe(0)

		expect(result.stdout).toContain("pulled:")

		expect(result.stdout).not.toContain('"event":"complete"')
	})
})

describe("scenario: push --json output contract", () => {
	test("clean no-op push still emits one complete event with status", async () => {
		env = makeTestEnv(simple)
		expect((await runPull(env)).exitCode).toBe(0)
		const result = await runPush(env, { json: true })
		expect(result.exitCode).toBe(0)

		const evt = extractCompleteEvent(result.stdout)
		expect(evt.event).toBe("complete")
		expect(evt.status).toBeDefined()
		expect(evt.status!.outgoing.added).toEqual([])
		expect(evt.status!.outgoing.modified).toEqual([])
		expect(evt.status!.outgoing.removed).toEqual([])
	})
})
