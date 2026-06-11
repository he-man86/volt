/**
 * Workspace ↔ PLC-project identity contract.
 *
 * `volt init` records the bridge's `{platform, projectName, plcProjectName}`
 * triple in `.volt/config.json`. Every subsequent verb verifies the
 * bridge STILL reports the same triple before doing work. Two failure
 * modes this guards against:
 *
 *   1. Wrong-project accidents — engineer flipped to a different PLC
 *      project in the same IDE session. Without this check, `volt pull`
 *      would happily overwrite the workspace with foreign content.
 *   2. Legitimate renames — engineer added a version suffix. The
 *      mismatch is detected and the engineer is told exactly how to
 *      accept it (`volt init --force`).
 *
 * Strict equality on all three fields. The bridges don't expose a
 * stable identifier today (no GUID, no project-file hash), so human
 * names ARE the identity. When/if the bridge wire protocol grows a
 * `projectFingerprint` field, prefer that here and let name-only diffs
 * silently auto-update.
 */
import type { HealthResponse } from "../bridge/types.js";
import type { WorkspaceConfig } from "./workspace.js";

export interface ProjectIdentity {
	readonly platform: string;
	readonly projectName: string;
	readonly plcProjectName: string;
}

export type BindingDiffField = "platform" | "projectName" | "plcProjectName";

export interface BindingMismatch {
	readonly configuredAs: ProjectIdentity;
	readonly bridgeReports: ProjectIdentity;
	/** Subset of fields that differ — lets the UX layer highlight only
	 *  what changed instead of showing the full triple as a blob. */
	readonly diffFields: ReadonlyArray<BindingDiffField>;
}

export type BindingCheck =
	| { readonly ok: true }
	| { readonly ok: false; readonly mismatch: BindingMismatch };

/**
 * Compare what `.volt/config.json` recorded against what `/health` says
 * right now. Returns `{ ok: true }` when every identity field matches.
 *
 * Pure function — no I/O, no side effects. Callers (init, pull, push,
 * build, status) compose this with their existing config-load /
 * bridge-probe flow.
 */
export function verifyProjectBinding(
	cfg: WorkspaceConfig,
	health: HealthResponse,
): BindingCheck {
	const configuredAs: ProjectIdentity = {
		platform: cfg.project.platform,
		projectName: cfg.project.projectName,
		plcProjectName: cfg.project.plcProjectName,
	};
	const bridgeReports: ProjectIdentity = {
		platform: health.platform,
		// `health.projectName` / `plcProjectName` are nullable on the wire —
		// init refuses to save null/empty, so any non-null cfg.project field
		// can be safely compared against the (possibly null) bridge field;
		// missing on the bridge side counts as a mismatch.
		projectName: health.projectName ?? "",
		plcProjectName: health.plcProjectName ?? "",
	};
	const diffFields: BindingDiffField[] = [];
	if (configuredAs.platform !== bridgeReports.platform) diffFields.push("platform");
	if (configuredAs.projectName !== bridgeReports.projectName) diffFields.push("projectName");
	if (configuredAs.plcProjectName !== bridgeReports.plcProjectName) diffFields.push("plcProjectName");
	if (diffFields.length === 0) return { ok: true };
	return { ok: false, mismatch: { configuredAs, bridgeReports, diffFields } };
}

/**
 * Build the human-readable refusal message every non-init verb emits
 * on mismatch. Single source of truth — keeps wording consistent
 * across `pull`, `push`, `build`, the agent's stderr, and the VS Code
 * toast/tree-warning UI.
 *
 * Example:
 *   "workspace bound to beckhoff/Untitled2/Untitled2,
 *    but bridge has   beckhoff/Untitled2_v3/Untitled2_v3 —
 *    run `volt init --force` to accept the new name (snapshot history
 *    preserved), or point the bridge at the original project."
 */
export function bindingMismatchMessage(m: BindingMismatch): string {
	const cfg = formatIdentity(m.configuredAs);
	const live = formatIdentity(m.bridgeReports);
	return (
		`workspace bound to ${cfg}, but bridge has ${live} — ` +
		"run `volt init --force` to accept the new name (snapshot history " +
		"preserved), or point the bridge at the original project."
	);
}

function formatIdentity(id: ProjectIdentity): string {
	return `${id.platform}/${id.projectName}/${id.plcProjectName}`;
}
