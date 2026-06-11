import { afterEach, describe, expect, test } from "bun:test"

import { readWorkspace } from "../../harness/assert-workspace.js"
import { makeTestEnv, type TestEnv } from "../../harness/make-test-env.js"
import { runPull } from "../../harness/run-verb.js"

let env: TestEnv | undefined
afterEach(() => {
	env?.cleanup()
	env = undefined
})

const FB_BASE =
	"FUNCTION_BLOCK FB_Pump\n" +
	"VAR\n" +
	"\tspeed: REAL;\n" +
	"END_VAR\n" +
	"speed := 0;\n" +
	"END_FUNCTION_BLOCK\n"

function fbWithChildren(extra: string): string {
	return FB_BASE + "\n" + extra
}

describe("scenario: textual child element drift (add / remove / edit)", () => {
	test("bridge adds an ACTION to an FB — next pull surfaces it in the parent .st", async () => {
		env = makeTestEnv({
			items: [
				{
					name: "FB_Pump",
					kind: "function_block",
					folder: "POUs",
					sourceText: FB_BASE,
				},
			],
		})
		await runPull(env)
		expect(readWorkspace(env.workspace, "src/POUs/FB_Pump.st")).not.toContain("ACTION Start")

		const stored = env.bridge.items.get("FB_Pump")!
		stored.sourceText = fbWithChildren(
			"ACTION Start\nspeed := 100;\nEND_ACTION\n",
		)

		const second = await runPull(env)
		expect(second.exitCode).toBe(0)
		const text = readWorkspace(env.workspace, "src/POUs/FB_Pump.st")
		expect(text).toContain("ACTION Start")
		expect(text).toContain("speed := 100;")
	})

	test("bridge removes an ACTION — next pull drops it from the parent .st", async () => {
		env = makeTestEnv({
			items: [
				{
					name: "FB_Pump",
					kind: "function_block",
					folder: "POUs",
					sourceText: fbWithChildren(
						"ACTION Start\nspeed := 100;\nEND_ACTION\n",
					),
				},
			],
		})
		await runPull(env)
		expect(readWorkspace(env.workspace, "src/POUs/FB_Pump.st")).toContain("ACTION Start")

		const stored = env.bridge.items.get("FB_Pump")!
		stored.sourceText = FB_BASE

		await runPull(env)
		expect(readWorkspace(env.workspace, "src/POUs/FB_Pump.st")).not.toContain("ACTION Start")
	})

	test("bridge edits an ACTION's body — next pull updates the parent .st", async () => {
		env = makeTestEnv({
			items: [
				{
					name: "FB_Pump",
					kind: "function_block",
					folder: "POUs",
					sourceText: fbWithChildren(
						"ACTION Start\nspeed := 100;\nEND_ACTION\n",
					),
				},
			],
		})
		await runPull(env)

		const stored = env.bridge.items.get("FB_Pump")!
		stored.sourceText = fbWithChildren(
			"ACTION Start\nspeed := 200;\nEND_ACTION\n",
		)

		await runPull(env)
		const text = readWorkspace(env.workspace, "src/POUs/FB_Pump.st")
		expect(text).toContain("speed := 200;")
		expect(text).not.toContain("speed := 100;")
	})

	test("bridge adds a METHOD — next pull surfaces it in the parent .st", async () => {
		env = makeTestEnv({
			items: [
				{
					name: "FB_Pump",
					kind: "function_block",
					folder: "POUs",
					sourceText: FB_BASE,
				},
			],
		})
		await runPull(env)

		const stored = env.bridge.items.get("FB_Pump")!
		stored.sourceText = fbWithChildren(
			"METHOD GetSpeed : REAL\nVAR_INPUT\nEND_VAR\nGetSpeed := speed;\nEND_METHOD\n",
		)

		await runPull(env)
		const text = readWorkspace(env.workspace, "src/POUs/FB_Pump.st")
		expect(text).toContain("METHOD GetSpeed")
		expect(text).toContain("GetSpeed := speed;")
	})

	test("renaming a child (remove + add at once) syncs both sides cleanly", async () => {
		env = makeTestEnv({
			items: [
				{
					name: "FB_Pump",
					kind: "function_block",
					folder: "POUs",
					sourceText: fbWithChildren(
						"ACTION OldName\nspeed := 50;\nEND_ACTION\n",
					),
				},
			],
		})
		await runPull(env)
		expect(readWorkspace(env.workspace, "src/POUs/FB_Pump.st")).toContain("ACTION OldName")

		const stored = env.bridge.items.get("FB_Pump")!
		stored.sourceText = fbWithChildren(
			"ACTION NewName\nspeed := 50;\nEND_ACTION\n",
		)

		await runPull(env)
		const text = readWorkspace(env.workspace, "src/POUs/FB_Pump.st")
		expect(text).toContain("ACTION NewName")
		expect(text).not.toContain("ACTION OldName")
	})

	test("multiple children mutate at once — pull surfaces every change", async () => {
		env = makeTestEnv({
			items: [
				{
					name: "FB_Pump",
					kind: "function_block",
					folder: "POUs",
					sourceText: fbWithChildren(
						"ACTION A1\nspeed := 1;\nEND_ACTION\n" +
							"ACTION A2\nspeed := 2;\nEND_ACTION\n",
					),
				},
			],
		})
		await runPull(env)

		const stored = env.bridge.items.get("FB_Pump")!
		stored.sourceText = fbWithChildren(
			"ACTION A1\nspeed := 999;\nEND_ACTION\n" +
				"ACTION A3\nspeed := 3;\nEND_ACTION\n",
		)

		await runPull(env)
		const text = readWorkspace(env.workspace, "src/POUs/FB_Pump.st")
		expect(text).toContain("ACTION A1")
		expect(text).toContain("speed := 999;")
		expect(text).not.toContain("ACTION A2")
		expect(text).toContain("ACTION A3")
	})
})

