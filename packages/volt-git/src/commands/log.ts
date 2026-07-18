/** volt-git log — the IDE-sync history: commits on refs/remotes/volt/ide (the IDE remote), newest first. */
import { commitPaths, listLog, resolveGitDir } from "../git.js";
import { RANGE } from "../domain/ide-tree.js";
import type { LogEntry } from "../types.js";

export type { LogEntry };

export function log(root: string, limit = 20): LogEntry[] {
	const gitDir = resolveGitDir(root);
	return listLog(gitDir, RANGE, limit).map((e) => ({ sha: e.sha, date: e.date, summary: e.subject, paths: commitPaths(gitDir, e.sha) }));
}
