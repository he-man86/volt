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
import { gitInit, isInsideRepo, commitAll, headCommit, currentBranch, readTreeToIndex, resolveGitDir, updateRef } from "./git/plumbing.js";
import { materializeItem } from "./translate/materialize.js";
import { writeSrcFiles } from "./workspace/files.js";
import { writeWorkspaceScaffold } from "./scaffold.js";
import { buildVoltIdeTree, commitVoltIde, RANGE, saveIdeRefs } from "./sync/refs.js";
import { ensureGitignore } from "./workspace/files.js";

export type InitResult =
	| { kind: "ok"; project: string; gitCreated: boolean; pulled: number; scaffold: number; corpus: number; note?: string }
	| { kind: "error"; reason: string };

export async function init(workspace: string, bridge: Remote): Promise<InitResult> {
	const root = resolve(workspace);
	mkdirSync(root, { recursive: true });

	if (configExists(root)) {
		return { kind: "error", reason: "this workspace is already initialized — run `volt pull` to sync with the IDE (to re-bind from scratch, delete .git/volt/config.json first)" };
	}

	const health = await bridge.getHealth();
	if (health.projectName === undefined || health.projectName === null || health.projectName === "") {
		return { kind: "error", reason: "the bridge has no PLC project loaded — open a project in the IDE before `volt init`" };
	}

	const gitCreated = !isInsideRepo(root);
	if (gitCreated) gitInit(root);
	ensureGitignore(root);

	const cfg: WorkspaceConfig = {
		bridge: { port: bridge.port },
		project: { platform: health.platform, projectName: health.projectName },
		linkedAt: new Date().toISOString(),
	};
	saveConfig(root, cfg);

	const scaffold = writeWorkspaceScaffold(root, health.projectName ?? "");
	const corpus = await tryInstallCorpus(root, vendorFor(health.platform));
	const project = `${health.platform}/${health.projectName}`;

	if (gitCreated) commitAll(root, `volt init: ${health.projectName}`);

	const fetched = await bridge.init();
	const ideFiles = fetched.changed.flatMap(materializeItem);
	const gitDir = resolveGitDir(root);
	const head = headCommit(root);

	// Seed the workspace with the IDE's files.
	const tree = buildVoltIdeTree(gitDir, head ?? undefined, ideFiles, []);
	const commit = commitVoltIde(gitDir, tree, head ?? undefined, `volt: IDE @ ${fetched.projectVersion}`);
	updateRef(gitDir, RANGE, commit);
	writeSrcFiles(root, ideFiles);
	readTreeToIndex(root, commit);
	updateRef(gitDir, `refs/heads/${currentBranch(root) ?? "main"}`, commit);

	saveIdeRefs(root, { projectVersion: fetched.projectVersion, items: fetched.items, folders: fetched.folders });
	return { kind: "ok", project, gitCreated, pulled: ideFiles.length, scaffold: scaffold.created.length, corpus };
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