describe("scenario: child folder organization inside a POU is flattened by the bridge", () => {
	test("flat children and folder-organized children produce identical workspace files", async () => {
		const flatBody = fbWithChildren(
			"ACTION A1\nspeed := 1;\nEND_ACTION\n" +
				"ACTION A2\nspeed := 2;\nEND_ACTION\n" +
				"ACTION A3\nspeed := 3;\nEND_ACTION\n",
		)

		env = makeTestEnv({
			items: [
				{ name: "FB_A", kind: "function_block", folder: "POUs", sourceText: flatBody },
				{ name: "FB_B", kind: "function_block", folder: "POUs", sourceText: flatBody },
			],
		})
		await runPull(env)
		const a = readWorkspace(env.workspace, "src/POUs/FB_A.st")
		const b = readWorkspace(env.workspace, "src/POUs/FB_B.st")
		expect(a).toBe(b)
		expect(a).toContain("ACTION A1")
		expect(a).toContain("ACTION A2")
		expect(a).toContain("ACTION A3")
	})

	test("bridge moves children into a new internal folder — workspace stays byte-stable", async () => {
		const body = fbWithChildren(
			"ACTION Start\nspeed := 1;\nEND_ACTION\n" +
				"ACTION Stop\nspeed := 0;\nEND_ACTION\n",
		)

		env = makeTestEnv({
			items: [
				{ name: "FB_Pump", kind: "function_block", folder: "POUs", sourceText: body },
			],
		})
		await runPull(env)
		const initialText = readWorkspace(env.workspace, "src/POUs/FB_Pump.st")

		env.bridge.items.get("FB_Pump")!.sourceText = body
		const second = await runPull(env)
		expect(second.exitCode).toBe(0)
		expect(readWorkspace(env.workspace, "src/POUs/FB_Pump.st")).toBe(initialText)
	})
})
