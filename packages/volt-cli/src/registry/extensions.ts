/**
 * Extension registry — the single source of truth for every workspace file extension Volt tracks.
 * The bridge owns classification and body transpilation; the CLI only sees the per-item extension.
 *
 * The registry is ONE flat list keyed purely by EXTENSION — every row is `{ ext, defaultAccess }`
 * (+ `nameIsVerbatim` for the lone artifact file). What a row means to the CLI is decided entirely
 * by its extension and access. The bridge speaks a different vocabulary (item KINDS, plus a POU body
 * LANGUAGE); the small "bridge vocabulary" block below translates that vocabulary to an extension —
 * it never adds per-row fields.
 *
 *   - `ext`           workspace file extension WITHOUT a leading dot ("" === the folder placeholder)
 *   - `defaultAccess` baseline `r` (pull only) or `rw` (pull+push). Also marks a round-trippable
 *                     source item — the items `volt push` writes back are exactly the `rw` ones.
 *   - `nameIsVerbatim` the on-disk name IS the file (tmc_file → `Foo.tmc`, not `Foo.tmc.<ext>`).
 *
 * Invariants (enforced by extensions.test.ts / vocabulary.test.ts):
 *   1. Every `ext` is unique.
 *   2. Every extension resolves back to exactly one access.
 *   3. `knownKinds()` (derived from the extensions + the vocabulary block) stays in lockstep with
 *      the bridge via item-kinds.json.
 */
export type DefaultAccess = "r" | "rw";

export interface ExtensionDef {
	/** Workspace file extension WITHOUT a leading dot — the row's identity ("" === folder). */
	readonly ext: string;
	readonly defaultAccess: DefaultAccess;
	/** The on-disk name IS the file (e.g. tmc_file → `Foo.tmc`, not `Foo.tmc.<ext>`). */
	readonly nameIsVerbatim?: boolean;
}

const EXTENSIONS: readonly ExtensionDef[] = [
	// POU bodies — RW means the VG body round-trips (`volt push` writes it back). A POU's extension
	// is its body language lowercased (ST→st, FBD→fbd, …); see the bridge vocabulary block below.
	{ ext: "st",  defaultAccess: "rw" },
	{ ext: "fbd", defaultAccess: "rw" },   // editable VG (round-tripped)
	{ ext: "ld",  defaultAccess: "rw" },   // editable VG (round-tripped)
	{ ext: "cfc", defaultAccess: "r"  },   // read-only view (not transpiled yet)
	{ ext: "sfc", defaultAccess: "r"  },   // read-only view (not transpiled yet)

	// DUTs / GVL / interface — RW (round-tripped textual items).
	{ ext: "itf",    defaultAccess: "rw" },
	{ ext: "gvl",    defaultAccess: "rw" },
	{ ext: "struct", defaultAccess: "rw" },
	{ ext: "union",  defaultAccess: "rw" },
	{ ext: "enum",   defaultAccess: "rw" },
	{ ext: "alias",  defaultAccess: "rw" },

	// Reference items — R (engineer owns these in the IDE; pulled to read, never pushed). For all of
	// these the bridge kind equals the extension (read-only marker files). The one artifact file is
	// tmc, whose `.tmc` is the real on-disk TwinCAT file (nameIsVerbatim).
	{ ext: "library",               defaultAccess: "r" },
	{ ext: "task",                  defaultAccess: "r" },
	{ ext: "image_pool",            defaultAccess: "r" },
	{ ext: "text_list",             defaultAccess: "r" },
	{ ext: "recipe_manager",        defaultAccess: "r" },
	{ ext: "visualization_manager", defaultAccess: "r" },
	{ ext: "visualization",         defaultAccess: "r" },
	{ ext: "library_manager",       defaultAccess: "r" },
	{ ext: "class_diagram",         defaultAccess: "r" },
	{ ext: "external_types",        defaultAccess: "r" },
	{ ext: "tmc", defaultAccess: "r", nameIsVerbatim: true },

	// Folder placeholder — the only item with no extension.
	{ ext: "", defaultAccess: "r" },
] as const;

