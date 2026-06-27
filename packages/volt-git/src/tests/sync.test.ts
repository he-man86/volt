import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init } from "../init.js";
import { pull } from "../sync/pull.js";
import { push } from "../sync/push.js";
import { status } from "../sync/status.js";
import { merge } from "../merge.js";
import { build } from "../build.js";
import { show } from "../show.js";
import { log } from "../log.js";
import { isMerging } from "../git/plumbing.js";
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

	test("6. push sends edits to the bridge + lands volt/ide on HEAD (like git push)", async () => {
		const bridge = await setup([{ name: "A.st", sourceText: "a1\n" }]);
		writeSrc(root, "A.st", "a1\nmine\n");
		commitAll(root, "edit A");
		const r = await push(root, bridge);
		expect(r.kind).toBe("ok");
		if (r.kind === "ok") expect(r.items).toContain("A.st");
		expect(bridge.pushCalls.length).toBe(1);
		// volt/ide now points AT the pushed commit — origin/main == main after a git push
		expect(git(root, "rev-parse", "refs/remotes/volt/ide")).toBe(git(root, "rev-parse", "HEAD"));
		// pushing again is a no-op (IDE now matches)
		const r2 = await push(root, bridge);
		expect(r2.kind).toBe("ok");
		if (r2.kind === "ok") expect(r2.items.length).toBe(0);
	});

	test("7. read-only items can't be pushed", async () => {
		const bridge = await setup([{ name: "Lib.library", sourceText: "ref\n" }]);
		writeSrc(root, "Lib.library", "ref\nedited\n");
		commitAll(root, "edit lib");
		const r = await push(root, bridge);
		expect(r.kind).toBe("rejected");
		if (r.kind === "rejected") expect(r.reason).toContain("read-only");
	});

	test("8. push is rejected when the IDE drifted", async () => {
		const bridge = await setup([{ name: "A.st", sourceText: "a1\n" }]);
		writeSrc(root, "A.st", "a1\nmine\n");
		commitAll(root, "edit A");
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

	const keys = (items: Record<string, string>): string[] => Object.keys(items).sort();

	test("10. pure rename → one `set` op carrying just the new name", async () => {
		const bridge = await setup([{ name: "A.st", sourceText: "x\n" }]);
		git(root, "mv", "src/A.st", "src/B.st");
		commitAll(root, "rename A→B");
		const r = await push(root, bridge);
		expect(r.kind).toBe("ok");
		const ops = bridge.pushCalls[0]!.ops;
		expect(ops).toHaveLength(1);
		expect(ops[0]).toMatchObject({ op: "set", name: "A.st", toName: "B.st" });
		expect((ops[0] as Record<string, unknown>).sourceText).toBeUndefined(); // refs preserved, content not resent
		expect(keys((await bridge.getRefs()).items)).toEqual(["B.st"]); // A.st renamed to B.st
	});

	test("11. pure move (folder change, name kept) → one `set` op with the new folder", async () => {
		const bridge = await setup([{ name: "A.st", sourceText: "x\n", folder: "F1" }]);
		mkdirSync(join(root, "src", "F2"), { recursive: true });
		git(root, "mv", "src/F1/A.st", "src/F2/A.st");
		commitAll(root, "move A F1→F2");
		const r = await push(root, bridge);
		expect(r.kind).toBe("ok");
		const ops = bridge.pushCalls[0]!.ops;
		expect(ops).toHaveLength(1);
		expect(ops[0]).toMatchObject({ op: "set", name: "A.st", toFolder: "F2" });
		expect((await bridge.getRefs()).folders["A.st"]).toBe("F2");
	});

	test("12. rename + content edit → one atomic `set` (no refusal)", async () => {
		const big = "PROGRAM P\nVAR\n" + Array.from({ length: 30 }, (_, i) => `  v${i} : INT;`).join("\n") + "\nEND_VAR\nEND_PROGRAM\n";
		const bridge = await setup([{ name: "A.st", sourceText: big }]);
		git(root, "mv", "src/A.st", "src/B.st");
		const edited = big.replace("v0 : INT;", "v0 : DINT;");
		writeSrc(root, "B.st", edited); // ~97% similar → git sees R<100 (rename + edit)
		commitAll(root, "rename + edit");
		const r = await push(root, bridge);
		expect(r.kind).toBe("ok");
		const ops = bridge.pushCalls[0]!.ops;
		expect(ops).toHaveLength(1);
		expect(ops[0]).toMatchObject({ op: "set", name: "A.st", toName: "B.st", sourceText: edited });
		expect(keys((await bridge.getRefs()).items)).toEqual(["B.st"]); // A.st gone; B.st has the edit
	});

	test("13. rename AND move in one step → one atomic `set` (no refusal)", async () => {
		const bridge = await setup([{ name: "A.st", sourceText: "x\n", folder: "F1" }]);
		mkdirSync(join(root, "src", "F2"), { recursive: true });
		git(root, "mv", "src/F1/A.st", "src/F2/B.st"); // name + folder both change (content identical)
		commitAll(root, "rename + move");
		const r = await push(root, bridge);
		expect(r.kind).toBe("ok");
		const ops = bridge.pushCalls[0]!.ops;
		expect(ops).toHaveLength(1);
		expect(ops[0]).toMatchObject({ op: "set", name: "A.st", toName: "B.st", toFolder: "F2" });
		const refs = await bridge.getRefs();
		expect(keys(refs.items)).toEqual(["B.st"]);
		expect(refs.folders["B.st"]).toBe("F2");
	});

	test("14. a brand-new file, once committed, is pushed as a create", async () => {
		const bridge = await setup([{ name: "A.st", sourceText: "a\n" }]);
		writeSrc(root, "NEW.st", "PROGRAM NEW\nEND_PROGRAM\n");
		commitAll(root, "add NEW");
		const r = await push(root, bridge);
		expect(r.kind).toBe("ok");
		const setOp = bridge.pushCalls[0]!.ops.find((o) => o.op === "set" && o.name === "NEW.st");
		expect(setOp).toMatchObject({ op: "set", name: "NEW.st", ifVersion: null }); // create
		expect(keys((await bridge.getRefs()).items)).toContain("NEW.st");
	});

	test("15. commit-before-push guard refuses a dirty tree (symmetric with pull)", async () => {
		const bridge = await setup([{ name: "A.st", sourceText: "a1\n" }]);
		writeSrc(root, "A.st", "a1\nuncommitted\n"); // dirty, not committed
		const r = await push(root, bridge);
		expect(r.kind).toBe("rejected");
		if (r.kind === "rejected") expect(r.reason.toLowerCase()).toContain("commit");
	});
});

