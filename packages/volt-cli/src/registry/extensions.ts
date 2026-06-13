/**
 * Extension registry — single source of truth for every IEC 61131-3
 * item kind Volt tracks. The bridge owns classification and body
 * transpilation; the CLI only sees the per-kind file extension.
 *
 * For each tracked kind:
 *   - `kind`          vendor-neutral string the bridge wire speaks
 *   - `ext`           workspace file extension WITHOUT a leading dot
 *   - `defaultAccess` baseline `r` (pull only) or `rw` (pull+push)
 *   - `family`        source, config, or folder
 *   - `describe`      human-readable label for CLI output / docs
 *
 * Invariants enforced by test:
 *   1. Every `kind` is unique.
 *   2. Every extension resolves back to exactly one entry.
 */
export type Family = "source" | "config" | "folder";
export type DefaultAccess = "r" | "rw";

export interface ExtensionDef {
	readonly kind: string;
	readonly ext: string;
	readonly defaultAccess: DefaultAccess;
	readonly family: Family;
	readonly describe: string;
	readonly nameIsVerbatim?: boolean;
}

export const EXTENSIONS: readonly ExtensionDef[] = [
	// Source POUs — RW
	{ kind: "function_block", ext: "st",    defaultAccess: "rw", family: "source", describe: "Function block" },
	{ kind: "function",       ext: "st",    defaultAccess: "rw", family: "source", describe: "Function" },
	{ kind: "program",        ext: "st",    defaultAccess: "rw", family: "source", describe: "Program" },
	{ kind: "interface",      ext: "itf",   defaultAccess: "rw", family: "source", describe: "Interface" },
	{ kind: "gvl",            ext: "gvl",   defaultAccess: "rw", family: "source", describe: "Global Variable List" },
	{ kind: "structure",      ext: "struct", defaultAccess: "rw", family: "source", describe: "Structure" },
	{ kind: "union",          ext: "union",  defaultAccess: "rw", family: "source", describe: "Union" },
	{ kind: "enumeration",    ext: "enum",   defaultAccess: "rw", family: "source", describe: "Enumeration" },
	{ kind: "alias",          ext: "alias",  defaultAccess: "rw", family: "source", describe: "Alias" },

	// Config kinds — R (engineer owns these in the IDE).
	// This list must stay in lockstep with the bridge's emitted kinds — see
	// ../../../volt-bridges/item-kinds.json (enforced by vocabulary.test.ts).
	{ kind: "library",                ext: "library",       defaultAccess: "r", family: "config", describe: "Library reference" },
	{ kind: "task",                   ext: "task",          defaultAccess: "r", family: "config", describe: "IEC task" },
	{ kind: "image_pool",             ext: "imagepool",     defaultAccess: "r", family: "config", describe: "Image pool" },
	{ kind: "text_list",              ext: "textlist",      defaultAccess: "r", family: "config", describe: "Text list" },
	{ kind: "recipe_manager",         ext: "recipes",       defaultAccess: "r", family: "config", describe: "Recipe manager" },
	{ kind: "visualization_manager",  ext: "visu",          defaultAccess: "r", family: "config", describe: "Visualization manager" },
	{ kind: "visualization",          ext: "visualization", defaultAccess: "r", family: "config", describe: "Visualization screen" },
	{ kind: "library_manager",        ext: "libraries",     defaultAccess: "r", family: "config", describe: "Library manager" },
	{ kind: "class_diagram",          ext: "uml",           defaultAccess: "r", family: "config", describe: "UML class diagram" },
	{ kind: "external_types",         ext: "exttypes",      defaultAccess: "r", family: "config", describe: "External types" },
	{ kind: "tmc_file",               ext: "tmc",           defaultAccess: "r", family: "config", describe: "TMC file", nameIsVerbatim: true },

	// Folder marker
	{ kind: "folder", ext: "", defaultAccess: "r", family: "folder", describe: "Empty engineer folder" },
] as const;

const BY_KIND: ReadonlyMap<string, ExtensionDef> = new Map(
	EXTENSIONS.map((e) => [e.kind, e]),
);

const BY_EXT: ReadonlyMap<string, ExtensionDef> = (() => {
	const m = new Map<string, ExtensionDef>();
	for (const def of EXTENSIONS) {
		if (def.ext.length === 0) continue;
		const extWithDot = `.${def.ext.toLowerCase()}`;
		const existing = m.get(extWithDot);
		if (existing !== undefined) {
			if (existing.family !== def.family) {
				throw new Error(
					`registry: extension '${extWithDot}' has incompatible family — ` +
						`'${existing.kind}' (${existing.family}) vs '${def.kind}' (${def.family})`,
				);
			}
		} else {
			m.set(extWithDot, def);
		}
	}
	return m;
})();

export function getByKind(kind: string): ExtensionDef | undefined {
	return BY_KIND.get(kind);
}

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

export function pickExtension(kind: string): string {
	const def = getByKind(kind);
	if (def === undefined) throw new Error(`pickExtension: unknown kind '${kind}'`);
	return def.ext;
}

export function nameFromPath(relPath: string): string | undefined {
	const slash = relPath.lastIndexOf("/");
	const base = slash >= 0 ? relPath.slice(slash + 1) : relPath;
	if (base === FOLDER_MARKER) {
		const beforeSlash = relPath.lastIndexOf("/", slash - 1);
		if (slash <= 0) return undefined;
		return relPath.slice(beforeSlash + 1, slash);
	}
	const dot = base.lastIndexOf(".");
	if (dot < 0) return undefined;
	const def = getByExt(base.slice(dot).toLowerCase());
	if (def === undefined) return undefined;
	return base.slice(0, dot);
}

export function isTrackedPath(relPath: string): boolean {
	if (relPath.endsWith(`/${FOLDER_MARKER}`) || relPath === FOLDER_MARKER) return true;
	if (relPath === ".gitattributes") return true;
	return getByPath(relPath) !== undefined;
}

export function sourceExtensions(): readonly string[] {
	const out = new Set<string>();
	for (const def of EXTENSIONS) {
		if (def.family !== "source" || def.ext.length === 0) continue;
		out.add(`.${def.ext}`);
	}
	return [...out].sort();
}

export function accessForExt(ext: string): DefaultAccess | undefined {
	const def = BY_EXT.get(ext.toLowerCase());
	return def?.defaultAccess;
}

export function trackedExtensions(): readonly string[] {
	return [...BY_EXT.keys()].sort();
}

export function defaultExtensionAccess(): Record<string, DefaultAccess> {
	const out: Record<string, DefaultAccess> = {};
	for (const ext of trackedExtensions()) {
		if (ext === ".gitkeep") continue;
		out[ext] = accessForExt(ext)!;
	}
	return out;
}

export function gitattributesContent(): string {
	return sourceExtensions().map((e) => `*${e} text eol=lf`).join("\n") + "\n";
}

export const FOLDER_MARKER = ".gitkeep";
