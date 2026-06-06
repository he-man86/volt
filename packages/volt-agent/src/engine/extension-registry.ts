/**
 * Extension registry — single source of truth for every CODESYS /
 * TwinCAT item kind Volt tracks.
 *
 * For each tracked kind we declare:
 *   - `kind`            the vendor-neutral string the bridge wire
 *                       protocol speaks (`function_block`, `library`,
 *                       `device`, …). Same vocabulary on both bridges.
 *   - `ext`             workspace file extension WITHOUT a leading
 *                       dot ("" = folder marker, no file).
 *   - `defaultAccess`   baseline `r` (pull only) or `rw` (pull+push).
 *                       Config (`.volt/config.json#extensionAccess`)
 *                       can override per workspace.
 *   - `family`          coarse classification driving downstream
 *                       behavior — sources get an LSP, configs are
 *                       opaque text manifests, folders only carry
 *                       `.gitkeep`.
 *   - `languageOverrides`  for source POU kinds whose body can be
 *                       FBD/LD/SFC/CFC, the per-language file ext.
 *                       Bridge's `language` field on FetchedItem
 *                       picks the override.
 *   - `describe`        human-readable label for CLI output / docs.
 *
 * Adding a new tracked kind = one entry below + (if it's a config
 * kind) one extractor entry in `volt-bridges/codesys/CodesysBridge/
 * handlers/extensions.py`. ANY other change site is a smell —
 * something didn't read from the registry.
 *
 * Two invariants enforced by `tests/scenarios/registry-invariants
 * .test.ts`:
 *   1. Every `kind` is unique.
 *   2. Every reachable file extension (`ext` + every value in
 *      `languageOverrides`) resolves back to exactly one entry.
 */

export type Family = "source" | "config" | "folder";
export type DefaultAccess = "r" | "rw";

/** Per-language file-extension + access pair. Source POU kinds carry a
 *  language-override map of this shape so each body language (ST,
 *  graphical) can declare its own RW vs R policy independently of the
 *  parent kind's `defaultAccess`. */
export interface LanguageOverride {
	readonly ext: string;
	readonly access: DefaultAccess;
}

export interface ExtensionDef {
	readonly kind: string;
	readonly ext: string;
	readonly defaultAccess: DefaultAccess;
	readonly family: Family;
	readonly languageOverrides?: Readonly<Record<string, LanguageOverride>>;
	readonly describe: string;
	/** True iff the bridge's `item.name` already carries the extension
	 *  (e.g. TwinCAT TMC files arrive as `Foo.tmc`). The materializer
	 *  writes the file name as `item.name` verbatim instead of
	 *  appending `.${ext}`. The extension still registers normally in
	 *  the lookup map so `.tmc` paths resolve. */
	readonly nameIsVerbatim?: boolean;
}

/** Per-language extension overrides shared by all source POU body
 *  kinds (function_block / function / program). Defined once so
 *  the override map doesn't drift between entries.
 *
 *  Access mode is per-language, not per-parent-kind: an FB body in ST
 *  is round-trippable (rw), but an FB body in FBD/LD/SFC/CFC is
 *  read-only by default because we either don't have a stable transpile
 *  back-path (FBD/LD) or no transpile at all (SFC/CFC). Engineers can
 *  flip `.fbd` → `rw` via `.volt/config.json#extensionAccess` once
 *  they're confident in the round-trip. */
const POU_BODY_LANGUAGES: Record<string, LanguageOverride> = {
	ST: { ext: "st", access: "rw" },
	FBD: { ext: "fbd", access: "r" },
	LD: { ext: "ld", access: "r" },
	SFC: { ext: "sfc", access: "r" },
	CFC: { ext: "cfc", access: "r" },
};

