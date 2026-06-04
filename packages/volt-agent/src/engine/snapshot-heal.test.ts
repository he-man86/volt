import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSnapshotRepo } from "./snapshot.js";

function freshTmpRoot(): string {
	return mkdtempSync(join(tmpdir(), "volt-heal-"));
}

describe("ensureSnapshotRepo — health detection + heal", () => {
	test("fresh dir: initializes a bare repo, reports no heal", () => {
		const root = freshTmpRoot();
		try {
			const snap = join(root, ".volt", "snapshot");
			const res = ensureSnapshotRepo(snap);
			expect(res.rebuilt).toBe(false);
			expect(existsSync(join(snap, "HEAD"))).toBe(true);
			expect(existsSync(join(snap, "objects"))).toBe(true);
			expect(existsSync(join(snap, "refs"))).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("healthy bare repo: no-op, no heal", () => {
		const root = freshTmpRoot();
		try {
			const snap = join(root, ".volt", "snapshot");
			ensureSnapshotRepo(snap);
			const res = ensureSnapshotRepo(snap);
			expect(res.rebuilt).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("corrupted: directory with objects/ subdir but no HEAD/refs gets healed", () => {
		const root = freshTmpRoot();
		try {
			const snap = join(root, ".volt", "snapshot");
			mkdirSync(join(snap, ".git", "objects"), { recursive: true });
			// Mirror the user's broken state — only .git/objects/ exists.
			const res = ensureSnapshotRepo(snap);
			expect(res.rebuilt).toBe(true);
			expect(res.reason).toBeDefined();
			// After heal: clean bare repo.
			expect(existsSync(join(snap, "HEAD"))).toBe(true);
			expect(existsSync(join(snap, "objects"))).toBe(true);
			expect(existsSync(join(snap, "refs"))).toBe(true);
			// And the corrupt .git/ shape is gone.
			expect(existsSync(join(snap, ".git"))).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("corrupted: stale state.json gets wiped along with the repo", () => {
		const root = freshTmpRoot();
		try {
			const snap = join(root, ".volt", "snapshot");
			mkdirSync(snap, { recursive: true });
			// state.json pointing at a now-missing commit — the kind of
			// thing a crashed pull leaves behind.
			writeFileSync(join(snap, "state.json"), JSON.stringify({ projectVersion: "v1", commitSha: "deadbeef", items: {}, folders: {} }));
			// Add a fake HEAD so isRepo passes initially.
			writeFileSync(join(snap, "HEAD"), "ref: refs/heads/main\n");
			// But NO objects/, NO refs/ — bare repo is broken.
			const res = ensureSnapshotRepo(snap);
			expect(res.rebuilt).toBe(true);
			expect(existsSync(join(snap, "state.json"))).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("corrupted snapshot nested inside a workspace git repo still heals", () => {
		// Regression: when the user's workspace is itself a git repo
		// (the common case — they `git init` to track their POU files),
		// `git rev-parse --git-dir` from a nested directory WALKS UP and
		// finds the workspace's .git/. Earlier `isRepo` returned true on
		// that, masking snapshot corruption from inspectSnapshot. The
		// structural check (HEAD/objects/refs) catches it anyway, but
		// only if the dispatch reaches that branch.
		const root = freshTmpRoot();
		try {
			// Make the OUTER dir a git repo (mimics user's workspace).
			spawnSync("git", ["init", "--quiet", root], { encoding: "utf-8" });
			// Place a broken snapshot dir inside (mimics .volt/snapshot/
			// after a fork-storm crash: .git/ subdir with only objects/,
			// no HEAD at the root, no refs/, no config).
			const snap = join(root, ".volt", "snapshot");
			mkdirSync(join(snap, ".git", "objects"), { recursive: true });
			writeFileSync(
				join(snap, "state.json"),
				JSON.stringify({ projectVersion: "v1", commitSha: "deadbeef", items: {}, folders: {} }),
			);
			const res = ensureSnapshotRepo(snap);
			expect(res.rebuilt).toBe(true);
			expect(existsSync(join(snap, "HEAD"))).toBe(true);
			expect(existsSync(join(snap, "objects"))).toBe(true);
			expect(existsSync(join(snap, "refs"))).toBe(true);
			expect(existsSync(join(snap, ".git"))).toBe(false);
			// state.json wiped → caller's pull will fullRebuild from bridge.
			expect(existsSync(join(snap, "state.json"))).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("heal reason is descriptive when bare repo is incomplete", () => {
		const root = freshTmpRoot();
		try {
			const snap = join(root, ".volt", "snapshot");
			mkdirSync(snap, { recursive: true });
			writeFileSync(join(snap, "HEAD"), "ref: refs/heads/main\n");
			// Has HEAD but no config/objects/refs — isRepo will fail because
			// `git rev-parse --git-dir` checks the broader bare-repo shape.
			const res = ensureSnapshotRepo(snap);
			expect(res.rebuilt).toBe(true);
			expect(res.reason).toMatch(/missing/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
