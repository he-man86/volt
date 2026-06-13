#!/usr/bin/env node
import { BridgeClient } from "./bridge/client.js"
import { parseArgs } from "./args.js"
import { formatError, exitCode } from "./output/errors.js"

async function main() {
	const { verb, operands, workspace, port, has, value } = parseArgs(process.argv.slice(2))
	const bridge = new BridgeClient({ port })

	switch (verb) {
		case "init": {
			const { init } = await import("./commands/init.js")
			const result = await init(workspace, bridge, { force: has("--force"), noScaffold: has("--no-scaffold") })
			if (result.kind === "error") {
				console.error(formatError(result.error))
				process.exitCode = exitCode(result.error)
			}
			break
		}
		case "pull": {
			const { pull } = await import("./commands/pull.js")
			const { renderPull, applyEmission } = await import("./output/outcome.js")
			const json = has("--json")
			const result = await pull(workspace, bridge, { force: has("--force"), dryRun: has("--dry-run"), json })
			applyEmission(renderPull(result, json))
			break
		}
		case "push": {
			const { push } = await import("./commands/push.js")
			const { renderPush, applyEmission } = await import("./output/outcome.js")
			const json = has("--json")
			const result = await push(workspace, bridge, { force: has("--force"), dryRun: has("--dry-run"), json })
			applyEmission(renderPush(result, json))
			break
		}
		case "status": {
			const { status } = await import("./commands/status.js")
			await status(workspace, bridge, { json: has("--json") })
			break
		}
		case "build": {
			const { build } = await import("./commands/build.js")
			await build(workspace, bridge, { full: has("--full") })
			break
		}
		case "merge": {
			const { merge } = await import("./commands/merge.js")
			await merge(workspace, bridge, {
				continue: has("--continue"),
				abort: has("--abort"),
				resolve: value("--resolve"),
				useOurs: has("--use-ours"),
				useTheirs: has("--use-theirs"),
			})
			break
		}
		case "show": {
			const { show } = await import("./commands/show.js")
			if (operands.length < 2) {
				console.error("usage: volt show <ref> <path>")
				process.exit(1)
			}
			await show(workspace, bridge, operands[0]!, operands[1]!)
			break
		}
		case "log": {
			const { log } = await import("./commands/log.js")
			const limit = value("--limit")
			await log(workspace, bridge, {
				limit: limit !== undefined ? Number.parseInt(limit, 10) || undefined : undefined,
				json: has("--json"),
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
