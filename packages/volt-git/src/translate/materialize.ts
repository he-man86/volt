/**
 * Item ⇄ file translation. One IDE item = one workspace file (src-relative path). The bridge already
 * materialized graphical FBD/LD bodies as VG (CFC/SFC read-only), so this layer is pure path/content
 * mapping — no PLC knowledge.
 */
import type { FetchedItem } from "../bridge/types.js";
import { defFromName, fullNameFromPath, FOLDER_MARKER } from "../registry/extensions.js";

export interface MaterializedFile {
	/** src-RELATIVE path, e.g. "POUs/FB_Motor.st" (no leading "src/"). */
	path: string;
	content: string;
}

function joinPath(...parts: string[]): string {
	return parts.filter((p) => p.length > 0).join("/");
}

/** IDE item → src-relative workspace file(s). A folder item (extension "") becomes a `.gitkeep` marker. */
export function materializeItem(item: FetchedItem): MaterializedFile[] {
	const folder = item.folder ?? "";
	const name = item.name; // includes extension
	const def = defFromName(name);
	if (!def) throw new Error(`unrecognized extension in "${name}" — add it to registry/extensions.ts`);
	if (def.ext.length === 0) return [{ path: joinPath(folder, name, FOLDER_MARKER), content: "" }];
	return [{ path: joinPath(folder, name), content: item.sourceText }];
}

/** A src-relative workspace path → its bridge wire name + containing folder. undefined if untracked. */
export function pathToItem(relPath: string): { name: string; folder: string } | undefined {
	const name = fullNameFromPath(relPath);
	if (name === undefined) return undefined;
	const slash = relPath.lastIndexOf("/");
	return { name, folder: slash >= 0 ? relPath.slice(0, slash) : "" };
}
