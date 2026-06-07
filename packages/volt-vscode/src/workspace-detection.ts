/**
 * Pure-logic helpers for detecting state changes in a Volt workspace.
 *
 * Isolated here (no vscode imports) so they're testable under `bun test`
 * without a full VS Code extension-host harness.
 *
 * Two detection sources back the SCM tree refresh:
 *   1. `readStateMtime` — `.volt/snapshot/state.json` mtime, polled by
 *      `VoltWorkspace.pollStateMtime` to catch external CLI mutations
 *      (`volt pull` run from a terminal). state.json is touched by every
 *      mutating CLI verb, and statSync is reliable on OneDrive-synced
 *      folders where VS Code's FileSystemWatcher silently drops bulk-write
 *      events.
 *   2. `isPouFile` — extension filter used by the `onDidSaveTextDocument`
 *      listener so an editor save on a tracked PLC source triggers an
 *      outgoing-change refresh. The list mirrors what volt-agent
 *      materializes — see engine/extension-registry.ts.
 */
import { statSync } from "node:fs";
import { join } from "node:path";

/** PLC source extensions Volt syncs from the IDE. Editor saves on these
 *  paths trigger an outgoing-change refresh. Keep in sync with volt-agent
 *  engine/extension-registry.ts. */
const POU_EXTENSIONS = new Set([
	"st", "gvl",
	"struct", "enum", "union", "alias",
	"itf",
	"fbd", "ld", "sfc", "cfc",
]);

/** True when this file path's extension is one Volt tracks as a PLC
 *  source. Case-insensitive — Windows paths arrive in mixed case. */
export function isPouFile(fileName: string): boolean {
	const idx = fileName.lastIndexOf(".");
	if (idx < 0) return false;
	return POU_EXTENSIONS.has(fileName.slice(idx + 1).toLowerCase());
}

/** Read the current mtime (ms since epoch) of `.volt/snapshot/state.json`
 *  under the given workspace root. Returns 0 when the file doesn't exist
 *  or is unreadable. Callers compare against a cached previous value to
 *  detect external mutations between polls. */
export function readStateMtime(workspaceRoot: string): number {
	try {
		return statSync(join(workspaceRoot, ".volt", "snapshot", "state.json")).mtimeMs;
	} catch {
		return 0;
	}
}
