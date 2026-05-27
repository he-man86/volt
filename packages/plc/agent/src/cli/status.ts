/**
 * `plc status` verb — show what differs between IDE, snapshot, and workspace.
 *
 * Default output is shaped like `git status`: a one-line summary, then
 * a per-item breakdown labelled with the VCS-standard direction terms.
 * `incoming` ([IDE] block) = `hg incoming` / `HEAD..@{u}`.
 * `outgoing` ([WS] block)  = `hg outgoing` / `@{u}..HEAD`.
 *
 * `--porcelain` outputs ONLY one line per item, in a stable
 * machine-parseable format (inspired by `git status --porcelain`):
 *   <dir><code> <name>
 * where <dir> is `i` (incoming) or `o` (outgoing), <code> is `A`
 * (added), `M` (modified), or `D` (deleted), separated from the name
 * by a single space. No preamble, no summary, no projectVersion
 * footer — empty stdout means clean. Sorted: incoming items first
 * (alphabetical within a code), then outgoing.
 */
import { runStatus } from "../engine/status.js";
import { hasChanges, type ChangeSet } from "../engine/snapshot.js";
import { flagBool, type VerbFn } from "./_shared.js";

export const status: VerbFn = async ({ workspace, bridge, flags }) => {
	const r = await runStatus(workspace, bridge);

	if (flagBool(flags, "porcelain")) {
		// Pre-init / pre-bind: nothing to report yet. Empty stdout is
		// the correct porcelain answer — scripts that care can check
		// the exit code from a later verb. Print a sentinel to stderr
		// so a human running it interactively isn't confused.
		if (!r.initialized) {
			process.stderr.write(`# ${r.summary}\n`);
			return 0;
		}
		writePorcelain("i", r.incoming);
		writePorcelain("o", r.outgoing);
		return 0;
	}

	if (!r.initialized) {
		console.log(r.summary);
		console.log(`bridge projectVersion: ${r.bridgeProjectVersion}`);
		return 0;
	}

	console.log(r.summary);
	console.log("");

	if (hasChanges(r.incoming)) {
		console.log("incoming — would land in workspace on plc pull:");
		for (const name of r.incoming.added) console.log(`  [IDE] + ${name}  (engineer created)`);
		for (const name of r.incoming.modified) console.log(`  [IDE] M ${name}  (engineer edited)`);
		for (const name of r.incoming.removed) console.log(`  [IDE] - ${name}  (engineer deleted)`);
	}
	if (r.workspaceDirty) {
		if (hasChanges(r.incoming)) console.log("");
		console.log("outgoing — would be sent to bridge on plc push:");
		for (const name of r.outgoing.added) console.log(`  [WS]  + ${name}  (you created)`);
		for (const name of r.outgoing.modified) console.log(`  [WS]  M ${name}  (you edited)`);
		for (const name of r.outgoing.removed) console.log(`  [WS]  - ${name}  (you deleted)`);
	}

	if (r.availableCapabilities.length > 0) {
		console.log("");
		console.log("active capability leases (AI can use these elevated parameters):");
		for (const cap of r.availableCapabilities) {
			const oneShot = cap.oneShot ? " (one-shot)" : "";
			console.log(`  [AUTH] ${cap.capability}  expires in ${cap.expiresInSeconds}s${oneShot}`);
		}
	}

	console.log("");
	console.log(`snapshot projectVersion: ${r.snapshotProjectVersion ?? "<none>"}`);
	console.log(`bridge   projectVersion: ${r.bridgeProjectVersion}`);
	return 0;
};

function writePorcelain(dir: "i" | "o", c: ChangeSet): void {
	for (const n of c.added) process.stdout.write(`${dir}A ${n}\n`);
	for (const n of c.modified) process.stdout.write(`${dir}M ${n}\n`);
	for (const n of c.removed) process.stdout.write(`${dir}D ${n}\n`);
}
