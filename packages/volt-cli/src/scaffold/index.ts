/**
 * Workspace scaffold — written by `volt init` after the snapshot bare
 * repo and CODESYS reference corpus are in place.
 *
 * Turns a sparse Volt-bound directory into a proper Bun project:
 *   `package.json`, `tsconfig.json`, `bunfig.toml`, `README.md`,
 *   `.vscode/settings.json`, `tests/example.test.ts`.
 *
 * The IDE-synced source code lives under `src/` (see
 * `engine/workspace-layout.ts`); this scaffold sets up the project
 * shell at the workspace root so engineers can `bun install`,
 * `bun test`, and write TS tooling alongside their PLC code.
 *
 * Idempotent: by default, existing files are NOT overwritten — only
 * missing scaffold files are created. Pass `force: true` to refresh
 * every file unconditionally (used by `volt init --force`).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { toPackageName } from "./sanitize.js";
import {
	bunfig,
	exampleTest,
	packageJson,
	readme,
	tsconfig,
	vscodeSettings,
} from "./templates.js";

export interface ScaffoldOptions {
	/** Workspace root — where `package.json` lands. */
	readonly root: string;
	/** PLC project name from `.volt/config.json` — feeds `package.json#name`
	 *  (after sanitization) and the README header. */
	readonly plcProjectName: string;
	/** Agent's own package version — recorded as the `@opencode-ai/volt-cli`
	 *  devDep so the workspace pins to the version that scaffolded it. */
	readonly agentVersion: string;
	/** When true, overwrite existing scaffold files. Default `false` —
	 *  preserve engineer customizations across `volt init` re-runs. */
	readonly force?: boolean;
}

export interface ScaffoldReport {
	/** Files written this run (relative paths). */
	readonly created: readonly string[];
	/** Files left untouched because they already existed (relative paths). */
	readonly skipped: readonly string[];
}

/**
 * Write the scaffold. Returns which files were created vs skipped so
 * `volt init` can print a one-line summary.
 *
 * Write order is deliberate: `.vscode/settings.json` FIRST so VS Code's
 * file watcher exclusions are in place before `node_modules/` could
 * appear, then the rest in alphabetic order for predictability.
 */
export function writeWorkspaceScaffold(opts: ScaffoldOptions): ScaffoldReport {
	const name = toPackageName(opts.plcProjectName);
	const files: Array<{ path: string; content: string }> = [
		// First — see above.
		{ path: ".vscode/settings.json", content: vscodeSettings() },
		{ path: "README.md", content: readme(opts.plcProjectName) },
		{ path: "bunfig.toml", content: bunfig() },
		{ path: "package.json", content: packageJson(name, opts.agentVersion) },
		{ path: "tests/example.test.ts", content: exampleTest() },
		{ path: "tsconfig.json", content: tsconfig() },
	];

	const created: string[] = [];
	const skipped: string[] = [];

	for (const f of files) {
		const abs = join(opts.root, f.path);
		if (!opts.force && existsSync(abs)) {
			skipped.push(f.path);
			continue;
		}
		mkdirSync(dirname(abs), { recursive: true });
		writeFileSync(abs, f.content, "utf-8");
		created.push(f.path);
	}

	return { created, skipped };
}
