import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isPouFile, readStateMtime } from "./files";

describe("isPouFile", () => {
	test("matches the kind-named source extensions", () => {
		expect(isPouFile("Foo.fb")).toBe(true);
		expect(isPouFile("PLC_PRG.prg")).toBe(true);
		expect(isPouFile("Fun_Calc.fun")).toBe(true);
		expect(isPouFile("IMotor.itf")).toBe(true);
		expect(isPouFile("DUT_Data.dut")).toBe(true);
		expect(isPouFile("GVL_Config.gvl")).toBe(true);
		// Every DUT variant is one `.dut` — the old per-subkind extensions no longer match.
		expect(isPouFile("DUT_Data.struct")).toBe(false);
		expect(isPouFile("E_Mode.enum")).toBe(false);
	});

	test("is case-insensitive (Windows paths arrive mixed-case)", () => {
		expect(isPouFile("Foo.FB")).toBe(true);
		expect(isPouFile("FB_Motor.Prg")).toBe(true);
	});

	test("rejects non-source extensions", () => {
		expect(isPouFile("README.md")).toBe(false);
		expect(isPouFile("package.json")).toBe(false);
		expect(isPouFile("config.yaml")).toBe(false);
	});

	test("rejects files with no extension", () => {
		expect(isPouFile("Dockerfile")).toBe(false);
		expect(isPouFile("Makefile")).toBe(false);
	});

	test("handles full absolute paths", () => {
		expect(isPouFile("C:\\Users\\foo\\src\\POUs\\FB_Motor.fb")).toBe(true);
		expect(isPouFile("/home/foo/src/POUs/FB_Motor.fb")).toBe(true);
	});

	test("only the rightmost extension counts", () => {
		// ide-refs.json.bak - .bak isn't a PLC extension.
		expect(isPouFile("ide-refs.json.bak")).toBe(false);
		// foo.fb.bak - last segment is .bak, not .fb.
		expect(isPouFile("foo.fb.bak")).toBe(false);
	});
});

describe("readStateMtime", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `volt-detection-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	test("returns 0 when ide-refs.json doesn't exist", () => {
		expect(readStateMtime(testDir)).toBe(0);
	});

	test("returns 0 when only .git/volt/ exists but no ide-refs.json", () => {
		mkdirSync(join(testDir, ".git", "volt"), { recursive: true });
		expect(readStateMtime(testDir)).toBe(0);
	});

	test("returns positive mtime once ide-refs.json exists", () => {
		const stateDir = join(testDir, ".git", "volt");
		mkdirSync(stateDir, { recursive: true });
		writeFileSync(join(stateDir, "ide-refs.json"), "{}");
		expect(readStateMtime(testDir)).toBeGreaterThan(0);
	});

	test("returns a larger value after the file is touched forward in time", () => {
		const stateDir = join(testDir, ".git", "volt");
		mkdirSync(stateDir, { recursive: true });
		const statePath = join(stateDir, "ide-refs.json");
		writeFileSync(statePath, "{}");
		const initial = readStateMtime(testDir);
		// Bump mtime explicitly to dodge filesystem mtime resolution races
		// (Windows NTFS is ~100ms; sometimes two writes within that window
		// share an mtime, which would make the test flaky without this).
		const future = new Date(Date.now() + 10_000);
		utimesSync(statePath, future, future);
		const after = readStateMtime(testDir);
		expect(after).toBeGreaterThan(initial);
	});

	test("returns 0 again after ide-refs.json is deleted", () => {
		const stateDir = join(testDir, ".git", "volt");
		mkdirSync(stateDir, { recursive: true });
		const statePath = join(stateDir, "ide-refs.json");
		writeFileSync(statePath, "{}");
		expect(readStateMtime(testDir)).toBeGreaterThan(0);
		rmSync(statePath);
		expect(readStateMtime(testDir)).toBe(0);
	});
});