export const EXTENSIONS: readonly ExtensionDef[] = [
	// ─── Source POUs — RW ────────────────────────────────────────────
	// Bodies can be ST or graphical. Graphical pulls down as ST via
	// the agent's transpiler but keeps the source-language extension
	// (.fbd / .ld) so the engineer's intent stays visible.
	{
		kind: "function_block",
		ext: "st",
		defaultAccess: "rw",
		family: "source",
		languageOverrides: POU_BODY_LANGUAGES,
		describe: "Function block",
	},
	{
		kind: "function",
		ext: "st",
		defaultAccess: "rw",
		family: "source",
		languageOverrides: POU_BODY_LANGUAGES,
		describe: "Function",
	},
	{
		kind: "program",
		ext: "st",
		defaultAccess: "rw",
		family: "source",
		languageOverrides: POU_BODY_LANGUAGES,
		describe: "Program",
	},
	// Declaration-only source kinds — no body language.
	{ kind: "interface",   ext: "itf", defaultAccess: "rw", family: "source", describe: "Interface" },
	{ kind: "gvl",         ext: "gvl", defaultAccess: "rw", family: "source", describe: "Global Variable List" },
	{ kind: "structure",   ext: "dut", defaultAccess: "rw", family: "source", describe: "Structure" },
	{ kind: "union",       ext: "dut", defaultAccess: "rw", family: "source", describe: "Union" },
	{ kind: "enumeration", ext: "dut", defaultAccess: "rw", family: "source", describe: "Enumeration" },
	{ kind: "alias",       ext: "dut", defaultAccess: "rw", family: "source", describe: "Alias" },

	// ─── Config kinds — R (engineer owns these in the IDE) ───────────
	// Each has a typed extractor on the bridge side that reads
	// IronPython properties and renders a deterministic text manifest.
	{ kind: "library",                ext: "library",       defaultAccess: "r", family: "config", describe: "Library reference" },
	{ kind: "task",                   ext: "task",          defaultAccess: "r", family: "config", describe: "IEC task" },
	{ kind: "device",                 ext: "device",        defaultAccess: "r", family: "config", describe: "Device tree node" },
	{ kind: "trace",                  ext: "trace",         defaultAccess: "r", family: "config", describe: "Trace" },
	{ kind: "image_pool",             ext: "imagepool",     defaultAccess: "r", family: "config", describe: "Image pool" },
	{ kind: "text_list",              ext: "textlist",      defaultAccess: "r", family: "config", describe: "Text list" },
	{ kind: "recipe_manager",         ext: "recipes",       defaultAccess: "r", family: "config", describe: "Recipe manager" },
	{ kind: "visualization_manager",  ext: "visu",          defaultAccess: "r", family: "config", describe: "Visualization manager" },
	{ kind: "visualization",          ext: "visualization", defaultAccess: "r", family: "config", describe: "Visualization screen" },
	{ kind: "symbol_config",          ext: "symbols",       defaultAccess: "r", family: "config", describe: "Symbol configuration" },
	{ kind: "project_info",           ext: "projectinfo",   defaultAccess: "r", family: "config", describe: "Project information" },
	// TwinCAT-specific kinds — Beckhoff bridge emits these; CODESYS
	// bridge doesn't (CODESYS drills Library Manager into individual
	// library refs, and the others are TwinCAT concepts that don't
	// exist in CODESYS projects).
	{ kind: "library_manager",        ext: "libraries",     defaultAccess: "r", family: "config", describe: "Library manager (TwinCAT)" },
	{ kind: "class_diagram",          ext: "uml",           defaultAccess: "r", family: "config", describe: "UML class diagram (TwinCAT)" },
	{ kind: "external_types",         ext: "exttypes",      defaultAccess: "r", family: "config", describe: "External types (TwinCAT)" },
	// TMC file — the item name already ends in `.tmc` (e.g.
	// `MyProject.tmc`), so we mark `nameIsVerbatim` and the
	// materializer skips the `.${ext}` suffix while the extension
	// still registers in lookup maps for path-based recognition.
	{ kind: "tmc_file", ext: "tmc", defaultAccess: "r", family: "config", describe: "TwinCAT Module Class file", nameIsVerbatim: true },

	// ─── Folder marker — empty engineer-created CODESYS folders ──────
	// Materialized as `<folder>/<name>/.gitkeep` so git preserves the
	// directory. No content; structural drift surfaces via add/remove.
	{ kind: "folder", ext: "", defaultAccess: "r", family: "folder", describe: "Empty engineer folder" },
] as const;

// ─── Computed lookups ────────────────────────────────────────────────

const BY_KIND: ReadonlyMap<string, ExtensionDef> = new Map(
	EXTENSIONS.map((e) => [e.kind, e]),
);

