/**
 * POU file-extension helpers — single source of truth for "what counts
 * as a POU file in the workspace" and how to map between bridge item
 * kinds / body languages and on-disk extensions.
 *
 * Everything else in the engine (ops.ts materializer, snapshot.ts walks,
 * pull.ts remove-detection) imports from here so adding a new extension
 * is a one-place change.
 *
 * Two extension families:
 *  - **ST-content** (.st/.gvl/.dut/.itf): parsable ST grammar; pull +
 *    push round-trip via plain text.
 *  - **Graphical** (.fbd/.ld/.sfc/.cfc): textual declaration plus a
 *    PLCopenXML `<body>` block (see `graphical-pou.ts`). Pull + push
 *    round-trip works update-only — creating a NEW graphical POU
 *    from a `.fbd` file isn't supported yet (bridge create_pou path
 *    can't set body language). `isGraphicalPath` flags these files
 *    so the engine routes them through the graphical-aware splitter
 *    rather than treating their content as raw ST.
 */
import type { PouKind } from "../bridge/types.js";

/** Extension per POU kind. POU body kinds may be overridden by LANG_EXT. */
export const KIND_EXT: Record<PouKind, string> = {
	function_block: "st",
	function: "st",
	program: "st",
	interface: "itf",
	gvl: "gvl",
	structure: "dut",
	union: "dut",
	enumeration: "dut",
	alias: "dut",
};

/**
 * Per-kind extensions for non-source bridge items.
 *
 * Most are CODESYS-native conventions (.visu / .recipes / .libraries /
 * .textlist / .imagepool / .task) that PLC engineers recognize on
 * sight. Both bridges classify their items into the same vendor-
 * neutral kind vocabulary below; mismatched kinds fall through to
 * `config` → `.xml` (catch-all).
 *
 * Special case: `tmc_file` → empty extension. The item name already
 * ends in `.tmc` (it's a TwinCAT Module Class file like
 * `MyProject.tmc`), so appending `.xml` produces the ugly double
 * `MyProject.tmc.xml`. Empty ext means "use the item name verbatim".
 */
export const CONFIG_KIND_EXT: Record<string, string> = {
	// ─── Leaf items — recognizable per-kind extensions ────────────
	// These are the "atomic" config items a PLC engineer edits or
	// touches: one visualization, one task, one library reference.
	visualization: "visu",
	image_pool: "imagepool",
	text_list: "textlist",
	task: "task",
	library: "library",
	class_diagram: "uml",
	device: "device",
	trace: "trace",
	cam: "cam",

	// ─── Manager / container kinds — plain `.xml` ─────────────────
	// Library Manager / Visualization Manager / Recipe Manager /
	// Alarm Configuration are mostly wrappers around their children.
	// Giving them a dedicated extension that mirrors the leaf kind's
	// (.libraries vs .library, .visu vs .visu) reads as duplication
	// next to the sibling folder; plain .xml keeps the manager file
	// visually distinct from its child folder.
	visualization_manager: "xml",
	library_manager: "xml",
	recipe_manager: "xml",
	alarm_configuration: "xml",

	// ─── TwinCAT-specific ────────────────────────────────────────
	tmc_file: "",  // item name already ends with .tmc
	external_types: "xml",

	// Generic catch-all for unmapped non-source kinds.
	config: "xml",
};

/** Catch-all extension for any non-source kind without an explicit mapping. */
const CONFIG_FALLBACK_EXT = "xml";

/** Extension per body language. Applies to POU body kinds only. */
const LANG_EXT: Record<string, string> = {
	ST: "st",
	FBD: "fbd",
	LD: "ld",
	SFC: "sfc",
	CFC: "cfc",
	UNKNOWN: "st",
};

/** Every extension this workspace recognizes as a POU file. */
export const POU_EXTENSIONS = [".st", ".gvl", ".dut", ".itf", ".fbd", ".ld", ".sfc", ".cfc"] as const;

/** Every extension the workspace recognizes as a non-source config file.
 *  Includes `.tmc` because the `tmc_file` kind uses the item's own
 *  trailing `.tmc` instead of appending an extension; we still need
 *  to recognize the path as ours during tracked-path checks. */
export const CONFIG_EXTENSIONS = Array.from(
	new Set([
		...Object.values(CONFIG_KIND_EXT).filter((e) => e.length > 0).map((e) => `.${e}`),
		".tmc",
	]),
);

/** Graphical-language extensions — files with PLCopenXML body block. */
const GRAPHICAL_EXTENSIONS = [".fbd", ".ld", ".sfc", ".cfc"] as const;

/** True if a workspace-relative path is a POU file (any recognized ST or graphical extension). */
function isPouPath(path: string): boolean {
	return POU_EXTENSIONS.some((e) => path.endsWith(e));
}

