/**
 * Tests for `detectWorkspaceDirty`. The CRLF/LF case is the load-bearing
 * one — Windows + git autocrlf produces CRLF workspace files while the
 * snapshot stores LF blobs (`syncFromBridge` normalizes on import).
 * Without normalization on the dirty check, every Windows workspace
 * shows clean files as dirty, triggering phantom merge conflicts.
 *
 * This test pairs with `workspaceMatchesBridge` (ops.test.ts) which
 * already normalizes — keeping the two predicates in agreement is the
 * fix's whole point.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildTree,
	createDeterministicCommit,
	initBareRepo,
	updateRef,
	writeBlob,
} from "./git-cmds.js";
import { detectWorkspaceDirty, ensureGitignore } from "./snapshot.js";

describe("detectWorkspaceDirty (line-ending normalization)", () => {
	let tmp: string;
	let snapshotPath: string;
	let workspaceRoot: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "volt-dirty-eol-"));
		snapshotPath = join(tmp, "snapshot");
		workspaceRoot = join(tmp, "ws");
		mkdirSync(workspaceRoot, { recursive: true });
		initBareRepo(snapshotPath);
	});
	afterEach(() => {
		try {
			rmSync(tmp, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	});

	function seedSnapshot(files: Record<string, string>): string {
		// Write LF-normalized blobs (mirrors syncFromBridge's behaviour).
		const entries = Object.entries(files).map(([path, content]) => ({
			path,
			sha: writeBlob(snapshotPath, content.replace(/\r\n/g, "\n")),
		}));
		const treeSha = buildTree(snapshotPath, entries);
		const commitSha = createDeterministicCommit(snapshotPath, treeSha, undefined, "seed");
		updateRef(snapshotPath, "refs/heads/main", commitSha);
		return commitSha;
	}

	it("CRLF workspace file with same logical content as LF snapshot blob is NOT dirty", () => {
		const commit = seedSnapshot({
			"PLC_PRG.st": "PROGRAM PLC_PRG\nVAR\nEND_VAR\n\nEND_PROGRAM\n",
		});
		// Write the EXACT same logical content with CRLF endings — Windows
		// editors and git autocrlf do this by default.
		writeFileSync(
			join(workspaceRoot, "PLC_PRG.st"),
			"PROGRAM PLC_PRG\r\nVAR\r\nEND_VAR\r\n\r\nEND_PROGRAM\r\n",
		);
		expect(detectWorkspaceDirty(snapshotPath, workspaceRoot, commit)).toEqual([]);
	});

	it("LF workspace file matching LF snapshot blob is NOT dirty", () => {
		const commit = seedSnapshot({
			"PLC_PRG.st": "PROGRAM PLC_PRG\nVAR\nEND_VAR\n\nEND_PROGRAM\n",
		});
		writeFileSync(
			join(workspaceRoot, "PLC_PRG.st"),
			"PROGRAM PLC_PRG\nVAR\nEND_VAR\n\nEND_PROGRAM\n",
		);
		expect(detectWorkspaceDirty(snapshotPath, workspaceRoot, commit)).toEqual([]);
	});

	it("workspace file with REAL content change IS dirty", () => {
		const commit = seedSnapshot({
			"PLC_PRG.st": "PROGRAM PLC_PRG\nVAR\nEND_VAR\n\nEND_PROGRAM\n",
		});
		writeFileSync(
			join(workspaceRoot, "PLC_PRG.st"),
			"PROGRAM PLC_PRG\nVAR\n\tfoo: BOOL;\nEND_VAR\n\nEND_PROGRAM\n",
		);
		expect(detectWorkspaceDirty(snapshotPath, workspaceRoot, commit)).toEqual(["PLC_PRG.st"]);
	});

	it("missing workspace file IS dirty (user deleted a tracked file)", () => {
		const commit = seedSnapshot({
			"PLC_PRG.st": "PROGRAM PLC_PRG\nVAR\nEND_VAR\n\nEND_PROGRAM\n",
		});
		// Don't write PLC_PRG.st — simulate deletion.
		expect(detectWorkspaceDirty(snapshotPath, workspaceRoot, commit)).toEqual(["PLC_PRG.st"]);
	});
});

describe("ensureGitignore", () => {
	let tmp: string;
	let workspaceRoot: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "volt-gitignore-"));
		workspaceRoot = join(tmp, "ws");
		mkdirSync(workspaceRoot, { recursive: true });
	});
	afterEach(() => {
		try {
			rmSync(tmp, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	});

	it("creates .gitignore with /.volt/ when the file is missing", () => {
		const giPath = join(workspaceRoot, ".gitignore");
		expect(existsSync(giPath)).toBe(false);
		ensureGitignore(workspaceRoot);
		expect(existsSync(giPath)).toBe(true);
		expect(readFileSync(giPath, "utf-8")).toContain("/.volt/");
	});

	it("appends /.volt/ when an existing .gitignore lacks it", () => {
		const giPath = join(workspaceRoot, ".gitignore");
		writeFileSync(giPath, "node_modules/\ndist/\n", "utf-8");
		ensureGitignore(workspaceRoot);
		const text = readFileSync(giPath, "utf-8");
		// User's existing lines are preserved.
		expect(text).toContain("node_modules/");
		expect(text).toContain("dist/");
		// And our line is appended.
		expect(text).toContain("/.volt/");
	});

	it("is idempotent — running twice does not duplicate the entry", () => {
		ensureGitignore(workspaceRoot);
		const after1 = readFileSync(join(workspaceRoot, ".gitignore"), "utf-8");
		ensureGitignore(workspaceRoot);
		const after2 = readFileSync(join(workspaceRoot, ".gitignore"), "utf-8");
		expect(after2).toBe(after1);
		// And the entry appears exactly once.
		const matches = after2.match(/^\s*\/?\.volt\/?\s*$/gm);
		expect(matches?.length ?? 0).toBe(1);
	});

	it("recognizes prior `.volt/` (no leading slash) and does not re-append", () => {
		const giPath = join(workspaceRoot, ".gitignore");
		writeFileSync(giPath, "node_modules/\n.volt/\n", "utf-8");
		ensureGitignore(workspaceRoot);
		const text = readFileSync(giPath, "utf-8");
		// The function recognizes the existing line; no duplicate added.
		const matches = text.match(/^\s*\/?\.volt\/?\s*$/gm);
		expect(matches?.length ?? 0).toBe(1);
	});
});