/** Map every reachable extension (with leading dot, lowercased) to a
 *  representative entry. Multiple kinds CAN share an extension — for
 *  example function_block / function / program all use `.st` (plus
 *  `.fbd` / `.ld` / `.sfc` / `.cfc` via language overrides) because
 *  the workspace doesn't need to know which POU sub-kind a `.st`
 *  file is; the bridge owns that classification.
 *
 *  Constraint: kinds sharing an extension MUST agree on
 *  `family` and `defaultAccess`. Otherwise lookups would give
 *  inconsistent answers depending on registration order. The guard
 *  below enforces that, leaving the actual representative-kind
 *  choice deterministic (first match wins). */
/** Per-extension effective access. Built alongside BY_EXT so callers
 *  (access.ts → effectiveAccess) can resolve `.fbd` → `r` even though
 *  its parent kind `function_block` is `defaultAccess: "rw"`. */
const ACCESS_BY_EXT: ReadonlyMap<string, DefaultAccess> = (() => {
	const m = new Map<string, DefaultAccess>();
	const add = (extWithDot: string, access: DefaultAccess, label: string): void => {
		const existing = m.get(extWithDot);
		if (existing !== undefined && existing !== access) {
			throw new Error(
				`extension-registry: extension '${extWithDot}' has incompatible access claims — ` +
					`'${existing}' vs '${access}' (from ${label}). ` +
					`Each extension must resolve to exactly one access mode.`,
			);
		}
		m.set(extWithDot, access);
	};
	for (const def of EXTENSIONS) {
		if (def.ext.length > 0) add(`.${def.ext.toLowerCase()}`, def.defaultAccess, def.kind);
		if (def.languageOverrides !== undefined) {
			for (const [lang, override] of Object.entries(def.languageOverrides)) {
				add(`.${override.ext.toLowerCase()}`, override.access, `${def.kind}/${lang}`);
			}
		}
	}
	return m;
})();

const BY_EXT: ReadonlyMap<string, ExtensionDef> = (() => {
	const m = new Map<string, ExtensionDef>();
	const add = (extWithDot: string, def: ExtensionDef): void => {
		const existing = m.get(extWithDot);
		if (existing === undefined) {
			m.set(extWithDot, def);
			return;
		}
		if (existing.family !== def.family) {
			throw new Error(
				`extension-registry: extension '${extWithDot}' has incompatible family claims — ` +
					`'${existing.kind}' (${existing.family}) vs '${def.kind}' (${def.family}). ` +
					`Extensions can be shared only when family matches.`,
			);
		}
		// Otherwise: same family — keep the first registration as the
		// representative. Access is tracked separately via ACCESS_BY_EXT
		// so a single extension can carry a per-language access mode.
	};
	for (const def of EXTENSIONS) {
		if (def.ext.length > 0) add(`.${def.ext.toLowerCase()}`, def);
		if (def.languageOverrides !== undefined) {
			for (const override of Object.values(def.languageOverrides)) {
				add(`.${override.ext.toLowerCase()}`, def);
			}
		}
	}
	return m;
})();

// ─── Public API ──────────────────────────────────────────────────────

/** Lookup by vendor-neutral kind string. Returns `undefined` for
 *  unregistered kinds; callers should fail loudly per the
 *  no-fallbacks memory rather than silently passing through. */
export function getByKind(kind: string): ExtensionDef | undefined {
	return BY_KIND.get(kind);
}

/** Lookup by extension. `ext` MUST start with a dot. Case-insensitive. */
export function getByExt(ext: string): ExtensionDef | undefined {
	return BY_EXT.get(ext.toLowerCase());
}

/** Lookup by workspace-relative path. Reads the extension off the
 *  path's basename. Returns `undefined` for untracked paths. */
export function getByPath(relPath: string): ExtensionDef | undefined {
	const slash = relPath.lastIndexOf("/");
	const base = slash >= 0 ? relPath.slice(slash + 1) : relPath;
	const dot = base.lastIndexOf(".");
	if (dot < 0) {
		// Edge case: `.gitkeep` and `.gitattributes` are treated as
		// tracked despite having no real extension. Handled by
		// `isTrackedPath`, not here.
		return undefined;
	}
	return getByExt(base.slice(dot));
}

/** Pick the workspace file extension for an item the bridge sent.
 *
 *  Throws when `kind` isn't registered. ALSO throws when `kind` has
 *  `languageOverrides` (source POU) but `language` is missing,
 *  `"UNKNOWN"`, or not in the override map — the bridge must commit
 *  to a real language. Silently falling back to `.st` for an
 *  unclassifiable POU was the exact bug that hid CFC POUs as `.st`
 *  files in the workspace. See `feedback_no_fallbacks` memory. */
