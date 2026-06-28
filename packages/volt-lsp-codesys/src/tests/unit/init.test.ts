/**
 * Tests for `volt-lsp-codesys init`. Runs in a temp dir per test so
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

// ── TwinCAT vendor tests ────────────────────────────────────────────────────
//
// When vendor="twincat", runInit installs BOTH codesys-reference/ (the shared
// base — TC was forked from CODESYS) and twincat-reference/ (the deltas).
// The twincat-reference/ source lives at dirname(sourceDir)/twincat-reference,
// so the fixture must create that sibling directory alongside the codesys src.

async function makeTcFixture(): Promise<{ tmpDir: string; sourceDir: string }> {
	const tmpDir = await mkdtemp(join(tmpdir(), "volt-init-tc-"));
	const sourceDir = join(tmpDir, "src-docs");
	const sourceTcDir = join(tmpDir, "twincat-reference"); // sibling of src-docs
	await mkdir(sourceDir, { recursive: true });
	await mkdir(sourceTcDir, { recursive: true });
	// Fake CODESYS corpus.
	await writeFile(join(sourceDir, "00-index.md"), "# CODESYS index\n", "utf-8");
	await writeFile(join(sourceDir, "07-pragmas.md"), "# shared pragmas\n", "utf-8");
	// Fake TC corpus (deltas).
	await writeFile(join(sourceTcDir, "00-index.md"), "# TwinCAT index\n", "utf-8");
	await writeFile(join(sourceTcDir, "07-pragmas.md"), "# TC pragmas\n", "utf-8");
	return { tmpDir, sourceDir };
}

describe("init: TwinCAT vendor — installs both codesys-reference and twincat-reference", () => {
	it("copies CODESYS and TC files; filesCopied counts both", async () => {
		const { tmpDir, sourceDir } = await makeTcFixture();
		const target = join(tmpDir, "project");
		await mkdir(target, { recursive: true });

		const result = await runInit({
			targetDir: target,
			sourceDir,
			vendor: "twincat",
			version: "1.0.0",
			log: () => {},
		});

		expect(result.filesCopied).toBe(4); // 2 codesys + 2 TC
		const codesysFiles = await readdir(result.docsDir);
		expect(codesysFiles.sort()).toEqual(["00-index.md", "07-pragmas.md"]);
		const tcDir = join(target, ".claude/skills/st-reference/twincat-reference");
		const tcFiles = await readdir(tcDir);
		expect(tcFiles.sort()).toEqual(["00-index.md", "07-pragmas.md"]);
	});

	it("SKILL.md references twincat-reference/ sections and marks vendor: twincat", async () => {
		const { tmpDir, sourceDir } = await makeTcFixture();
		const target = join(tmpDir, "project");
		await mkdir(target, { recursive: true });

		const result = await runInit({
			targetDir: target,
			sourceDir,
			vendor: "twincat",
			version: "1.0.0",
			log: () => {},
		});

		const content = await readFile(result.skillPath, "utf-8");
		expect(content).toContain("twincat-reference/");
		expect(content).toContain("codesys-reference/");
		expect(content).toContain("vendor: twincat");
	});

	it("--update refreshes TC reference files", async () => {
		const { tmpDir, sourceDir } = await makeTcFixture();
		const target = join(tmpDir, "project");
		await mkdir(target, { recursive: true });

		await runInit({ targetDir: target, sourceDir, vendor: "twincat", version: "1.0.0", log: () => {} });
		// Add a new TC file in the source.
		const sourceTcDir = join(tmpDir, "twincat-reference");
		await writeFile(join(sourceTcDir, "13-error-messages.md"), "# errors\n", "utf-8");

		const result2 = await runInit({
			targetDir: target,
			sourceDir,
			vendor: "twincat",
			version: "2.0.0",
			update: true,
			log: () => {},
		});

		expect(result2.filesCopied).toBe(5); // 2 codesys + 3 TC
		const tcDir = join(target, ".claude/skills/st-reference/twincat-reference");
		const tcFiles = await readdir(tcDir);
		expect(tcFiles).toContain("13-error-messages.md");
	});
});

describe("init: CODESYS vendor (default) — installs only codesys-reference", () => {
	it("does not create twincat-reference/ dir", async () => {
		const { tmpDir, sourceDir } = await makeFixture();
		const target = join(tmpDir, "project");
		await mkdir(target, { recursive: true });

		await runInit({ targetDir: target, sourceDir, vendor: "codesys", version: "1.0.0", log: () => {} });

		const tcDir = join(target, ".claude/skills/st-reference/twincat-reference");
		let exists = false;
		try {
			await stat(tcDir);
			exists = true;
		} catch { /* expected */ }
		expect(exists).toBe(false);
	});

	it("SKILL.md does not mention twincat-reference", async () => {
		const { tmpDir, sourceDir } = await makeFixture();
		const target = join(tmpDir, "project");
		await mkdir(target, { recursive: true });

		const result = await runInit({ targetDir: target, sourceDir, vendor: "codesys", version: "1.0.0", log: () => {} });

		const content = await readFile(result.skillPath, "utf-8");
		expect(content).not.toContain("twincat-reference");
		expect(content).toContain("vendor: codesys");
	});

	it("omitting vendor defaults to CODESYS-only install", async () => {
		const { tmpDir, sourceDir } = await makeFixture();
		const target = join(tmpDir, "project");
		await mkdir(target, { recursive: true });

		const result = await runInit({ targetDir: target, sourceDir, version: "1.0.0", log: () => {} });

		expect(result.filesCopied).toBe(3);
	});
});

describe("init: missing TC source is non-fatal for TC vendor", () => {
	it("succeeds with CODESYS-only install when twincat-reference/ source is absent", async () => {
		// makeFixture creates only the codesys source dir — no twincat-reference sibling.
		const { tmpDir, sourceDir } = await makeFixture();
		const target = join(tmpDir, "project");
		await mkdir(target, { recursive: true });

		// Must not throw — init.ts catches the missing-TC-dir case and logs a warning.
		const result = await runInit({
			targetDir: target,
			sourceDir,
			vendor: "twincat",
			version: "1.0.0",
			log: () => {},
		});

		expect(result.filesCopied).toBe(3); // CODESYS only
		const tcDir = join(target, ".claude/skills/st-reference/twincat-reference");
		let exists = false;
		try {
			await stat(tcDir);
			exists = true;
		} catch { /* expected */ }
		expect(exists).toBe(false);
	});
});
