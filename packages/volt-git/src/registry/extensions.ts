/**
 * Extension registry — the single source of truth for every workspace file extension Volt tracks.
 * The bridge sends full filenames (name.ext); the CLI only looks up the extension in this flat table
 * to determine access (rw for source items, r for references).
 */

export type DefaultAccess = "r" | "rw";

export interface ExtensionDef {
	readonly ext: string;
	readonly defaultAccess: DefaultAccess;
}

const EXTENSIONS: readonly ExtensionDef[] = [
	{ ext: "st", defaultAccess: "rw" },
	{ ext: "fbd", defaultAccess: "rw" },
	{ ext: "ld", defaultAccess: "rw" },
	{ ext: "cfc", defaultAccess: "r" },
	{ ext: "sfc", defaultAccess: "r" },
	{ ext: "itf", defaultAccess: "rw" },
	{ ext: "gvl", defaultAccess: "rw" },
	{ ext: "struct", defaultAccess: "rw" },
	{ ext: "union", defaultAccess: "rw" },
	{ ext: "enum", defaultAccess: "rw" },
	{ ext: "alias", defaultAccess: "rw" },
	{ ext: "library", defaultAccess: "r" },
	{ ext: "task", defaultAccess: "r" },
	{ ext: "image_pool", defaultAccess: "r" },
	{ ext: "parameter_list", defaultAccess: "r" },
	{ ext: "text_list", defaultAccess: "r" },
	{ ext: "recipe_manager", defaultAccess: "r" },
	{ ext: "visualization_manager", defaultAccess: "r" },
	{ ext: "visualization", defaultAccess: "r" },
	{ ext: "library_manager", defaultAccess: "r" },
	{ ext: "class_diagram", defaultAccess: "r" },
	{ ext: "external_types", defaultAccess: "r" },
	{ ext: "tmc", defaultAccess: "r" },
	{ ext: "", defaultAccess: "r" },
] as const;

export const FOLDER_MARKER = ".gitkeep";

export function isSourcePou(def: ExtensionDef): boolean {
	return def.defaultAccess === "rw";
}

const BY_EXT: ReadonlyMap<string, ExtensionDef> = (() => {
	const m = new Map<string, ExtensionDef>();
	for (const def of EXTENSIONS) {
		if (def.ext.length === 0) continue;
		const extWithDot = `.${def.ext.toLowerCase()}`;
		if (m.has(extWithDot)) throw new Error(`registry: duplicate extension '${extWithDot}'`);
		m.set(extWithDot, def);
	}
	return m;
})();

export function getByExt(ext: string): ExtensionDef | undefined {
	return BY_EXT.get(ext.toLowerCase());
}

export function getByPath(relPath: string): ExtensionDef | undefined {
	const slash = relPath.lastIndexOf("/");
	const base = slash >= 0 ? relPath.slice(slash + 1) : relPath;
	const dot = base.lastIndexOf(".");
	if (dot < 0) return undefined;
	return getByExt(base.slice(dot));
}

/** The full filename from a workspace path ("POUs/FB_Motor.st" → "FB_Motor.st"). Folder markers resolve
 *  to the containing folder name. Used to match the bridge's wire names (which include extensions). */
export function fullNameFromPath(relPath: string): string | undefined {
	const slash = relPath.lastIndexOf("/");
	const base = slash >= 0 ? relPath.slice(slash + 1) : relPath;
	if (base === FOLDER_MARKER) {
		if (slash <= 0) return undefined;
		const beforeSlash = relPath.lastIndexOf("/", slash - 1);
		return relPath.slice(beforeSlash + 1, slash);
	}
	const dot = base.lastIndexOf(".");
	if (dot < 0) return undefined;
	if (getByExt(base.slice(dot).toLowerCase()) === undefined) return undefined;
	return base;
}

/** The extension definition for a full filename ("PLC_PRG.st" → { ext:"st", defaultAccess:"rw" }). */
export function defFromName(fullName: string): ExtensionDef | undefined {
	const dot = fullName.lastIndexOf(".");
	if (dot < 0) return undefined;
	return getByExt(fullName.slice(dot));
}

export function isTrackedPath(relPath: string): boolean {
	if (relPath.endsWith(`/${FOLDER_MARKER}`) || relPath === FOLDER_MARKER) return true;
	if (relPath === ".gitattributes") return true;
	return getByPath(relPath) !== undefined;
}

export function isPushable(relPath: string): boolean {
	return getByPath(relPath)?.defaultAccess === "rw";
}

export function isReadOnly(relPath: string): boolean {
	return getByPath(relPath)?.defaultAccess === "r";
}

export function sourceExtensions(): readonly string[] {
	const out = new Set<string>();
	for (const def of EXTENSIONS) {
		if (!isSourcePou(def) || def.ext.length === 0) continue;
		out.add(`.${def.ext}`);
	}
	return [...out].sort();
}

export function gitattributesContent(): string {
	return sourceExtensions().map((e) => `*${e} text eol=lf`).join("\n") + "\n";
}
