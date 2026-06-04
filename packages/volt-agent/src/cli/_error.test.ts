import { describe, expect, test } from "bun:test";
import { GitCmdError } from "../engine/git-cmds.js";
import {
	formatVoltError,
	isDebugMode,
	isVoltError,
	VoltError,
	wrapEngineError,
} from "./_error.js";

describe("VoltError", () => {
	test("renders what + why + hint with consistent layout", () => {
		const err = new VoltError({
			what: "pull refused — 2 workspace edit(s) would be overwritten",
			why: "the following files differ from the snapshot:\n  - POUs/A.st\n  - POUs/B.st",
			hint: "send them first with `volt push`, drop them with `volt pull --force`",
		});
		const out = formatVoltError(err);
		expect(out).toBe(
			"volt: pull refused — 2 workspace edit(s) would be overwritten\n" +
				"      the following files differ from the snapshot:\n" +
				"        - POUs/A.st\n" +
				"        - POUs/B.st\n" +
				"  hint: send them first with `volt push`, drop them with `volt pull --force`\n",
		);
	});

	test("renders with only what (no why, no hint)", () => {
		const err = new VoltError({ what: "something failed" });
		expect(formatVoltError(err)).toBe("volt: something failed\n");
	});

	test("isVoltError identifies the type", () => {
		expect(isVoltError(new VoltError({ what: "x" }))).toBe(true);
		expect(isVoltError(new Error("x"))).toBe(false);
		expect(isVoltError(null)).toBe(false);
		expect(isVoltError("x")).toBe(false);
	});

	test("debug mode appends cause trace", () => {
		const cause = new Error("underlying failure");
		const err = new VoltError({ what: "x", cause });
		const debug = formatVoltError(err, true);
		expect(debug).toContain("cause:");
		expect(debug).toContain("underlying failure");
		// Without debug, the cause is hidden.
		expect(formatVoltError(err, false)).not.toContain("underlying failure");
	});

	test("exitCode defaults to 1 and can be overridden", () => {
		expect(new VoltError({ what: "x" }).exitCode).toBe(1);
		expect(new VoltError({ what: "x", exitCode: 2 }).exitCode).toBe(2);
	});

	test("wrap() preserves the original error as cause", () => {
		const original = new Error("boom");
		const wrapped = VoltError.wrap(original, { what: "operation failed" });
		expect(wrapped.cause).toBe(original);
		expect(wrapped.what).toBe("operation failed");
	});
});

describe("isDebugMode", () => {
	test("returns true when --debug flag is set", () => {
		expect(isDebugMode({ debug: true })).toBe(true);
		expect(isDebugMode({ debug: false })).toBe(false);
	});

	test("respects VOLT_DEBUG env var", () => {
		const prev = process.env.VOLT_DEBUG;
		try {
			process.env.VOLT_DEBUG = "1";
			expect(isDebugMode(undefined)).toBe(true);
			process.env.VOLT_DEBUG = "0";
			expect(isDebugMode(undefined)).toBe(false);
			process.env.VOLT_DEBUG = "";
			expect(isDebugMode(undefined)).toBe(false);
			delete process.env.VOLT_DEBUG;
			expect(isDebugMode(undefined)).toBe(false);
		} finally {
			if (prev === undefined) delete process.env.VOLT_DEBUG;
			else process.env.VOLT_DEBUG = prev;
		}
	});
});

describe("wrapEngineError", () => {
	test("translates 'invalid object' git error into snapshot-corruption guidance", () => {
		const git = new GitCmdError(
			"-C /repo write-tree",
			128,
			"error: invalid object 100644 bbcb1f8275 for 'POUs/A.st'\nfatal: git-write-tree: error building trees",
		);
		const v = wrapEngineError(git, "pull from bridge");
		expect(v.what).toBe("pull from bridge failed — snapshot is corrupt");
		expect(v.hint).toContain("volt pull --force");
		expect(v.hint).toContain("delete .volt/snapshot/");
		expect(v.cause).toBe(git);
	});

	test("translates 'not a git repository' into init guidance", () => {
		const git = new GitCmdError("-C /repo write-tree", 128, "fatal: not a git repository");
		const v = wrapEngineError(git, "push");
		expect(v.what).toContain("snapshot missing or unreadable");
		expect(v.hint).toContain("volt init");
	});

	test("unknown error gets generic debug + recovery hint", () => {
		const v = wrapEngineError(new Error("some unknown failure"), "do stuff");
		expect(v.what).toBe("do stuff failed");
		expect(v.why).toBe("some unknown failure");
		expect(v.hint).toContain("--debug");
	});

	test("non-Error values get stringified", () => {
		const v = wrapEngineError("plain string", "do stuff");
		expect(v.why).toBe("plain string");
	});
});
