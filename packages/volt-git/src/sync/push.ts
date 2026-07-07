/**
 * volt-git push — diff the committed branch (HEAD) against the IDE baseline (refs/remotes/volt/ide), send the
 * changes to the bridge (with ifVersion optimistic-concurrency guards), then fast-forward refs/remotes/volt/ide
 * to HEAD's tree. Like `git push`, it operates on your COMMITTED history — a dirty src/ tree is refused
 * so uncommitted edits are never silently skipped. The worktree is the editing surface, git is the truth.
 */
import type { PushOp, Remote } from "../bridge/types.js";
import { loadConfig, verifyBinding } from "../config/workspace.js";
import { autoCommitSrc, diffRefs, diffWorktree, gitShowBytes, headCommit, resolveGitDir, updateRef } from "../git/plumbing.js";
import { isPushable, isReadOnly, isTrackedPath } from "../registry/extensions.js";
import { pathToItem } from "../translate/materialize.js";
import { stripSrcPrefix } from "../workspace/files.js";
import { computeIncoming, countChanges, hasChanges } from "./diff.js";
import { loadIdeRefs, RANGE, saveIdeRefs, voltIdeHead } from "./refs.js";
import type { PushResult } from "./types.js";

export interface PushOptions {
	force?: boolean;
	/** Lease version: force only if the bridge is still at this projectVersion (atomic force). */
	forceWithLease?: string;
	dryRun?: boolean;
}

