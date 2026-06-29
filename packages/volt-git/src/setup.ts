/**
 * `setup()` — wire the volt LSP + `volt` tool into opencode's GLOBAL config, so the agent gets PLC
 * intelligence in EVERY project. **Not a CLI verb** — called at install time by the CLI's npm postinstall
 * and the desktop's startup (registration is the installer's job, not a command). Idempotent (merge, never
 * clobber).
 *
 * Why global: opencode merges global config before project config, and spawns LSPs with cwd = project —
 * so a project-local relative path can't reach the LSP. One global registration with an ABSOLUTE command
 * covers every workspace. (See openspec wire-lsp-for-agent.)
 *
 * Binaries resolve relative to this CLI (so dev = repo build, bundled = beside the app), overridable via
 * VOLT_LSP_BIN / VOLT_BIN for the packaged desktop, which bundles them elsewhere.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const EXTENSIONS = [".st", ".gvl", ".itf", ".struct", ".enum", ".union", ".alias", ".fbd", ".ld", ".sfc", ".cfc"];

export interface SetupResult {
	configFile: string;
	toolFile: string;
	lspBin: string;
	voltBin: string;
}

/** opencode's global config dir (mirrors core Global.config: $OPENCODE_CONFIG_DIR ?? $XDG_CONFIG_HOME/opencode). */
function globalConfigDir(): string {
	if (process.env.OPENCODE_CONFIG_DIR) return process.env.OPENCODE_CONFIG_DIR;
	const xdg = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
	return join(xdg, "opencode");
}

/** Strip // and block comments so an existing JSONC config still parses. ponytail: naive — fine for a
 *  config whose only `/` are in absolute paths (which are inside quoted strings → not matched here). */
function parseJsonc(text: string): Record<string, unknown> {
	const stripped = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"])\/\/.*$/gm, "$1");
	return stripped.trim() ? (JSON.parse(stripped) as Record<string, unknown>) : {};
}

/** The `volt` custom tool, self-contained with VOLT_BIN baked in (the agent shells the CLI through it). */
function toolSource(voltBin: string): string {
	return `import { tool } from "@opencode-ai/plugin"
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { promisify } from "node:util"

// Written by \`volt setup\` — absolute path to the volt CLI so the tool resolves from ANY project.
const run = promisify(execFile)
const MUTATING = new Set(["init", "pull", "push", "merge"])
const VOLT_BIN = ${JSON.stringify(voltBin)}

export default tool({
  description: \`Drive a CODESYS / TwinCAT 3 (IEC 61131-3) PLC IDE through the Volt CLI — a git-style workflow over text. Prefer this over guessing shell commands.

Verbs (pass via "command"):
- status  incoming/outgoing between the IDE and your workspace. Read-only. Run first.
- build   ask the IDE to build; returns diagnostics. Read-only.
- show    display a file at a ref:  args ["<ref>", "<path>"]
- log     IDE-sync history:         args ["--limit", "10"]
- init    bind this workspace to the IDE project (one-time). Mutating.
- pull    IDE -> workspace (git merge).  Mutating.
- push    workspace -> IDE.  Mutating.
- merge   finish a conflicted pull (--continue/--abort/--resolve).  Mutating.

Extra flags/operands go in "args" (e.g. ["--json"]). Mutating verbs prompt for human approval.\`,
  args: {
    command: tool.schema
      .enum(["status", "build", "show", "log", "init", "pull", "push", "merge"])
      .describe("Volt subcommand to run."),
    args: tool.schema.array(tool.schema.string()).optional().describe("Extra CLI flags/operands."),
    cwd: tool.schema.string().optional().describe("Workspace directory; defaults to the session directory."),
  },
  async execute(args, ctx) {
    if (!existsSync(VOLT_BIN)) return "volt CLI not found: " + VOLT_BIN
    const rest = args.args ?? []
    if (MUTATING.has(args.command)) {
      await ctx.ask({
        permission: "volt",
        patterns: ["volt " + args.command],
        always: ["volt " + args.command],
        metadata: { command: args.command, args: rest },
      })
    }
    const title = ["volt", args.command, ...rest].join(" ").trim()
    try {
      const { stdout, stderr } = await run("bun", [VOLT_BIN, args.command, ...rest], {
        cwd: args.cwd ?? ctx.directory,
        signal: ctx.abort,
        maxBuffer: 10 * 1024 * 1024,
      })
      return { title, output: [stdout, stderr].join("\\n").trim() || "(no output)" }
    } catch (e: any) {
      const body = [e.stdout, e.stderr].filter(Boolean).join("\\n").trim()
      return { title, output: ("exit " + (e.code ?? 1) + "\\n" + (body || e.message || "volt failed")).trim() }
    }
  },
})
`;
}

/** Register the LSP + tool in opencode's global config. Idempotent. */
export function setup(): SetupResult {
	const here = import.meta.dirname;
	const lspBin = process.env.VOLT_LSP_BIN ?? resolve(here, "../../volt-lsp-codesys/dist/bin.js");
	const voltBin = process.env.VOLT_BIN ?? resolve(process.argv[1] ?? resolve(here, "bin.js"));

	const dir = globalConfigDir();
	mkdirSync(dir, { recursive: true });

	// LSP — merge into the existing config file (prefer .jsonc if present).
	const configFile = existsSync(join(dir, "opencode.jsonc")) ? join(dir, "opencode.jsonc") : join(dir, "opencode.json");
	const config = existsSync(configFile) ? parseJsonc(readFileSync(configFile, "utf8")) : {};
	const lsp = (config.lsp as Record<string, unknown>) ?? {};
	// `node <bin.js>` while a runtime is around (dev/desktop); a bare exe (compiled binary) runs itself.
	const command = lspBin.endsWith(".js") ? ["node", lspBin, "--stdio"] : [lspBin, "--stdio"];
	lsp["volt-lsp-codesys"] = { command, extensions: EXTENSIONS };
	config.lsp = lsp;
	if (!config["$schema"]) config["$schema"] = "https://opencode.ai/config.json";
	writeFileSync(configFile, JSON.stringify(config, null, 2) + "\n");

	// Tool — a self-contained file in the global tool/ dir (opencode scans {tool,tools}/*.ts).
	const toolFile = join(dir, "tool", "volt.ts");
	mkdirSync(dirname(toolFile), { recursive: true });
	writeFileSync(toolFile, toolSource(voltBin));

	return { configFile, toolFile, lspBin, voltBin };
}
