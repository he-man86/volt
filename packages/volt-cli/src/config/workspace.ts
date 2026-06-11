/**
 * Workspace binding — links a local folder to a specific PLC IDE
 * project on a specific bridge. Stored as JSON at
 * `<workspace>/.volt/config.json`.
 *
 * The binding is created by `volt init`, read by every other `volt`
 * verb, and is the one source of truth for "which IDE project does
 * this workspace talk to?" — no environment variables, no implicit
 * cwd detection beyond looking up the `.volt/` directory.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { Access, AccessOverrides } from "./access.js";

/** Schema version of the on-disk config — bump when the shape changes. */
const SCHEMA_VERSION = 2;

export interface WorkspaceConfig extends AccessOverrides {
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
	 * Per-extension access mode overrides.
	 *
	 * Each tracked extension has a default access mode in
	 * `engine/extension-registry.ts` (`r` for config kinds,
	 * `rw` for source kinds). The engineer can override any extension
	 * per workspace:
	 *   - `"r"`   — pull only; push refuses any edit
	 *   - `"rw"`  — pull + push (engineer asserts they want to write)
	 *   - `"off"` — skip entirely; pull won't materialize, push ignores
	 *
	 * Example:
	 *   "extensionAccess": {
	 *     ".library": "off",     // don't even pull library refs
	 *     ".fbd":     "rw"       // I want to write FBD bodies directly
	 *   }
	 *
	 * Replaces the v1 `pushPolicy.allowExtensions` allowlist (which
	 * only modeled push). Hard cutover — no backward compat shim.
	 */
	linkedAt: string;
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
			`workspace config at ${configPath} has schemaVersion=${String(parsed.schemaVersion)}, expected ${SCHEMA_VERSION} — ` +
				`re-init the workspace with \`volt init --force\``,
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
	// extensionAccess is optional. Validate shape: object with string→
	// ("r"|"rw"|"off") values. Reject malformed entries loudly — a
	// silent acceptance would leave the engineer wondering why their
	// override doesn't apply.
	const access = readAccessOverrides(parsed, configPath);
	return {
		schemaVersion: SCHEMA_VERSION,
		bridge: { port: parsed.bridge.port },
		project: {
			platform: parsed.project.platform,
			projectName: parsed.project.projectName,
			plcProjectName: parsed.project.plcProjectName,
		},
		...(access !== undefined ? { extensionAccess: access } : {}),
		linkedAt: typeof parsed.linkedAt === "string" ? parsed.linkedAt : "",
	};
}

function readAccessOverrides(
	parsed: Partial<WorkspaceConfig>,
	configPath: string,
): Record<string, Access> | undefined {
	const raw = (parsed as { extensionAccess?: unknown }).extensionAccess;
	if (raw === undefined) return undefined;
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new Error(
			`workspace config at ${configPath} has malformed 'extensionAccess' — expected object {".ext": "r"|"rw"|"off"}`,
		);
	}
	const out: Record<string, Access> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (value !== "r" && value !== "rw" && value !== "off") {
			throw new Error(
				`workspace config at ${configPath}: extensionAccess[${JSON.stringify(key)}] is '${String(value)}' — must be "r", "rw", or "off"`,
			);
		}
		// Normalize: lowercase + ensure leading dot.
		const ext = key.toLowerCase();
		out[ext.startsWith(".") ? ext : `.${ext}`] = value;
	}
	return out;
}

export function saveConfig(workspaceRoot: string, cfg: Omit<WorkspaceConfig, "schemaVersion">): void {
	const { stateDir, configPath } = workspacePaths(workspaceRoot);
	mkdirSync(stateDir, { recursive: true });
	const full: WorkspaceConfig = { schemaVersion: SCHEMA_VERSION, ...cfg };
	writeFileSync(configPath, `${JSON.stringify(full, null, 2)}\n`, "utf-8");
}
