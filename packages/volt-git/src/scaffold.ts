/**
 * Workspace scaffold — turns a Volt-bound directory into a proper Bun project (package.json,
 * tsconfig, bunfig, README, .vscode, example test) so engineers can `bun install`/`bun test` alongside
 * their PLC code. Idempotent: existing files are kept unless `force`.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const FALLBACK = "plc-workspace";
function toPackageName(plcProjectName: string): string {
	const s = plcProjectName.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
	return s.length > 0 ? s : FALLBACK;
}

export interface ScaffoldReport {
	created: string[];
	skipped: string[];
}

export function writeWorkspaceScaffold(root: string, plcProjectName: string, agentVersion: string, force = false): ScaffoldReport {
	const name = toPackageName(plcProjectName);
	const files: Array<{ path: string; content: string }> = [
		{ path: ".vscode/settings.json", content: vscodeSettings() },
		{ path: "README.md", content: readme(plcProjectName) },
		{ path: "bunfig.toml", content: '[test]\nroot = "tests"\n' },
		{ path: "package.json", content: packageJson(name, agentVersion) },
		{ path: "tests/example.test.ts", content: exampleTest() },
		{ path: "tsconfig.json", content: tsconfig() },
	];
	const created: string[] = [];
	const skipped: string[] = [];
	for (const f of files) {
		const abs = join(root, f.path);
		if (!force && existsSync(abs)) {
			skipped.push(f.path);
			continue;
		}
		mkdirSync(dirname(abs), { recursive: true });
		writeFileSync(abs, f.content, "utf-8");
		created.push(f.path);
	}
	return { created, skipped };
}

function packageJson(name: string, agentVersion: string): string {
	return (
		JSON.stringify(
			{
				name,
				private: true,
				type: "module",
				scripts: { test: "bun test", typecheck: "tsc --noEmit" },
				devDependencies: {
					"@opencode-ai/volt-git": `^${agentVersion}`,
					"@tsconfig/bun": "1.0.9",
					"@types/bun": "1.3.13",
					typescript: "5.8.2",
				},
			},
			null,
			2,
		) + "\n"
	);
}

function tsconfig(): string {
	return (
		JSON.stringify(
			{
				$schema: "https://json.schemastore.org/tsconfig.json",
				extends: "@tsconfig/bun/tsconfig.json",
				compilerOptions: { strict: true, noEmit: true, types: ["bun-types"] },
				include: ["tests/**/*.ts", "scripts/**/*.ts"],
				exclude: ["node_modules", "src", ".claude"],
			},
			null,
			2,
		) + "\n"
	);
}

function vscodeSettings(): string {
	return (
		JSON.stringify(
			{
				"files.watcherExclude": { "**/node_modules/**": true },
				"search.exclude": { "**/node_modules": true },
				"typescript.tsdk": "node_modules/typescript/lib",
			},
			null,
			2,
		) + "\n"
	);
}

function exampleTest(): string {
	return ['import { test, expect } from "bun:test";', "", 'test("workspace is wired up", () => {', "\texpect(1 + 1).toBe(2);", "});", ""].join("\n");
}

function readme(plcProjectName: string): string {
	return [
		`# ${plcProjectName} (Volt workspace)`,
		"",
		"Bound to a running PLC IDE — Volt keeps its binding + IDE baseline in `.git/volt/` (managed for you).",
		"",
		"## Two axes",
		"- **`volt pull` / `volt push`** sync `src/` with the live IDE (the machine).",
		"- **`git commit` / `git push`** version the text + share with the team. Commit before pulling.",
		"",
		"`src/` mirrors the IDE — edit `.st`/`.gvl` locally; `volt push` writes them back. `.fbd`/`.ld`/",
		"`.sfc`/`.cfc` are read-only views of graphical bodies (don't hand-edit).",
		"",
		"## What lives where",
		"- `.git/`    a normal git repo — Volt keeps its binding + IDE baseline in `.git/volt/`",
		"- `.claude/` AI language reference for ST (committed)",
		"- `src/`     synced from the IDE",
		"- `tests/`   your tests (`.test.ts`)",
		"",
	].join("\n");
}
