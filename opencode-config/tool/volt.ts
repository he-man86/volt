import { z } from "zod"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

// Shipped in the Volt config dir (handed to opencode via OPENCODE_CONFIG_DIR). `volt` resolves off PATH
// (the installer adds resources/volt/bin), so nothing machine-specific is baked — this file is STATIC.
// A bare command name means execFile PATH-resolves it; a missing/unresolvable binary surfaces as the
// caught ENOENT below rather than a stat check, so no `existsSync` guard is needed.
//
// opencode's `tool()` helper is just `(x) => x` and `tool.schema` is just zod — so we skip the dependency
// entirely and export the plain shape opencode loads: { description, args, execute }. That keeps this file
// (and its self-contained bundle) free of @opencode-ai/plugin; the only bundled dep is zod.
const run = promisify(execFile)
const MUTATING = new Set(["init", "pull", "push", "merge"])

// The subset of opencode's ToolContext this tool uses — typed locally so opencode-config needs no opencode package.
type ToolContext = {
  directory: string
  abort: AbortSignal
  ask(input: {
    permission: string
    patterns: string[]
    always: string[]
    metadata: Record<string, unknown>
  }): Promise<void>
}

const args = {
  command: z
    .enum(["status", "build", "show", "init", "pull", "push", "merge"])
    .describe("Volt subcommand to run."),
  args: z.array(z.string()).optional().describe("Extra CLI flags/operands."),
  cwd: z.string().optional().describe("Workspace directory; defaults to the session directory."),
}

export default {
  description: `Drive a CODESYS / TwinCAT 3 (IEC 61131-3) PLC IDE through the Volt CLI — a git-style workflow over text. Prefer this over guessing shell commands.

Verbs (pass via "command"):
- status  incoming/outgoing between the IDE and your workspace. Read-only. Run first.
- build   ask the IDE to build; returns diagnostics. Read-only.
- show    display a file at a ref:  args ["<ref>", "<path>"]
- init    bind this workspace to the IDE project (one-time). Mutating.
- pull    IDE -> workspace (git merge).  Mutating.
- push    workspace -> IDE.  Mutating.
- merge   finish a conflicted pull (--continue/--abort/--resolve).  Mutating.

Extra flags/operands go in "args" (e.g. ["--json"]). Mutating verbs prompt for human approval.`,
  args,
  async execute(input: z.infer<z.ZodObject<typeof args>>, ctx: ToolContext) {
    const rest = input.args ?? []
    if (MUTATING.has(input.command)) {
      await ctx.ask({
        permission: "volt",
        patterns: ["volt " + input.command],
        always: ["volt " + input.command],
        metadata: { command: input.command, args: rest },
      })
    }
    const title = ["volt", input.command, ...rest].join(" ").trim()
    try {
      const { stdout, stderr } = await run("volt", [input.command, ...rest], {
        cwd: input.cwd ?? ctx.directory,
        signal: ctx.abort,
        maxBuffer: 10 * 1024 * 1024,
      })
      return { title, output: [stdout, stderr].join("\n").trim() || "(no output)" }
    } catch (e: any) {
      const body = [e.stdout, e.stderr].filter(Boolean).join("\n").trim()
      return { title, output: ("exit " + (e.code ?? 1) + "\n" + (body || e.message || "volt failed")).trim() }
    }
  },
}
