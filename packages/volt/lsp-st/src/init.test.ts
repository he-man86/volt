/**
 * Tests for `volt-lsp-st init`. Runs in a temp dir per test so
 * file-system side-effects don't bleed.
 */
import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "./init.js";

async function makeFixture(): Promise<{ tmpDir: string; sourceDir: string }> {
	const tmpDir = await mkdtemp(join(tmpdir(), "volt-init-"));
	const sourceDir = join(tmpDir, "src-docs");
	await mkdir(sourceDir, { recursive: true });
	// Fake a small corpus.
	await writeFile(join(sourceDir, "00-index.md"), "# index\n", "utf-8");
	await writeFile(join(sourceDir, "07-pragmas.md"), "# pragmas\n", "utf-8");
	await writeFile(join(sourceDir, "11-fb-lifecycle.md"), "# lifecycle\n", "utf-8");
	return { tmpDir, sourceDir };
}

describe("init: fresh install", () => {
	it("creates docs/codesys-reference/ with copied files", async () => {
		const { tmpDir, sourceDir } = await makeFixture();
		const target = join(tmpDir, "project");
		await mkdir(target, { recursive: true });

		const result = await runInit({ targetDir: target, sourceDir, version: "9.9.9", log: () => {} });

		expect(result.filesCopied).toBe(3);
		const files = await readdir(result.docsDir);
		expect(files.sort()).toEqual(["00-index.md", "07-pragmas.md", "11-fb-lifecycle.md"]);
	});

	it("creates CLAUDE.md when none exists", async () => {
		const { tmpDir, sourceDir } = await makeFixture();
		const target = join(tmpDir, "project");
		await mkdir(target, { recursive: true });

		const result = await runInit({ targetDir: target, sourceDir, version: "9.9.9", log: () => {} });

		expect(result.claudeMdAction).toBe("created");
		const content = await readFile(result.claudeMdPath, "utf-8");
		expect(content).toContain("## CODESYS Structured Text reference");
		expect(content).toContain("docs/codesys-reference/");
		expect(content).toContain("07-pragmas.md");
	});

	it("writes version marker", async () => {
		const { tmpDir, sourceDir } = await makeFixture();
		const target = join(tmpDir, "project");
		await mkdir(target, { recursive: true });

		const result = await runInit({ targetDir: target, sourceDir, version: "1.2.3", log: () => {} });

		const marker = await readFile(result.versionMarkerPath, "utf-8");
		expect(marker.trim()).toBe("1.2.3");
	});
});

describe("init: existing CLAUDE.md", () => {
	it("appends section when CLAUDE.md exists without it", async () => {
		const { tmpDir, sourceDir } = await makeFixture();
		const target = join(tmpDir, "project");
		await mkdir(target, { recursive: true });
		await writeFile(
			join(target, "CLAUDE.md"),
			"# My Project\n\nSome existing content.\n",
			"utf-8",
		);

		const result = await runInit({ targetDir: target, sourceDir, version: "9.9.9", log: () => {} });

		expect(result.claudeMdAction).toBe("appended");
		const content = await readFile(result.claudeMdPath, "utf-8");
		expect(content).toContain("# My Project");
		expect(content).toContain("Some existing content");
		expect(content).toContain("## CODESYS Structured Text reference");
	});

	it("replaces existing CODESYS section without nuking unrelated content", async () => {
		const { tmpDir, sourceDir } = await makeFixture();
		const target = join(tmpDir, "project");
		await mkdir(target, { recursive: true });
		await writeFile(
			join(target, "CLAUDE.md"),
			`# My Project

## CODESYS Structured Text reference

old content that should be replaced

## Other Section

unrelated content that must survive
`,
			"utf-8",
		);

		await runInit({ targetDir: target, sourceDir, version: "9.9.9", update: true, log: () => {} });

		const content = await readFile(join(target, "CLAUDE.md"), "utf-8");
		expect(content).toContain("# My Project");
		expect(content).toContain("## Other Section");
		expect(content).toContain("unrelated content that must survive");
		expect(content).not.toContain("old content that should be replaced");
		expect(content).toContain("07-pragmas.md");
	});
});

describe("init: idempotency", () => {
	it("second run without --update is a no-op", async () => {
		const { tmpDir, sourceDir } = await makeFixture();
		const target = join(tmpDir, "project");
		await mkdir(target, { recursive: true });

		await runInit({ targetDir: target, sourceDir, version: "1.0.0", log: () => {} });
		const result2 = await runInit({ targetDir: target, sourceDir, version: "2.0.0", log: () => {} });

		expect(result2.filesCopied).toBe(0);
		expect(result2.claudeMdAction).toBe("unchanged");
		// Version marker still at 1.0.0, not bumped.
		const marker = await readFile(result2.versionMarkerPath, "utf-8");
		expect(marker.trim()).toBe("1.0.0");
	});

	it("second run with --update refreshes everything", async () => {
		const { tmpDir, sourceDir } = await makeFixture();
		const target = join(tmpDir, "project");
		await mkdir(target, { recursive: true });

		await runInit({ targetDir: target, sourceDir, version: "1.0.0", log: () => {} });
		// Simulate a corpus update.
		await writeFile(join(sourceDir, "00-index.md"), "# index v2\n", "utf-8");
		await writeFile(join(sourceDir, "14-new-section.md"), "# new\n", "utf-8");

		const result2 = await runInit({
			targetDir: target,
			sourceDir,
			version: "2.0.0",
			update: true,
			log: () => {},
		});

		expect(result2.filesCopied).toBe(4);
		const refreshed = await readFile(join(result2.docsDir, "00-index.md"), "utf-8");
		expect(refreshed).toContain("v2");
		const marker = await readFile(result2.versionMarkerPath, "utf-8");
		expect(marker.trim()).toBe("2.0.0");
	});
});

describe("init: error cases", () => {
	it("throws when source corpus is missing", async () => {
		const tmpDir = await mkdtemp(join(tmpdir(), "volt-init-err-"));
		await expect(
			runInit({
				targetDir: tmpDir,
				sourceDir: join(tmpDir, "nonexistent"),
				log: () => {},
			}),
		).rejects.toThrow(/source corpus not found/i);
	});
});
