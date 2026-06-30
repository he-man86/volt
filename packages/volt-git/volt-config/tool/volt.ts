import { tool } from "@opencode-ai/plugin"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

// Shipped in the Volt config dir (handed to opencode via OPENCODE_CONFIG_DIR). `volt` resolves off PATH
// (the installer adds resources/volt/bin), so nothing machine-specific is baked — this file is STATIC.
// A bare command name means execFile PATH-resolves it; a missing/unresolvable binary surfaces as the
// caught ENOENT below rather than a stat check, so no `existsSync` guard is needed.
const run = promisify(execFile)
const MUTATING = new Set(["init", "pull", "push", "merge"])

export default tool({
  description: `Drive a CODESYS / TwinCAT 3 (IEC 61131-3) PLC IDE through the Volt CLI — a git-style workflow over text. Prefer this over guessing shell commands.

Verbs (pass via "command"):
- status  incoming/outgoing between the IDE and your workspace. Read-only. Run first.
- build   ask the IDE to build; returns diagnostics. Read-only.
- show    display a file at a ref:  args ["<ref>", "<path>"]
- log     IDE-sync history:         args ["--limit", "10"]
- init    bind this workspace to the IDE project (one-time). Mutating.
- pull    IDE -> workspace (git merge).  Mutating.
- push    workspace -> IDE.  Mutating.
- merge   finish a conflicted pull (--continue/--abort/--resolve).  Mutating.

Extra flags/operands go in "args" (e.g. ["--json"]). Mutating verbs prompt for human approval.`,
  args: {
    command: tool.schema
      .enum(["status", "build", "show", "log", "init", "pull", "push", "merge"])
      .describe("Volt subcommand to run."),
    args: tool.schema.array(tool.schema.string()).optional().describe("Extra CLI flags/operands."),
    cwd: tool.schema.string().optional().describe("Workspace directory; defaults to the session directory."),
  },
  async execute(args, ctx) {
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
      const { stdout, stderr } = await run("volt", [args.command, ...rest], {
        cwd: args.cwd ?? ctx.directory,
        signal: ctx.abort,
        maxBuffer: 10 * 1024 * 1024,
      })
      return { title, output: [stdout, stderr].join("\n").trim() || "(no output)" }
    } catch (e: any) {
      const body = [e.stdout, e.stderr].filter(Boolean).join("\n").trim()
      return { title, output: ("exit " + (e.code ?? 1) + "\n" + (body || e.message || "volt failed")).trim() }
    }
  },
})
