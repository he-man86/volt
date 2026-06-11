import { describe, expect, test } from "bun:test"
import { GitCmdError } from "../../git/plumbing.js"
import type { CliError } from "../../output/errors.js"
import { formatError, exitCode } from "../../output/errors.js"

describe("CliError", () => {
	test("formatError renders meaningful messages", () => {
		expect(formatError({ kind: "bridge_offline", port: 8555 })).toContain("bridge offline")
		expect(formatError({ kind: "not_initialized" })).toContain("not initialized")
		expect(formatError({ kind: "workspace_dirty", paths: ["a.st"] })).toContain("uncommitted changes")
	})

	test("exitCode returns 2 for refusal cases", () => {
		expect(exitCode({ kind: "merge_conflict", paths: [] })).toBe(2)
		expect(exitCode({ kind: "pull_refused", reason: "dirty" })).toBe(2)
		expect(exitCode({ kind: "workspace_dirty", paths: [] })).toBe(2)
	})

	test("exitCode returns 1 for errors", () => {
		expect(exitCode({ kind: "bridge_offline", port: 0 })).toBe(1)
		expect(exitCode({ kind: "internal", message: "boom" })).toBe(1)
		expect(exitCode({ kind: "not_initialized" })).toBe(1)
	})

	test("GitCmdError preserves cmd, exitCode, and stderr", () => {
		const err = new GitCmdError("-C /repo write-tree", 128, "error: invalid object\nfatal: error building trees")
		expect(err.cmd).toBe("-C /repo write-tree")
		expect(err.exitCode).toBe(128)
		expect(err.stderr).toContain("invalid object")
		expect(err.message).toContain("error building trees")
	})
})
