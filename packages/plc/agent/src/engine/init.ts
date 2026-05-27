/**
 * `plc init` — bind a workspace folder to the IDE project the bridge
 * has open. Writes `<workspace>/.plcassist/config.json` and creates an
 * empty snapshot bare repo. Idempotent: re-running on an already-init'd
 * workspace verifies the binding still matches the bridge's project
 * and rewrites the config (a no-op when nothing changed).
 *
 * The user runs this once per workspace dir, NOT once per session.
 * After `init`, `plc import` / `plc export` / `plc status` / `plc compile`
 * all just read the binding.
 */
import { resolve } from "node:path";
import { detectVendor, installCorpus, type DetectedVendor } from "@opencode-ai/plc-lsp-st";
import { BridgeClient } from "../bridge/client.js";
import { configExists, loadConfig, saveConfig, workspacePaths } from "./config.js";
import { ensureGitignore, ensureSnapshotRepo } from "./snapshot.js";

export interface InitOptions {
	/**
	 * Allow re-init with a different project than the existing
	 * config points at. Default behavior refuses to overwrite a
	 * mismatched binding to avoid accidentally re-pointing a
	 * workspace at the wrong IDE project.
	 */
	force?: boolean;
}

export interface InitResult {
	platform: string;
	projectName: string;
	plcProjectName: string;
	/** True if this was a no-op re-init of an already-bound workspace. */
	alreadyInitialized: boolean;
	/** Corpus installation outcome — `undefined` if the install was skipped. */
	corpus?: {
		filesCopied: number;
		claudeMdAction: "created" | "appended" | "unchanged";
	};
	/** Detected vendor, or undefined if no signal found (caller falls back to platform default). */
	detectedVendor?: DetectedVendor;
}

export async function runInit(
	workspaceRoot: string,
	bridge: BridgeClient,
	bridgePort: number,
	opts: InitOptions = {},
): Promise<InitResult> {
	const root = resolve(workspaceRoot);
	const paths = workspacePaths(root);

	const health = await bridge.getHealth();
	if (health.projectName === undefined || health.plcProjectName === undefined) {
		throw new Error(
			"bridge has no project loaded — open a PLC project in the IDE before running `plc init`",
		);
	}

	if (configExists(root)) {
		const existing = loadConfig(root);
		const sameProject =
			existing.project.platform === health.platform &&
			existing.project.projectName === health.projectName &&
			existing.project.plcProjectName === health.plcProjectName;
		if (!sameProject && !opts.force) {
			throw new Error(
				`workspace at ${root} is already bound to ${existing.project.platform}/${existing.project.projectName}/${existing.project.plcProjectName}; ` +
					`bridge has ${health.platform}/${health.projectName}/${health.plcProjectName}. ` +
					`re-run with --force to repoint.`,
			);
		}
		ensureSnapshotRepo(paths.snapshotPath);
		ensureGitignore(root);
		if (sameProject) {
			const corpus = await tryInstallCorpus(root, opts.force === true);
			return {
				platform: existing.project.platform,
				projectName: existing.project.projectName,
				plcProjectName: existing.project.plcProjectName,
				alreadyInitialized: true,
				...(corpus !== undefined ? { corpus } : {}),
			};
		}
		// fall through to overwrite when --force + mismatched project
	}

	saveConfig(root, {
		bridge: { port: bridgePort },
		project: {
			platform: health.platform,
			projectName: health.projectName,
			plcProjectName: health.plcProjectName,
		},
		linkedAt: new Date().toISOString(),
	});
	ensureSnapshotRepo(paths.snapshotPath);
	ensureGitignore(root);

	const corpus = await tryInstallCorpus(root, opts.force === true);
	const vendorHint = await tryDetectVendor(root, health.platform);

	return {
		platform: health.platform,
		projectName: health.projectName,
		plcProjectName: health.plcProjectName,
		alreadyInitialized: false,
		...(corpus !== undefined ? { corpus } : {}),
		...(vendorHint !== undefined ? { detectedVendor: vendorHint } : {}),
	};
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
	// Platform string from bridge is the strongest signal.
	const plat = platform.toLowerCase();
	if (plat.includes("twincat") || plat.includes("beckhoff")) return "twincat";
	if (plat.includes("codesys")) return "codesys";
	// Fall back to filesystem scan.
	try {
		return await detectVendor(root);
	} catch {
		return undefined;
	}
}

/**
 * Install (or refresh) the CODESYS reference corpus + CLAUDE.md
 * pointer in the workspace. Failures are non-fatal — `plc init`
 * should still succeed when the corpus is unavailable (e.g. when
 * the LSP package is not installed in the workspace).
 */
async function tryInstallCorpus(
	root: string,
	update: boolean,
): Promise<InitResult["corpus"]> {
	try {
		const r = await installCorpus({
			targetDir: root,
			update,
			log: () => {
				/* silenced; plc init formats its own output */
			},
		});
		return {
			filesCopied: r.filesCopied,
			claudeMdAction: r.claudeMdAction,
		};
	} catch (err) {
		// Surface as a warning, don't fail the init.
		console.warn(
			`warning: could not install CODESYS reference corpus: ${err instanceof Error ? err.message : String(err)}`,
		);
		return undefined;
	}
}
