#!/usr/bin/env node
import { join, resolve } from "node:path"
import { existsSync } from "node:fs"
import { BridgeClient } from "./bridge/client.js"
import { formatError, exitCode, type CliError } from "./output/errors.js"

async function main() {
	const args = process.argv.slice(2)

	const workspaceFlagIdx = args.indexOf("--workspace")
	const workspaceFromFlag = workspaceFlagIdx >= 0 ? args[workspaceFlagIdx + 1] : undefined
	const workspace = workspaceFromFlag ?? process.env.VOLT_WORKSPACE ?? process.cwd()

	const portFlagIdx = args.indexOf("--port")
	const port = portFlagIdx >= 0 ? Number.parseInt(args[portFlagIdx + 1]) : Number.parseInt(process.env.VOLT_BRIDGE_PORT ?? "8555")

	const verb = args.find((a) => !a.startsWith("-") && !a.startsWith("--")) ?? "help"
	const bridge = new BridgeClient({ port })

	const flagTakingValue = new Set(["--workspace", "--port", "--resolve", "--limit"])
	const positionals = args.filter((a, i) => !a.startsWith("-") && (i === 0 || !flagTakingValue.has(args[i - 1]!)))

	switch (verb) {
		case "init": {
			const { init } = await import("./commands/init.js")
			const result = await init(workspace, bridge, { force: args.includes("--force"), noScaffold: args.includes("--no-scaffold") })
			if (result.kind === "error") {
				console.error(formatError(result.error))
				process.exitCode = exitCode(result.error)
			}
			break
		}
		case "pull": {
			const { pull } = await import("./commands/pull.js")
			await pull(workspace, bridge, { force: args.includes("--force"), dryRun: args.includes("--dry-run") })
			break
		}
		case "push": {
			const { push } = await import("./commands/push.js")
			await push(workspace, bridge, { force: args.includes("--force"), dryRun: args.includes("--dry-run") })
			break
		}
		case "status": {
			const { status } = await import("./commands/status.js")
			await status(workspace, bridge, { json: args.includes("--json") })
			break
		}
		case "build": {
			const { build } = await import("./commands/build.js")
			await build(workspace, bridge, { full: args.includes("--full") })
			break
		}
		case "merge": {
			const { merge } = await import("./commands/merge.js")
			const resolveIdx = args.indexOf("--resolve")
			await merge(workspace, bridge, {
				continue: args.includes("--continue"),
				abort: args.includes("--abort"),
				resolve: resolveIdx >= 0 ? args[resolveIdx + 1] : undefined,
				useOurs: args.includes("--use-ours"),
				useTheirs: args.includes("--use-theirs"),
			})
			break
		}
		case "show": {
			const { show } = await import("./commands/show.js")
			const showPos = positionals.slice(positionals.indexOf(verb) + 1)
			if (showPos.length < 2) {
				console.error("usage: volt show <ref> <path>")
				process.exit(1)
			}
			await show(workspace, bridge, showPos[0]!, showPos[1]!)
			break
		}
		case "log": {
			const { log } = await import("./commands/log.js")
			const limitIdx = args.indexOf("--limit")
			await log(workspace, bridge, {
				limit: limitIdx >= 0 ? Number.parseInt(args[limitIdx + 1]!) || undefined : undefined,
				json: args.includes("--json"),
			})
			break
		}
		default:
			console.log(`volt — CLI for IEC 61131-3 projects

Usage: volt <command> [flags]

Commands:
  init     Bind workspace to an IDE project
  pull     Pull project state from IDE
  push     Push workspace changes to IDE
  status   Show incoming/outgoing changes
  build    Build project and show diagnostics
  merge    Resolve 3-way merge conflicts
  show     Display file at a given ref
  log      Show snapshot history

Flags:
  --workspace <path>   Workspace root (default: cwd)
  --port <port>        Bridge port (default: 8555)
  --force              Bypass safety checks
  --dry-run            Preview without applying
  --json               Machine-readable output`)
			process.exit(verb === "help" ? 0 : 1)
	}
}

main().catch((err) => {
	if (err instanceof Error) console.error(err.message)
	else console.error(String(err))
	process.exit(1)
})
