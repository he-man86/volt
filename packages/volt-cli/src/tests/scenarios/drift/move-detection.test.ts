import { afterEach, describe, expect, test } from "bun:test"

import { writeFileSync, mkdirSync, renameSync } from "node:fs"
import { join, dirname } from "node:path"
import { runPull, runPush } from "../../harness/run-verb.js"
import {
	readWorkspace,
	workspaceHas,
	workspaceHasFile,
} from "../../harness/assert-workspace.js"
import { makeTestEnv, type TestEnv } from "../../harness/make-test-env.js"

let env: TestEnv | undefined
afterEach(() => {
	env?.cleanup()
	env = undefined
})

const FB_SOURCE =
	"FUNCTION_BLOCK FB_Motor\n" +
	"VAR\n\tspeed: REAL;\n\trunning: BOOL;\nEND_VAR\n" +
	"speed := 0;\n" +
	"END_FUNCTION_BLOCK\n"

describe("scenario: IDE moves a POU — next pull mirrors the move into the workspace", () => {
	test("simple folder change — file appears at new path, old path swept", async () => {
		env = makeTestEnv({
			items: [
				{
					name: "FB_Motor",
					kind: "function_block",
					folder: "POUs/Motors",
					sourceText: FB_SOURCE,
				},
			],
		})
		await runPull(env)
		expect(workspaceHasFile(env.workspace, "src/POUs/Motors/FB_Motor.st")).toBe(true)

		env.bridge.items.get("FB_Motor")!.folder = "POUs/Archived"

		const second = await runPull(env)
		expect(second.exitCode).toBe(0)
		expect(workspaceHasFile(env.workspace, "src/POUs/Archived/FB_Motor.st")).toBe(true)
		expect(workspaceHas(env.workspace, "src/POUs/Motors/FB_Motor.st")).toBe(false)
	})

	test("move + content edit happen together — single pull captures both", async () => {
		env = makeTestEnv({
			items: [
				{
					name: "FB_Motor",
					kind: "function_block",
					folder: "POUs/Motors",
					sourceText: FB_SOURCE,
				},
			],
		})
		await runPull(env)
		expect(readWorkspace(env.workspace, "src/POUs/Motors/FB_Motor.st")).toContain("speed := 0;")

		const stored = env.bridge.items.get("FB_Motor")!
		stored.folder = "POUs/Archived"
		stored.sourceText = FB_SOURCE.replace("speed := 0;", "speed := 42;")

		await runPull(env)
		expect(workspaceHasFile(env.workspace, "src/POUs/Archived/FB_Motor.st")).toBe(true)
		expect(readWorkspace(env.workspace, "src/POUs/Archived/FB_Motor.st")).toContain("speed := 42;")
		expect(workspaceHas(env.workspace, "src/POUs/Motors/FB_Motor.st")).toBe(false)
	})

	test("move to root folder (empty string) — file lands at workspace top", async () => {
		env = makeTestEnv({
			items: [
				{
					name: "FB_Motor",
					kind: "function_block",
					folder: "POUs/Motors",
					sourceText: FB_SOURCE,
				},
			],
		})
		await runPull(env)

		env.bridge.items.get("FB_Motor")!.folder = ""

		await runPull(env)
		expect(workspaceHasFile(env.workspace, "src/FB_Motor.st")).toBe(true)
		expect(workspaceHas(env.workspace, "src/POUs/Motors/FB_Motor.st")).toBe(false)
	})

	test("moving a folder-worth of items (rename a parent folder in IDE) — every item migrates", async () => {
		env = makeTestEnv({
			items: [
				{ name: "FB_A", kind: "function_block", folder: "POUs/Motors", sourceText: FB_SOURCE.replace("FB_Motor", "FB_A") },
				{ name: "FB_B", kind: "function_block", folder: "POUs/Motors", sourceText: FB_SOURCE.replace("FB_Motor", "FB_B") },
				{ name: "FB_C", kind: "function_block", folder: "POUs/Motors", sourceText: FB_SOURCE.replace("FB_Motor", "FB_C") },
			],
		})
		await runPull(env)
		expect(workspaceHasFile(env.workspace, "src/POUs/Motors/FB_A.st")).toBe(true)
		expect(workspaceHasFile(env.workspace, "src/POUs/Motors/FB_B.st")).toBe(true)
		expect(workspaceHasFile(env.workspace, "src/POUs/Motors/FB_C.st")).toBe(true)

		for (const name of ["FB_A", "FB_B", "FB_C"]) {
			env.bridge.items.get(name)!.folder = "POUs/Drives"
		}

		const second = await runPull(env)
		expect(second.exitCode).toBe(0)
		expect(workspaceHasFile(env.workspace, "src/POUs/Drives/FB_A.st")).toBe(true)
		expect(workspaceHasFile(env.workspace, "src/POUs/Drives/FB_B.st")).toBe(true)
		expect(workspaceHasFile(env.workspace, "src/POUs/Drives/FB_C.st")).toBe(true)
		expect(workspaceHas(env.workspace, "src/POUs/Motors/FB_A.st")).toBe(false)
		expect(workspaceHas(env.workspace, "src/POUs/Motors/FB_B.st")).toBe(false)
		expect(workspaceHas(env.workspace, "src/POUs/Motors/FB_C.st")).toBe(false)
	})

	test("no-op pull after a move: workspace stays byte-stable", async () => {
		env = makeTestEnv({
			items: [
				{ name: "FB_Motor", kind: "function_block", folder: "POUs/Motors", sourceText: FB_SOURCE },
			],
		})
		await runPull(env)

		env.bridge.items.get("FB_Motor")!.folder = "POUs/Archived"
		await runPull(env)
		const afterMove = readWorkspace(env.workspace, "src/POUs/Archived/FB_Motor.st")

		const noop = await runPull(env)
		expect(noop.exitCode).toBe(0)
		expect(readWorkspace(env.workspace, "src/POUs/Archived/FB_Motor.st")).toBe(afterMove)
	})
})

