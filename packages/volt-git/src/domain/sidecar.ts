/**
 * The optimistic-concurrency baseline — what the IDE last had — persisted at `.git/volt/ide-refs.json`
 * (machine-local, inside `.git` so git never tracks it). pull/push read it to diff against the bridge and
 * advance it after a successful sync. The git-native ref side of the model lives in `ide-tree.ts`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { workspacePaths } from "../config.js";

export interface IdeRefs {
	projectVersion: string;
	items: Record<string, string>; // full name → version  (what the IDE last had)
	folders: Record<string, string>; // full name → folder
}

export function loadIdeRefs(root: string): IdeRefs | undefined {
	const p = workspacePaths(root).ideRefsPath;
	if (!existsSync(p)) return undefined; // no baseline yet — expected before the first pull
	// A present-but-corrupt sidecar is unexpected: throw loudly (malformed JSON throws here too).
	const raw = JSON.parse(readFileSync(p, "utf-8")) as Partial<IdeRefs>;
	if (raw.projectVersion === undefined || raw.items === undefined || raw.folders === undefined) {
		throw new Error(`.git/volt/ide-refs.json is malformed — delete it and run \`volt pull\` to rebuild the baseline`);
	}
	return raw as IdeRefs;
}

export function saveIdeRefs(root: string, refs: IdeRefs): void {
	const paths = workspacePaths(root);
	mkdirSync(paths.stateDir, { recursive: true });
	writeFileSync(paths.ideRefsPath, JSON.stringify(refs, null, 2) + "\n");
}
