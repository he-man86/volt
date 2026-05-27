/**
 * ST file assembler — bridge POU + children → one workspace file.
 *
 * Format: top-level declarations, all in one file per POU. The outer
 * POU (FUNCTION_BLOCK / PROGRAM / FUNCTION / INTERFACE) comes first,
 * then its children (METHOD / ACTION / PROPERTY) as siblings. Parent
 * association is implicit from the file name — `POUs/FB_Motor.st`
 * contains everything related to `FB_Motor`.
 *
 * This format is exactly what `@opencode-ai/volt-lsp-st`'s parser expects,
 * which is why we don't ship our own parser — the LSP package owns
 * structural parsing for the whole project.
 *
 *   import { parseSource } from "@opencode-ai/volt-lsp-st";
 *
 * Assembly is one-way (no parser logic here); it complements parseSource
 * for the bridge → workspace direction.
 */

export type PouKind =
	| "function_block"
	| "function"
	| "program"
	| "interface";

export type ChildKind = "method" | "action" | "property";

export interface AssembleAccessor {
	declaration?: string;
	implementation?: string;
}

export interface AssembleChild {
	kind: ChildKind;
	name: string;
	declaration: string;       // signature + VAR blocks
	implementation?: string;
	getter?: AssembleAccessor;
	setter?: AssembleAccessor;
	/**
	 * In-FB folder this child lives in (e.g. "Modes", "Modes/Sub"). Empty
	 * or undefined means root of the FB. Emitted as a trailing comment
	 * on the signature line — standard ST allows trailing comments and
	 * the LSP parser sees them as benign trivia; we treat them as
	 * load-bearing metadata for round-trip.
	 */
	folder?: string;
}

/** Marker used to encode in-FB folder on a child's signature line. */
export const FOLDER_COMMENT_RE = /\(\*\s*folder\s*:\s*([^*]*?)\s*\*\)/i;
function folderComment(folder: string): string {
	return `(* folder: ${folder} *)`;
}

export interface AssemblePou {
	kind: PouKind;
	declaration: string;       // includes outer keyword line (e.g. "FUNCTION_BLOCK FB_X\nVAR ... END_VAR")
	implementation?: string;
	children?: AssembleChild[];
}

/**
 * Assemble a POU + children into one workspace `.st` file. Deterministic
 * (same input → same bytes) — drives the no-churn skip in `volt import`.
 *
 *   FUNCTION_BLOCK FB_X
 *   VAR ... END_VAR
 *
 *   <body>
 *
 *   END_FUNCTION_BLOCK
 *
 *   METHOD ChildA : BOOL
 *   ...
 *   END_METHOD
 *
 *   ACTION ChildB
 *   ...
 *   END_ACTION
 *
 *   PROPERTY ChildC : INT
 *   GET ... END_GET
 *   SET ... END_SET
 *   END_PROPERTY
 */
export function assemblePou(pou: AssemblePou): string {
	const lines: string[] = [];

	// Outer POU: declaration block + body + END_X.
	lines.push(pou.declaration.replace(/\s+$/, ""));
	const impl = (pou.implementation ?? "").replace(/^\s+|\s+$/g, "");
	if (impl.length > 0) {
		lines.push("");
		lines.push(impl);
	}
	lines.push("");
	lines.push(`END_${pouEndKeyword(pou.kind)}`);

	// Children as top-level siblings. Stable order: methods, then actions,
	// then properties, alphabetical within each kind — keeps diffs stable
	// across re-imports.
	const order: Record<ChildKind, number> = { method: 0, action: 1, property: 2 };
	const sorted = [...(pou.children ?? [])].sort((a, b) => {
		const k = order[a.kind] - order[b.kind];
		return k !== 0 ? k : a.name.localeCompare(b.name);
	});
	for (const child of sorted) {
		lines.push("");
		lines.push(assembleChild(child));
	}

	lines.push(""); // trailing newline
	return lines.join("\n");
}

function pouEndKeyword(kind: PouKind): string {
	switch (kind) {
		case "function_block": return "FUNCTION_BLOCK";
		case "program": return "PROGRAM";
		case "function": return "FUNCTION";
		case "interface": return "INTERFACE";
	}
}

function assembleChild(child: AssembleChild): string {
	if (child.kind === "property") return assembleProperty(child);
	const decl = withFolderAnnotation(child.declaration, child.folder);
	const impl = (child.implementation ?? "").replace(/^\s+|\s+$/g, "");
	const endKw = child.kind === "method" ? "END_METHOD" : "END_ACTION";
	return impl.length === 0 ? `${decl}\n${endKw}` : `${decl}\n${impl}\n${endKw}`;
}

function assembleProperty(child: AssembleChild): string {
	const parts: string[] = [withFolderAnnotation(child.declaration, child.folder)];
	if (child.getter !== undefined) parts.push(assembleAccessor("GET", child.getter));
	if (child.setter !== undefined) parts.push(assembleAccessor("SET", child.setter));
	parts.push("END_PROPERTY");
	return parts.join("\n");
}

/**
 * Inject the `(* folder: X *)` marker on the SIGNATURE line of a
 * METHOD / ACTION / PROPERTY declaration (the line containing the
 * opening keyword + name). No-op when folder is empty/undefined.
 *
 * We can't put it after the whole declaration (which spans multiple
 * lines including VAR blocks) — comment placement on the keyword line
 * is what the parser reads as metadata-on-the-block.
 */
function withFolderAnnotation(declaration: string, folder: string | undefined): string {
	const trimmed = declaration.replace(/\s+$/, "");
	if (folder === undefined || folder.length === 0) return trimmed;
	const lines = trimmed.split("\n");
	const firstLine = lines[0] ?? "";
	// Strip any existing folder annotation before re-adding (idempotent).
	const cleaned = firstLine.replace(FOLDER_COMMENT_RE, "").replace(/\s+$/, "");
	lines[0] = `${cleaned}    ${folderComment(folder)}`;
	return lines.join("\n");
}

function assembleAccessor(keyword: "GET" | "SET", acc: AssembleAccessor): string {
	const decl = (acc.declaration ?? "").replace(/^\s+|\s+$/g, "");
	const impl = (acc.implementation ?? "").replace(/^\s+|\s+$/g, "");
	const lines: string[] = [keyword];
	if (decl.length > 0) lines.push(decl);
	if (impl.length > 0) lines.push(impl);
	lines.push(`END_${keyword}`);
	return lines.join("\n");
}
