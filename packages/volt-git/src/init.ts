/**
 * volt-git init — bind the workspace to the bridge's loaded project, git-init the project root (the
 * user-facing repo), write `.volt/config.json` + `.gitignore`/`.gitattributes`, and do the first pull.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Remote } from "./bridge/types.js";
import { saveConfig, type WorkspaceConfig } from "./config/workspace.js";
import { gitInit, isInsideRepo } from "./git/plumbing.js";
import { pull } from "./sync/pull.js";
import { ensureGitignore } from "./workspace/files.js";

export type InitResult =
	| { kind: "ok"; project: string; gitCreated: boolean; pulled: number; note?: string }
	| { kind: "error"; reason: string };

export async function init(workspace: string, bridge: Remote): Promise<InitResult> {
	const root = resolve(workspace);
	mkdirSync(root, { recursive: true });

	const health = await bridge.getHealth();
	if (health.projectName === undefined || health.projectName === null || health.projectName === "" || health.plcProjectName === undefined || health.plcProjectName === null || health.plcProjectName === "") {
		return { kind: "error", reason: "the bridge has no PLC project loaded — open a project in the IDE before `volt-git init`" };
	}

	// git-init the project root (skip if already inside a repo, e.g. a clone or monorepo).
	const gitCreated = !isInsideRepo(root);
	if (gitCreated) gitInit(root);
	ensureGitignore(root);

	const cfg: WorkspaceConfig = {
		bridge: { port: bridge.port },
		project: { platform: health.platform, projectName: health.projectName, plcProjectName: health.plcProjectName },
		linkedAt: new Date().toISOString(),
	};
	saveConfig(root, cfg);

	const project = `${health.platform}/${health.projectName}/${health.plcProjectName}`;
	const pulled = await pull(root, bridge);
	if (pulled.kind === "ok") return { kind: "ok", project, gitCreated, pulled: pulled.synced.length };
	return { kind: "ok", project, gitCreated, pulled: 0, note: pulled.kind === "refused" ? pulled.reason : "first pull hit a conflict — resolve and re-run" };
}
