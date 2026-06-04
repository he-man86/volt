/**
 * CLI dispatcher — argv parsing + verb lookup. The thin bin entry
 * (`cli/bin.ts`) just calls into here.
 *
 * Each verb lives in its own file and exports a VerbFn. Adding a new
 * verb: add `cli/<verb>.ts`, register it in VERBS, update HELP.
 */
import { existsSync, readFileSync } from "node:fs";
import { BridgeClient } from "../bridge/client.js";
import { workspacePaths } from "../engine/config.js";
import { flagInt, flagString, safeVerb, type Flags, type VerbFn } from "./_shared.js";
import { build } from "./build.js";
import { init } from "./init.js";
import { log } from "./log.js";
import { merge } from "./merge.js";
import { pullVerb } from "./pull.js";
import { pushVerb } from "./push.js";
import { show } from "./show.js";
import { status } from "./status.js";

const VERBS: Record<string, VerbFn> = {
	init,
	pull: pullVerb,
	push: pushVerb,
	status,
	build,
	merge,
	show,
	log,
};

export const HELP = `volt <verb> [flags]

Verbs:
  init                          Bind this workspace folder to the IDE project the bridge has open.
  pull                          Pull IDE state into the workspace (= git fetch + merge). 3-way
                                merges automatically when workspace and IDE have both changed.
  push                          Push workspace state to the IDE. Refuses on IDE drift unless --force.
  status                        Show what differs between IDE, snapshot, and workspace. Reports
                                'Unmerged paths:' when a 3-way merge is in progress.
  build [--full]                Ask the IDE to build the project. Returns diagnostics.
  merge --continue              Finalize an in-progress 3-way merge after conflict resolution.
  merge --abort                 Abandon an in-progress merge and restore workspace to ORIG_HEAD.
  show <ref> <path>             Cat a file's content from a snapshot ref or live bridge.
                                Ref is HEAD / MERGE_HEAD / ORIG_HEAD / WORKSPACE / BRIDGE
                                / <commit-sha>. BRIDGE fetches from the IDE live without
                                touching the snapshot or workspace (used by the diff click).
                                Commit SHAs are used by the Sync history view.
  log [--limit N] [--json]      Print the snapshot's pull history (each pull = one commit).
                                --json emits structured output for the VS Code extension's
                                Sync history view; default is human-readable.
  help                          Show this list.

Flags:
  --port N                       Bridge port (default 8555, env VOLT_BRIDGE_PORT)
  --workspace DIR                Workspace root (default current working directory)
  --force                        init: repoint; pull: discard local edits; push: bypass drift check
  --force-with-lease=<version>   push only: like --force, but only if the bridge is still at
                                 <version> (= what you saw via volt status). Refuses if the bridge
                                 has moved further. Safer than --force. Same idea as
                                 \`git push --force-with-lease\`.
  --no-merge                     pull only: preserve the v1 refuse-on-dirty behavior. Use when you
                                 want to stash workspace edits manually before pulling.
  --dry-run / -n                 push / pull: compute what would happen and print the preview,
                                 but don't write to the bridge / workspace / snapshot. Mirrors
                                 \`git push --dry-run\` / \`git fetch --dry-run\`.
  --porcelain                    status only: machine-readable one-line-per-item output.
                                 Format: <dir><code> <name> where dir is i (incoming), o
                                 (outgoing), or x (direction-agnostic, mid-merge); code is A / M
                                 / D / U (unmerged). Inspired by \`git status --porcelain\`.
  --json                         status only: a single JSON object covering merging-state,
                                 incoming / outgoing change sets, and projectVersions. Stable
                                 surface for the VS Code extension.
  --full                         build only — full rebuild instead of incremental
  --continue                     merge only — finalize the in-progress merge
  --abort                        merge only — abandon the in-progress merge
  --resolve <path>               merge only — mark <path> resolved with current workspace bytes
                                 (analog of \`git add <path>\` after manual conflict edit).
  --use-ours / --use-theirs      merge only, combine with --resolve — first overwrite <path>
                                 with the workspace-pre-merge content (ours) or the IDE content
                                 (theirs), then mark resolved. Analogs of
                                 \`git checkout --ours/--theirs <path> && git add <path>\`.

A typical session:
  volt init                   # once per workspace
  volt pull                   # pull current IDE state
  # ... edit .st files with your editor / AI of choice
  volt status                 # see what changed
  volt push                   # push edits back to the IDE
  volt build                  # build and read diagnostics

When pull encounters conflicts (you and the engineer touched the same lines):
  volt pull                   # writes <<<<<<< / ======= / >>>>>>> markers, exits 2
  # ... resolve markers in your editor (or use the Volt VS Code extension's merge editor)
  volt merge --continue       # records the merge, advances snapshot
  volt push                   # send the resolved content back to the IDE`;

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
			// Positional args, in order. Stored as `_positional` (first) and
			// `_positional2` (second) — extend if more verbs need 3+.
			// Verbs that don't take positionals ignore the fields.
			if (flags["_positional"] === undefined) flags["_positional"] = arg;
			else if (flags["_positional2"] === undefined) flags["_positional2"] = arg;
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

	const workspace = flagString(flags, "workspace") ?? process.cwd();
	const port = resolveBridgePort(flags, workspace);
	const bridge = new BridgeClient({ port });

	return safeVerb(fn, { workspace, port, bridge, flags });
}

/**
 * Resolve which bridge port to talk to, in precedence order:
 *
 *   1. Explicit `--port N` CLI flag (highest precedence — overrides
 *      everything; useful for one-off targeting of a different bridge)
 *   2. `VOLT_BRIDGE_PORT` env var (set per-shell / per-process)
 *   3. `.volt/config.json` `bridge.port` in the workspace (THE
 *      most common case — `volt init` writes the live bridge's
 *      port here, so subsequent commands and the VS Code extension
 *      automatically target the right IDE without flags)
 *   4. Hardcoded 8555 (TwinCAT default — last-resort for commands
 *      run outside a workspace, e.g. `volt init` itself before
 *      the config exists)
 *
 * Reading the config is best-effort: malformed JSON, missing file,
 * or missing `bridge.port` all silently fall through to the next
 * tier. Verbs that genuinely need a workspace (pull/push/status)
 * will fail later with a clearer error from `loadConfig`.
 */
function resolveBridgePort(flags: Flags, workspaceRoot: string): number {
	const flagged = flagInt(flags, "port", -1);
	if (flagged !== -1) return flagged;

	const envRaw = process.env.VOLT_BRIDGE_PORT;
	if (envRaw !== undefined && envRaw.length > 0) {
		const n = Number.parseInt(envRaw, 10);
		if (Number.isFinite(n) && n > 0) return n;
	}

	const fromConfig = readPortFromConfig(workspaceRoot);
	if (fromConfig !== undefined) return fromConfig;

	return 8555;
}

function readPortFromConfig(workspaceRoot: string): number | undefined {
	try {
		const { configPath } = workspacePaths(workspaceRoot);
		if (!existsSync(configPath)) return undefined;
		const raw = JSON.parse(readFileSync(configPath, "utf-8")) as {
			bridge?: { port?: unknown };
		};
		const p = raw.bridge?.port;
		return typeof p === "number" && p > 0 ? p : undefined;
	} catch {
		return undefined;
	}
}