export async function push(root: string, bridge: Remote, opts: PushOptions = {}): Promise<PushResult> {
	const gitDir = resolveGitDir(root);
	const cfg = loadConfig(root);
	const bindErr = verifyBinding(cfg, await bridge.getHealth());
	if (bindErr !== undefined) return { kind: "rejected", reason: bindErr };

	const sidecar = loadIdeRefs(root);
	const voltHead = voltIdeHead(gitDir);
	if (sidecar === undefined || voltHead === undefined) {
		return { kind: "rejected", reason: "no IDE baseline yet — run `volt-git pull` once before pushing" };
	}

	// Unrecognized-extension guard (BEFORE committing anything). A file like `Foo.dut` isn't in the
	// extension registry, so the op-builder below silently skips it (pathToItem === undefined) and — if it's
	// the only change — push would falsely report "nothing to push". This is exactly how an AI that names a
	// struct `.dut` (CODESYS's term) instead of `.struct` loses its work with no signal. Fail loud instead:
	// name the offenders + the valid kind extensions, touch no refs, and don't even commit them (so a later
	// rename to a valid extension is a clean add, not a rename off an unknown old path). Mirrors the
	// read-only guard below, but pre-commit and keyed on "not a tracked path at all".
	const foreign = diffWorktree(root, RANGE, "src")
		.filter((r) => r.kind !== "delete")
		.map((r) => stripSrcPrefix(r.kind === "rename" ? r.newPath : r.path))
		.filter((rel) => !isTrackedPath(rel));
	if (foreign.length > 0) {
		return {
			kind: "rejected",
			reason:
				`unrecognized file extension — these can't sync to the IDE and were NOT pushed. Rename each to its ` +
				`Volt kind extension (struct→.struct, enum→.enum, union→.union, alias→.alias; ` +
				`POUs .fb/.prg/.fun/.itf; global var list .gvl):\n${foreign.map((p) => `  ${p}`).join("\n")}`,
		};
	}

	// Simple flow (auto-commit-on-push): commit any working changes, then push the committed branch. A
	// clean tree commits nothing — commit by hand first if you want to control the message/granularity.
	autoCommitSrc(root);

	const refs = await bridge.getRefs();
	if (opts.forceWithLease !== undefined && opts.forceWithLease !== refs.projectVersion) {
		return { kind: "rejected", reason: `--force-with-lease is stale: the IDE is at ${refs.projectVersion}, not ${opts.forceWithLease} — run \`volt-git pull\` first` };
	}
	const forcing = opts.force === true || opts.forceWithLease === refs.projectVersion;

	// Drift: the IDE moved since our baseline → pull first (unless forcing).
	const drift = computeIncoming(refs.items, sidecar.items);
	if (refs.projectVersion !== sidecar.projectVersion && hasChanges(drift) && !forcing) {
		const n = countChanges(drift);
		return { kind: "rejected", reason: `the IDE changed since your last sync (${n} item(s)) — run \`volt-git pull\` first (or push --force)` };
	}
	// Forcing clobbers the IDE's current state, so guard against THAT (not the stale baseline).
	const guardItems = forcing ? refs.items : sidecar.items;
	const guardProjectVersion = forcing ? refs.projectVersion : sidecar.projectVersion;

	// Content comes from the committed blob (HEAD), not the worktree — the clean-tree guard above
	// guarantees they're identical, but reading git keeps the engine's source of truth unambiguous.
	const headSrc = (rel: string): string => gitShowBytes(root, "HEAD", `src/${rel}`)?.toString("utf-8") ?? "";

	const rows = diffRefs(root, RANGE, "HEAD", "src");

	const affected = rows.flatMap((r) => (r.kind === "rename" ? [stripSrcPrefix(r.oldPath), stripSrcPrefix(r.newPath)] : [stripSrcPrefix(r.path)]));
	// Read-only = a reference-kind extension (library/task/visu/…). Graphical CFC/SFC POU bodies are no
	// longer content-marked; a push over one is refused by the bridge on LIVE IDE state (BodyLanguage), so
	// there's nothing to pre-filter by content here.
	const readOnly = affected.filter((p) => isReadOnly(p));
	if (readOnly.length > 0) {
		return { kind: "rejected", reason: `read-only items can't be pushed — revert these:\n${readOnly.map((p) => `  ${p}`).join("\n")}` };
	}

	// Each diff row → exactly one op. A rename / move / edit (any combination) is one declarative `set`:
	// the bridge applies it atomically — native rename (call-sites updated) → recreate-move (name-based
	// refs survive) → content via the shared writer. No classification, no refusals, no fallbacks.
	const ops: PushOp[] = [];
	const setForChange = (rel: string): void => {
		const item = pathToItem(rel);
		if (item === undefined || !isPushable(rel)) return; // folder markers / foreign files — not IDE items
		const ifVersion = guardItems[item.name] ?? null;
		ops.push({
			op: "set",
			name: item.name,
			toFolder: ifVersion === null ? item.folder : undefined, // create: placement; update: folder unchanged
			sourceText: headSrc(rel),
			ifVersion,
		});
	};

	for (const row of rows) {
		if (row.kind === "delete") {
			const rel = stripSrcPrefix(row.path);
			const item = pathToItem(rel);
			if (item === undefined || !isPushable(rel)) continue;
			const v = guardItems[item.name];
			if (v !== undefined) ops.push({ op: "deleteItem", name: item.name, ifVersion: v });
		} else if (row.kind === "rename") {
			const newRel = stripSrcPrefix(row.newPath);
			if (!isPushable(newRel)) continue; // folder marker / foreign file
			const o = pathToItem(stripSrcPrefix(row.oldPath));
			const n = pathToItem(newRel)!;
			if (o === undefined) {
				// The old side was never an IDE item (e.g. a foreign-extension file that slipped into HEAD
				// out-of-band, now renamed to a valid kind). Treat it as a plain create of the new item —
				// not a rename off a nonexistent identity (which would crash on o.name).
				setForChange(newRel);
				continue;
			}
			const ver = guardItems[o.name];
			if (ver === undefined) throw new Error(`renamed item '${o.name}' has no known IDE version — run \`volt-git pull\` first`);
			ops.push({
				op: "set",
				name: o.name,
				toName: o.name !== n.name ? n.name : undefined, // name change
				toFolder: o.folder !== n.folder ? n.folder : undefined, // folder change
				sourceText: row.identical ? undefined : headSrc(newRel), // content change (R<100)
				ifVersion: ver,
			});
		} else {
			setForChange(stripSrcPrefix(row.path)); // add | modify
		}
	}

	if (ops.length === 0) return { kind: "ok", items: [], message: "nothing to push — the IDE already matches your workspace" };
	if (opts.dryRun === true) return { kind: "ok", items: ops.map((o) => o.name), message: "dry run — would push these item(s)" };

	const resp = await bridge.pushBatch({ ops, expectedProjectVersion: guardProjectVersion });
	if (!resp.accepted) {
		const lines = resp.conflicts.map((c) => `  ${c.name}: ${c.reason}`).join("\n");
		return { kind: "rejected", reason: `the bridge rejected the push:\n${lines}` };
	}

	// Point refs/remotes/volt/ide AT HEAD — exactly what you just pushed. Like `git push` landing
	// origin/main on main: the graph now shows `volt/ide` sitting on your pushed commit (in sync). As you
	// commit more locally, main moves ahead of volt/ide → your unpushed work, shown the git-native way.
	const after = await bridge.getRefs();
	saveIdeRefs(root, { projectVersion: after.projectVersion, items: after.items, folders: after.folders });
	updateRef(gitDir, RANGE, headCommit(root)!);

	return { kind: "ok", items: ops.map((o) => o.name) };
}
