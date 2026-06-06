/**
 * `volt init` verb — bind a workspace folder to the IDE project the
 * bridge has open. Writes `<workspace>/.volt/config.json` and creates
 * an empty snapshot bare repo. Idempotent: re-running on an
 * already-init'd workspace verifies the binding still matches the
 * bridge's project and rewrites the config (a no-op when nothing
 * changed).
 *
 * The user runs this once per workspace dir, NOT once per session.
 * After `init`, `volt pull` / `volt push` / `volt status` / `volt
 * build` all just read the binding.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { detectVendor, installCorpus, type DetectedVendor } from "@opencode-ai/volt-lsp";
import { verifyProjectBinding } from "../engine/binding.js";
import { configExists, loadConfig, saveConfig, workspacePaths } from "../engine/config.js";
import { defaultExtensionAccess } from "../engine/extension-registry.js";
import { ensureGitignore, ensureSnapshotRepo, reportSnapshotHeal } from "../engine/snapshot.js";
import { writeWorkspaceScaffold } from "../scaffold/index.js";
import { flagBool, type VerbFn } from "./_shared.js";

export const init: VerbFn = async ({ workspace, port, bridge, flags }) => {
	const force = flagBool(flags, "force");
	const noScaffold = flagBool(flags, "no-scaffold");
	const root = resolve(workspace);
	const paths = workspacePaths(root);

	const health = await bridge.getHealth();
	// Reject null/empty too, not just undefined. Right after a TC
	// crash + reopen the bridge briefly reports projectName: null
	// (IDE process is up, project not yet loaded). Old code accepted
	// null, saved a config with `project.projectName: null`, and
	// downstream `volt pull` rejected it as "malformed 'project'" —
	// silent corruption.
	if (
		health.projectName === undefined || health.projectName === null || health.projectName === "" ||
		health.plcProjectName === undefined || health.plcProjectName === null || health.plcProjectName === ""
	) {
		throw new Error(
			"bridge has no project loaded — open a PLC project in the IDE before running `volt init` " +
				`(bridge reports projectName=${JSON.stringify(health.projectName)}, plcProjectName=${JSON.stringify(health.plcProjectName)})`,
		);
	}

	let alreadyInitialized = false;
	if (configExists(root)) {
		const existing = loadConfig(root);
		const check = verifyProjectBinding(existing, health);
		if (!check.ok && !force) {
			const m = check.mismatch;
			throw new Error(
				`workspace at ${root} is already bound to ${m.configuredAs.platform}/${m.configuredAs.projectName}/${m.configuredAs.plcProjectName}; ` +
					`bridge has ${m.bridgeReports.platform}/${m.bridgeReports.projectName}/${m.bridgeReports.plcProjectName}. ` +
					`re-run with --force to repoint.`,
			);
		}
		reportSnapshotHeal(ensureSnapshotRepo(paths.snapshotPath));
		ensureGitignore(root);
		// Force + mismatched project → fall through to overwrite the config.
		alreadyInitialized = check.ok;
	}

	if (!alreadyInitialized) {
		// Seed `extensionAccess` with every tracked extension's default
		// mode so the config is self-documenting from the start. The
		// engineer sees the full surface in `.volt/config.json` and can
		// flip any line to `"off"` (skip the extension entirely on
		// pull/push) or override `r ↔ rw` without needing to know which
		// extensions the registry tracks. Existing workspaces are
		// untouched (this branch only runs on a fresh init or
		// --force repoint).
		saveConfig(root, {
			bridge: { port },
			project: {
				platform: health.platform,
				projectName: health.projectName,
				plcProjectName: health.plcProjectName,
			},
			linkedAt: new Date().toISOString(),
			extensionAccess: defaultExtensionAccess(),
		});
		reportSnapshotHeal(ensureSnapshotRepo(paths.snapshotPath));
		ensureGitignore(root);
	}

	const corpus = await tryInstallCorpus(root, force);
	const detectedVendor = alreadyInitialized
		? undefined
		: await tryDetectVendor(root, health.platform);

	const scaffold = noScaffold
		? undefined
		: writeWorkspaceScaffold({
				root,
				plcProjectName: health.plcProjectName,
				agentVersion: readAgentVersion(),
				force,
			});

	const project = `${health.platform}/${health.projectName}/${health.plcProjectName}`;
	if (alreadyInitialized) {
		console.log(`workspace already initialized for ${project}`);
	} else {
		console.log(`initialized workspace for ${project}`);
		console.log("next: run `volt pull` to populate.");
	}
	if (corpus !== undefined && corpus.filesCopied > 0) {
		console.log(
			`Language reference: installed ${corpus.filesCopied} files; SKILL.md ${corpus.skillAction}.`,
		);
	}
	if (scaffold !== undefined && scaffold.created.length > 0) {
		console.log(
			`Scaffold: wrote ${scaffold.created.length} file(s) (${scaffold.skipped.length} already present).`,
		);
		console.log("next: run `bun install` in this folder to install dev dependencies.");
	}
	if (detectedVendor !== undefined) {
		console.log(`Detected vendor: ${detectedVendor}.`);
	}
	return 0;
};

/** Read this package's own `version` field so the scaffold can pin
 *  `@opencode-ai/volt-agent` in the workspace `package.json` to the
 *  exact version that wrote it. Failure → `"latest"` (rare, but the
 *  scaffold should still complete). */
function readAgentVersion(): string {
	try {
		const here = dirname(fileURLToPath(import.meta.url));
		// Compiled layout is `<pkg>/dist/cli/init.js`; walk two levels
		// up to find the package root. Dev layout is `<pkg>/src/cli/`
		// — same shape.
		const pkgPath = join(here, "..", "..", "package.json");
		const raw = readFileSync(pkgPath, "utf-8");
		const m = /"version"\s*:\s*"([^"]+)"/.exec(raw);
		return m?.[1] ?? "latest";
	} catch {
		return "latest";
	}
}

/**
 * Detect vendor from workspace files. Fall back to the bridge's
 * `platform` field as a hint (which is the most authoritative — the
 * bridge IS the vendor's IDE wrapper).
 */
async function tryDetectVendor(
	root: string,
	platform: string,
): Promise<DetectedVendor | undefined> {
	const plat = platform.toLowerCase();
	if (plat.includes("twincat") || plat.includes("beckhoff")) return "twincat";
	if (plat.includes("codesys")) return "codesys";
	try {
		return await detectVendor(root);
	} catch {
		return undefined;
	}
}

/**
 * Install (or refresh) the CODESYS reference corpus + SKILL.md in
 * the workspace. Failures are non-fatal — `volt init` should still
 * succeed when the corpus is unavailable (e.g. when the LSP package
 * is not installed in the workspace).
 */
async function tryInstallCorpus(
	root: string,
	update: boolean,
): Promise<{ filesCopied: number; skillAction: "created" | "updated" | "unchanged" } | undefined> {
	try {
		const r = await installCorpus({
			targetDir: root,
			update,
			log: () => {
				/* silenced; volt init formats its own output */
			},
		});
		return {
			filesCopied: r.filesCopied,
			skillAction: r.skillAction,
		};
	} catch (err) {
		console.warn(
			`warning: could not install CODESYS reference corpus: ${err instanceof Error ? err.message : String(err)}`,
		);
		return undefined;
	}
}
