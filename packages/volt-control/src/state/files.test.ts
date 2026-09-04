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
		expect(isPouFile("GVL_Config.gvl")).toBe(true);
		// A DUT is named by its declaration's subtype — four extensions, all source.
		expect(isPouFile("DUT_Data.struct")).toBe(true);
		expect(isPouFile("E_Mode.enum")).toBe(true);
		expect(isPouFile("U_Bits.union")).toBe(true);
		expect(isPouFile("T_Handle.alias")).toBe(true);
		// `.dut` is the WIRE kind, never a file — nothing writes one, so nothing recognizes one.
		expect(isPouFile("DUT_Data.dut")).toBe(false);
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

// The gap: the VoltStatus tracker auto-refreshes only on (a) an IDE-side health edge (→ incoming) and
// (b) a change to .git/volt/ide-refs.json — the mtime poll's signal, which moves ONLY on pull/push. NOTHING
// watches the workspace `src/` tree, so an OUTGOING change (a workspace edit) is auto-detected only via the
// extension's onDidSaveTextDocument hook (editor saves only) — and never on the desktop, nor for agent/terminal/
// external edits. This test pins that: editing a tracked src file leaves readStateMtime (the poll signal)
// unchanged, so the tracker cannot see the edit without a manual refresh. The fix is a debounced src/ watcher.
describe("outgoing detection gap", () => {
	let testDir: string;
	beforeEach(() => {
		testDir = join(tmpdir(), `volt-outgoing-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(testDir, { recursive: true });
	});
	afterEach(() => rmSync(testDir, { recursive: true, force: true }));

	test("editing a workspace src file does NOT move the mtime-poll signal (so outgoing isn't auto-detected)", () => {
		const stateDir = join(testDir, ".git", "volt");
		mkdirSync(stateDir, { recursive: true });
		writeFileSync(join(stateDir, "ide-refs.json"), "{}");
		const before = readStateMtime(testDir);

		// An out-of-editor outgoing change: the agent / a terminal / an external editor writes a tracked POU.
		const srcDir = join(testDir, "src", "POUs");
		mkdirSync(srcDir, { recursive: true });
		const pou = join(srcDir, "FB_Motor.fb");
		writeFileSync(pou, "FUNCTION_BLOCK FB_Motor\nVAR\nEND_VAR\nx := 1;");
		// Bump the POU's mtime far into the future to rule out any filesystem resolution race.
		const future = new Date(Date.now() + 10_000);
		utimesSync(pou, future, future);

		// It IS a tracked file (so it belongs in `outgoing`) — yet the poll signal is unchanged.
		expect(isPouFile(pou)).toBe(true);
		expect(readStateMtime(testDir)).toBe(before);
	});
});