describe("collisions, conflict resolution, diff/show + the remaining commands", () => {
	// Both sides change A from a common base, overlapping → a real merge conflict (MERGE_HEAD present).
	async function reachConflict(): Promise<MockBridge> {
		const bridge = await setup([{ name: "A.st", sourceText: "base\n" }]);
		writeSrc(root, "A.st", "MINE\n");
		commitAll(root, "mine");
		bridge.set("A.st", "IDE\n");
		expect((await pull(root, bridge)).kind).toBe("conflict");
		return bridge;
	}

	// ── collisions (both sides moved before a sync) ──
	test("collision: both sides change DIFFERENT items → push still blocked (any IDE drift ⇒ pull first)", async () => {
		const bridge = await setup([{ name: "A.st", sourceText: "a\n" }, { name: "B.st", sourceText: "b\n" }]);
		writeSrc(root, "A.st", "a\nmine\n");
		commitAll(root, "edit A");
		bridge.set("B.st", "b\nide\n"); // IDE moved an UNRELATED item
		const r = await push(root, bridge);
		expect(r.kind).toBe("rejected");
		if (r.kind === "rejected") expect(r.reason.toLowerCase()).toContain("pull");
	});

	test("collision: IDE deletes an item I edited → pull is a delete/modify conflict", async () => {
		const bridge = await setup([{ name: "A.st", sourceText: "a\n" }]);
		writeSrc(root, "A.st", "a\nmine\n");
		commitAll(root, "edit A");
		bridge.remove("A.st"); // IDE deleted exactly what I changed
		expect((await pull(root, bridge)).kind).toBe("conflict");
	});

	// ── diff/show — the 3-way data the merge editor + diff tab read ──
	test("diff/show: MERGE_OURS / MERGE_THEIRS / MERGE_BASE during a conflict", async () => {
		const bridge = await reachConflict();
		const ours = await show(root, bridge, "MERGE_OURS", "A.st");
		const theirs = await show(root, bridge, "MERGE_THEIRS", "A.st");
		const base = await show(root, bridge, "MERGE_BASE", "A.st");
		expect(Buffer.isBuffer(ours) ? ours.toString("utf8") : "").toBe("MINE\n"); // my side (HEAD)
		expect(Buffer.isBuffer(theirs) ? theirs.toString("utf8") : "").toBe("IDE\n"); // IDE side (MERGE_HEAD)
		expect(Buffer.isBuffer(base) ? base.toString("utf8") : "").toBe("base\n"); // common ancestor
	});

	// ── conflict resolution through `volt merge` ──
	test("resolve: merge --abort restores the pre-merge tree", async () => {
		await reachConflict();
		expect(isMerging(root)).toBe(true);
		expect(merge(root, { abort: true }).code).toBe(0);
		expect(isMerging(root)).toBe(false);
		expect(readSrc(root, "A.st")).toBe("MINE\n");
	});

	test("resolve: --resolve --use-theirs then --continue takes the IDE side", async () => {
		await reachConflict();
		expect(merge(root, { resolve: "A.st", useTheirs: true }).code).toBe(0);
		expect(merge(root, { continue: true }).code).toBe(0);
		expect(isMerging(root)).toBe(false);
		expect(readSrc(root, "A.st")).toBe("IDE\n");
	});

	test("resolve: --resolve --use-ours keeps my side", async () => {
		await reachConflict();
		merge(root, { resolve: "A.st", useOurs: true });
		expect(merge(root, { continue: true }).code).toBe(0);
		expect(readSrc(root, "A.st")).toBe("MINE\n");
	});

	test("resolve: --continue refuses while files are still unresolved", async () => {
		await reachConflict();
		const r = merge(root, { continue: true }); // markers still present
		expect(r.code).toBe(2);
		expect(r.message.toLowerCase()).toContain("unresolved");
		merge(root, { abort: true });
	});

	// ── dry-run (no side effects) ──
	test("push --dry-run reports items but sends nothing + leaves volt/ide put", async () => {
		const bridge = await setup([{ name: "A.st", sourceText: "a\n" }]);
		const before = git(root, "rev-parse", "refs/remotes/volt/ide");
		writeSrc(root, "A.st", "a\nmine\n");
		commitAll(root, "edit");
		const r = await push(root, bridge, { dryRun: true });
		expect(r.kind).toBe("ok");
		if (r.kind === "ok") expect(r.items).toContain("A.st");
		expect(bridge.pushCalls.length).toBe(0);
		expect(git(root, "rev-parse", "refs/remotes/volt/ide")).toBe(before);
	});

	test("pull --dry-run reports incoming but doesn't merge", async () => {
		const bridge = await setup([{ name: "A.st", sourceText: "a\n" }]);
		bridge.set("A.st", "a\nide\n");
		const before = git(root, "rev-parse", "HEAD");
		expect((await pull(root, bridge, { dryRun: true })).kind).toBe("ok");
		expect(git(root, "rev-parse", "HEAD")).toBe(before); // no merge commit
		expect(readSrc(root, "A.st")).toBe("a\n"); // worktree untouched
	});

	// ── force-with-lease ──
	test("push --force-with-lease: stale lease rejected, current lease clobbers the drift", async () => {
		const bridge = await setup([{ name: "A.st", sourceText: "a\n" }]);
		writeSrc(root, "A.st", "a\nmine\n");
		commitAll(root, "edit");
		bridge.set("A.st", "a\nide\n"); // IDE drifted
		const lease = (await bridge.getRefs()).projectVersion;
		expect((await push(root, bridge, { forceWithLease: "deadbeefdeadbeef" })).kind).toBe("rejected");
		expect((await push(root, bridge, { forceWithLease: lease })).kind).toBe("ok");
	});

	// ── build ──
	test("build delegates to the bridge + returns normalized diagnostics", async () => {
		const bridge = await setup([{ name: "A.st", sourceText: "a\n" }]);
		const r = await build(bridge, false);
		expect(r.success).toBe(true);
		expect(Array.isArray(r.diagnostics)).toBe(true);
	});

	// ── log (the IDE-sync history on volt/ide) ──
	test("log returns the sync history, newest first, with summary + paths", async () => {
		const bridge = await setup([{ name: "A.st", sourceText: "a\n" }]); // init = first pull → a volt/ide commit
		writeSrc(root, "A.st", "a\nmine\n");
		commitAll(root, "edit A");
		await push(root, bridge); // push → volt/ide = HEAD (the edit commit)
		const entries = log(root);
		expect(entries.length).toBeGreaterThan(0);
		expect(entries[0]!.summary).toBe("edit A"); // newest first
		expect(Array.isArray(entries[0]!.paths)).toBe(true);
		expect(entries[0]!.sha.length).toBeGreaterThan(0);
	});

	// ── binding guard (wrong project open in the IDE) ──
	test("binding guard: a project mismatch blocks both push and pull", async () => {
		const bridge = await setup([{ name: "A.st", sourceText: "a\n" }]); // binds to the mock's project
		bridge.project = { ...bridge.project, projectName: "DifferentProject" }; // IDE now reports another project
		writeSrc(root, "A.st", "a\nmine\n");
		commitAll(root, "edit");
		const p = await push(root, bridge);
		expect(p.kind).toBe("rejected");
		if (p.kind === "rejected") expect(p.reason.toLowerCase()).toContain("bound");
		const l = await pull(root, bridge);
		expect(l.kind).toBe("refused");
	});
});
