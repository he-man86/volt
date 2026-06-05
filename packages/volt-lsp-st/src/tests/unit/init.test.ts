/**
 * Tests for `volt-lsp-st init`. Runs in a temp dir per test so
 * file-system side-effects don't bleed.
 */
import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../init.js";

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

	it("creates SKILL.md at .claude/skills/st-reference/ when none exists", async () => {
		const { tmpDir, sourceDir } = await makeFixture();
		const target = join(tmpDir, "project");
		await mkdir(target, { recursive: true });

		const result = await runInit({ targetDir: target, sourceDir, version: "9.9.9", log: () => {} });

		expect(result.skillAction).toBe("created");
		expect(result.skillPath).toBe(join(target, ".claude/skills/st-reference/SKILL.md"));
		const content = await readFile(result.skillPath, "utf-8");
		expect(content).toContain("name: st-reference");
		expect(content).toContain("description:");
		expect(content).toContain(".claude/skills/st-reference/codesys-reference/");
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

describe("init: existing SKILL.md", () => {
	it("overwrites existing SKILL.md on --update with canonical template", async () => {
		const { tmpDir, sourceDir } = await makeFixture();
		const target = join(tmpDir, "project");
		await mkdir(join(target, ".claude/skills/st-reference"), { recursive: true });
		await writeFile(
			join(target, ".claude/skills/st-reference/SKILL.md"),
			"---\nname: st-reference\ndescription: old\n---\n\nstale content\n",
			"utf-8",
		);

		const result = await runInit({ targetDir: target, sourceDir, version: "9.9.9", update: true, log: () => {} });

		expect(result.skillAction).toBe("updated");
		const content = await readFile(result.skillPath, "utf-8");
		expect(content).not.toContain("stale content");
		expect(content).toContain("name: st-reference");
		expect(content).toContain("FB_Init");
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
		expect(result2.skillAction).toBe("unchanged");
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
		expect(result2.skillAction).toBe("updated");
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
