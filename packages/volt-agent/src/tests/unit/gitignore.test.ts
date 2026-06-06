import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureGitignoreEntries, type GitignoreEntry } from "../../engine/gitignore.js";

function fresh(): string {
	return mkdtempSync(join(tmpdir(), "volt-gitignore-"));
}

const TWO_ENTRIES: readonly GitignoreEntry[] = [
	{
		comment: "volt local state",
		patterns: ["/.volt/"],
		matcher: /^\s*\/?\.volt\/?\s*$/m,
	},
	{
		comment: "bun / node tooling",
		patterns: ["/node_modules/"],
		matcher: /^\s*\/?node_modules\/?\s*$/m,
	},
];

describe("ensureGitignoreEntries", () => {
	test("creates .gitignore when absent, with every entry", () => {
		const root = fresh();
		try {
			ensureGitignoreEntries(root, TWO_ENTRIES);
			const text = readFileSync(join(root, ".gitignore"), "utf-8");
			expect(text).toContain("# volt local state");
			expect(text).toContain("/.volt/");
			expect(text).toContain("# bun / node tooling");
			expect(text).toContain("/node_modules/");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("idempotent: second call appends nothing", () => {
		const root = fresh();
		try {
			ensureGitignoreEntries(root, TWO_ENTRIES);
			const first = readFileSync(join(root, ".gitignore"), "utf-8");
			ensureGitignoreEntries(root, TWO_ENTRIES);
			const second = readFileSync(join(root, ".gitignore"), "utf-8");
			expect(second).toBe(first);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("appends only the missing entry when one is already present", () => {
		const root = fresh();
		try {
			writeFileSync(
				join(root, ".gitignore"),
				"# user content\n*.log\n/.volt/\n",
				"utf-8",
			);
			ensureGitignoreEntries(root, TWO_ENTRIES);
			const text = readFileSync(join(root, ".gitignore"), "utf-8");
			// User content survives.
			expect(text).toContain("*.log");
			// Existing /.volt/ block not duplicated.
			expect(text.match(/\/\.volt\//g)?.length).toBe(1);
			// node_modules block appended.
			expect(text).toContain("/node_modules/");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("preserves trailing-newline policy of existing file", () => {
		const root = fresh();
		try {
			writeFileSync(join(root, ".gitignore"), "*.log\n", "utf-8");
			ensureGitignoreEntries(root, TWO_ENTRIES);
			const text = readFileSync(join(root, ".gitignore"), "utf-8");
			expect(text.startsWith("*.log\n")).toBe(true);
			// Two new blocks appended after a single separator newline.
			expect(text).toContain("/.volt/");
			expect(text).toContain("/node_modules/");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("missing trailing newline → adds one before appending", () => {
		const root = fresh();
		try {
			writeFileSync(join(root, ".gitignore"), "*.log", "utf-8");
			ensureGitignoreEntries(root, TWO_ENTRIES);
			const text = readFileSync(join(root, ".gitignore"), "utf-8");
			// No fused line: "*.log# volt …" must NOT appear.
			expect(text).not.toContain("*.log#");
			expect(text).toContain("*.log");
			expect(text).toContain("# volt local state");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("recognizes .volt and /.volt and .volt/ as the same entry", () => {
		const root = fresh();
		try {
			writeFileSync(join(root, ".gitignore"), ".volt\n", "utf-8");
			ensureGitignoreEntries(root, TWO_ENTRIES);
			const text = readFileSync(join(root, ".gitignore"), "utf-8");
			// Existing line preserved, no duplicate block added.
			expect(text.match(/^# volt local state/gm)?.length ?? 0).toBe(0);
			// node_modules block appended.
			expect(text).toContain("/node_modules/");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("does not touch the file when every entry is already present", () => {
		const root = fresh();
		try {
			const initial = "*.log\n/.volt/\n/node_modules/\n";
			const path = join(root, ".gitignore");
			writeFileSync(path, initial, "utf-8");
			ensureGitignoreEntries(root, TWO_ENTRIES);
			expect(readFileSync(path, "utf-8")).toBe(initial);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("no entries → no-op on missing file", () => {
		const root = fresh();
		try {
			ensureGitignoreEntries(root, []);
			expect(existsSync(join(root, ".gitignore"))).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
