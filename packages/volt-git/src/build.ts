/** volt-git build — delegate to the bridge's build endpoint + return normalized diagnostics. */
import type { ProgressHandler, Remote } from "./bridge/types.js";
import { diffWorktree, resolveGitDir } from "./git/plumbing.js";
import { RANGE, voltIdeHead } from "./sync/refs.js";

export interface BuildDiagnostic {
	severity: "error" | "warning" | "info";
	message: string;
	object?: string | null;
}
export interface BuildResult {
	success: boolean;
	duration: number;
	diagnostics: BuildDiagnostic[];
}

export async function build(bridge: Remote, full: boolean, onProgress?: ProgressHandler): Promise<BuildResult> {
	const r = await bridge.build({ buildType: full ? "full" : "incremental" }, onProgress);
	return { success: r.success, duration: r.duration, diagnostics: r.diagnostics.map((d) => ({ severity: d.severity, message: d.message, object: d.object ?? null })) };
}

/**
 * How many workspace items differ from the IDE baseline (`refs/remotes/volt/ide`) — i.e. local changes not
 * yet pushed. `build` runs against the IDE's CURRENT project, NOT your local `src/`, so a nonzero count
 * means the build result reflects the IDE, not what you're editing. The CLI surfaces this so a green/red
 * build on stale state isn't mistaken for a verdict on your unpushed work. 0 when the workspace isn't bound.
 */
export function unpushedCount(root: string): number {
	const gitDir = resolveGitDir(root);
	if (voltIdeHead(gitDir) === undefined) return 0;
	return diffWorktree(root, RANGE, "src").length;
}
