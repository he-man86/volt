import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init } from "../commands/init.js";
import { MockBridge } from "./mock-bridge.js";

// Suspicion #4 from the PackML session: what a second `volt init` does to an already-bound repo. The
// original behavior silently re-pulled+merged, stacking `volt: IDE @` / `merge IDE @` commits (the
// confusing history seen in the live repo). init now GUARDS against this: a re-init on a workspace that
// already has a `.git/volt/config.json` binding is refused with a pointer to `volt-git pull`. These
// tests pin that guard + the data-safety invariant (re-init never touches committed work).

const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (root: string, ...args: string[]): string => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", env: ENV }).trim();
const configure = (root: string): void => {
	git(root, "config", "user.name", "t");
	git(root, "config", "user.email", "t@t");
	git(root, "config", "core.autocrlf", "false");
};

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "voltg-reinit-"));
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("re-init on an already-bound repo (suspicion #4)", () => {
	test("a second init is refused (not a silent re-sync) and touches nothing", async () => {
		const bridge = new MockBridge([{ name: "A.fb", sourceText: "a1\n" }]);
		expect((await init(root, bridge)).kind).toBe("ok");
		configure(root);
		const before = git(root, "rev-list", "--count", "HEAD");

		const r2 = await init(root, bridge);
		expect(r2.kind).toBe("error");
		if (r2.kind === "error") expect(r2.reason).toContain("already initialized");
		expect(git(root, "rev-list", "--count", "HEAD")).toBe(before); // no new commits
		expect(git(root, "status", "--porcelain")).toBe(""); // clean tree
	});

	test("a refused re-init leaves local work AND a moved IDE untouched (no data loss, no merge)", async () => {
		const bridge = new MockBridge([{ name: "A.fb", sourceText: "a1\n" }]);
		expect((await init(root, bridge)).kind).toBe("ok");
		configure(root);

		// Local committed work (the AI's "Add PackML framework" commit) + the IDE moving underneath.
		git(root, "commit", "--allow-empty", "-q", "-m", "Add PackML framework");
		bridge.set("A.fb", "a1\nide-moved\n");
		const before = git(root, "rev-parse", "HEAD");

		const r2 = await init(root, bridge);
		expect(r2.kind).toBe("error"); // refused — no pull, no merge
		expect(git(root, "rev-parse", "HEAD")).toBe(before); // HEAD unmoved: no merge commit
		expect(git(root, "log", "--oneline")).toContain("Add PackML framework");
		expect(git(root, "status", "--porcelain")).toBe("");
	});
});
