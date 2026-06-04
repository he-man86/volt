/**
 * `volt log` — print the snapshot's pull history.
 *
 * Each entry corresponds to one `volt pull` (or post-push reconcile)
 * commit on `.volt/snapshot/refs/heads/main`. Default: human-readable
 * output (timestamp + short sha + subject). With `--json`: structured
 * output the VS Code extension consumes for its "Sync history" view.
 *
 * Flags:
 *   --limit N     Cap to the N most recent commits (default 50).
 *   --json        Emit one JSON object instead of human-readable lines.
 *   --paths       (human mode) Also list changed paths under each commit.
 *
 * Exit codes:
 *   0  — output written
 *   1  — missing snapshot / unable to read history
 */
import { resolve } from "node:path";
import { workspacePaths } from "../engine/config.js";
import { diffPaths, listLog, resolveRef } from "../engine/git-cmds.js";
import { ensureSnapshotRepo, reportSnapshotHeal } from "../engine/snapshot.js";
import { flagBool, flagInt, type VerbFn } from "./_shared.js";

interface JsonEntry {
	sha: string;
	shaShort: string;
	timestampSec: number;
	subject: string;
	paths: string[];
}

export const log: VerbFn = async ({ workspace, flags }) => {
	const limit = flagInt(flags, "limit", 50);
	const wantJson = flagBool(flags, "json");
	const wantPaths = flagBool(flags, "paths");

	const root = resolve(workspace);
	const paths = workspacePaths(root);
	reportSnapshotHeal(ensureSnapshotRepo(paths.snapshotPath));

	const head = resolveRef(paths.snapshotPath, "refs/heads/main");
	if (head === undefined) {
		// Fresh workspace, never pulled — no history to show.
		if (wantJson) {
			process.stdout.write(`${JSON.stringify({ commits: [] })}\n`);
		} else {
			process.stdout.write("no sync history yet — run `volt pull` to populate.\n");
		}
		return 0;
	}

	const entries = listLog(paths.snapshotPath, head, limit);

	if (wantJson) {
		// Always include changed paths in JSON output — the SCM extension
		// needs them to render the expandable per-commit file list.
		const json = {
			commits: entries.map<JsonEntry>((e) => ({
				sha: e.sha,
				shaShort: e.shaShort,
				timestampSec: e.timestampSec,
				subject: e.subject,
				paths: diffPaths(paths.snapshotPath, e.parentShas[0], e.sha),
			})),
		};
		process.stdout.write(`${JSON.stringify(json)}\n`);
		return 0;
	}

	// Human output.
	for (const e of entries) {
		const ts = new Date(e.timestampSec * 1000).toISOString().replace("T", " ").slice(0, 19);
		process.stdout.write(`${ts}  ${e.shaShort}  ${e.subject}\n`);
		if (wantPaths) {
			for (const p of diffPaths(paths.snapshotPath, e.parentShas[0], e.sha)) {
				process.stdout.write(`    ${p}\n`);
			}
		}
	}
	if (entries.length === 0) {
		process.stdout.write("no sync history yet.\n");
	}
	return 0;
};
