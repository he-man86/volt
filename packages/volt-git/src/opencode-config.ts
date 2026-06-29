/**
 * `writeOpencodeConfig(root)` — wire the volt LSP + `volt` tool into THIS project's `.opencode/`, so the
 * agent gets PLC intelligence in the workspace. Called by `volt init`.
 *
 * Project-local, never the global `~/.config/opencode`: opencode reads project config too, so the LSP loads
 * here without touching the config stock opencode shares — they coexist, and there's nothing global to clean
 * up on uninstall. Idempotent (merges the LSP into an existing config, never clobbers). The resolved paths
 * are machine-specific, so `volt init` gitignores these two files; each machine's `init` regenerates them.
 *
 * Binaries resolve via env override → beside the running volt binary (packaged: resources/volt/bin) → the
 * repo build (dev).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

const EXTENSIONS = [".st", ".gvl", ".itf", ".struct", ".enum", ".union", ".alias", ".fbd", ".ld", ".sfc", ".cfc"]

export interface WireResult {
	configFile: string
	toolFile: string
	lspBin: string
	voltBin: string
}

/** Strip // and block comments so an existing JSONC config still parses. ponytail: naive — fine for a
 *  config whose only `/` are in absolute paths (inside quoted strings → not matched here). */
function parseJsonc(text: string): Record<string, unknown> {
	const stripped = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"])\/\/.*$/gm, "$1")
	return stripped.trim() ? (JSON.parse(stripped) as Record<string, unknown>) : {}
}

/** Resolve a bundled binary: env override → beside the running volt binary (packaged) → repo build (dev). */
function resolveBin(envVar: string, bundledName: string, devPath: string): string {
	const fromEnv = process.env[envVar]
	if (fromEnv) return fromEnv
	const ext = process.platform === "win32" ? ".exe" : ""
	const sibling = join(dirname(process.execPath), bundledName + ext)
	return existsSync(sibling) ? sibling : devPath
}

/** The `volt` custom tool, self-contained with VOLT_BIN baked in (the agent shells the CLI through it). */
function toolSource(voltBin: string): string {
	return `import { tool } from "@opencode-ai/plugin"
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { promisify } from "node:util"

// Written by \`volt init\` — absolute path to the volt CLI so the tool resolves from ANY project.
const run = promisify(execFile)
const MUTATING = new Set(["init", "pull", "push", "merge"])
const VOLT_BIN = ${JSON.stringify(voltBin)}
// A .js/.ts entry runs under bun; a compiled binary (volt.exe) runs directly — bun cannot exec a compiled exe.
const [VOLT_CMD, VOLT_ARGS] = VOLT_BIN.endsWith(".js") || VOLT_BIN.endsWith(".ts") ? ["bun", [VOLT_BIN]] : [VOLT_BIN, []]

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
      const { stdout, stderr } = await run(VOLT_CMD, [...VOLT_ARGS, args.command, ...rest], {
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
`
}

/** Write the volt LSP + tool into `<root>/.opencode/`. Idempotent (merges the LSP into an existing config). */
export function writeOpencodeConfig(root: string): WireResult {
	const here = import.meta.dirname
	const lspBin = resolveBin("VOLT_LSP_BIN", "volt-lsp-codesys", resolve(here, "../../volt-lsp-codesys/dist/bin.js"))
	const voltBin = resolveBin("VOLT_BIN", "volt", process.argv[1] ?? resolve(here, "bin.js"))

	const dir = join(root, ".opencode")
	mkdirSync(dir, { recursive: true })

	// LSP — merge into the existing project config (prefer .jsonc if present).
	const configFile = existsSync(join(dir, "opencode.jsonc")) ? join(dir, "opencode.jsonc") : join(dir, "opencode.json")
	const config = existsSync(configFile) ? parseJsonc(readFileSync(configFile, "utf8")) : {}
	const lsp = (config.lsp as Record<string, unknown>) ?? {}
	// `node <bin.js>` while a runtime is around (dev); a bare exe (compiled binary) runs itself.
	const command = lspBin.endsWith(".js") ? ["node", lspBin, "--stdio"] : [lspBin, "--stdio"]
	lsp["volt-lsp-codesys"] = { command, extensions: EXTENSIONS }
	config.lsp = lsp
	if (!config["$schema"]) config["$schema"] = "https://opencode.ai/config.json"
	writeFileSync(configFile, JSON.stringify(config, null, 2) + "\n")

	// Tool — a self-contained file in the project tool/ dir (opencode scans {tool,tools}/*.ts).
	const toolFile = join(dir, "tool", "volt.ts")
	mkdirSync(dirname(toolFile), { recursive: true })
	writeFileSync(toolFile, toolSource(voltBin))

	return { configFile, toolFile, lspBin, voltBin }
}
