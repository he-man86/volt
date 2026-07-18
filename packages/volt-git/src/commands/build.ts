/** volt-git build — delegate to the bridge's build endpoint + return normalized diagnostics. */
import type { ProgressHandler, Remote } from "../bridge/types.js";
import { configExists, loadConfig, verifyBinding } from "../config.js";
import { diffWorktree, resolveGitDir } from "../git.js";
import { RANGE, voltIdeHead } from "../domain/ide-tree.js";

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

export async function build(root: string, bridge: Remote, full: boolean, onProgress?: ProgressHandler): Promise<BuildResult> {
	// Build runs against the IDE's LOADED project — verify it's the one this workspace is bound to (and that an
	// IDE is attached), else a green/red build silently reflects some other project. Surfaced as a build error.
	if (!configExists(root)) return refuse("not a Volt workspace — run `volt init` first");
	const bindErr = verifyBinding(loadConfig(root), await bridge.getHealth());
	if (bindErr !== undefined) return refuse(bindErr);

	const r = await bridge.build({ buildType: full ? "full" : "incremental" }, onProgress);
	return { success: r.success, duration: r.duration, diagnostics: r.diagnostics.map((d) => ({ severity: d.severity, message: d.message, object: d.object ?? null })) };
}

const refuse = (message: string): BuildResult => ({ success: false, duration: 0, diagnostics: [{ severity: "error", message }] });

/**
 * How many workspace items differ from the IDE baseline (`refs/remotes/volt/ide`) — i.e. local changes not
 * yet pushed. `build` runs against the IDE's CURRENT project, NOT your local `src/`, so a nonzero count
 * means the build result reflects the IDE, not what you're editing. The CLI surfaces this so a green/red
 * build on stale state isn't mistaken for a verdict on your unpushed work. 0 when the workspace isn't bound.
 */
export function unpushedCount(root: string): number {
	try {
		const gitDir = resolveGitDir(root);
		if (voltIdeHead(gitDir) === undefined) return 0; // not bound / never synced
		return diffWorktree(root, RANGE, "src").length;
	} catch {
		return 0; // not a git repo yet — nothing pushed
	}
}
