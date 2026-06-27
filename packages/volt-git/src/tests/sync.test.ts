import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init } from "../init.js";
import { pull } from "../sync/pull.js";
import { push } from "../sync/push.js";
import { status } from "../sync/status.js";
import { MockBridge, type MockItem } from "./mock-bridge.js";

const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (root: string, ...args: string[]): string => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", env: ENV }).trim();
const commitAll = (root: string, msg: string): void => {
	git(root, "add", "-A");
	git(root, "commit", "-q", "-m", msg);
};
const headParents = (root: string): string[] => git(root, "log", "-1", "--format=%P").split(" ").filter((s) => s.length > 0);
const srcFile = (root: string, rel: string): string => join(root, "src", rel);
const readSrc = (root: string, rel: string): string => readFileSync(srcFile(root, rel), "utf8");
const writeSrc = (root: string, rel: string, content: string): void => writeFileSync(srcFile(root, rel), content);

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "voltg-"));
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

async function setup(items: MockItem[]): Promise<MockBridge> {
	const bridge = new MockBridge(items);
	const r = await init(root, bridge);
	expect(r.kind).toBe("ok");
	git(root, "config", "core.autocrlf", "false");
	return bridge;
}

describe("volt-git sync", () => {
	test("1. init bootstrap materializes the IDE under src/", async () => {
		await setup([{ name: "FB_Motor.st", sourceText: "v1\n", folder: "POUs" }]);
		expect(existsSync(srcFile(root, "POUs/FB_Motor.st"))).toBe(true);
		expect(readSrc(root, "POUs/FB_Motor.st")).toBe("v1\n");
		const s = await status(root, new MockBridge([{ name: "FB_Motor.st", sourceText: "v1\n", folder: "POUs" }]));
		expect(s.merging).toBeNull();
	});

	test("2. no-edit pull fast-forwards (no merge commit)", async () => {
		const bridge = await setup([{ name: "A.st", sourceText: "v1\n" }]);
		bridge.set("A.st", "v2\n");
		const r = await pull(root, bridge);
		expect(r.kind).toBe("ok");
		expect(readSrc(root, "A.st")).toBe("v2\n");
		expect(headParents(root).length).toBe(1); // fast-forward, not a merge commit
	});

	test("3. independent edits → one clean merge commit", async () => {
		const bridge = await setup([{ name: "A.st", sourceText: "a1\n" }, { name: "B.st", sourceText: "b1\n" }]);
		writeSrc(root, "A.st", "a1\nlocal\n");
		commitAll(root, "edit A");
		bridge.set("B.st", "b1\nide\n");
		const r = await pull(root, bridge);
		expect(r.kind).toBe("ok");
		expect(readSrc(root, "A.st")).toContain("local");
		expect(readSrc(root, "B.st")).toContain("ide");
		expect(headParents(root).length).toBe(2); // merge commit
	});

	test("4. overlapping edits → conflict markers", async () => {
		const bridge = await setup([{ name: "A.st", sourceText: "line1\n" }]);
		writeSrc(root, "A.st", "line1\nLOCAL\n");
		commitAll(root, "edit A");
		bridge.set("A.st", "line1\nIDE\n");
		const r = await pull(root, bridge);
		expect(r.kind).toBe("conflict");
		if (r.kind === "conflict") expect(r.paths).toContain("A.st");
		expect(readSrc(root, "A.st")).toContain("<<<<<<<");
		git(root, "merge", "--abort"); // recovers
		const s = await status(root, bridge);
		expect(s.merging).toBeNull();
	});

	test("5. commit-before-pull guard refuses on a dirty tree", async () => {
		const bridge = await setup([{ name: "A.st", sourceText: "a1\n" }]);
		writeSrc(root, "A.st", "a1\nuncommitted\n"); // dirty, not committed
		bridge.set("A.st", "a2\n");
		const r = await pull(root, bridge);
		expect(r.kind).toBe("refused");
		if (r.kind === "refused") expect(r.reason).toContain("commit or stash");
	});

	test("6. push sends workspace edits to the bridge + ff's volt/ide", async () => {
		const bridge = await setup([{ name: "A.st", sourceText: "a1\n" }]);
		writeSrc(root, "A.st", "a1\nmine\n");
		const r = await push(root, bridge);
		expect(r.kind).toBe("ok");
		if (r.kind === "ok") expect(r.items).toContain("A.st");
		expect(bridge.pushCalls.length).toBe(1);
		// pushing again is a no-op (IDE now matches)
		const r2 = await push(root, bridge);
		expect(r2.kind).toBe("ok");
		if (r2.kind === "ok") expect(r2.items.length).toBe(0);
	});

	test("7. read-only items can't be pushed", async () => {
		const bridge = await setup([{ name: "Lib.library", sourceText: "ref\n" }]);
		writeSrc(root, "Lib.library", "ref\nedited\n");
		const r = await push(root, bridge);
		expect(r.kind).toBe("rejected");
		if (r.kind === "rejected") expect(r.reason).toContain("read-only");
	});

	test("8. push is rejected when the IDE drifted", async () => {
		const bridge = await setup([{ name: "A.st", sourceText: "a1\n" }]);
		writeSrc(root, "A.st", "a1\nmine\n");
		bridge.set("A.st", "a1\nide-moved\n"); // drift after the last sync
		const r = await push(root, bridge);
		expect(r.kind).toBe("rejected");
		if (r.kind === "rejected") expect(r.reason.toLowerCase()).toContain("pull");
		// --force adopts (pushes over the drift)
		const r2 = await push(root, bridge, { force: true });
		expect(r2.kind).toBe("ok");
	});

	test("9. status reports incoming and outgoing", async () => {
		const bridge = await setup([{ name: "A.st", sourceText: "a1\n" }]);
		// outgoing: local edit (committed so it's not just dirty)
		writeSrc(root, "A.st", "a1\nlocal\n");
		commitAll(root, "edit");
		// incoming: a different IDE item changes
		bridge.set("B.st", "b-new\n");
		const s = await status(root, bridge);
		expect(s.outgoing.modified).toContain("A.st");
		expect(s.incoming.added).toContain("B.st");
	});
});
