/** Pure change-set helpers shared by pull/push/status. */
import type { ChangeSet } from "./types.js";

/** Compare the bridge's item→version map against the baseline (what the IDE last had). */
export function computeIncoming(bridge: Record<string, string>, base: Record<string, string>): ChangeSet {
	const added: string[] = [];
	const modified: string[] = [];
	const removed: string[] = [];
	for (const [name, v] of Object.entries(bridge)) {
		if (!(name in base)) added.push(name);
		else if (base[name] !== v) modified.push(name);
	}
	for (const name of Object.keys(base)) if (!(name in bridge)) removed.push(name);
	return { added: added.sort(), modified: modified.sort(), removed: removed.sort() };
}

export function hasChanges(c: ChangeSet): boolean {
	return c.added.length + c.modified.length + c.removed.length > 0;
}

export function changeList(c: ChangeSet): string[] {
	return [...c.added, ...c.modified, ...c.removed].sort();
}