/**
 * True if the path is a graphical-language POU. Used to route the
 * file through `extractGraphicalBody` during push so the embedded
 * PLCopenXML body gets sent as `implementationXml` (not crammed
 * into `sourceText` where StSplitter would choke on the XML).
 */
export function isGraphicalPath(path: string): boolean {
	return GRAPHICAL_EXTENSIONS.some((e) => path.endsWith(e));
}

/**
 * Extract the POU name from a workspace-relative path. Strips folder
 * prefix and recognized extension. Returns undefined if the path
 * isn't a POU file.
 */
export function nameFromPouPath(path: string): string | undefined {
	const slash = path.lastIndexOf("/");
	const base = slash >= 0 ? path.slice(slash + 1) : path;
	for (const ext of POU_EXTENSIONS) {
		if (base.endsWith(ext)) return base.slice(0, -ext.length);
	}
	return undefined;
}

/**
 * Pick the file extension for an item.
 *
 *  1. Config item → `.xml` (opaque passthrough, see CONFIG_EXT).
 *  2. Interface → .itf (no body language applies).
 *  3. Pure-declaration kinds (gvl / dut variants) → KIND_EXT.
 *  4. POU body kinds (FB / function / program) → LANG_EXT[language]
 *     when bridge reports a body language; else KIND_EXT (.st).
 */
export function pickExtension(kind: string, language?: string): string {
	// Config items short-circuit the POU dispatch entirely. Lookup the
	// per-kind extension (visualization → visu, recipe_manager → recipes,
	// etc.); unknown config-family kinds fall back to plain `.xml`.
	if (isConfigKind(kind)) {
		const explicit = CONFIG_KIND_EXT[kind];
		if (explicit !== undefined) return explicit;
		return CONFIG_FALLBACK_EXT;
	}
	const pouKind = kind as PouKind;
	if (pouKind === "interface") return KIND_EXT[pouKind];
	const isBodyKind = pouKind === "function_block" || pouKind === "function" || pouKind === "program";
	if (!isBodyKind) return KIND_EXT[pouKind] ?? "st";
	if (language !== undefined && LANG_EXT[language] !== undefined) {
		return LANG_EXT[language]!;
	}
	return KIND_EXT[pouKind] ?? "st";
}

/** Lines for the workspace's .gitattributes (LF normalization for every POU ext). */
export function gitattributesContent(): string {
	return POU_EXTENSIONS.map((e) => `*${e} text eol=lf`).join("\n") + "\n";
}

/**
 * Validate a bridge-supplied `kind` string against the set of POU kinds
 * the materializer knows how to handle. Returns the string typed as
 * PouKind when valid, undefined otherwise — the caller
 * should fail loudly on undefined (the wire shape is strict: every
 * item the bridge returns must have a recognized kind).
 *
 * The canonical kind vocabulary is shared with the C# bridge's
 * BlockTypeMapper.ToNodeType — vendor-agnostic by design.
 */
const KNOWN_KINDS: ReadonlySet<PouKind> = new Set([
	"function_block",
	"function",
	"program",
	"interface",
	"gvl",
	"structure",
	"union",
	"enumeration",
	"alias",
]);

export function asPouKind(kind: string): PouKind | undefined {
	return (KNOWN_KINDS as ReadonlySet<string>).has(kind) ? (kind as PouKind) : undefined;
}

/** True iff the bridge's `kind` is a non-source kind that gets
 *  materialized as a passthrough file (either dedicated per-kind
 *  extension like `.visu` / `.recipes`, or generic `.xml` fallback). */
export function isConfigKind(kind: string): boolean {
	return CONFIG_KIND_EXT[kind] !== undefined;
}

/** True iff the bridge's `kind` is an empty-folder marker. Materialized
 *  as `<folder>/<name>/.gitkeep` so git preserves the directory. */
export function isFolderKind(kind: string): boolean {
	return kind === "folder";
}

/** Marker filename written inside empty CODESYS folders. `.gitkeep` is
 *  the widely-recognized convention for "keep this otherwise-empty
 *  directory in git". Folders with real content don't get one. */
export const FOLDER_MARKER = ".gitkeep";

/** True if path uses a recognized non-source config extension. */
function isConfigPath(path: string): boolean {
	return CONFIG_EXTENSIONS.some((e) => path.endsWith(e));
}

/** True if path is a folder-marker file (`.../.gitkeep`). */
function isFolderMarkerPath(path: string): boolean {
	return path === FOLDER_MARKER || path.endsWith("/" + FOLDER_MARKER);
}

/** Tracked-path check: POU files + config files + folder markers +
 *  .gitattributes are ours. */
export function isTrackedPath(relPath: string): boolean {
	return (
		isPouPath(relPath) ||
		isConfigPath(relPath) ||
		isFolderMarkerPath(relPath) ||
		relPath === ".gitattributes"
	);
}
