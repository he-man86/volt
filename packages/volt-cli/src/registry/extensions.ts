/**
 * Extension registry — single source of truth for every IEC 61131-3
 * item kind Volt tracks. The bridge owns classification and body
 * transpilation; the CLI only sees the per-kind file extension.
 *
 * For each tracked kind:
 *   - `kind`          vendor-neutral string the bridge wire speaks
 *   - `ext`           workspace file extension WITHOUT a leading dot
 *                     (empty string === the folder placeholder kind)
 *   - `defaultAccess` baseline `r` (pull only) or `rw` (pull+push). This is
 *                     also what marks a round-trippable source POU: the items
 *                     `volt push` writes back are exactly the `rw` ones
 *                     (see `isSourcePou`). Read-only reference items are `r`.
 *
 * Invariants enforced by test:
 *   1. Every `kind` is unique.
 *   2. Every extension resolves back to exactly one entry (same access).
 */
export type DefaultAccess = "r" | "rw";

export interface ExtensionDef {
	readonly kind: string;
	readonly ext: string;
	readonly defaultAccess: DefaultAccess;
	readonly nameIsVerbatim?: boolean;
}

/**
 * A round-trippable source POU — the only items `volt push` writes back to the
 * IDE (everything else is pulled read-only). This is exactly the writable set,
 * keyed off the *registry default* (not effective access), so a user `rw`
 * override on a reference extension never silently turns it into a push target.
 */
export function isSourcePou(def: ExtensionDef): boolean {
	return def.defaultAccess === "rw";
}

export const EXTENSIONS: readonly ExtensionDef[] = [
	// Source POUs — RW (round-tripped; `volt push` writes these back)
	{ kind: "function_block", ext: "st",     defaultAccess: "rw" },
	{ kind: "function",       ext: "st",     defaultAccess: "rw" },
	{ kind: "program",        ext: "st",     defaultAccess: "rw" },
	{ kind: "interface",      ext: "itf",    defaultAccess: "rw" },
	{ kind: "gvl",            ext: "gvl",    defaultAccess: "rw" },
	{ kind: "structure",      ext: "struct", defaultAccess: "rw" },
	{ kind: "union",          ext: "union",  defaultAccess: "rw" },
	{ kind: "enumeration",    ext: "enum",   defaultAccess: "rw" },
	{ kind: "alias",          ext: "alias",  defaultAccess: "rw" },

	// Reference items — R (engineer owns these in the IDE; pulled to read, never pushed).
	// Convention: ext == kind (read-only marker files; unambiguous and self-syncing,
	// enforced by extensions.test.ts). The ONE exception is tmc_file, whose `.tmc` is
	// the real on-disk TwinCAT artifact (nameIsVerbatim). The kind set itself stays in
	// lockstep with the bridge via item-kinds.json / vocabulary.test.ts.
	{ kind: "library",               ext: "library",               defaultAccess: "r" },
	{ kind: "task",                  ext: "task",                  defaultAccess: "r" },
	{ kind: "image_pool",            ext: "image_pool",            defaultAccess: "r" },
	{ kind: "text_list",             ext: "text_list",             defaultAccess: "r" },
	{ kind: "recipe_manager",        ext: "recipe_manager",        defaultAccess: "r" },
	{ kind: "visualization_manager", ext: "visualization_manager", defaultAccess: "r" },
	{ kind: "visualization",         ext: "visualization",         defaultAccess: "r" },
	{ kind: "library_manager",       ext: "library_manager",       defaultAccess: "r" },
	{ kind: "class_diagram",         ext: "class_diagram",         defaultAccess: "r" },
	{ kind: "external_types",        ext: "external_types",        defaultAccess: "r" },
	{ kind: "tmc_file",              ext: "tmc",                   defaultAccess: "r", nameIsVerbatim: true },

	// Folder placeholder — the only kind with no extension.
	{ kind: "folder", ext: "", defaultAccess: "r" },
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
			if (existing.defaultAccess !== def.defaultAccess) {
				throw new Error(
					`registry: extension '${extWithDot}' has incompatible access — ` +
						`'${existing.kind}' (${existing.defaultAccess}) vs '${def.kind}' (${def.defaultAccess})`,
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
		if (!isSourcePou(def) || def.ext.length === 0) continue;
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
