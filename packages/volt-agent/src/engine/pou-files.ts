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
 *  1. Interface always → .itf (no body language applies).
 *  2. Pure-declaration kinds (gvl / dut variants) → KIND_EXT.
 *  3. POU body kinds (FB / function / program) → LANG_EXT[language]
 *     when bridge reports a body language; else KIND_EXT (.st).
 */
export function pickExtension(kind: PouKind, language?: string): string {
	if (kind === "interface") return KIND_EXT[kind];
	// POU body kinds = the ones with implementation language. Anything
	// else uses its KIND_EXT directly (gvl/dut/etc.).
	const isBodyKind = kind === "function_block" || kind === "function" || kind === "program";
	if (!isBodyKind) return KIND_EXT[kind] ?? "st";
	if (language !== undefined && LANG_EXT[language] !== undefined) {
		return LANG_EXT[language]!;
	}
	return KIND_EXT[kind] ?? "st";
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

/** Tracked-path check: POU files + our own .gitattributes are ours. */
export function isTrackedPath(relPath: string): boolean {
	return isPouPath(relPath) || relPath === ".gitattributes";
}
