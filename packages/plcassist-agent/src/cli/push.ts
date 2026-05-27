/**
 * `plc push` verb — push workspace state to the IDE.
 *
 * Exit code 2 is reserved for "the push DIDN'T happen because of
 * drift or bridge rejection" — distinct from "1 = something errored."
 * That lets shells / CI distinguish drift (user intervention needed)
 * from infrastructure failures.
 *
 * When `--force` overrides IDE drift, the verb prints the list of
 * items that came IN to the workspace as part of the post-push
 * reconcile. These are items the engineer had added that are now in
 * your workspace — NOT items that were overwritten. (Force-push
 * doesn't delete engineer-side items; it just bypasses the version
 * guard.)
 */
import { runPush } from "../engine/push.js";
import type { ChangeSet } from "../engine/snapshot.js";
import { flagBool, flagString, type VerbFn } from "./_shared.js";

export const pushVerb: VerbFn = async ({ workspace, bridge, flags }) => {
	const r = await runPush(workspace, bridge, {
		force: flagBool(flags, "force"),
		forceWithLease: flagString(flags, "force-with-lease"),
		dryRun: flagBool(flags, "dry-run"),
	});
	switch (r.status) {
		case "ok":
			printPushed(r.pushed, r.dryRun === true);
			if (r.adoptedFromBridge !== undefined && r.adoptedFromBridge.length > 0) {
				printAdopted(r.adoptedFromBridge, r.dryRun === true);
			}
			if (r.dryRun === true) {
				console.log("dry-run — nothing was sent to the bridge.");
			} else {
				console.log(`pushed. snapshot now @ ${r.commitSha.slice(0, 12)}`);
			}
			return 0;
		case "nothing_to_push":
			console.log("nothing to push — workspace matches snapshot.");
			return 0;
		case "lease_stale": {
			process.stderr.write(
				`--force-with-lease refused: bridge has moved further than what you expected.\n` +
					`  expected:  ${r.expectedProjectVersion}\n` +
					`  current:   ${r.bridgeProjectVersion}\n\n` +
					`Someone (or another client) changed the bridge AFTER you observed it. ` +
					`Re-run \`plc status\` to see what's new, then retry — use the bridge's ` +
					`current projectVersion as your new lease.\n`,
			);
			const c = r.incoming;
			if (c.added.length + c.modified.length + c.removed.length > 0) {
				process.stderr.write("\nincoming since your lease was issued:\n");
				for (const n of c.added) process.stderr.write(`  [IDE] + ${n}\n`);
				for (const n of c.modified) process.stderr.write(`  [IDE] M ${n}\n`);
				for (const n of c.removed) process.stderr.write(`  [IDE] - ${n}\n`);
			}
			return 2;
		}
		case "drift_detected": {
			process.stderr.write(
				`drift detected: IDE has changed since last pull.\n` +
					`  local snapshot:  ${r.localProjectVersion}\n` +
					`  bridge current:  ${r.bridgeProjectVersion}\n`,
			);
			const c = r.incoming;
			const anyChanges = c.added.length + c.modified.length + c.removed.length > 0;
			if (anyChanges) {
				process.stderr.write("\nincoming (engineer-side changes):\n");
				for (const n of c.added) process.stderr.write(`  [IDE] + ${n}\n`);
				for (const n of c.modified) process.stderr.write(`  [IDE] M ${n}\n`);
				for (const n of c.removed) process.stderr.write(`  [IDE] - ${n}\n`);
			}
			process.stderr.write(
				`\nrun \`plc pull\` to bring in IDE changes, or \`plc push --force\` to push anyway ` +
					`(force does NOT delete the engineer's items — it bypasses the version guard and ` +
					`reconciles your workspace with the bridge afterwards).\n`,
			);
			return 2;
		}
		case "rejected":
			process.stderr.write(`bridge rejected push: ${r.reason}\n`);
			return 2;
	}
};

function printPushed(p: ChangeSet, dryRun: boolean): void {
	const total = p.added.length + p.modified.length + p.removed.length;
	if (total === 0) return;
	process.stdout.write(dryRun ? "would push to bridge (dry-run):\n" : "pushed to bridge:\n");
	for (const n of p.added) process.stdout.write(`  [WS]  + ${n}  (created)\n`);
	for (const n of p.modified) process.stdout.write(`  [WS]  M ${n}  (updated)\n`);
	for (const n of p.removed) process.stdout.write(`  [WS]  - ${n}  (deleted)\n`);
}

function printAdopted(adopted: string[], dryRun: boolean): void {
	const header = dryRun
		? "--force / --force-with-lease was used. The following items would be pulled in as part of " +
			"the post-push reconcile (NOT overwritten on the bridge):\n"
		: "--force was used. The following items were on the bridge but NOT in your workspace " +
			"and have been pulled in as part of the post-push reconcile:\n";
	process.stderr.write(header);
	for (const n of adopted) process.stderr.write(`  [IDE] + ${n}  (added to workspace)\n`);
	if (!dryRun) {
		process.stderr.write(
			"These items were NOT overwritten — they survived the force-push and now live in your workspace too.\n\n",
		);
	}
}
