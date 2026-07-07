/**
 * volt-git init — bind the workspace to the bridge's loaded project, git-init the project root, write
 * `.git/volt/config.json` + `.gitignore`/`.gitattributes`, scaffold the Cargo (Rust) project, install
 * the LSP language-reference corpus, and do the first pull.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { installCorpus, type DetectedVendor } from "@opencode-ai/volt-lsp-iec";
import type { Remote } from "./bridge/types.js";
import { configExists, saveConfig, type WorkspaceConfig } from "./config/workspace.js";
import { gitInit, isInsideRepo, commitAll } from "./git/plumbing.js";
import { writeWorkspaceScaffold } from "./scaffold.js";
import { pull } from "./sync/pull.js";
import { ensureGitignore } from "./workspace/files.js";

export type InitResult =
	| { kind: "ok"; project: string; gitCreated: boolean; pulled: number; scaffold: number; corpus: number; note?: string }
	| { kind: "error"; reason: string };

export async function init(workspace: string, bridge: Remote): Promise<InitResult> {
	const root = resolve(workspace);
	mkdirSync(root, { recursive: true });

	// Already bound? Refuse rather than silently re-pull+merge. A second `init` on a live workspace used to
	// stack `volt: IDE @` / `merge IDE @` commits (confusing history for no gain) — sync is `pull`'s job.
	if (configExists(root)) {
		return { kind: "error", reason: "this workspace is already initialized — run `volt-git pull` to sync with the IDE (to re-bind from scratch, delete .git/volt/config.json first)" };
	}

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

	const scaffold = writeWorkspaceScaffold(root, health.plcProjectName);
	const corpus = await tryInstallCorpus(root, vendorFor(health.platform));

	// The agent toolchain (LSP + `volt` tool + agent + theme + permissions) ships globally via
	// OPENCODE_CONFIG_DIR — set by the desktop and the `volt` binary at launch — so init no longer writes a
	// per-project `.opencode/`. It only binds the IDE project (above) + installs the vendor skills.

	const project = `${health.platform}/${health.projectName}/${health.plcProjectName}`;

	// Baseline commit: when we created the repo, commit the scaffold + corpus so init leaves a clean
	// repo with a real HEAD, and the first pull merges the IDE's src onto it. Never auto-commit into a
	// repo the user already manages.
	if (gitCreated) commitAll(root, `volt init: ${health.plcProjectName}`);

	const pulled = await pull(root, bridge);
	const base = { project, gitCreated, scaffold: scaffold.created.length, corpus };
	if (pulled.kind === "ok") return { kind: "ok", ...base, pulled: pulled.synced.length };
	return { kind: "ok", ...base, pulled: 0, note: pulled.kind === "refused" ? pulled.reason : "first pull hit a conflict — resolve and re-run" };
}

function vendorFor(platform: string): DetectedVendor {
	const p = platform.toLowerCase();
	return p.includes("twincat") || p.includes("beckhoff") ? "twincat" : "codesys";
}

async function tryInstallCorpus(root: string, vendor: DetectedVendor): Promise<number> {
	try {
		const r = await installCorpus({ targetDir: root, update: false, vendor, log: () => {} });
		return r.filesCopied;
	} catch (err) {
		console.warn(`warning: could not install the ST language reference: ${err instanceof Error ? err.message : String(err)}`);
		return 0;
	}
}