export function pickExtension(kind: string, language?: string): string {
	const def = getByKind(kind);
	if (def === undefined) {
		throw new Error(
			`pickExtension: unknown kind '${kind}'. Register it in extension-registry.ts.`,
		);
	}
	if (def.languageOverrides !== undefined) {
		// Source POU kind — language is REQUIRED and must resolve.
		if (language === undefined) {
			throw new Error(
				`pickExtension: kind '${kind}' requires a body language but bridge sent none. ` +
					`Bridge must classify every POU body (no silent ST fallback).`,
			);
		}
		const override = def.languageOverrides[language];
		if (override === undefined) {
			throw new Error(
				`pickExtension: kind '${kind}' has no extension mapping for language '${language}'. ` +
					`Either add the language to extension-registry.ts or skip the item at the materializer.`,
			);
		}
		return override.ext;
	}
	return def.ext;
}

/** Extract the bridge-side item name from a workspace path. Strips
 *  the directory prefix AND the recognized extension. Special-cases
 *  folder markers — they share their parent dir name with the item
 *  name, not the marker filename. Returns `undefined` for untracked
 *  paths. */
export function nameFromPath(relPath: string): string | undefined {
	const slash = relPath.lastIndexOf("/");
	const base = slash >= 0 ? relPath.slice(slash + 1) : relPath;
	// Folder marker: the file lives at `<folder>/<itemName>/.gitkeep`,
	// so the ITEM name is the immediate parent directory.
	if (base === FOLDER_MARKER) {
		const beforeSlash = relPath.lastIndexOf("/", slash - 1);
		if (slash <= 0) return undefined;
		return relPath.slice(beforeSlash + 1, slash);
	}
	const dot = base.lastIndexOf(".");
	if (dot < 0) return undefined;
	const ext = base.slice(dot).toLowerCase();
	const def = getByExt(ext);
	if (def === undefined) return undefined;
	return base.slice(0, dot);
}

/** True iff the path is something Volt manages. Covers every tracked
 *  extension, `.gitkeep` folder markers, and `.gitattributes`. */
export function isTrackedPath(relPath: string): boolean {
	if (relPath.endsWith(`/${FOLDER_MARKER}`) || relPath === FOLDER_MARKER) {
		return true;
	}
	if (relPath === ".gitattributes") return true;
	return getByPath(relPath) !== undefined;
}

/** Every distinct file extension a tracked source-family kind can
 *  produce (including language overrides like `.fbd` / `.ld`).
 *  Used by `gitattributesContent` to apply LF normalization. */
export function sourceExtensions(): readonly string[] {
	const out = new Set<string>();
	for (const def of EXTENSIONS) {
		if (def.family !== "source") continue;
		if (def.ext.length > 0) out.add(`.${def.ext}`);
		if (def.languageOverrides !== undefined) {
			for (const override of Object.values(def.languageOverrides)) {
				out.add(`.${override.ext}`);
			}
		}
	}
	return [...out].sort();
}

/** Effective access for an extension (with leading dot). Returns
 *  `undefined` for extensions not in the registry — caller treats as
 *  "untracked / off". Used by `engine/access.ts` to honor per-language
 *  access modes (`.fbd` defaults to read-only even though its parent
 *  source kind is rw). */
export function accessForExt(ext: string): DefaultAccess | undefined {
	return ACCESS_BY_EXT.get(ext.toLowerCase());
}

/** Every distinct file extension across ALL tracked families.
 *  Mainly for diagnostic / introspection (e.g. CLI help, doc gen). */
export function trackedExtensions(): readonly string[] {
	return [...BY_EXT.keys()].sort();
}

/** Lines for the workspace's `.gitattributes` — LF normalization on
 *  every source extension so cross-platform git diffs stay clean.
 *  Config extensions aren't included because they're written
 *  verbatim and may contain CRLF the bridge produced. */
export function gitattributesContent(): string {
	return sourceExtensions().map((e) => `*${e} text eol=lf`).join("\n") + "\n";
}

/** Marker filename inside empty engineer folders. Conventional
 *  `.gitkeep` so git tools recognize the intent. */
export const FOLDER_MARKER = ".gitkeep";
