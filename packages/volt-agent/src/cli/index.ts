/**
 * CLI dispatcher — argv parsing + verb lookup. The thin bin entry
 * (`cli/bin.ts`) just calls into here.
 *
 * Each verb lives in its own file and exports a VerbFn. Adding a new
 * verb: add `cli/<verb>.ts`, register it in VERBS, update HELP.
 */
import { BridgeClient } from "../bridge/client.js";
import { flagInt, flagString, safeVerb, type Flags, type VerbFn } from "./_shared.js";
import { init } from "./init.js";
import { pullVerb } from "./pull.js";
import { pushVerb } from "./push.js";
import { status } from "./status.js";
import { build } from "./build.js";

const VERBS: Record<string, VerbFn> = {
	init,
	pull: pullVerb,
	push: pushVerb,
	status,
	build,
};

export const HELP = `volt <verb> [flags]

Verbs:
  init                          Bind this workspace folder to the IDE project the bridge has open.
  pull                          Pull IDE state into the workspace (= git fetch + merge).
  push                          Push workspace state to the IDE. Refuses on IDE drift unless --force.
  status                        Show what differs between IDE, snapshot, and workspace.
  build [--full]                Ask the IDE to build the project. Returns diagnostics.
  help                          Show this list.

Flags:
  --port N                       Bridge port (default 8555, env VOLT_BRIDGE_PORT)
  --workspace DIR                Workspace root (default current working directory)
  --force                        init: repoint; pull: discard local edits; push: bypass drift check
  --force-with-lease=<version>   push only: like --force, but only if the bridge is still at
                                 <version> (= what you saw via volt status). Refuses if the bridge
                                 has moved further. Safer than --force. Same idea as
                                 \`git push --force-with-lease\`.
  --dry-run / -n                 push / pull: compute what would happen and print the preview,
                                 but don't write to the bridge / workspace / snapshot. Mirrors
                                 \`git push --dry-run\` / \`git fetch --dry-run\`.
  --porcelain                    status only: machine-readable one-line-per-item output.
                                 Format: <dir><code> <name> where dir is i (incoming) or o
                                 (outgoing) and code is A / M / D. Inspired by \`git status
                                 --porcelain\`.
  --full                         build only — full rebuild instead of incremental

A typical session:
  volt init                   # once per workspace
  volt pull                   # pull current IDE state
  # ... edit .st files with your editor / AI of choice
  volt status                 # see what changed
  volt push                   # push edits back to the IDE
  volt build                  # build and read diagnostics`;

// Single-char short flags map to their long-form key (git-style: `-n`
// is the same as `--dry-run`). Keep this list short on purpose — git
// itself only registers a handful of single-letter flags.
const SHORT_FLAG_ALIASES: Record<string, string> = {
	n: "dry-run",
};

export function parseArgs(argv: readonly string[]): { verb: string; flags: Flags } {
	const verb = argv[0] ?? "help";
	const flags: Flags = {};
	for (let i = 1; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === undefined) continue;
		const isLong = arg.startsWith("--") && arg.length > 2;
		const isShort = arg.startsWith("-") && !arg.startsWith("--") && arg.length === 2;
		if (!isLong && !isShort) {
			// First non-flag arg after the verb becomes the positional.
			// Verbs that don't take a positional just ignore the field.
			if (flags["_positional"] === undefined) flags["_positional"] = arg;
			continue;
		}
		const eq = arg.indexOf("=");
		let key: string;
		let value: string | true;
		if (eq >= 0 && isLong) {
			key = arg.slice(2, eq);
			value = arg.slice(eq + 1);
		} else {
			const rawKey = isLong ? arg.slice(2) : arg.slice(1);
			key = isShort ? (SHORT_FLAG_ALIASES[rawKey] ?? rawKey) : rawKey;
			const next = argv[i + 1];
			if (next !== undefined && !next.startsWith("-")) {
				value = next;
				i += 1;
			} else {
				value = true;
			}
		}
		flags[key] = value;
	}
	return { verb, flags };
}

export async function runVerb(verb: string, flags: Flags): Promise<number> {
	if (verb === "help" || verb === "-h" || verb === "--help") {
		console.log(HELP);
		return 0;
	}

	const fn = VERBS[verb];
	if (fn === undefined) {
		process.stderr.write(`unknown verb: ${verb}\n\n${HELP}\n`);
		return 1;
	}

	const port = flagInt(flags, "port", Number.parseInt(process.env.VOLT_BRIDGE_PORT ?? "8555", 10));
	const workspace = flagString(flags, "workspace") ?? process.cwd();
	const bridge = new BridgeClient({ port });

	return safeVerb(fn, { workspace, port, bridge, flags });
}
