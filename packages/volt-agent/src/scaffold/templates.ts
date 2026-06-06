/**
 * Pure-function templates for every file `volt init` scaffolds into a
 * workspace. Each function returns a string; no I/O, no globals. Keeps
 * the scaffold content reviewable and unit-testable in isolation.
 *
 * Versions match the monorepo's catalog so the generated workspace
 * gets the same TS / @types/bun the agent itself uses.
 */

/** Generate `package.json` content. */
export function packageJson(name: string, agentVersion: string): string {
	const json = {
		name,
		private: true,
		type: "module",
		scripts: {
			test: "bun test",
			typecheck: "tsc --noEmit",
		},
		devDependencies: {
			"@opencode-ai/volt-agent": `^${agentVersion}`,
			"@tsconfig/bun": "1.0.9",
			"@types/bun": "1.3.13",
			typescript: "5.8.2",
		},
	};
	return JSON.stringify(json, null, 2) + "\n";
}

/** Generate `tsconfig.json` content. */
export function tsconfig(): string {
	const json = {
		$schema: "https://json.schemastore.org/tsconfig.json",
		extends: "@tsconfig/bun/tsconfig.json",
		compilerOptions: {
			strict: true,
			noEmit: true,
			types: ["bun-types"],
		},
		include: ["tests/**/*.ts", "scripts/**/*.ts"],
		exclude: ["node_modules", "src", ".volt", ".claude"],
	};
	return JSON.stringify(json, null, 2) + "\n";
}

/** Generate `bunfig.toml` content. */
export function bunfig(): string {
	return [
		"[test]",
		'root = "tests"',
		"",
	].join("\n");
}

/** Generate `tests/example.test.ts` — single trivial test, removes the
 *  "how do I add tests?" friction for new workspaces. */
export function exampleTest(): string {
	return [
		'import { test, expect } from "bun:test";',
		"",
		'test("workspace is wired up", () => {',
		"\texpect(1 + 1).toBe(2);",
		"});",
		"",
	].join("\n");
}

/** Generate `.vscode/settings.json` — keeps VS Code's LSP and file
 *  watcher from indexing node_modules / .volt/snapshot. Must land
 *  before the user opens the workspace, else the LSP restart loop
 *  kicks in. */
export function vscodeSettings(): string {
	const json = {
		"files.watcherExclude": {
			"**/.volt/snapshot/**": true,
			"**/node_modules/**": true,
		},
		"search.exclude": {
			"**/.volt": true,
			"**/node_modules": true,
		},
		"typescript.tsdk": "node_modules/typescript/lib",
	};
	return JSON.stringify(json, null, 2) + "\n";
}

/** Generate `README.md` — quick-start for engineers landing in a fresh
 *  workspace. References the `project` metadata so it reads like it
 *  was written for THIS PLC project. */
export function readme(plcProjectName: string): string {
	return [
		`# ${plcProjectName} (Volt workspace)`,
		"",
		"Bound to a running PLC IDE — see `.volt/config.json` for the bridge port and project binding.",
		"",
		"## PLC code",
		"`src/` mirrors the IDE project. Edit `.st` files locally; `volt push`",
		"writes them back to TwinCAT. Do not edit `.fbd`/`.ld`/`.sfc`/`.cfc`",
		"by hand — they are read-only views of graphical bodies.",
		"",
		"## Tooling",
		"- `bun install`            install dev dependencies",
		"- `bun test`               run tests in `tests/`",
		"- `bun run typecheck`      typecheck tooling scripts",
		"- `volt pull` / `volt push` / `volt status`   sync with the IDE",
		"",
		"## What lives where",
		"- `.volt/`     internal Volt state (do not edit, gitignored)",
		"- `.claude/`   AI language reference for ST (committed)",
		"- `src/`       synced from IDE (IDE is source of truth)",
		"- `tests/`     your tests (`.test.ts`)",
		"- `scripts/`   your TS tooling (optional)",
		"",
		"If you add prettier / eslint / oxlint, remember to ignore `src/` —",
		"its contents are PLC source, not JavaScript.",
		"",
	].join("\n");
}
