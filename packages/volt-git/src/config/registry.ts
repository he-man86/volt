/**
 * Reverse workspace registry — a machine-local index mapping a live bridge (its port + the IDE project loaded
 * on it) BACK to the workspace root that binds it.
 *
 * The per-repo binding (`.git/volt/config.json`, see ./workspace) records workspace → bridge, which is not
 * reverse-resolvable. The Volt connector owns the IDE-changes panel but only knows its live IDE — not which git
 * repo maps to it. So `volt-git` upserts an entry here on every bridge-touching command (init/pull/push/status),
 * and the connector reads it to answer "for the project on port N, which workspace?" and then shells `volt-git`.
 *
 * Location: `%LOCALAPPDATA%\Volt\workspaces.json` — Volt machine-local, beside the VoltLog store. Windows-only
 * product; falls back to the OS home dir when LOCALAPPDATA is unset (tests / non-Windows CI). Override the dir
 * with `VOLT_REGISTRY_DIR` (tests).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { loadConfig } from "./workspace.js";

export interface WorkspaceEntry {
	root: string; // absolute workspace path
	port: number; // the bound bridge port
	platform: string; // "codesys" | "twincat"
	projectName: string; // the IDE project bound to this workspace
	lastSeen: string; // ISO timestamp of the last bridge-touching command that recorded it
}

/** The registry file path. `VOLT_REGISTRY_DIR` overrides the containing dir (tests). */
export function registryPath(): string {
	const base = process.env.VOLT_REGISTRY_DIR ?? process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
	return process.env.VOLT_REGISTRY_DIR ? join(base, "workspaces.json") : join(base, "Volt", "workspaces.json");
}

/** Raw read — every recorded entry, unfiltered. Missing/malformed file ⇒ empty (never throws). */
export function entries(): WorkspaceEntry[] {
	try {
		const raw = JSON.parse(readFileSync(registryPath(), "utf-8"));
		return Array.isArray(raw) ? (raw as WorkspaceEntry[]) : [];
	} catch {
		return [];
	}
}

function writeAll(list: WorkspaceEntry[]): void {
	const p = registryPath();
	try {
		mkdirSync(dirname(p), { recursive: true });
		writeFileSync(p, JSON.stringify(list, null, 2) + "\n");
	} catch {
		/* best-effort: the registry is a convenience index, never critical to a sync operation */
	}
}

/** Insert/replace the entry for `entry.root` (one per workspace), and prune any entry whose root no longer
 *  exists — so the registry self-cleans on every write. */
export function upsert(entry: WorkspaceEntry): void {
	const kept = entries().filter((e) => e.root !== entry.root && existsSync(e.root));
	kept.push(entry);
	writeAll(kept);
}

/** Record this workspace from its binding config. No-op if it isn't a bound Volt workspace yet. Call from
 *  every bridge-touching command so the reverse index stays current. */
export function recordWorkspace(root: string): void {
	let cfg;
	try {
		cfg = loadConfig(root);
	} catch {
		return; // not an initialized/bound workspace — nothing to record
	}
	upsert({
		root: resolve(root),
		port: cfg.bridge.port,
		platform: cfg.project.platform,
		projectName: cfg.project.projectName,
		lastSeen: new Date().toISOString(),
	});
}

/** The workspace bound to the live bridge on `port` (optionally requiring a matching `projectName`): the
 *  most-recently-seen entry whose root still exists. Read-only. */
export function resolveWorkspace(port: number, projectName?: string): string | undefined {
	return entries()
		.filter((e) => e.port === port && existsSync(e.root) && (projectName === undefined || e.projectName === projectName))
		.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))[0]?.root;
}

/** Every entry whose root still exists (dead ones filtered). Read-only. */
export function knownWorkspaces(): WorkspaceEntry[] {
	return entries().filter((e) => existsSync(e.root));
}
