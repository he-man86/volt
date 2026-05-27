/**
 * `plc pull` verb — pull IDE state into the workspace.
 *
 * Supports `--dry-run` / `-n` to preview the incoming ChangeSet
 * without writing anything (modeled on `git fetch --dry-run`).
 */
import { runPull } from "../engine/pull.js";
import { flagBool, type VerbFn } from "./_shared.js";

export const pullVerb: VerbFn = async ({ workspace, bridge, flags }) => {
	const dryRun = flagBool(flags, "dry-run");
	const r = await runPull(workspace, bridge, {
		force: flagBool(flags, "force"),
		dryRun,
	});
	const inc = r.incoming;
	const incCount = inc.added.length + inc.modified.length + inc.removed.length;
	if (dryRun) {
		if (incCount === 0) {
			console.log("dry-run — already up to date, nothing to pull.");
		} else {
			console.log("would pull from bridge (dry-run):");
			for (const n of inc.added) console.log(`  [IDE] + ${n}  (engineer created)`);
			for (const n of inc.modified) console.log(`  [IDE] M ${n}  (engineer edited)`);
			for (const n of inc.removed) console.log(`  [IDE] - ${n}  (engineer deleted)`);
			console.log("dry-run — workspace and snapshot were NOT touched.");
		}
	} else if (r.upToDate && r.written.length === 0 && r.removed.length === 0) {
		console.log("already up to date.");
	} else {
		console.log(`pulled: ${r.written.length} file(s), removed: ${r.removed.length} file(s).`);
	}
	return 0;
};
