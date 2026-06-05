import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sweepEmptyDirs } from "../../engine/snapshot.js";

function fresh(): string {
	return mkdtempSync(join(tmpdir(), "volt-sweep-"));
}

describe("sweepEmptyDirs", () => {
	test("removes a top-level empty directory", () => {
		const root = fresh();
		try {
			mkdirSync(join(root, "Alarm Configuration"));
			const removed = sweepEmptyDirs(root);
			expect(removed).toContain("Alarm Configuration");
			expect(existsSync(join(root, "Alarm Configuration"))).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("removes a deeply nested empty subtree (leaves up)", () => {
		const root = fresh();
		try {
			mkdirSync(join(root, "Device/Plc Logic/Application/Stale"), { recursive: true });
			const removed = sweepEmptyDirs(root);
			// Both the leaf and any intermediate dirs that became empty
			// after the leaf went away should be swept.
			expect(removed).toContain("Device/Plc Logic/Application/Stale");
			expect(existsSync(join(root, "Device/Plc Logic/Application/Stale"))).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("keeps directories that contain files (anywhere in subtree)", () => {
		const root = fresh();
		try {
			mkdirSync(join(root, "Device/Plc Logic/Application"), { recursive: true });
			writeFileSync(join(root, "Device/Plc Logic/Application/PLC_PRG.st"), "PROGRAM x END_PROGRAM\n");
			const removed = sweepEmptyDirs(root);
			expect(removed).toEqual([]);
			expect(existsSync(join(root, "Device/Plc Logic/Application/PLC_PRG.st"))).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("keeps engineer folders backed by a .gitkeep marker", () => {
		const root = fresh();
		try {
			// Mirrors what the bridge's `kind=folder` items produce when an
			// engineer creates an empty named folder in the IDE.
			mkdirSync(join(root, "Device/Plc Logic/Application/folder"), { recursive: true });
			writeFileSync(join(root, "Device/Plc Logic/Application/folder/.gitkeep"), "");
			const removed = sweepEmptyDirs(root);
			expect(removed).toEqual([]);
			expect(existsSync(join(root, "Device/Plc Logic/Application/folder/.gitkeep"))).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("never touches .volt or .git at the root", () => {
		const root = fresh();
		try {
			mkdirSync(join(root, ".volt/snapshot/objects"), { recursive: true });
			mkdirSync(join(root, ".git/objects"), { recursive: true });
			const removed = sweepEmptyDirs(root);
			expect(removed).toEqual([]);
			expect(existsSync(join(root, ".volt/snapshot/objects"))).toBe(true);
			expect(existsSync(join(root, ".git/objects"))).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
