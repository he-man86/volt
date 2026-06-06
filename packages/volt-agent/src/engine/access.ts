/**
 * Per-extension access mode resolution.
 *
 * Each tracked extension has a default access in the registry
 * (`r` / `rw`). The workspace's `.volt/config.json` can override
 * per-extension to:
 *   - `r`  — pull only (workspace receives, push refused)
 *   - `rw` — pull + push (full edit cycle)
 *   - `off` — skip entirely (not pulled, ignored on push)
 *
 * This replaces the older `pushPolicy.allowExtensions` which only
 * modeled push and was a binary allowlist. The richer three-mode
 * model lets engineers say "I don't want libraries in my workspace
 * at all" (`"off"`) or "I'm going to write .fbd files directly,
 * bypass the transpile" (`"rw"`).
 *
 * Unknown extensions still rejected — the registry is the closed
 * set of trackable kinds. Asking for access on `.weird` is a bug,
 * not an override opportunity.
 */

import { accessForExt, getByExt } from "./extension-registry.js";

/** The three modes the config supports. */
export type Access = "r" | "rw" | "off";

/** Minimal shape from config we care about. The full `Config` type
 *  in `engine/config.ts` extends this; defining the slice here keeps
 *  this module decoupled from config schema churn. */
export interface AccessOverrides {
	readonly extensionAccess?: Readonly<Record<string, Access>>;
}

/** Resolve effective access for an extension given the workspace
 *  config. `ext` MUST start with a dot. Returns the override if
 *  present, otherwise the registry's `defaultAccess`. Unknown
 *  extensions return `"off"` — caller should treat as "not tracked".
 */
export function effectiveAccess(ext: string, cfg: AccessOverrides | undefined): Access {
	// Folder markers (`.gitkeep`) are pure structural artifacts that
	// preserve empty engineer-created CODESYS folders so the workspace
	// tree mirrors the IDE's project tree. They don't go through the
	// registry — they're produced by the materializer for `kind: folder`
	// items regardless of the bridge's `ext` value — so the standard
	// "unknown → off" gate would silently strip every empty folder.
	// Always pullable, always read-only.
	if (ext === ".gitkeep") return "r";
	const def = getByExt(ext);
	if (def === undefined) return "off";
	const override = cfg?.extensionAccess?.[ext.toLowerCase()];
	if (override !== undefined) return override;
	// Prefer the per-extension access (lets graphical languages like
	// `.fbd` declare `r` even though their parent kind is `rw`). Falls
	// back to the kind-level `defaultAccess` for non-language extensions.
	return accessForExt(ext) ?? def.defaultAccess;
}

/** Pull-side gate. `r` and `rw` come down; `off` is skipped. */
export function isPullable(ext: string, cfg: AccessOverrides | undefined): boolean {
	const mode = effectiveAccess(ext, cfg);
	return mode === "r" || mode === "rw";
}

/** Push-side gate. Only `rw` goes back to the bridge. */
export function isPushable(ext: string, cfg: AccessOverrides | undefined): boolean {
	return effectiveAccess(ext, cfg) === "rw";
}

/** Describe the effective access mode for human-facing output
 *  (CLI status, VS Code tooltips). Returns labels like
 *  `"read-only (default)"` / `"read-write (default)"` /
 *  `"read-only (config override)"` / `"skipped (config override)"`. */
export function describeAccess(ext: string, cfg: AccessOverrides | undefined): string {
	const def = getByExt(ext);
	if (def === undefined) return "untracked";
	const override = cfg?.extensionAccess?.[ext.toLowerCase()];
	const mode = override ?? accessForExt(ext) ?? def.defaultAccess;
	const suffix = override !== undefined ? "config override" : "default";
	const label = mode === "rw" ? "read-write" : mode === "r" ? "read-only" : "skipped";
	return `${label} (${suffix})`;
}
