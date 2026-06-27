#!/usr/bin/env node
/**
 * volt-git CLI entry — init · pull · push · status · log. Resolves the bridge port from --port / env /
 * the workspace binding (8555 default), dispatches, renders the result, sets the exit code.
 */
import { resolve } from "node:path";
import { BridgeClient, isBridgeOfflineError } from "./bridge/client.js";
import { configuredBridgePort } from "./config/workspace.js";
import { listLog, resolveGitDir } from "./git/plumbing.js";
import { init } from "./init.js";
import { pull } from "./sync/pull.js";
import { push } from "./sync/push.js";
import { RANGE } from "./sync/refs.js";
import { status } from "./sync/status.js";
import type { ChangeSet } from "./sync/types.js";

const VALUE_FLAGS = new Set(["--workspace", "--port"]);

function parseArgs(argv: string[]) {
	const flags = new Set<string>();
	const values: Record<string, string> = {};
	const positional: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]!;
		if (a.startsWith("--")) {
			if (VALUE_FLAGS.has(a)) values[a] = argv[++i] ?? "";
			else flags.add(a);
		} else positional.push(a);
	}
	const portStr = values["--port"] ?? process.env.VOLT_BRIDGE_PORT;
	return {
		verb: positional[0],
		operands: positional.slice(1),
		has: (f: string) => flags.has(f),
		workspace: values["--workspace"] ?? process.env.VOLT_WORKSPACE ?? process.cwd(),
		port: portStr !== undefined && portStr !== "" ? Number(portStr) : undefined,
	};
}

function fmtChangeSet(label: string, c: ChangeSet): void {
	const total = c.added.length + c.modified.length + c.removed.length;
	if (total === 0) return;
	console.log(`${label} (${total}):`);
	for (const p of c.added) console.log(`  + ${p}`);
	for (const p of c.modified) console.log(`  ~ ${p}`);
	for (const p of c.removed) console.log(`  - ${p}`);
}

const USAGE = `volt-git — git-native Volt CLI

  volt-git init     bind to the bridge, git-init the project, first pull
  volt-git pull     fetch the IDE → git merge into your branch   [--force] [--dry-run]
  volt-git push     workspace → IDE → fast-forward refs/volt/ide  [--force] [--dry-run]
  volt-git status   incoming / outgoing / merge state
  volt-git log      the IDE-sync history (git log refs/volt/ide)

  flags: --workspace <dir>  --port <n>`;

async function main(): Promise<number> {
	const args = parseArgs(process.argv.slice(2));
	const root = resolve(args.workspace);
	const port = args.port ?? configuredBridgePort(root) ?? 8555;
	const bridge = new BridgeClient({ port });

	switch (args.verb) {
		case "init": {
			const r = await init(args.workspace, bridge);
			if (r.kind === "error") {
				console.error(r.reason);
				return 1;
			}
			console.log(`bound to ${r.project}`);
			if (r.gitCreated) console.log("initialized a git repo for version control");
			console.log(r.note !== undefined ? r.note : `pulled ${r.pulled} file(s) — workspace ready`);
			return 0;
		}
		case "pull": {
			const r = await pull(root, bridge, { dryRun: args.has("--dry-run") });
			if (r.kind === "refused") {
				console.error(r.reason);
				return 1;
			}
			if (r.kind === "conflict") {
				console.log(`CONFLICT in ${r.paths.length} file(s) — resolve the markers, then \`git merge --continue\` (or \`git merge --abort\`):`);
				for (const p of r.paths) console.log(`  ! ${p}`);
				return 2;
			}
			console.log(r.message !== undefined ? r.message : `pulled ${r.synced.length} file(s)`);
			return 0;
		}
		case "push": {
			const r = await push(root, bridge, { force: args.has("--force"), dryRun: args.has("--dry-run") });
			if (r.kind === "rejected") {
				console.error(r.reason);
				return 1;
			}
			console.log(r.message !== undefined ? r.message : `pushed ${r.items.length} item(s)`);
			return 0;
		}
		case "status": {
			const s = await status(root, bridge);
			console.log(`bridge: ${s.bridge.online ? "connected" : "offline"} — ${s.bridge.detail}`);
			fmtChangeSet("incoming (IDE → you)", s.incoming);
			fmtChangeSet("outgoing (you → IDE)", s.outgoing);
			if (s.merging !== null) {
				console.log(`merge in progress — ${s.merging.paths.length} conflict(s):`);
				for (const p of s.merging.paths) console.log(`  ! ${p}`);
			}
			const clean = s.incoming.added.length + s.incoming.modified.length + s.incoming.removed.length === 0 && s.outgoing.added.length + s.outgoing.modified.length + s.outgoing.removed.length === 0 && s.merging === null;
			if (clean) console.log("in sync with the IDE.");
			if (s.recommend !== null) console.log(`next: ${s.recommend}`);
			return 0;
		}
		case "log": {
			const entries = listLog(resolveGitDir(root), RANGE, args.operands[0] !== undefined ? Number(args.operands[0]) : 20);
			if (entries.length === 0) {
				console.log("no sync history yet — run `volt-git pull`.");
				return 0;
			}
			for (const e of entries) console.log(`${e.sha.slice(0, 8)}  ${e.date.slice(0, 10)}  ${e.subject}`);
			return 0;
		}
		default:
			console.log(USAGE);
			return args.verb === undefined ? 0 : 1;
	}
}

main()
	.then((code) => {
		process.exitCode = code;
	})
	.catch((err: unknown) => {
		if (isBridgeOfflineError(err)) {
			console.error("bridge is not reachable — is the IDE bridge running? (check the port)");
		} else {
			console.error(err instanceof Error ? err.message : String(err));
		}
		process.exitCode = 1;
	});
