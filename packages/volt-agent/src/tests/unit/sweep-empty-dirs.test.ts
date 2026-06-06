import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sweepEmptyDirs } from "../../engine/snapshot.js";

function fresh(): string {
	const root = mkdtempSync(join(tmpdir(), "volt-sweep-"));
	// sweepEmptyDirs walks `<root>/src/` (the IDE-synced subtree); pre-
	// create it so each test only worries about its inner setup.
	mkdirSync(join(root, "src"));
	return root;
}

describe("sweepEmptyDirs", () => {
	test("removes a top-level empty directory under src/", () => {
		const root = fresh();
		try {
			mkdirSync(join(root, "src/Alarm Configuration"));
			const removed = sweepEmptyDirs(root);
			expect(removed).toContain("Alarm Configuration");
			expect(existsSync(join(root, "src/Alarm Configuration"))).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("removes a deeply nested empty subtree (leaves up)", () => {
		const root = fresh();
		try {
			mkdirSync(join(root, "src/Device/Plc Logic/Application/Stale"), { recursive: true });
			const removed = sweepEmptyDirs(root);
			// Both the leaf and any intermediate dirs that became empty
			// after the leaf went away should be swept.
			expect(removed).toContain("Device/Plc Logic/Application/Stale");
			expect(existsSync(join(root, "src/Device/Plc Logic/Application/Stale"))).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("keeps directories that contain files (anywhere in subtree)", () => {
		const root = fresh();
		try {
			mkdirSync(join(root, "src/Device/Plc Logic/Application"), { recursive: true });
			writeFileSync(join(root, "src/Device/Plc Logic/Application/PLC_PRG.st"), "PROGRAM x END_PROGRAM\n");
			const removed = sweepEmptyDirs(root);
			expect(removed).toEqual([]);
			expect(existsSync(join(root, "src/Device/Plc Logic/Application/PLC_PRG.st"))).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("keeps engineer folders backed by a .gitkeep marker", () => {
		const root = fresh();
		try {
			// Mirrors what the bridge's `kind=folder` items produce when an
			// engineer creates an empty named folder in the IDE.
			mkdirSync(join(root, "src/Device/Plc Logic/Application/folder"), { recursive: true });
			writeFileSync(join(root, "src/Device/Plc Logic/Application/folder/.gitkeep"), "");
			const removed = sweepEmptyDirs(root);
			expect(removed).toEqual([]);
			expect(existsSync(join(root, "src/Device/Plc Logic/Application/folder/.gitkeep"))).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("never touches siblings of src/ at the workspace root", () => {
		const root = fresh();
		try {
			// Sweep only walks src/; tooling files / state at the workspace
			// root (`.volt/`, `.git/`, `node_modules/`, `package.json`)
			// are by definition out of scope.
			mkdirSync(join(root, ".volt/snapshot/objects"), { recursive: true });
			mkdirSync(join(root, ".git/objects"), { recursive: true });
			mkdirSync(join(root, "node_modules/foo"), { recursive: true });
			const removed = sweepEmptyDirs(root);
			expect(removed).toEqual([]);
			expect(existsSync(join(root, ".volt/snapshot/objects"))).toBe(true);
			expect(existsSync(join(root, ".git/objects"))).toBe(true);
			expect(existsSync(join(root, "node_modules/foo"))).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
