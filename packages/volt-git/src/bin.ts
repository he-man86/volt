#!/usr/bin/env node
/**
 * volt-git CLI entry — init · pull · push · status · log. Resolves the bridge port from --port / env /
 * the workspace binding (8555 default), dispatches, renders the result, sets the exit code.
 */
import { resolve } from "node:path";
import { BridgeClient, isBridgeOfflineError } from "./bridge/client.js";
import { build } from "./build.js";
import { configuredBridgePort } from "./config/workspace.js";
import { commitPaths, listLog, resolveGitDir } from "./git/plumbing.js";
import { init } from "./init.js";
import { merge } from "./merge.js";
import { show } from "./show.js";
import { pull } from "./sync/pull.js";
import { push } from "./sync/push.js";
import { RANGE } from "./sync/refs.js";
import { status } from "./sync/status.js";
import type { ChangeSet, LogEntry, StatusJson } from "./sync/types.js";

const VALUE_FLAGS = new Set(["--workspace", "--port", "--limit", "--resolve"]);

function parseArgs(argv: string[]) {
	const flags = new Set<string>();
	const values: Record<string, string> = {};
	const positional: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]!;
		if (a.startsWith("--")) {
			const eq = a.indexOf("=");
			if (eq >= 0) values[a.slice(0, eq)] = a.slice(eq + 1); // --key=value
			else if (VALUE_FLAGS.has(a)) values[a] = argv[++i] ?? "";
			else flags.add(a);
		} else positional.push(a);
	}
	const portStr = values["--port"] ?? process.env.VOLT_BRIDGE_PORT;
	return {
		verb: positional[0],
		operands: positional.slice(1),
		has: (f: string) => flags.has(f),
		value: (f: string) => values[f],
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
			if (r.scaffold > 0) console.log(`scaffolded ${r.scaffold} project file(s)`);
			if (r.corpus > 0) console.log(`installed ${r.corpus} language-reference file(s)`);
			console.log(r.note !== undefined ? r.note : `pulled ${r.pulled} file(s) — workspace ready`);
			return 0;
		}
		case "pull": {
			const r = await pull(root, bridge, { dryRun: args.has("--dry-run") });
			if (args.has("--json")) {
				process.stdout.write(`${JSON.stringify(r)}\n`);
				return r.kind === "ok" ? 0 : 2;
			}
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
			const r = await push(root, bridge, { force: args.has("--force"), forceWithLease: args.value("--force-with-lease"), dryRun: args.has("--dry-run") });
			if (args.has("--json")) {
				process.stdout.write(`${JSON.stringify(r)}\n`);
				return r.kind === "ok" ? 0 : 2;
			}
			if (r.kind === "rejected") {
				console.error(r.reason);
				return 1;
			}
			console.log(r.message !== undefined ? r.message : `pushed ${r.items.length} item(s)`);
			return 0;
		}
		case "build": {
			const r = await build(bridge, args.has("--full"));
			if (args.has("--json")) {
				process.stdout.write(`${JSON.stringify(r)}\n`);
				return r.success ? 0 : 2;
			}
			console.log(`Build ${r.success ? "succeeded" : "FAILED"} (${r.duration}ms)`);
			for (const d of r.diagnostics) console.log(`  [${d.severity}] ${d.object ?? "(project)"}: ${d.message}`);
			return r.success ? 0 : 2;
		}
		case "status": {
			const s = await status(root, bridge);
			if (args.has("--json")) {
				const json: StatusJson = {
					initialized: s.initialized,
					merging: s.merging,
					incoming: s.incoming,
					outgoing: s.outgoing,
					pathByName: s.pathByName,
					projectMismatch: s.projectMismatch,
					summary: s.summary,
				};
				process.stdout.write(`${JSON.stringify(json)}\n`);
				return 0;
			}
			console.log(`bridge: ${s.online ? "connected" : "offline"} — ${s.detail}`);
			fmtChangeSet("incoming (IDE → you)", s.incoming);
			fmtChangeSet("outgoing (you → IDE)", s.outgoing);
			if (s.merging !== null) {
				console.log(`merge in progress — ${s.merging.conflicts.length} conflict(s):`);
				for (const c of s.merging.conflicts) console.log(`  ! ${c.path}`);
			}
			console.log(s.summary);
			if (s.recommend !== null) console.log(`next: ${s.recommend}`);
			return 0;
		}
		case "log": {
			const gitDir = resolveGitDir(root);
			const limit = Number(args.value("--limit") ?? args.operands[0] ?? "20");
			const entries = listLog(gitDir, RANGE, Number.isFinite(limit) ? limit : 20);
			if (args.has("--json")) {
				const arr: LogEntry[] = entries.map((e) => ({ sha: e.sha, date: e.date, summary: e.subject, paths: commitPaths(gitDir, e.sha) }));
				process.stdout.write(`${JSON.stringify(arr)}\n`);
				return 0;
			}
			if (entries.length === 0) {
				console.log("no sync history yet — run `volt-git pull`.");
				return 0;
			}
			for (const e of entries) console.log(`${e.sha.slice(0, 8)}  ${e.date.slice(0, 10)}  ${e.subject}`);
			return 0;
		}
		case "show": {
			const [ref, rel] = args.operands;
			if (ref === undefined || rel === undefined) {
				console.error("usage: volt-git show <ref> <path>");
				return 1;
			}
			const r = await show(root, bridge, ref, rel);
			if (Buffer.isBuffer(r)) {
				process.stdout.write(r);
				return 0;
			}
			console.error(r.error);
			return 1;
		}
		case "merge": {
			const r = merge(root, {
				continue: args.has("--continue"),
				abort: args.has("--abort"),
				resolve: args.value("--resolve"),
				useOurs: args.has("--use-ours"),
				useTheirs: args.has("--use-theirs"),
			});
			if (r.code === 0) console.log(r.message);
			else console.error(r.message);
			return r.code;
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
