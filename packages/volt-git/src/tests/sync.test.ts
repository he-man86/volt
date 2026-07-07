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
import { build, unpushedCount } from "../build.js";
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
const buf = (r: Buffer | { error: string }): string => (Buffer.isBuffer(r) ? r.toString("utf8") : `<error: ${r.error}>`);

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
	git(root, "config", "user.name", "t"); // autoCommitSrc commits via plumbing git → reads repo config
	git(root, "config", "user.email", "t@t");
	return bridge;
}

describe("volt-git sync", () => {
	test("1. init bootstrap materializes the IDE under src/", async () => {
		await setup([{ name: "FB_Motor.fb", sourceText: "v1\n", folder: "POUs" }]);
		expect(existsSync(srcFile(root, "POUs/FB_Motor.fb"))).toBe(true);
		expect(readSrc(root, "POUs/FB_Motor.fb")).toBe("v1\n");
		const s = await status(root, new MockBridge([{ name: "FB_Motor.fb", sourceText: "v1\n", folder: "POUs" }]));
		expect(s.merging).toBeNull();
	});

	test("1b. .library refs materialize nested under their Library Manager (mirrors CODESYS)", async () => {
		await setup([
			{ name: "A.fb", sourceText: "a\n" },
			{ name: "PackML.library", sourceText: "LIBRARY PackML\nNAMESPACE PACK_ML\nRESOLUTION PackML, 1 (v)\n", folder: "09 Misc/Library Manager" },
			{ name: "Motion.library", sourceText: "LIBRARY Motion\nNAMESPACE L_MC4P\nRESOLUTION Motion, 2 (v)\n", folder: "09 Misc/Library Manager" },
		]);
		// The libraries mirror the IDE: read-only .library files under their Library Manager folder.
		expect(existsSync(srcFile(root, "09 Misc/Library Manager/PackML.library"))).toBe(true);
		expect(existsSync(srcFile(root, "09 Misc/Library Manager/Motion.library"))).toBe(true);
		expect(readSrc(root, "09 Misc/Library Manager/PackML.library")).toContain("NAMESPACE PACK_ML");
		expect(git(root, "ls-files", "src/09 Misc/Library Manager/PackML.library")).toContain("PackML.library"); // committed
		expect(existsSync(join(root, "libs"))).toBe(false); // no separate generated catalog
	});

	test("1c. an excluded-from-build object is omitted by the bridge (no ground truth → not returned)", async () => {
		const bad = "FUNCTION_BLOCK Bad\nVAR\n\tx : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n";
		await setup([
			{ name: "Good.fb", sourceText: "FUNCTION_BLOCK Good\nEND_FUNCTION_BLOCK\n" },
			{ name: "Bad.fb", sourceText: bad, excludeFromBuild: true },
		]);
		// The excluded object is never materialized — the LSP can't false-positive on code the IDE won't
		// compile, and there is no marker machinery. The buildable object still comes through.
		expect(existsSync(srcFile(root, "Bad.fb"))).toBe(false);
		expect(existsSync(srcFile(root, "Good.fb"))).toBe(true);
	});

	test("2. no-edit pull fast-forwards (no merge commit)", async () => {
		const bridge = await setup([{ name: "A.fb", sourceText: "v1\n" }]);
		bridge.set("A.fb", "v2\n");
		const r = await pull(root, bridge);
		expect(r.kind).toBe("ok");
		expect(readSrc(root, "A.fb")).toBe("v2\n");
		expect(headParents(root).length).toBe(1); // fast-forward, not a merge commit
	});

	test("3. independent edits → one clean merge commit", async () => {
		const bridge = await setup([{ name: "A.fb", sourceText: "a1\n" }, { name: "B.fb", sourceText: "b1\n" }]);
		writeSrc(root, "A.fb", "a1\nlocal\n");
		commitAll(root, "edit A");
		bridge.set("B.fb", "b1\nide\n");
		const r = await pull(root, bridge);
		expect(r.kind).toBe("ok");
		expect(readSrc(root, "A.fb")).toContain("local");
		expect(readSrc(root, "B.fb")).toContain("ide");
		expect(headParents(root).length).toBe(2); // merge commit
	});

	test("4. overlapping edits → conflict markers", async () => {
		const bridge = await setup([{ name: "A.fb", sourceText: "line1\n" }]);
		writeSrc(root, "A.fb", "line1\nLOCAL\n");
		commitAll(root, "edit A");
		bridge.set("A.fb", "line1\nIDE\n");
		const r = await pull(root, bridge);
		expect(r.kind).toBe("conflict");
		if (r.kind === "conflict") expect(r.paths).toContain("A.fb");
		expect(readSrc(root, "A.fb")).toContain("<<<<<<<");
		git(root, "merge", "--abort"); // recovers
		const s = await status(root, bridge);
		expect(s.merging).toBeNull();
	});

	test("5. pull auto-commits local edits, then merges (simple flow)", async () => {
		const bridge = await setup([{ name: "A.fb", sourceText: "a1\n" }, { name: "B.fb", sourceText: "b1\n" }]);
		writeSrc(root, "A.fb", "a1\nmine\n"); // dirty local edit, NOT committed
		bridge.set("B.fb", "b1\nide\n"); // IDE changed a DIFFERENT item
		const r = await pull(root, bridge);
		expect(r.kind).toBe("ok"); // no refusal — auto-commits A, then merges B in
		expect(readSrc(root, "A.fb")).toContain("mine"); // my edit preserved (auto-committed)
		expect(readSrc(root, "B.fb")).toContain("ide"); // IDE change merged in
		expect(git(root, "status", "--porcelain", "--", "src").trim()).toBe(""); // clean tree after
	});

	test("6. push sends edits to the bridge + lands volt/ide on HEAD (like git push)", async () => {
		const bridge = await setup([{ name: "A.fb", sourceText: "a1\n" }]);
		writeSrc(root, "A.fb", "a1\nmine\n");
		commitAll(root, "edit A");
		const r = await push(root, bridge);
		expect(r.kind).toBe("ok");
		if (r.kind === "ok") expect(r.items).toContain("A.fb");
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

	test("7c. unpushedCount reflects local divergence from the IDE (the build-on-stale-state hint)", async () => {
		// build runs against the IDE's current project, not local src/. This count is what the CLI uses to
		// warn "this build reflects the IDE, not your workspace" — proven here to track the real divergence.
		const bridge = await setup([{ name: "A.fb", sourceText: "a1\n" }]);
		expect(unpushedCount(root)).toBe(0); // in sync after init
		writeSrc(root, "A.fb", "a1\nlocal\n");
		commitAll(root, "edit A");
		expect(unpushedCount(root)).toBeGreaterThan(0); // local work not yet pushed
		const r = await push(root, bridge);
		expect(r.kind).toBe("ok");
		expect(unpushedCount(root)).toBe(0); // push advanced volt/ide → back in sync
	});

	test("7b. an unrecognized extension (.dut) is rejected loud — not silently dropped as 'nothing to push'", async () => {
		// The PackML incident: an AI names a struct `.dut` (CODESYS's term) instead of `.struct`. The bug was
		// that push silently skipped it and reported "nothing to push — the IDE already matches your workspace",
		// so the item never reached the IDE and nothing said why — the AI then flailed guessing extensions.
		const bridge = await setup([{ name: "A.fb", sourceText: "a1\n" }]);
		writeSrc(root, "E_PackML_State.dut", "TYPE E_PackML_State :\n(\n\tIDLE := 0\n) USINT;\nEND_TYPE\n");
		const r = await push(root, bridge);
		expect(r.kind).toBe("rejected"); // the old bug returned kind:"ok" ("nothing to push") here
		if (r.kind === "rejected") {
			expect(r.reason).toContain("E_PackML_State.dut"); // names the offender
			expect(r.reason).toContain(".enum"); // and tells the AI the right extension
		}
		expect(bridge.pushCalls.length).toBe(0); // nothing reached the IDE
		expect(Object.keys((await bridge.getRefs()).items)).toEqual(["A.fb"]); // no PackML item created
		expect(git(root, "ls-files", "src/E_PackML_State.dut")).toBe(""); // and it was NOT committed — no refs touched

		// Recovery: rename to the correct extension → clean push, the item lands in the IDE.
		rmSync(srcFile(root, "E_PackML_State.dut"));
		writeSrc(root, "E_PackML_State.enum", "TYPE E_PackML_State :\n(\n\tIDLE := 0\n) USINT;\nEND_TYPE\n");
		const r2 = await push(root, bridge);
		expect(r2.kind).toBe("ok");
		expect(Object.keys((await bridge.getRefs()).items)).toContain("E_PackML_State.enum");
	});

	test("8. push is rejected when the IDE drifted", async () => {
		const bridge = await setup([{ name: "A.fb", sourceText: "a1\n" }]);
		writeSrc(root, "A.fb", "a1\nmine\n");
		commitAll(root, "edit A");
		bridge.set("A.fb", "a1\nide-moved\n"); // drift after the last sync
		const r = await push(root, bridge);
		expect(r.kind).toBe("rejected");
		if (r.kind === "rejected") expect(r.reason.toLowerCase()).toContain("pull");
		// --force adopts (pushes over the drift)
		const r2 = await push(root, bridge, { force: true });
		expect(r2.kind).toBe("ok");
	});

	test("9. status reports incoming and outgoing", async () => {
		const bridge = await setup([{ name: "A.fb", sourceText: "a1\n" }]);
		// outgoing: local edit (committed so it's not just dirty)
		writeSrc(root, "A.fb", "a1\nlocal\n");
		commitAll(root, "edit");
		// incoming: a different IDE item changes
		bridge.set("B.fb", "b-new\n");
		const s = await status(root, bridge);
		expect(s.outgoing.modified).toContain("A.fb");
		expect(s.incoming.added).toContain("B.fb");
	});

	const keys = (items: Record<string, string>): string[] => Object.keys(items).sort();

	test("10. pure rename → one `set` op carrying just the new name", async () => {
		const bridge = await setup([{ name: "A.fb", sourceText: "x\n" }]);
		git(root, "mv", "src/A.fb", "src/B.fb");
		commitAll(root, "rename A→B");
		const r = await push(root, bridge);
		expect(r.kind).toBe("ok");
		const ops = bridge.pushCalls[0]!.ops;
		expect(ops).toHaveLength(1);
		expect(ops[0]).toMatchObject({ op: "set", name: "A.fb", toName: "B.fb" });
		expect((ops[0] as Record<string, unknown>).sourceText).toBeUndefined(); // refs preserved, content not resent
		expect(keys((await bridge.getRefs()).items)).toEqual(["B.fb"]); // A.fb renamed to B.fb
	});

	test("11. pure move (folder change, name kept) → one `set` op with the new folder", async () => {
		const bridge = await setup([{ name: "A.fb", sourceText: "x\n", folder: "F1" }]);
		mkdirSync(join(root, "src", "F2"), { recursive: true });
		git(root, "mv", "src/F1/A.fb", "src/F2/A.fb");
		commitAll(root, "move A F1→F2");
		const r = await push(root, bridge);
		expect(r.kind).toBe("ok");
		const ops = bridge.pushCalls[0]!.ops;
		expect(ops).toHaveLength(1);
		expect(ops[0]).toMatchObject({ op: "set", name: "A.fb", toFolder: "F2" });
		expect((await bridge.getRefs()).folders["A.fb"]).toBe("F2");
	});

	test("12. rename + content edit → one atomic `set` (no refusal)", async () => {
		const big = "PROGRAM P\nVAR\n" + Array.from({ length: 30 }, (_, i) => `  v${i} : INT;`).join("\n") + "\nEND_VAR\nEND_PROGRAM\n";
		const bridge = await setup([{ name: "A.fb", sourceText: big }]);
		git(root, "mv", "src/A.fb", "src/B.fb");
		const edited = big.replace("v0 : INT;", "v0 : DINT;");
		writeSrc(root, "B.fb", edited); // ~97% similar → git sees R<100 (rename + edit)
		commitAll(root, "rename + edit");
		const r = await push(root, bridge);
		expect(r.kind).toBe("ok");
		const ops = bridge.pushCalls[0]!.ops;
		expect(ops).toHaveLength(1);
		expect(ops[0]).toMatchObject({ op: "set", name: "A.fb", toName: "B.fb", sourceText: edited });
		expect(keys((await bridge.getRefs()).items)).toEqual(["B.fb"]); // A.fb gone; B.fb has the edit
	});

	test("13. rename AND move in one step → one atomic `set` (no refusal)", async () => {
		const bridge = await setup([{ name: "A.fb", sourceText: "x\n", folder: "F1" }]);
		mkdirSync(join(root, "src", "F2"), { recursive: true });
		git(root, "mv", "src/F1/A.fb", "src/F2/B.fb"); // name + folder both change (content identical)
		commitAll(root, "rename + move");
		const r = await push(root, bridge);
		expect(r.kind).toBe("ok");
		const ops = bridge.pushCalls[0]!.ops;
		expect(ops).toHaveLength(1);
		expect(ops[0]).toMatchObject({ op: "set", name: "A.fb", toName: "B.fb", toFolder: "F2" });
		const refs = await bridge.getRefs();
		expect(keys(refs.items)).toEqual(["B.fb"]);
		expect(refs.folders["B.fb"]).toBe("F2");
	});

	test("14. a brand-new file, once committed, is pushed as a create", async () => {
		const bridge = await setup([{ name: "A.fb", sourceText: "a\n" }]);
		writeSrc(root, "NEW.fb", "PROGRAM NEW\nEND_PROGRAM\n");
		commitAll(root, "add NEW");
		const r = await push(root, bridge);
		expect(r.kind).toBe("ok");
		const setOp = bridge.pushCalls[0]!.ops.find((o) => o.op === "set" && o.name === "NEW.fb");
		expect(setOp).toMatchObject({ op: "set", name: "NEW.fb", ifVersion: null }); // create
		expect(keys((await bridge.getRefs()).items)).toContain("NEW.fb");
	});

	test("15. push auto-commits working changes, then pushes (simple flow)", async () => {
		const bridge = await setup([{ name: "A.fb", sourceText: "a1\n" }]);
		writeSrc(root, "A.fb", "a1\nmine\n"); // dirty, NOT committed
		const r = await push(root, bridge);
		expect(r.kind).toBe("ok"); // no rejection — auto-commits, then pushes
		if (r.kind === "ok") expect(r.items).toContain("A.fb");
		expect(git(root, "rev-parse", "refs/remotes/volt/ide")).toBe(git(root, "rev-parse", "HEAD")); // volt/ide on the auto-commit
		expect(git(root, "status", "--porcelain", "--", "src").trim()).toBe(""); // clean tree after
	});
});

describe("collisions, conflict resolution, diff/show + the remaining commands", () => {
	// Both sides change A from a common base, overlapping → a real merge conflict (MERGE_HEAD present).
	async function reachConflict(): Promise<MockBridge> {
		const bridge = await setup([{ name: "A.fb", sourceText: "base\n" }]);
		writeSrc(root, "A.fb", "MINE\n");
		commitAll(root, "mine");
		bridge.set("A.fb", "IDE\n");
		expect((await pull(root, bridge)).kind).toBe("conflict");
		return bridge;
	}

	// ── collisions (both sides moved before a sync) ──
	test("collision: both sides change DIFFERENT items → push still blocked (any IDE drift ⇒ pull first)", async () => {
		const bridge = await setup([{ name: "A.fb", sourceText: "a\n" }, { name: "B.fb", sourceText: "b\n" }]);
		writeSrc(root, "A.fb", "a\nmine\n");
		commitAll(root, "edit A");
		bridge.set("B.fb", "b\nide\n"); // IDE moved an UNRELATED item
		const r = await push(root, bridge);
		expect(r.kind).toBe("rejected");
		if (r.kind === "rejected") expect(r.reason.toLowerCase()).toContain("pull");
	});

	test("collision: IDE deletes an item I edited → pull is a delete/modify conflict", async () => {
		const bridge = await setup([{ name: "A.fb", sourceText: "a\n" }]);
		writeSrc(root, "A.fb", "a\nmine\n");
		commitAll(root, "edit A");
		bridge.remove("A.fb"); // IDE deleted exactly what I changed
		expect((await pull(root, bridge)).kind).toBe("conflict");
	});

	// ── diff/show — the 3-way data the merge editor + diff tab read ──
	test("diff/show: MERGE_OURS / MERGE_THEIRS / MERGE_BASE during a conflict", async () => {
		const bridge = await reachConflict();
		const ours = await show(root, bridge, "MERGE_OURS", "A.fb");
		const theirs = await show(root, bridge, "MERGE_THEIRS", "A.fb");
		const base = await show(root, bridge, "MERGE_BASE", "A.fb");
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
		expect(readSrc(root, "A.fb")).toBe("MINE\n");
	});

	test("resolve: --resolve --use-theirs then --continue takes the IDE side", async () => {
		await reachConflict();
		expect(merge(root, { resolve: "A.fb", useTheirs: true }).code).toBe(0);
		expect(merge(root, { continue: true }).code).toBe(0);
		expect(isMerging(root)).toBe(false);
		expect(readSrc(root, "A.fb")).toBe("IDE\n");
	});

	test("resolve: --resolve --use-ours keeps my side", async () => {
		await reachConflict();
		merge(root, { resolve: "A.fb", useOurs: true });
		expect(merge(root, { continue: true }).code).toBe(0);
		expect(readSrc(root, "A.fb")).toBe("MINE\n");
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
		const bridge = await setup([{ name: "A.fb", sourceText: "a\n" }]);
		const before = git(root, "rev-parse", "refs/remotes/volt/ide");
		writeSrc(root, "A.fb", "a\nmine\n");
		commitAll(root, "edit");
		const r = await push(root, bridge, { dryRun: true });
		expect(r.kind).toBe("ok");
		if (r.kind === "ok") expect(r.items).toContain("A.fb");
		expect(bridge.pushCalls.length).toBe(0);
		expect(git(root, "rev-parse", "refs/remotes/volt/ide")).toBe(before);
	});

	test("pull --dry-run reports incoming but doesn't merge", async () => {
		const bridge = await setup([{ name: "A.fb", sourceText: "a\n" }]);
		bridge.set("A.fb", "a\nide\n");
		const before = git(root, "rev-parse", "HEAD");
		expect((await pull(root, bridge, { dryRun: true })).kind).toBe("ok");
		expect(git(root, "rev-parse", "HEAD")).toBe(before); // no merge commit
		expect(readSrc(root, "A.fb")).toBe("a\n"); // worktree untouched
	});

	// ── force-with-lease ──
	test("push --force-with-lease: stale lease rejected, current lease clobbers the drift", async () => {
		const bridge = await setup([{ name: "A.fb", sourceText: "a\n" }]);
		writeSrc(root, "A.fb", "a\nmine\n");
		commitAll(root, "edit");
		bridge.set("A.fb", "a\nide\n"); // IDE drifted
		const lease = (await bridge.getRefs()).projectVersion;
		expect((await push(root, bridge, { forceWithLease: "deadbeefdeadbeef" })).kind).toBe("rejected");
		expect((await push(root, bridge, { forceWithLease: lease })).kind).toBe("ok");
	});

	// ── build ──
	test("build delegates to the bridge + returns normalized diagnostics", async () => {
		const bridge = await setup([{ name: "A.fb", sourceText: "a\n" }]);
		const r = await build(bridge, false);
		expect(r.success).toBe(true);
		expect(Array.isArray(r.diagnostics)).toBe(true);
	});

	// ── log (the IDE-sync history on volt/ide) ──
	test("log returns the sync history, newest first, with summary + paths", async () => {
		const bridge = await setup([{ name: "A.fb", sourceText: "a\n" }]); // init = first pull → a volt/ide commit
		writeSrc(root, "A.fb", "a\nmine\n");
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
		const bridge = await setup([{ name: "A.fb", sourceText: "a\n" }]); // binds to the mock's project
		bridge.project = { ...bridge.project, projectName: "DifferentProject" }; // IDE now reports another project
		writeSrc(root, "A.fb", "a\nmine\n");
		commitAll(root, "edit");
		const p = await push(root, bridge);
		expect(p.kind).toBe("rejected");
		if (p.kind === "rejected") expect(p.reason.toLowerCase()).toContain("bound");
		const l = await pull(root, bridge);
		expect(l.kind).toBe("refused");
	});

	// ── outgoing detection reads the WORKING TREE (the UX fix: an edit shows before commit) ──
	test("status detects outgoing from the working tree — uncommitted, untracked, AND committed-unpushed", async () => {
		const bridge = await setup([{ name: "A.fb", sourceText: "a1\n" }, { name: "C.fb", sourceText: "c1\n" }]);
		writeSrc(root, "A.fb", "a1\nmine\n"); // (1) uncommitted edit to a tracked file
		writeSrc(root, "NEW.fb", "PROGRAM NEW\nEND_PROGRAM\n"); // (2) untracked new file
		writeSrc(root, "C.fb", "c1\ndone\n"); // (3) committed but NOT pushed
		commitAll(root, "edit C");
		const s = await status(root, bridge);
		expect(s.outgoing.modified).toContain("A.fb"); // uncommitted edit shows immediately
		expect(s.outgoing.added).toContain("NEW.fb"); // untracked new file shows
		expect(s.outgoing.modified).toContain("C.fb"); // committed-but-unpushed shows
	});

	// ── the diff TABS' content (what each side of the diff actually renders) ──
	test("diff content: outgoing = VOLTIDE↔WORKSPACE (shows a live edit); incoming = VOLTIDE↔BRIDGE", async () => {
		const bridge = await setup([{ name: "A.fb", sourceText: "base\n" }, { name: "B.fb", sourceText: "b\n" }]);
		// OUTGOING — edit A but do NOT commit. The diff is baseline ↔ working file.
		writeSrc(root, "A.fb", "base\nmine\n");
		expect(buf(await show(root, bridge, "VOLTIDE", "A.fb"))).toBe("base\n"); // left = last synced
		expect(buf(await show(root, bridge, "WORKSPACE", "A.fb"))).toBe("base\nmine\n"); // right = my LIVE uncommitted edit
		expect(buf(await show(root, bridge, "HEAD", "A.fb"))).toBe("base\n"); // HEAD = committed — why VOLTIDE↔HEAD was empty
		// INCOMING — the IDE changes B. The diff is baseline ↔ live IDE.
		bridge.set("B.fb", "b\nide\n");
		expect(buf(await show(root, bridge, "VOLTIDE", "B.fb"))).toBe("b\n"); // left = last synced
		expect(buf(await show(root, bridge, "BRIDGE", "B.fb"))).toBe("b\nide\n"); // right = live IDE
	});
});