// ── Bridge wire vocabulary ───────────────────────────────────────────────────────────────────
// The CLI works in EXTENSIONS; the bridge speaks item KINDS (+ a POU body LANGUAGE). These three
// small maps translate the wire vocabulary to an extension. Everything else (a kind that equals its
// extension) needs no entry.

/** POU kinds — their extension is the body LANGUAGE lowercased (ST→st, FBD→fbd, LD→ld, …). */
export const POU_KINDS: ReadonlySet<string> = new Set(["program", "function", "function_block"]);

/** The POU body extensions (the lowercased languages) — never item kinds. */
const POU_EXTS: ReadonlySet<string> = new Set(["st", "fbd", "ld", "cfc", "sfc"]);

/** The only kinds whose extension differs from the kind word; every other kind's ext IS its name. */
const KIND_EXT: ReadonlyMap<string, string> = new Map([
	["interface", "itf"],
	["structure", "struct"],
	["enumeration", "enum"],
	["tmc_file", "tmc"],
	["folder", ""],
]);
const EXT_KIND: ReadonlyMap<string, string> = new Map([...KIND_EXT].map(([k, e]) => [e, k] as const));

const FOLDER_DEF = EXTENSIONS.find((e) => e.ext === "")!;

/**
 * A round-trippable source item — the only items `volt push` writes back to the
 * IDE (everything else is pulled read-only). Keyed off the *registry default* (not
 * effective access), so a user `rw` override on a reference extension never silently
 * turns it into a push target.
 */
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

/** Every item kind the registry recognizes: the POU kinds plus each non-POU extension's kind. */
export function knownKinds(): readonly string[] {
	return [
		...POU_KINDS,
		...EXTENSIONS.filter((e) => !POU_EXTS.has(e.ext)).map((e) => EXT_KIND.get(e.ext) ?? e.ext),
	];
}

export function isKnownKind(kind: string): boolean {
	if (POU_KINDS.has(kind)) return true;
	if (KIND_EXT.has(kind)) return true;
	return !POU_EXTS.has(kind) && BY_EXT.has(`.${kind}`);
}

/** The definition for a non-POU kind (POU kinds resolve by language — use `pickExtension`). */
export function getByKind(kind: string): ExtensionDef | undefined {
	if (POU_KINDS.has(kind)) return undefined;
	const ext = KIND_EXT.get(kind) ?? kind;
	if (ext === "") return FOLDER_DEF;
	if (POU_EXTS.has(ext)) return undefined;
	return BY_EXT.get(`.${ext}`);
}

/** Whether an item's on-disk name is the file itself (e.g. tmc_file → `Foo.tmc`, not `Foo.tmc_file`). */
export function nameIsVerbatim(kind: string): boolean {
	return getByKind(kind)?.nameIsVerbatim === true;
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

/**
 * The workspace file extension for an item. A POU's extension is its body LANGUAGE lowercased
 * (FBD→fbd, LD→ld, ST/absent→st); every other kind maps via the bridge vocabulary (usually
 * kind === ext). Throws on an unknown kind or an unknown POU language — no silent fallback.
 */
export function pickExtension(kind: string, language?: string): string {
	if (POU_KINDS.has(kind)) {
		const ext = (language ?? "ST").toLowerCase();
		if (!POU_EXTS.has(ext)) throw new Error(`pickExtension: POU '${kind}' has unknown body language '${language}'`);
		return ext;
	}
	const ext = KIND_EXT.get(kind) ?? kind;
	if (POU_EXTS.has(ext) || (ext !== "" && !BY_EXT.has(`.${ext}`))) {
		throw new Error(`pickExtension: unknown kind '${kind}'`);
	}
	return ext;
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

function trackedExtensions(): readonly string[] {
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
