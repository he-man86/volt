/**
 * volt-git init — bind the workspace to the bridge's loaded project, git-init the project root, write
 * `.volt/config.json` + `.gitignore`/`.gitattributes`, scaffold the Bun project, install the LSP
 * language-reference corpus, and do the first pull.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installCorpus, type DetectedVendor } from "@opencode-ai/volt-lsp";
import type { Remote } from "./bridge/types.js";
import { saveConfig, type WorkspaceConfig } from "./config/workspace.js";
import { gitInit, isInsideRepo } from "./git/plumbing.js";
import { writeWorkspaceScaffold } from "./scaffold.js";
import { pull } from "./sync/pull.js";
import { ensureGitignore } from "./workspace/files.js";

export type InitResult =
	| { kind: "ok"; project: string; gitCreated: boolean; pulled: number; scaffold: number; corpus: number; note?: string }
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

	const scaffold = writeWorkspaceScaffold(root, health.plcProjectName, agentVersion());
	const corpus = await tryInstallCorpus(root, vendorFor(health.platform));

	const project = `${health.platform}/${health.projectName}/${health.plcProjectName}`;
	const pulled = await pull(root, bridge);
	const base = { project, gitCreated, scaffold: scaffold.created.length, corpus };
	if (pulled.kind === "ok") return { kind: "ok", ...base, pulled: pulled.synced.length };
	return { kind: "ok", ...base, pulled: 0, note: pulled.kind === "refused" ? pulled.reason : "first pull hit a conflict — resolve and re-run" };
}

function agentVersion(): string {
	try {
		const pkg = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf-8");
		return /"version"\s*:\s*"([^"]+)"/.exec(pkg)?.[1] ?? "0.1.0";
	} catch {
		return "0.1.0";
	}
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
