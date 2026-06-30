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
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

const EXTENSIONS = [".st", ".gvl", ".itf", ".struct", ".enum", ".union", ".alias", ".fbd", ".ld", ".sfc", ".cfc"]

// The `volt` tool imports @opencode-ai/plugin. opencode auto-installs a tool's deps at THIS binary's version —
// volt's (e.g. 0.1.0), which isn't on npm, so the install 404s and the prompt fails. Pin it instead to the
// opencode base version this binary embeds (which IS published). OPENCODE_PLUGIN_VERSION is injected at build
// (build.ts) from packages/opencode/package.json, so it auto-tracks upstream merges; fall back for dev-from-source.
declare const OPENCODE_PLUGIN_VERSION: string | undefined
const OPENCODE_VERSION = typeof OPENCODE_PLUGIN_VERSION === "string" ? OPENCODE_PLUGIN_VERSION : "1.17.11"

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

/** The `volt` custom tool, self-contained with VOLT_BIN baked in (the agent shells the CLI through it).
 *  Twin of the repo's own dev tool `.opencode/tool/volt.ts` — same behaviour; keep the two in sync (the
 *  generated copy must stay self-contained, so they can't share a module). */
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

	// Pin @opencode-ai/plugin (the tool's import) to the published opencode base version and install it now, so
	// opencode resolves it from node_modules instead of trying — and failing — to auto-install volt's version.
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify(
			{ name: "volt-workspace-tools", private: true, dependencies: { "@opencode-ai/plugin": OPENCODE_VERSION } },
			null,
			2,
		) + "\n",
	)
	// Keep the machine-specific package.json + node_modules out of the consumer's repo (opencode writes the same
	// .gitignore when it first runs; do it now so a commit before the first chat can't leak them).
	const giFile = join(dir, ".gitignore")
	if (!existsSync(giFile)) writeFileSync(giFile, "node_modules\npackage.json\npackage-lock.json\nbun.lock\n.gitignore\n")
	const win = process.platform === "win32"
	const installed =
		spawnSync("bun", ["install"], { cwd: dir, stdio: "ignore", shell: win }).status === 0 ||
		spawnSync("npm", ["install"], { cwd: dir, stdio: "ignore", shell: win }).status === 0
	if (!installed)
		console.warn("⚠ Could not install the volt tool's deps (need bun or npm on PATH) — run `bun install` in .opencode/ if the agent's `volt` tool fails to load.")

	return { configFile, toolFile, lspBin, voltBin }
}
