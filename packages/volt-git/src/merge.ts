/**
 * volt-git merge — a thin shim over native git so the `merge` verb (and its opencode.json gate +
 * vscode mergeCmd) keeps working in the git-native model. `--continue`/`--abort` map to git;
 * `--resolve <path> [--use-ours|--use-theirs]` takes one whole side of a conflict.
 */
import { checkoutSide, mergeAbort, mergeContinue, unmergedPaths } from "./git/plumbing.js";
import { SRC_DIR } from "./workspace/files.js";

export interface MergeOptions {
	continue?: boolean;
	abort?: boolean;
	resolve?: string;
	useOurs?: boolean;
	useTheirs?: boolean;
}
export interface MergeResult {
	code: number;
	message: string;
}

export function merge(root: string, opts: MergeOptions): MergeResult {
	if (opts.abort === true) {
		mergeAbort(root);
		return { code: 0, message: "merge aborted — workspace restored" };
	}
	if (opts.resolve !== undefined) {
		const side = opts.useTheirs === true ? "theirs" : "ours";
		checkoutSide(root, `${SRC_DIR}/${opts.resolve}`, side);
		return { code: 0, message: `resolved ${opts.resolve} using ${side}` };
	}
	if (opts.continue === true) {
		const unresolved = unmergedPaths(root);
		if (unresolved.length > 0) {
			return { code: 2, message: `still ${unresolved.length} unresolved file(s) — resolve the markers (or \`volt-git merge --resolve <path> --use-ours|--use-theirs\`) first` };
		}
		mergeContinue(root);
		return { code: 0, message: "merge completed" };
	}
	return { code: 1, message: "merge: pass --continue, --abort, or --resolve <path> [--use-ours|--use-theirs]" };
}
