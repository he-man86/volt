/**
 * Workspace binding — links a local folder to a specific PLC IDE
 * project on a specific bridge. Stored as JSON at
 * `<workspace>/.volt/config.json`.
 *
 * The binding is created by `volt init`, read by every other `volt` verb,
 * and is the one source of truth for "which IDE project does this
 * workspace talk to?" — no environment variables, no implicit cwd
 * detection beyond looking up the `.volt/` directory.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Schema version of the on-disk config — bump when the shape changes. */
const SCHEMA_VERSION = 1;

export interface WorkspaceConfig {
	schemaVersion: number;
	bridge: {
		/** Loopback HTTP port the bridge listens on. */
		port: number;
	};
	project: {
		/** Vendor identifier from /health.platform (e.g. "beckhoff", "codesys"). */
		platform: string;
		/** Solution-level project name (e.g. TwinCAT's `.tsproj` name). */
		projectName: string;
		/** PLC-project-within-solution name (e.g. TwinCAT's `Untitled2`). */
		plcProjectName: string;
	};
	/**
	 * Per-extension push policy. Controls which file extensions
	 * `volt push` is allowed to send to the bridge. Files with
	 * extensions NOT in `allowExtensions` are PULLED normally (so
	 * AI can read them for context) but REFUSED at push time with
	 * a clear error.
	 *
	 * Default (when absent or empty): `[".st", ".gvl", ".dut", ".itf"]`
	 * — only ST-grammar files are pushable; graphical bodies,
	 * device descriptions, recipes, trace configs, alarms etc. are
	 * implicitly read-only.
	 *
	 * The user can opt extensions in by editing `.volt/config.json`
	 * directly — the schema is intentionally simple.
	 *
	 * This guard is INDEPENDENT of the graphical-body-edit guard
	 * (see push.ts), which catches body-XML changes within
	 * declaration-pushable graphical files. The two guards
	 * compose: graphical files might allow declaration changes
	 * (depending on this list) but never body changes (per the
	 * graphical read-only contract).
	 */
	pushPolicy?: {
		/** File extensions (with leading dot) that `volt push` may send. Empty or missing = use defaults. */
		allowExtensions: string[];
	};
	/** ISO timestamp of `volt init`. Informational. */
	linkedAt: string;
}

/** Default push allowlist — ST-grammar files only. */
export const DEFAULT_PUSH_ALLOW_EXTENSIONS: readonly string[] = [
	".st",
	".gvl",
	".dut",
	".itf",
];

/**
 * Return the effective push allowlist for a workspace's config.
 * Single source of truth used by `volt push` and tests.
 */
export function effectivePushAllowExtensions(cfg: WorkspaceConfig): readonly string[] {
	const allow = cfg.pushPolicy?.allowExtensions;
	if (allow === undefined || allow.length === 0) return DEFAULT_PUSH_ALLOW_EXTENSIONS;
	// Normalize: lowercase + ensure leading dot.
	return allow.map((e) => {
		const lower = e.toLowerCase().trim();
		return lower.startsWith(".") ? lower : `.${lower}`;
	});
}

export interface WorkspacePaths {
	/** Absolute path to the workspace root. */
	root: string;
	/** Absolute path to the hidden `.volt/` directory. */
	stateDir: string;
	/** Absolute path to the config JSON file. */
	configPath: string;
	/** Absolute path to the hidden snapshot bare git repo. */
	snapshotPath: string;
}

export function workspacePaths(workspaceRoot: string): WorkspacePaths {
	const root = resolve(workspaceRoot);
	const stateDir = join(root, ".volt");
	return {
		root,
		stateDir,
		configPath: join(stateDir, "config.json"),
		snapshotPath: join(stateDir, "snapshot"),
	};
}

export function configExists(workspaceRoot: string): boolean {
	return existsSync(workspacePaths(workspaceRoot).configPath);
}

export function loadConfig(workspaceRoot: string): WorkspaceConfig {
	const { configPath, root } = workspacePaths(workspaceRoot);
	if (!existsSync(configPath)) {
		throw new Error(
			`no volt workspace at ${root} (missing .volt/config.json) — run \`volt init\` first`,
		);
	}
	const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as Partial<WorkspaceConfig>;
	if (parsed.schemaVersion !== SCHEMA_VERSION) {
		throw new Error(
			`workspace config at ${configPath} has schemaVersion=${String(parsed.schemaVersion)}, expected ${SCHEMA_VERSION}`,
		);
	}
	if (parsed.bridge === undefined || typeof parsed.bridge.port !== "number") {
		throw new Error(`workspace config at ${configPath} is missing 'bridge.port'`);
	}
	if (
		parsed.project === undefined ||
		typeof parsed.project.platform !== "string" ||
		typeof parsed.project.projectName !== "string" ||
		typeof parsed.project.plcProjectName !== "string"
	) {
		throw new Error(`workspace config at ${configPath} is missing or malformed 'project'`);
	}
	// Optional pushPolicy — accept missing, malformed-but-recoverable
	// (silently ignore non-array values), or well-formed string-array.
	let pushPolicy: WorkspaceConfig["pushPolicy"];
	const rawPolicy = (parsed as { pushPolicy?: unknown }).pushPolicy;
	if (
		rawPolicy !== undefined &&
		typeof rawPolicy === "object" &&
		rawPolicy !== null &&
		Array.isArray((rawPolicy as { allowExtensions?: unknown }).allowExtensions)
	) {
		const arr = (rawPolicy as { allowExtensions: unknown[] }).allowExtensions;
		const cleaned = arr.filter((e): e is string => typeof e === "string");
		pushPolicy = { allowExtensions: cleaned };
	}
	return {
		schemaVersion: SCHEMA_VERSION,
		bridge: { port: parsed.bridge.port },
		project: {
			platform: parsed.project.platform,
			projectName: parsed.project.projectName,
			plcProjectName: parsed.project.plcProjectName,
		},
		...(pushPolicy !== undefined ? { pushPolicy } : {}),
		linkedAt: typeof parsed.linkedAt === "string" ? parsed.linkedAt : "",
	};
}

export function saveConfig(workspaceRoot: string, cfg: Omit<WorkspaceConfig, "schemaVersion">): void {
	const { stateDir, configPath } = workspacePaths(workspaceRoot);
	mkdirSync(stateDir, { recursive: true });
	const full: WorkspaceConfig = { schemaVersion: SCHEMA_VERSION, ...cfg };
	writeFileSync(configPath, `${JSON.stringify(full, null, 2)}\n`, "utf-8");
}
