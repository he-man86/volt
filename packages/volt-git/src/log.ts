/** volt-git log — the IDE-sync history: commits on refs/remotes/volt/ide (the IDE remote), newest first. */
import { commitPaths, listLog, resolveGitDir } from "./git/plumbing.js";
import { RANGE } from "./sync/refs.js";

export interface LogEntry {
	sha: string;
	date: string;
	summary: string;
	paths: string[];
}

export function log(root: string, limit = 20): LogEntry[] {
	const gitDir = resolveGitDir(root);
	return listLog(gitDir, RANGE, limit).map((e) => ({ sha: e.sha, date: e.date, summary: e.subject, paths: commitPaths(gitDir, e.sha) }));
}
