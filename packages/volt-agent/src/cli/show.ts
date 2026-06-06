/**
 * `volt show <ref> <path>` — write a blob's content to stdout.
 *
 * Used by the VS Code extension's `TextDocumentContentProvider` to back
 * virtual `volt://` URIs for the SCM panel and the built-in merge
 * editor. Without this verb, the extension would have to peek inside
 * `.volt/snapshot/objects/` directly, which would couple it tightly
 * to the snapshot's internal layout. This verb is the stable surface.
 *
 * Refs (case-sensitive):
 *
 *   HEAD         — snapshot's current `refs/heads/main` (the last-pulled
 *                  state from the IDE)
 *   MERGE_HEAD   — the in-progress merge's "theirs" commit; only valid
 *                  when a merge is in progress (else exits 1)
 *   ORIG_HEAD    — the pre-merge HEAD; only valid mid-merge
 *   WORKSPACE    — the live workspace file on disk (not a snapshot ref;
 *                  symmetric for callers that want one verb to read all
 *                  four sides of a 3-way merge)
 *   BRIDGE       — the LIVE IDE state, fetched on demand from the bridge.
 *                  Pure-read (zero side effects on snapshot or
 *                  workspace — see `peekBridgeItem` in engine/ops.ts).
 *                  Used by the SCM extension's incoming-change diff
 *                  click so the user sees what the bridge has WITHOUT
 *                  silently overwriting their workspace copy.
 *
 * Exit codes:
 *   0  — content written to stdout
 *   1  — bad arguments / unknown ref / missing snapshot
 *   2  — file not present at that ref (path didn't exist in the tree)
 *
 * Example:
 *   volt show HEAD POUs/FB_Motor.st       # what the IDE had at last pull
 *   volt show MERGE_HEAD POUs/FB_Motor.st # what the IDE has now (mid-merge)
 *   volt show WORKSPACE POUs/FB_Motor.st  # what's in the editor right now
 *   volt show BRIDGE POUs/FB_Motor.st     # what the IDE has RIGHT NOW (live)
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { workspacePaths } from "../engine/config.js";
import {
	listTree,
	readBlobBytes,
	readMergeFile,
	resolveRef,
} from "../engine/git-cmds.js";
import { peekBridgeItem } from "../engine/ops.js";
import { nameFromPath as nameFromTrackedPath } from "../engine/extension-registry.js";
import { ensureSnapshotRepo, reportSnapshotHeal } from "../engine/snapshot.js";
import { flagString, type VerbFn } from "./_shared.js";

type NamedRef = "HEAD" | "MERGE_HEAD" | "ORIG_HEAD" | "WORKSPACE" | "BRIDGE";

/** Hex SHA (4-40 chars). Matches `git rev-parse --short` output too. */
const SHA_RE = /^[0-9a-f]{4,40}$/;

export const show: VerbFn = async ({ workspace, bridge, flags }) => {
	// `flags._positional` holds the first non-flag positional (the ref);
	// the second positional comes from a separate flag arg. The current
	// parser only captures the first positional, so accept both forms:
	//   volt show <ref> <path>
	//   volt show --ref=<ref> --path=<path>
	const positional = flagString(flags, "_positional");
	const refArg = (flagString(flags, "ref") ?? positional) as string | undefined;
	const pathArg = flagString(flags, "path") ?? flagString(flags, "_positional2");

	if (refArg === undefined || pathArg === undefined) {
		process.stderr.write(
			"usage: volt show <ref> <path>\n  where <ref> is HEAD | MERGE_HEAD | ORIG_HEAD | WORKSPACE | BRIDGE | <commit-sha>\n",
		);
		return 1;
	}

	// Named refs are uppercase keywords; commit SHAs are 4-40 hex chars.
	// Anything else is a typo (don't silently accept).
	const isNamedRef = ["HEAD", "MERGE_HEAD", "ORIG_HEAD", "WORKSPACE", "BRIDGE"].includes(refArg);
	const isShaRef = SHA_RE.test(refArg);
	if (!isNamedRef && !isShaRef) {
		process.stderr.write(
			`unknown ref: ${refArg} (expected HEAD / MERGE_HEAD / ORIG_HEAD / WORKSPACE / BRIDGE / <commit-sha>)\n`,
		);
		return 1;
	}

	const root = resolve(workspace);
	const paths = workspacePaths(root);

	if (refArg === "WORKSPACE") {
		const abs = join(root, pathArg);
		if (!existsSync(abs)) {
			process.stderr.write(`not found in workspace: ${pathArg}\n`);
			return 2;
		}
		process.stdout.write(readFileSync(abs));
		return 0;
	}

	if (refArg === "BRIDGE") {
		// Pure-read fetch from the live bridge. peekBridgeItem
		// guarantees no snapshot or workspace mutation — even if the
		// user clicks the diff view a hundred times, their local copy
		// is never silently overwritten. The path must be any tracked
		// workspace path — POU source (`.st`/`.fbd`/`.ld`/...) OR a
		// config item (`.task`/`.xml`/`.visu`/`.tmc`/...).
		const name = nameFromTrackedPath(pathArg);
		if (name === undefined) {
			process.stderr.write(
				`BRIDGE ref requires a tracked workspace path (any of .st/.fbd/.ld/.xml/.task/.visu/.tmc/...); got: ${pathArg}\n`,
			);
			return 1;
		}
		try {
			const outputs = await peekBridgeItem(bridge, name);
			// One bridge item can produce multiple files (parent + any
			// graphical children). Find the one whose path matches what
			// the user asked for; fall back to the parent (first entry)
			// when the path-derived name matched the parent itself.
			const normalized = pathArg.replace(/\\/g, "/");
			const match = outputs.find((o) => o.path === normalized) ?? outputs[0];
			if (match === undefined) {
				process.stderr.write(`bridge produced no content for ${pathArg}\n`);
				return 2;
			}
			process.stdout.write(match.content);
			return 0;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			process.stderr.write(`bridge fetch failed for ${pathArg}: ${msg}\n`);
			return 2;
		}
	}

	reportSnapshotHeal(ensureSnapshotRepo(paths.snapshotPath));

	// Resolve symbolic ref to a commit SHA. SHA refs pass through
	// directly (they're already commit SHAs — used by the activity-bar
	// "Sync history" view to fetch historical versions).
	let commitSha: string | undefined;
	if (isShaRef) {
		commitSha = refArg;
	} else if (refArg === "HEAD") {
		commitSha = resolveRef(paths.snapshotPath, "refs/heads/main");
	} else if (refArg === "MERGE_HEAD") {
		commitSha = readMergeFile(paths.snapshotPath, "MERGE_HEAD")?.trim();
	} else if (refArg === "ORIG_HEAD") {
		commitSha = readMergeFile(paths.snapshotPath, "ORIG_HEAD")?.trim();
	}
	if (commitSha === undefined || commitSha.length === 0) {
		process.stderr.write(`ref not set: ${refArg}\n`);
		return 1;
	}

	const tree = listTree(paths.snapshotPath, commitSha);
	const entry = tree.find((e) => e.path === pathArg);
	if (entry === undefined) {
		process.stderr.write(`not found at ${refArg}: ${pathArg}\n`);
		return 2;
	}
	process.stdout.write(readBlobBytes(paths.snapshotPath, entry.sha));
	return 0;
};
