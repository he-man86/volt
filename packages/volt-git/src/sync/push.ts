/**
 * volt-git push — diff the workspace src/ against the IDE baseline (refs/volt/ide), send the changes to
 * the bridge (with ifVersion optimistic-concurrency guards), then fast-forward refs/volt/ide to the
 * just-pushed state. Push works on an uncommitted tree (it only reads src/ + moves the hidden ref).
 */
import type { PushOp, Remote } from "../bridge/types.js";
import { loadConfig, verifyBinding } from "../config/workspace.js";
import { diffRows, headCommit, resolveGitDir, updateRef, type DiffRow } from "../git/plumbing.js";
import { getByPath } from "../registry/extensions.js";
import { pathToItem } from "../translate/materialize.js";
import { listSrcFiles, readSrcFile, stripSrcPrefix } from "../workspace/files.js";
import { computeIncoming, hasChanges } from "./diff.js";
import { buildVoltIdeTree, commitVoltIde, loadIdeRefs, RANGE, saveIdeRefs, voltIdeHead } from "./refs.js";
import type { PushResult } from "./types.js";

export interface PushOptions {
	force?: boolean;
	/** Lease version: force only if the bridge is still at this projectVersion (atomic force). */
	forceWithLease?: string;
	dryRun?: boolean;
}

const isReadOnly = (rel: string): boolean => getByPath(rel)?.defaultAccess === "r";
const isPushable = (rel: string): boolean => getByPath(rel)?.defaultAccess === "rw";

/** A rename the IDE can apply atomically: content unchanged (R100) and exactly ONE axis changed —
 *  a move (folder only) or a rename (name only). Names are globally unique, so those map 1:1 to the
 *  bridge's moveItem/renameItem. Anything else can't be expressed in one batch. */
function cleanStructural(r: DiffRow): boolean {
	if (r.kind !== "rename" || !r.identical) return false;
	const o = pathToItem(stripSrcPrefix(r.oldPath));
	const n = pathToItem(stripSrcPrefix(r.newPath));
	if (o === undefined || n === undefined) return false;
	return (o.name !== n.name) !== (o.folder !== n.folder); // XOR: exactly one axis changed
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

	const refs = await bridge.getRefs();
	if (opts.forceWithLease !== undefined && opts.forceWithLease !== refs.projectVersion) {
		return { kind: "rejected", reason: `--force-with-lease is stale: the IDE is at ${refs.projectVersion}, not ${opts.forceWithLease} — run \`volt-git pull\` first` };
	}
	const forcing = opts.force === true || opts.forceWithLease === refs.projectVersion;

	// Drift: the IDE moved since our baseline → pull first (unless forcing).
	const drift = computeIncoming(refs.items, sidecar.items);
	if (refs.projectVersion !== sidecar.projectVersion && hasChanges(drift) && !forcing) {
		const n = drift.added.length + drift.modified.length + drift.removed.length;
		return { kind: "rejected", reason: `the IDE changed since your last sync (${n} item(s)) — run \`volt-git pull\` first (or push --force)` };
	}
	// Forcing clobbers the IDE's current state, so guard against THAT (not the stale baseline).
	const guardItems = forcing ? refs.items : sidecar.items;
	const guardProjectVersion = forcing ? refs.projectVersion : sidecar.projectVersion;

	const rows = diffRows(root, RANGE, "src");

	const affected = rows.flatMap((r) => (r.kind === "rename" ? [stripSrcPrefix(r.oldPath), stripSrcPrefix(r.newPath)] : [stripSrcPrefix(r.path)]));
	const readOnly = affected.filter(isReadOnly);
	if (readOnly.length > 0) {
		return { kind: "rejected", reason: `read-only items can't be pushed — revert these:\n${readOnly.map((p) => `  ${p}`).join("\n")}` };
	}

	// No fallbacks: a rename the bridge can't apply atomically (renamed AND edited, or renamed AND moved)
	// is refused loudly — never silently downgraded to delete+add (which would drop the IDE's references).
	const unsplittable = rows.filter((r): r is Extract<DiffRow, { kind: "rename" }> => r.kind === "rename" && isPushable(stripSrcPrefix(r.newPath)) && !cleanStructural(r));
	if (unsplittable.length > 0) {
		const list = unsplittable.map((r) => `  ${stripSrcPrefix(r.oldPath)} → ${stripSrcPrefix(r.newPath)}`).join("\n");
		return {
			kind: "rejected",
			reason: `renamed AND edited (or moved) in one step — the IDE can't apply that atomically. Make ONE change at a time: rename or move on its own → push → then the content edit:\n${list}`,
		};
	}

	const ops: PushOp[] = [];
	const addOp = (rel: string): void => {
		const item = pathToItem(rel);
		if (item === undefined || !isPushable(rel)) return; // folder markers / foreign files — not IDE items
		ops.push({ op: "pushItem", name: item.name, folder: item.folder, sourceText: readSrcFile(root, rel), ifVersion: guardItems[item.name] ?? null });
	};
	const delOp = (rel: string): void => {
		const item = pathToItem(rel);
		if (item === undefined || !isPushable(rel)) return;
		const v = guardItems[item.name];
		if (v !== undefined) ops.push({ op: "deleteItem", name: item.name, ifVersion: v });
	};

	for (const row of rows) {
		if (row.kind === "rename") {
			const newRel = stripSrcPrefix(row.newPath);
			if (!isPushable(newRel)) continue; // folder marker / foreign file
			const o = pathToItem(stripSrcPrefix(row.oldPath))!;
			const n = pathToItem(newRel)!; // pushable ⇒ both resolve (validated by cleanStructural above)
			const ver = guardItems[o.name];
			if (ver === undefined) throw new Error(`renamed item '${o.name}' has no known IDE version — run \`volt-git pull\` first`);
			if (o.name === n.name) ops.push({ op: "moveItem", name: o.name, newFolder: n.folder, ifVersion: ver });
			else ops.push({ op: "renameItem", name: o.name, newName: n.name, ifVersion: ver });
		} else if (row.kind === "delete") {
			delOp(stripSrcPrefix(row.path));
		} else {
			addOp(stripSrcPrefix(row.path)); // add | modify
		}
	}

	if (ops.length === 0) return { kind: "ok", items: [], message: "nothing to push — the IDE already matches your workspace" };
	if (opts.dryRun === true) return { kind: "ok", items: ops.map((o) => o.name), message: "dry run — would push these item(s)" };

	const resp = await bridge.pushBatch({ ops, expectedProjectVersion: guardProjectVersion });
	if (!resp.accepted) {
		const lines = resp.conflicts.map((c) => `  ${c.name}: ${c.reason}`).join("\n");
		return { kind: "rejected", reason: `the bridge rejected the push:\n${lines}` };
	}

	// Advance the baseline + fast-forward refs/volt/ide to the pushed state.
	const after = await bridge.getRefs();
	saveIdeRefs(root, { projectVersion: after.projectVersion, items: after.items, folders: after.folders });
	const tree = buildVoltIdeTree(gitDir, headCommit(root), listSrcFiles(root));
	updateRef(gitDir, RANGE, commitVoltIde(gitDir, tree, voltHead, `volt: pushed → IDE @ ${after.projectVersion}`));

	return { kind: "ok", items: ops.map((o) => o.name) };
}