describe("scenario: workspace move — push relocates the IDE item", () => {
	test("engineer drags FB.st to a new folder — push emits moveItem op", async () => {
		env = makeTestEnv({
			items: [
				{ name: "FB_Motor", kind: "function_block", folder: "POUs/Motors", sourceText: FB_SOURCE },
			],
		})
		await runPull(env)
		const oldPath = join(env.workspace, "src", "POUs", "Motors", "FB_Motor.st")
		const newPath = join(env.workspace, "src", "POUs", "Archived", "FB_Motor.st")

		mkdirSync(dirname(newPath), { recursive: true })
		renameSync(oldPath, newPath)

		const result = await runPush(env)
		expect(result.exitCode).toBe(0)
		expect(env.bridge.pushCalls.length).toBe(1)
		const ops = env.bridge.pushCalls[0]!.ops
		expect(ops.length).toBe(1)
		expect(ops[0]!.op).toBe("moveItem")
		expect((ops[0]! as { name: string }).name).toBe("FB_Motor")
		expect((ops[0]! as { newFolder: string }).newFolder).toBe("POUs/Archived")

		expect(env.bridge.items.get("FB_Motor")?.folder).toBe("POUs/Archived")
	})

	test("engineer moves AND edits content — push emits one pushItem carrying both", async () => {
		env = makeTestEnv({
			items: [
				{ name: "FB_Motor", kind: "function_block", folder: "POUs/Motors", sourceText: FB_SOURCE },
			],
		})
		await runPull(env)
		const oldPath = join(env.workspace, "src", "POUs", "Motors", "FB_Motor.st")
		const newPath = join(env.workspace, "src", "POUs", "Archived", "FB_Motor.st")

		mkdirSync(dirname(newPath), { recursive: true })
		renameSync(oldPath, newPath)
		writeFileSync(newPath, FB_SOURCE.replace("speed := 0;", "speed := 99;"))

		const result = await runPush(env)
		expect(result.exitCode).toBe(0)
		const ops = env.bridge.pushCalls[0]!.ops
		expect(ops.length).toBe(1)
		expect(ops[0]!.op).toBe("pushItem")
		const pushOp = ops[0]! as { name: string; folder?: string; sourceText: string }
		expect(pushOp.name).toBe("FB_Motor")
		expect(pushOp.folder).toBe("POUs/Archived")
		expect(pushOp.sourceText).toContain("speed := 99;")

		const stored = env.bridge.items.get("FB_Motor")!
		expect(stored.folder).toBe("POUs/Archived")
		expect(stored.sourceText).toContain("speed := 99;")
	})
})

describe("scenario: round-trip — IDE-move → pull → push is idempotent", () => {
	test("after IDE-move and pull, an empty push produces no ops", async () => {
		env = makeTestEnv({
			items: [
				{ name: "FB_Motor", kind: "function_block", folder: "POUs/Motors", sourceText: FB_SOURCE },
			],
		})
		await runPull(env)

		env.bridge.items.get("FB_Motor")!.folder = "POUs/Archived"
		await runPull(env)

		const pushCallsBefore = env.bridge.pushCalls.length
		const result = await runPush(env)
		expect(result.exitCode).toBe(0)
		const newCalls = env.bridge.pushCalls.slice(pushCallsBefore)
		for (const call of newCalls) {
			expect(call.ops.length).toBe(0)
		}
	})
})
