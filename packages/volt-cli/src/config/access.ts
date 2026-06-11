import { accessForExt, getByExt } from "../registry/extensions.js"

export type Access = "r" | "rw" | "off"

export interface AccessOverrides {
	readonly extensionAccess?: Readonly<Record<string, Access>>
}

export function effectiveAccess(ext: string, cfg: AccessOverrides | undefined): Access {
	if (ext === ".gitkeep") return "r"
	const def = getByExt(ext)
	if (def === undefined) return "off"
	const override = cfg?.extensionAccess?.[ext.toLowerCase()]
	if (override !== undefined) return override
	return accessForExt(ext) ?? def.defaultAccess
}

export function isPullable(ext: string, cfg: AccessOverrides | undefined): boolean {
	const mode = effectiveAccess(ext, cfg)
	return mode === "r" || mode === "rw"
}

export function isPushable(ext: string, cfg: AccessOverrides | undefined): boolean {
	return effectiveAccess(ext, cfg) === "rw"
}
