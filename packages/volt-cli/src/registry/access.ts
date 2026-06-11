/**
 * Per-extension access mode resolution.
 *
 * Each tracked extension has a default access in the registry
 * (`r` / `rw`). The workspace's `.volt/config.json` can override
 * per-extension to `r`, `rw`, or `off`.
 */
import { getByExt } from "./extensions.js";

export type Access = "r" | "rw" | "off";

export interface AccessOverrides {
	readonly extensionAccess?: Readonly<Record<string, Access>>;
}

export function effectiveAccess(ext: string, cfg: AccessOverrides | undefined): Access {
	if (ext === ".gitkeep") return "r";
	const def = getByExt(ext);
	if (def === undefined) return "off";
	const override = cfg?.extensionAccess?.[ext.toLowerCase()];
	if (override !== undefined) return override;
	return def.defaultAccess;
}

export function isPullable(ext: string, cfg: AccessOverrides | undefined): boolean {
	const mode = effectiveAccess(ext, cfg);
	return mode === "r" || mode === "rw";
}

export function isPushable(ext: string, cfg: AccessOverrides | undefined): boolean {
	return effectiveAccess(ext, cfg) === "rw";
}

export function describeAccess(ext: string, cfg: AccessOverrides | undefined): string {
	const def = getByExt(ext);
	if (def === undefined) return "untracked";
	const override = cfg?.extensionAccess?.[ext.toLowerCase()];
	const mode = override ?? def.defaultAccess;
	const suffix = override !== undefined ? "config override" : "default";
	const label = mode === "rw" ? "read-write" : mode === "r" ? "read-only" : "skipped";
	return `${label} (${suffix})`;
}
