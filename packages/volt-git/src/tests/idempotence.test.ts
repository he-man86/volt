/**
 * Round-trip idempotence + losslessness — the property gate. Data-loss in the round-trip is the highest-
 * consequence failure Volt can have (it silently corrupts a customer's PLC code), so this consolidates the
 * invariant over the full writable-KIND matrix + the SHAPES that have bitten round-trips.
 *
 * This file is the MOCK gate: the bridge is a HashMap, so it proves the volt-git sync/materialize pipeline is
 * lossless + idempotent for every kind. The bridge itself (where data-loss like the empty-body-clear incident
 * lives) is proven by the LIVE gate in `live-idempotence.test.ts`, which runs the same properties against a real
 * CODESYS/TwinCAT bridge and skips when none is reachable.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { init } from "../init.js";
import { push } from "../sync/push.js";
import { status } from "../sync/status.js";
import { MockBridge, type MockItem } from "./mock-bridge.js";

const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (root: string, ...args: string[]): string => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", env: ENV }).trim();

// Every writable source KIND (fb/prg/fun/itf/struct/union/enum/alias/gvl) plus the SHAPES that have bitten
// round-trips: an emptied body, a whitespace-only body, and an editable graphical (VG) body. The item name IS
// the wire identity; `sourceText` is the whole assembled file (LF).
const MATRIX: MockItem[] = [
	{ name: "FB_Motor.fb", folder: "POUs", sourceText: "FUNCTION_BLOCK FB_Motor\nVAR\n\tn : INT;\nEND_VAR\n\nn := n + 1;\nEND_FUNCTION_BLOCK\n" },
	{ name: "PLC_PRG.prg", folder: "POUs", sourceText: "PROGRAM PLC_PRG\nVAR\nEND_VAR\n\nx := 1;\nEND_PROGRAM\n" },
	{ name: "Add.fun", sourceText: "FUNCTION Add : INT\nVAR_INPUT\n\ta : INT;\n\tb : INT;\nEND_VAR\n\nAdd := a + b;\nEND_FUNCTION\n" },
	{ name: "IMotor.itf", sourceText: "INTERFACE IMotor\nEND_INTERFACE\n" },
	{ name: "ST_Data.struct", sourceText: "TYPE ST_Data :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE\n" },
	{ name: "U_Word.union", sourceText: "TYPE U_Word :\nUNION\n\tw : WORD;\n\tb : ARRAY[0..1] OF BYTE;\nEND_UNION\nEND_TYPE\n" },
	{ name: "E_State.enum", sourceText: "TYPE E_State :\n(\n\tIDLE := 0,\n\tRUN := 1\n) USINT;\nEND_TYPE\n" },
	{ name: "T_Count.alias", sourceText: "TYPE T_Count : UDINT;\nEND_TYPE\n" },
	{ name: "GVL_Main.gvl", sourceText: "VAR_GLOBAL\n\tg : INT;\nEND_VAR\n" },
	// shapes that have bitten round-trips:
	{ name: "EmptyBody.fb", sourceText: "FUNCTION_BLOCK EmptyBody\nVAR\nEND_VAR\nEND_FUNCTION_BLOCK\n" }, // no implementation
	{ name: "WsBody.fb", sourceText: "FUNCTION_BLOCK WsBody\nVAR\nEND_VAR\n   \n\t\nEND_FUNCTION_BLOCK\n" }, // whitespace-only impl
	{ name: "Graphical.fb", sourceText: "(* @volt-graphical: FBD *)\nFUNCTION_BLOCK Graphical\nVAR\n\ta : BOOL;\nEND_VAR\n\nLET a := TRUE;\nEND_FUNCTION_BLOCK\n" }, // editable graphical → VG body
];

const relOf = (it: MockItem): string => (it.folder ? `${it.folder}/${it.name}` : it.name);
const readWs = (root: string, rel: string): string => readFileSync(join(root, "src", rel), "utf8");
function writeWs(root: string, rel: string, content: string): void {
	const p = join(root, "src", rel);
	mkdirSync(dirname(p), { recursive: true });
	writeFileSync(p, content);
}
function configure(root: string): void {
	git(root, "config", "core.autocrlf", "false");
	git(root, "config", "user.name", "t");
	git(root, "config", "user.email", "t@t");
}

describe("round-trip idempotence + losslessness (sync pipeline, all kinds)", () => {
	let root: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "voltg-idem-"));
	});
	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test("materialize is lossless: every kind's workspace file is byte-identical to the IDE sourceText", async () => {
		const bridge = new MockBridge(MATRIX);
		expect((await init(root, bridge)).kind).toBe("ok");
		configure(root);
		for (const it of MATRIX) expect(readWs(root, relOf(it))).toBe(it.sourceText);
	});

	test("pull→push with no edits is a NO-OP (idempotent): clean status, zero ops", async () => {
		const bridge = new MockBridge(MATRIX);
		expect((await init(root, bridge)).kind).toBe("ok");
		configure(root);
		const s = await status(root, bridge);
		expect(s.outgoing.added).toEqual([]);
		expect(s.outgoing.modified).toEqual([]);
		expect(s.outgoing.removed).toEqual([]);
		const r = await push(root, bridge);
		expect(r.kind).toBe("ok");
		if (r.kind === "ok") expect(r.items).toEqual([]);
		expect(bridge.pushCalls.length).toBe(0); // nothing sent — the IDE already matches
	});

	test("push X → pull returns X byte-identical for every kind (into a fresh workspace)", async () => {
		// Create the whole matrix in the workspace, push it to the (minimal) bridge, then a FRESH clone
		// re-materializes every item identically — the full write → wire → read round-trip.
		const bridge = new MockBridge([{ name: "Seed.fb", sourceText: "FUNCTION_BLOCK Seed\nEND_FUNCTION_BLOCK\n" }]);
		expect((await init(root, bridge)).kind).toBe("ok");
		configure(root);
		for (const it of MATRIX) writeWs(root, relOf(it), it.sourceText);
		git(root, "add", "-A");
		git(root, "commit", "-q", "-m", "add matrix");
		const pr = await push(root, bridge);
		expect(pr.kind).toBe("ok");

		const ws2 = mkdtempSync(join(tmpdir(), "voltg-idem2-"));
		try {
			expect((await init(ws2, bridge)).kind).toBe("ok");
			configure(ws2);
			for (const it of MATRIX) expect(readWs(ws2, relOf(it))).toBe(it.sourceText);
		} finally {
			rmSync(ws2, { recursive: true, force: true });
		}
	});
});
