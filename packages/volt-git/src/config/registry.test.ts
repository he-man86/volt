/**
 * Reverse workspace registry — the read/write/resolve/prune logic (no git repo needed; entries are written
 * directly). The git-binding-derived `recordWorkspace` is covered by the sync integration tests.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { entries, knownWorkspaces, resolveWorkspace, upsert, type WorkspaceEntry } from "./registry.js";

let dir: string;
const roots: string[] = [];

const entry = (root: string, port: number, project: string, lastSeen: string): WorkspaceEntry => ({
	root,
	port,
	platform: "codesys",
	projectName: project,
	lastSeen,
});

/** A real temp dir to stand in for a workspace root (so `existsSync` passes). */
function root(name: string): string {
	const p = mkdtempSync(join(dir, name + "-"));
	roots.push(p);
	return p;
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "volt-reg-"));
	process.env.VOLT_REGISTRY_DIR = dir;
	roots.length = 0;
});
afterEach(() => {
	delete process.env.VOLT_REGISTRY_DIR;
	rmSync(dir, { recursive: true, force: true });
});

test("upsert then read round-trips", () => {
	const a = root("a");
	upsert(entry(a, 8556, "Conveyor", "2026-07-12T10:00:00Z"));
	expect(entries()).toEqual([entry(a, 8556, "Conveyor", "2026-07-12T10:00:00Z")]);
});

test("upsert replaces the entry for the same root (one per workspace)", () => {
	const a = root("a");
	upsert(entry(a, 8556, "Conveyor", "2026-07-12T10:00:00Z"));
	upsert(entry(a, 8556, "Conveyor", "2026-07-12T11:00:00Z"));
	expect(entries()).toHaveLength(1);
	expect(entries()[0].lastSeen).toBe("2026-07-12T11:00:00Z");
});

test("resolveWorkspace returns the most-recent entry for a port", () => {
	const a = root("a");
	const b = root("b");
	upsert(entry(a, 8556, "Old", "2026-07-12T10:00:00Z"));
	upsert(entry(b, 8556, "New", "2026-07-12T12:00:00Z"));
	expect(resolveWorkspace(8556)).toBe(b);
});

test("resolveWorkspace can require a matching project name", () => {
	const a = root("a");
	const b = root("b");
	upsert(entry(a, 8556, "Conveyor", "2026-07-12T10:00:00Z"));
	upsert(entry(b, 8556, "Palletizer", "2026-07-12T12:00:00Z"));
	expect(resolveWorkspace(8556, "Conveyor")).toBe(a);
	expect(resolveWorkspace(8555, "Conveyor")).toBeUndefined(); // wrong port
});

test("a dead root is pruned on the next write and never resolved", () => {
	const a = root("a");
	const gone = root("gone");
	upsert(entry(a, 8556, "A", "2026-07-12T10:00:00Z"));
	upsert(entry(gone, 8556, "Gone", "2026-07-12T11:00:00Z"));
	rmSync(gone, { recursive: true, force: true }); // workspace deleted
	expect(existsSync(gone)).toBe(false);
	expect(resolveWorkspace(8556)).toBe(a); // gone is skipped (root missing)
	expect(knownWorkspaces().map((e) => e.root)).toEqual([a]);
	upsert(entry(a, 8556, "A", "2026-07-12T12:00:00Z")); // any write self-prunes the dead entry
	expect(entries().map((e) => e.root)).toEqual([a]);
});
