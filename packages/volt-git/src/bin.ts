#!/usr/bin/env node
/**
 * volt-git CLI entry — init · pull · push · status · build · log · show · merge. Resolves the bridge port from --port / env /
 * the workspace binding (8555 default), dispatches, renders the result, sets the exit code.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { BridgeClient, isBridgeOfflineError } from "./bridge/client.js";
import { build } from "./build.js";
import { configuredBridgePort } from "./config/workspace.js";
import { diff } from "./diff.js";
import { init } from "./init.js";
import { log } from "./log.js";
import { merge } from "./merge.js";
import { setup } from "./setup.js";
import { show } from "./show.js";
import { pull } from "./sync/pull.js";
import { push } from "./sync/push.js";
import { status } from "./sync/status.js";
import type { ChangeSet, StatusJson } from "./sync/types.js";

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

const USAGE = `volt <command> [args] — git-native Volt CLI
  (bare \`volt\`, or any non-PLC command, opens the opencode agent)

  init     bind to the bridge, git-init the project, first pull
  pull     fetch the IDE → git merge into your branch       [--force] [--dry-run]
  push     workspace → IDE → fast-forward refs/remotes/volt/ide      [--force] [--dry-run] [--force-with-lease=<v>]
  status   incoming / outgoing / merge state                [--json]
  build    build via the IDE; returns diagnostics            [--full] [--json]
  log      the IDE-sync history                              [--json] [--limit N]
  show     a file at a ref:  <ref> <path>   (HEAD / MERGE_OURS|THEIRS|BASE / BRIDGE)
  merge    finish a conflicted pull:  --continue | --abort | --resolve <path> [--use-ours|--use-theirs]
  setup    register the volt LSP + tool in opencode's global config (every project gets PLC intelligence)

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
			if (args.has("--porcelain")) {
				const emit = (code: string, names: string[]): void => {
					for (const n of names) console.log(`${code} ${s.pathByName[n] ?? n}`);
				};
				emit("iA", s.incoming.added);
				emit("iM", s.incoming.modified);
				emit("iD", s.incoming.removed);
				emit("oA", s.outgoing.added);
				emit("oM", s.outgoing.modified);
				emit("oD", s.outgoing.removed);
				return 0;
			}
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
			const limit = Number(args.value("--limit") ?? args.operands[0] ?? "20");
			const entries = log(root, Number.isFinite(limit) ? limit : 20);
			if (args.has("--json")) {
				process.stdout.write(`${JSON.stringify(entries)}\n`);
				return 0;
			}
			if (entries.length === 0) {
				console.log("no sync history yet — run `volt-git pull`.");
				return 0;
			}
			for (const e of entries) console.log(`${e.sha.slice(0, 8)}  ${e.date.slice(0, 10)}  ${e.summary}`);
			return 0;
		}
		case "diff": {
			const r = diff(root);
			if (r.kind === "error") {
				if (args.has("--json")) { process.stdout.write("[]\n"); return 0; } // unbound → no outgoing diff
				console.error(r.reason);
				return 1;
			}
			if (args.has("--json")) { process.stdout.write(`${JSON.stringify(r.diffs)}\n`); return 0; }
			for (const d of r.diffs) console.log(`${d.status[0]!.toUpperCase()}  ${d.file}  +${d.additions} -${d.deletions}`);
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
		case "setup": {
			const r = setup();
			console.log("✓ volt setup — opencode will load the volt LSP + tool in every project");
			console.log(`  config: ${r.configFile}`);
			console.log(`  tool:   ${r.toolFile}`);
			console.log(`  lsp:    ${r.lspBin}`);
			console.log(`  cli:    ${r.voltBin}`);
			return 0;
		}
		case "help":
		case "--help":
			console.log(USAGE);
			return 0;
		default:
			console.log(USAGE);
			return args.verb === undefined ? 0 : 1;
	}
}

// `volt` is the single entry point: PLC verbs run this CLI; bare `volt` and anything else (run, auth,
// debug, …) delegate to the opencode agent. So `volt` opens the agent and `volt pull` syncs with the IDE.
const VOLT_VERBS = new Set(["init", "pull", "push", "build", "status", "log", "diff", "show", "merge", "setup", "help"]);
const firstArg = process.argv[2];
if (firstArg === undefined || !VOLT_VERBS.has(firstArg)) {
	const r = spawnSync("opencode", process.argv.slice(2), { stdio: "inherit" });
	process.exit(r.status ?? 0);
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
