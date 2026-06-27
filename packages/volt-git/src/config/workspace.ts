/**
 * Workspace config — the bridge binding (which bridge + which IDE project this workspace is linked to).
 * Volt's machine-local state lives INSIDE the repo at `.git/volt/` — right next to the `refs/volt/ide`
 * ref it already keeps there — so a Volt workspace has no visible `.volt/` directory. The git-native
 * sidecar (`.git/volt/ide-refs.json`) lives alongside the config but is owned by sync/refs.ts.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { HealthResponse } from "../bridge/types.js";
import { resolveGitDir } from "../git/plumbing.js";

export interface WorkspacePaths {
	root: string;
	stateDir: string; // <git-dir>/volt/
	configPath: string; // <git-dir>/volt/config.json
	ideRefsPath: string; // <git-dir>/volt/ide-refs.json  (the git-native sidecar baseline)
}

/** Volt's state paths, resolved under the repo's git dir. Throws if `root` isn't a git repo yet — only
 *  `configExists` runs before `git init`, and it guards for that. */
export function workspacePaths(root: string): WorkspacePaths {
	const stateDir = join(resolveGitDir(root), "volt");
	return {
		root: resolve(root),
		stateDir,
		configPath: join(stateDir, "config.json"),
		ideRefsPath: join(stateDir, "ide-refs.json"),
	};
}

export interface WorkspaceConfig {
	bridge: { port: number };
	project: { platform: string; projectName: string; plcProjectName: string };
	linkedAt: string;
}

export function configExists(root: string): boolean {
	try {
		return existsSync(workspacePaths(root).configPath);
	} catch {
		return false; // not a git repo yet → not an initialized Volt workspace
	}
}

export function loadConfig(root: string): WorkspaceConfig {
	const cfg = JSON.parse(readFileSync(workspacePaths(root).configPath, "utf-8")) as Partial<WorkspaceConfig>;
	if (
		cfg.bridge?.port === undefined ||
		cfg.project?.platform === undefined ||
		cfg.project?.projectName === undefined ||
		cfg.project?.plcProjectName === undefined
	) {
		throw new Error(".git/volt/config.json is malformed — re-run `volt-git init`");
	}
	return cfg as WorkspaceConfig;
}

export function saveConfig(root: string, cfg: WorkspaceConfig): void {
	const p = workspacePaths(root);
	mkdirSync(p.stateDir, { recursive: true });
	writeFileSync(p.configPath, JSON.stringify(cfg, null, 2) + "\n");
}

/** undefined when the bridge's loaded project matches this workspace's binding; else an error string. */
export function verifyBinding(cfg: WorkspaceConfig, health: HealthResponse): string | undefined {
	const proj = health.projectName ?? "";
	const plc = health.plcProjectName ?? "";
	if (proj !== cfg.project.projectName || plc !== cfg.project.plcProjectName) {
		return `bridge is on ${health.platform}/${proj}/${plc}, but this workspace is bound to ${cfg.project.platform}/${cfg.project.projectName}/${cfg.project.plcProjectName} — open the bound project in the IDE`;
	}
	return undefined;
}

export function configuredBridgePort(root: string): number | undefined {
	try {
		return loadConfig(root).bridge.port;
	} catch {
		return undefined;
	}
}
