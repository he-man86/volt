/**
 * volt-git show <ref> <src-relative-path> → raw file bytes at a ref. Used by the vscode diff/merge
 * editor + file-restore. Refs: HEAD / any git ref, VOLTIDE (the last-synced IDE baseline = refs/volt/ide,
 * the baseline both the incoming + outgoing diffs compare against), the merge sides (MERGE_OURS=HEAD,
 * MERGE_THEIRS=MERGE_HEAD, MERGE_BASE=merge-base), and BRIDGE (the live IDE item).
 */
import type { Remote } from "./bridge/types.js";
import { gitShowBytes, mergeBase } from "./git/plumbing.js";
import { fullNameFromPath } from "./registry/extensions.js";
import { RANGE } from "./sync/refs.js";
import { SRC_DIR } from "./workspace/files.js";

export async function show(root: string, bridge: Remote, ref: string, rel: string): Promise<Buffer | { error: string }> {
	if (ref === "BRIDGE") {
		const name = fullNameFromPath(rel);
		if (name === undefined) return { error: `unrecognized path: ${rel}` };
		const resp = await bridge.fetchChanges({ knownItems: { [name]: "" }, onlyItems: [name] });
		const item = resp.changed.find((i) => i.name === name);
		return item !== undefined ? Buffer.from(item.sourceText, "utf-8") : { error: `bridge has no item ${name}` };
	}
	const gitRef =
		ref === "VOLTIDE" ? RANGE
		: ref === "MERGE_OURS" ? "HEAD"
		: ref === "MERGE_THEIRS" ? "MERGE_HEAD"
		: ref === "MERGE_BASE" ? mergeBase(root, "HEAD", "MERGE_HEAD")
		: ref;
	if (gitRef === undefined) return { error: "no merge in progress (MERGE_BASE unavailable)" };
	const bytes = gitShowBytes(root, gitRef, `${SRC_DIR}/${rel}`);
	return bytes !== undefined ? bytes : { error: `${rel} not found at ${ref}` };
}
