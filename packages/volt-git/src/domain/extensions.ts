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
	// Writable source is named by KIND (bridge: ItemKind.ExtFor). A POU's editability is NOT the extension —
	// a graphical CFC/SFC body is the same .fb/.prg/.fun (materialized as an `(* @volt-graphical: LANG *)`
	// info comment). These default `rw`; a push over a CFC/SFC body is refused by the bridge on live IDE
	// state (not pre-filtered here). Only reference KINDS are read-only by extension.
	{ ext: "fb", defaultAccess: "rw" },
	{ ext: "prg", defaultAccess: "rw" },
	{ ext: "fun", defaultAccess: "rw" },
	{ ext: "itf", defaultAccess: "rw" },
	{ ext: "struct", defaultAccess: "rw" },
	{ ext: "union", defaultAccess: "rw" },
	{ ext: "enum", defaultAccess: "rw" },
	{ ext: "alias", defaultAccess: "rw" },
	{ ext: "gvl", defaultAccess: "rw" },
	{ ext: "library", defaultAccess: "r" },
	{ ext: "device", defaultAccess: "r" },
	{ ext: "projectinfo", defaultAccess: "r" },
	{ ext: "trace", defaultAccess: "r" },
	{ ext: "recipe", defaultAccess: "r" },
	{ ext: "symbols", defaultAccess: "r" },
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

function getByExt(ext: string): ExtensionDef | undefined {
	return BY_EXT.get(ext.toLowerCase());
}

function getByPath(relPath: string): ExtensionDef | undefined {
	const slash = relPath.lastIndexOf("/");
	const base = slash >= 0 ? relPath.slice(slash + 1) : relPath;
	const dot = base.lastIndexOf(".");
	if (dot < 0) return undefined;
	return getByExt(base.slice(dot));
}

/** The full filename from a workspace path ("POUs/FB_Motor.fb" → "FB_Motor.fb"). Folder markers resolve
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

/** The extension definition for a full filename ("PLC_PRG.prg" → { ext:"prg", defaultAccess:"rw" }). */
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

export function gitattributesContent(): string {
	// Normalize EVERY workspace file to LF. The bridge always emits LF and the whole workspace is text
	// (ST, VG, and the read-only manifests). Without a blanket rule, Windows git (core.autocrlf) round-
	// trips the un-attributed read-only kinds (.library/.task/…) through CRLF, so their committed blob
	// differs from the verbatim-LF `volt/ide` baseline and pull/push see spurious, unpushable drift.
	return "* text=auto eol=lf\n";
}
