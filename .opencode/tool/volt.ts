/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { promisify } from "node:util"

const run = promisify(execFile)

// Verbs that change IDE/workspace state. Invoked as a tool they bypass the
// `volt pull/push/init` bash `ask` gates in .opencode/opencode.jsonc, so we
// re-assert approval here via ctx.ask (mirrors those gates).
const MUTATING = new Set(["init", "pull", "push", "merge"])

// This file lives at <repoRoot>/.opencode/tool/volt.ts, so the built CLI is a
// fixed two levels up — resolved from the file (not ctx.directory) so it works
// regardless of which project the agent has open.
const VOLT_BIN = resolve(import.meta.dirname, "../../packages/volt-cli/dist/bin.js")

export default tool({
  description: `Drive a CODESYS / TwinCAT 3 (IEC 61131-3) PLC IDE through the Volt CLI — a git-style workflow over text. Prefer this over guessing shell commands.

Verbs (pass via "command"):
- status  drift between IDE, snapshot, and workspace. Read-only. Run first.
- build   ask the IDE to build; returns diagnostics. Read-only.
- show    display a file at a ref:  args ["<ref>", "<path>"]
- log     snapshot history:         args ["--limit", "10"]
- init    bind this workspace to the IDE project (one-time). Mutating.
- pull    IDE -> workspace.  Mutating.
- push    workspace -> IDE.  Mutating.
- merge   resolve 3-way conflicts.  Mutating.

Extra flags/operands go in "args" (e.g. ["--json"], ["--dry-run"]). Mutating verbs prompt for human approval.`,
  args: {
    command: tool.schema
      .enum(["status", "build", "show", "log", "init", "pull", "push", "merge"])
      .describe("Volt subcommand to run."),
    args: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe(`Extra CLI flags/operands, e.g. ["--json"] or (for show) ["HEAD", "Main.st"].`),
    cwd: tool.schema.string().optional().describe("Workspace directory; defaults to the session directory."),
  },
  async execute(args, ctx) {
    if (!existsSync(VOLT_BIN)) {
      return `volt CLI not built: ${VOLT_BIN}\nRun: bun --cwd packages/volt-cli run build`
    }

    const rest = args.args ?? []
    if (MUTATING.has(args.command)) {
      // Throws PermissionDenied if the user declines — propagated as the tool result.
      await ctx.ask({
        permission: "volt",
        patterns: [`volt ${args.command}`],
        always: [`volt ${args.command}`],
        metadata: { command: args.command, args: rest },
      })
    }

    const title = `volt ${[args.command, ...rest].join(" ")}`.trim()
    try {
      const { stdout, stderr } = await run("bun", [VOLT_BIN, args.command, ...rest], {
        cwd: args.cwd ?? ctx.directory,
        signal: ctx.abort,
        maxBuffer: 10 * 1024 * 1024,
      })
      return { title, output: [stdout, stderr].join("\n").trim() || "(no output)" }
    } catch (e: any) {
      // execFile rejects on non-zero exit; stdout/stderr/code hang off the error.
      const body = [e.stdout, e.stderr].filter(Boolean).join("\n").trim()
      return { title, output: `exit ${e.code ?? 1}\n${body || e.message || "volt failed"}`.trim() }
    }
  },
})
